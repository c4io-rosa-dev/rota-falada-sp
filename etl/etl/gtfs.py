"""ETL do GTFS da SPTrans para `parada` e `linha`.

O feed é baixado anonimamente (sem autenticação) de uma URL **http**, não
https (confirmado em 08/09/2026, ver `docs/pesquisa/2026-09-08-sptrans.md`).
O feed atual não traz nenhum campo de acessibilidade (`wheelchair_boarding`,
`wheelchair_accessible`) nem os arquivos `pathways.txt`/`levels.txt`/
`calendar_dates.txt`; se um dia passar a trazer, o escopo do projeto precisa
ser revisto — por isso `executar` falha alto em vez de ignorar em silêncio.
"""

import zipfile
from datetime import date
from email.utils import parsedate_to_datetime

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import Point
from shapely.ops import unary_union
from sqlalchemy import Engine, text

from etl.config import AREA_PILOTO, DIR_DADOS, UA, URL_GTFS
from etl.db import concluir_execucao, fonte_id, registrar_execucao
from etl.download import baixar
from etl.geo import bbox_para_poligono

CAMINHO_ZIP = DIR_DADOS / "gtfs-sptrans.zip"

# arquivos/campos de acessibilidade que o feed não tem hoje (ver docstring do
# módulo); `_verificar_sem_campos_de_acessibilidade` falha alto se aparecerem.
ARQUIVOS_ACESSIBILIDADE = {"pathways.txt", "levels.txt", "calendar_dates.txt"}
CAMPOS_ACESSIBILIDADE = {
    "stops.txt": {"wheelchair_boarding"},
    "routes.txt": {"wheelchair_accessible"},
}


class GtfsComCamposDeAcessibilidade(Exception):
    """O feed passou a trazer arquivo(s)/campo(s) de acessibilidade que o
    escopo do projeto não previa (ver `etl/README.md`); revisar antes de
    seguir em vez de carregar dados que o resto do sistema ainda ignora."""


def _verificar_sem_campos_de_acessibilidade(caminho_zip) -> None:
    with zipfile.ZipFile(caminho_zip) as zf:
        nomes = set(zf.namelist())
        arquivos_inesperados = ARQUIVOS_ACESSIBILIDADE & nomes
        if arquivos_inesperados:
            raise GtfsComCamposDeAcessibilidade(
                f"arquivo(s) de acessibilidade inesperado(s) no feed GTFS: "
                f"{sorted(arquivos_inesperados)}"
            )
        for arquivo, campos in CAMPOS_ACESSIBILIDADE.items():
            if arquivo not in nomes:
                continue
            with zf.open(arquivo) as f:
                cabecalho = f.readline().decode("utf-8-sig")
            colunas = {
                coluna.strip().strip('"') for coluna in cabecalho.strip().split(",")
            }
            campos_inesperados = campos & colunas
            if campos_inesperados:
                raise GtfsComCamposDeAcessibilidade(
                    f"campo(s) de acessibilidade inesperado(s) em {arquivo}: "
                    f"{sorted(campos_inesperados)}"
                )


def _data_referencia_zip(url: str) -> date:
    """Data do zip pelo cabeçalho `Last-Modified`; hoje se indisponível."""
    try:
        resposta = requests.head(
            url, headers={"User-Agent": UA}, timeout=30, allow_redirects=True
        )
        ultima_modificacao = resposta.headers.get("Last-Modified")
        if ultima_modificacao:
            return parsedate_to_datetime(ultima_modificacao).date()
    except requests.RequestException:
        pass
    return date.today()  # noqa: DTZ011 — data_referencia é DATE (sem fuso), não timestamp


def _dentro_da_area_piloto(pontos: list[Point]) -> list[bool]:
    uniao_piloto = unary_union(
        [bbox_para_poligono(bbox) for bbox in AREA_PILOTO.values()]
    )
    return [ponto.within(uniao_piloto) for ponto in pontos]


def executar(engine: Engine) -> dict:
    """Baixa (ou reaproveita) o GTFS da SPTrans e carrega `parada` (só as do
    piloto) e `linha` (todas, são poucas)."""
    execucao_id = registrar_execucao(engine, "gtfs")
    try:
        caminho = baixar(URL_GTFS, CAMINHO_ZIP, tamanho_minimo=5_000_000)
        _verificar_sem_campos_de_acessibilidade(caminho)
        data_ref = _data_referencia_zip(URL_GTFS)

        with zipfile.ZipFile(caminho) as zf:
            with zf.open("stops.txt") as f:
                stops = pd.read_csv(
                    f,
                    usecols=["stop_id", "stop_name", "stop_lat", "stop_lon"],
                    dtype={"stop_id": str},
                )
            with zf.open("routes.txt") as f:
                routes = pd.read_csv(
                    f,
                    usecols=["route_id", "route_short_name", "route_long_name"],
                    dtype={"route_id": str},
                )

        fid = fonte_id(engine, "sptrans")

        pontos = [
            Point(longitude, latitude)
            for latitude, longitude in zip(
                stops["stop_lat"], stops["stop_lon"], strict=True
            )
        ]
        dentro = _dentro_da_area_piloto(pontos)
        stops_piloto = stops[dentro].reset_index(drop=True)
        pontos_piloto = [
            ponto
            for ponto, esta_dentro in zip(pontos, dentro, strict=True)
            if esta_dentro
        ]

        gdf_paradas = gpd.GeoDataFrame(
            {
                "stop_id": stops_piloto["stop_id"],
                "nome": stops_piloto["stop_name"],
                "fonte_id": fid,
                "data_referencia": data_ref,
            },
            geometry=pontos_piloto,
            crs="EPSG:4326",
        ).rename_geometry("geom")

        # `route_short_name` é a coluna que mapeia para `nome_curto` (NOT
        # NULL); no feed real ela nunca vem vazia, mas se um trimestre futuro
        # tiver linha sem código curto, cai para o nome longo ou o próprio id.
        nome_curto = (
            routes["route_short_name"]
            .fillna(routes["route_long_name"])
            .fillna(routes["route_id"])
        )
        df_linhas = pd.DataFrame(
            {
                "route_id": routes["route_id"],
                "nome_curto": nome_curto,
                "nome_longo": routes["route_long_name"],
                "fonte_id": fid,
                "data_referencia": data_ref,
            }
        )

        with engine.begin() as conexao:
            conexao.execute(text("DELETE FROM linha"))
            conexao.execute(text("DELETE FROM parada"))
            gdf_paradas.to_postgis("parada", conexao, if_exists="append", index=False)
            df_linhas.to_sql("linha", conexao, if_exists="append", index=False)

        resultado = {"paradas": len(gdf_paradas), "linhas": len(df_linhas)}
        # `etl_execucao.linhas` é genérico ("linhas carregadas"), não a tabela
        # `linha`: soma as duas para refletir o total de registros da fonte.
        concluir_execucao(
            engine, execucao_id, "ok", linhas=resultado["paradas"] + resultado["linhas"]
        )
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
