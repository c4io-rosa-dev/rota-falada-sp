"""ETL das calçadas do GeoSampa (WFS paginado) para `calcada_sp`.

O WFS do GeoSampa trunca resultado em silêncio (HTTP 200, sem qualquer aviso)
se a paginação não verificar `numberReturned` contra `numberMatched`; por
isso `paginar` nunca conclui que terminou só porque uma página veio menor que
`count` — ele soma o `numberReturned` de todas as páginas e compara com o
`numberMatched` reportado ao final, levantando `TruncamentoWFS` se a soma não
bater. A paginação WFS 2.0 exige `sortBy` explícito para ser estável entre
páginas; testado manualmente em 14/09/2026 contra o serviço real:
`sortBy=cd_identificador_calcada` funciona direto (sem precisar do sufixo
`+A` nem de subdividir a bbox — ver `etl/README.md`).
"""

import re
import time
from datetime import date

import geopandas as gpd
import requests
from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union
from sqlalchemy import Engine, text

from etl.config import AREA_PILOTO, UA, URL_GEOSAMPA_WFS
from etl.db import concluir_execucao, fonte_id, registrar_execucao
from etl.geo import bbox_para_poligono

TYPE_NAME = "geoportal:calcada"

# Data de publicação do levantamento de calçadas do GeoSampa (fixa: a fonte
# não versiona por data de download, e sim por data de referência do
# levantamento em si — ver Task 1 do plano).
DATA_REFERENCIA = date(2021, 8, 13)


class TruncamentoWFS(Exception):
    """O WFS devolveu menos feições do que `numberMatched` indicava."""


def _bbox_str(bbox: tuple[float, float, float, float]) -> str:
    oeste, sul, leste, norte = bbox
    return f"{oeste},{sul},{leste},{norte},EPSG:4326"


def contar(bbox: tuple[float, float, float, float], sessao=None) -> int:
    """Número de feições que o WFS reporta para `bbox` (`resultType=hits`).

    O GeoServer devolve XML mesmo com `outputFormat=application/json` quando
    `resultType=hits` (não há feições para serializar como JSON), daí o
    regex sobre o corpo da resposta em vez de `response.json()`.
    """
    sessao = sessao or requests
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": TYPE_NAME,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "bbox": _bbox_str(bbox),
        "resultType": "hits",
    }
    resposta = sessao.get(URL_GEOSAMPA_WFS, params=params, headers={"User-Agent": UA}, timeout=120)
    resposta.raise_for_status()
    correspondencia = re.search(r'numberMatched="(\d+)"', resposta.text)
    if not correspondencia:
        raise TruncamentoWFS(f"resposta de contagem sem numberMatched: {resposta.text[:300]!r}")
    return int(correspondencia.group(1))


def paginar(bbox: tuple[float, float, float, float], count: int = 2000, sessao=None):
    """Itera todas as feições GeoJSON de `bbox`, paginando por `startIndex`.

    Levanta `TruncamentoWFS` ao final se a soma de `numberReturned` de todas
    as páginas não bater com o `numberMatched` reportado pelo WFS.
    """
    sessao = sessao or requests
    bbox_str = _bbox_str(bbox)
    start_index = 0
    total_retornado = 0
    numero_esperado = None

    while True:
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeName": TYPE_NAME,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
            "bbox": bbox_str,
            "count": count,
            "startIndex": start_index,
            "sortBy": "cd_identificador_calcada",
        }
        resposta = sessao.get(
            URL_GEOSAMPA_WFS, params=params, headers={"User-Agent": UA}, timeout=120
        )
        resposta.raise_for_status()
        dados = resposta.json()
        numero_esperado = dados["numberMatched"]
        retornadas = dados["numberReturned"]
        total_retornado += retornadas

        yield from dados["features"]

        if retornadas == 0 or retornadas < count:
            break
        start_index += retornadas
        time.sleep(1)

    if total_retornado != numero_esperado:
        raise TruncamentoWFS(
            f"bbox {bbox_str}: numberReturned somou {total_retornado}, "
            f"numberMatched era {numero_esperado}"
        )


def _numero(valor) -> float:
    """Converte para `float`; nulo ou não numérico vira 0.

    A semântica oficial do GeoSampa é "0 = não medido" (não uma medição
    real de largura/declividade zero); as colunas geradas `largura_medida`/
    `declividade_medida` do banco cuidam de distinguir os dois casos.
    """
    if valor is None:
        return 0.0
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def _texto(valor) -> str | None:
    return None if valor is None else str(valor)


def _multipoligono(geometria: dict) -> MultiPolygon:
    geom = shape(geometria)
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    return geom


def _dentro_da_area_piloto(registros: list[dict]) -> list[dict]:
    """Mantém só registros cuja geometria de fato intersecta a união das três
    `area_piloto`. O filtro `bbox` do WFS testa a caixa delimitadora da
    feição contra a bbox pedida (não a geometria exata): um polígono cuja
    borda fica fora do recorte, mas cuja bbox toca a bbox da consulta, ainda
    é devolvido — sem este filtro final ele violaria a garantia de que toda
    linha de `calcada_sp` está dentro da área piloto."""
    uniao_piloto = unary_union([bbox_para_poligono(bbox) for bbox in AREA_PILOTO.values()])
    return [registro for registro in registros if registro["geometry"].intersects(uniao_piloto)]


def _mapear_feature(feature: dict) -> dict:
    propriedades = feature["properties"]
    return {
        "cd_identificador_calcada": _texto(propriedades.get("cd_identificador_calcada")),
        "cd_setor_quadra": _texto(propriedades.get("cd_setor_quadra")),
        "nm_logradouro": _texto(propriedades.get("nm_logradouro")),
        "qt_area_m2": _numero(propriedades.get("qt_area_calcada")),
        "largura_min_m": _numero(propriedades.get("qt_largura_minima_trecho")),
        "largura_max_m": _numero(propriedades.get("qt_largura_maxima_trecho")),
        "largura_media_m": _numero(propriedades.get("qt_largura_media_trecho")),
        "declividade_min_pct": _numero(propriedades.get("pc_declividade_minima_trecho")),
        "declividade_max_pct": _numero(propriedades.get("pc_declividade_maxima_trecho")),
        "declividade_media_pct": _numero(propriedades.get("pc_declividade_media_trecho")),
        "tx_situacao": _texto(propriedades.get("tx_situacao")),
        "tx_plano_emergencial": _texto(propriedades.get("tx_plano_emergencial_calcada")),
        "geometry": _multipoligono(feature["geometry"]),
    }


def executar(engine: Engine) -> dict:
    """Baixa (via WFS paginado) e carrega as calçadas do GeoSampa das três
    áreas piloto em `calcada_sp`.

    Deduplica por `cd_identificador_calcada`: as bboxes de Ipiranga e Vila
    Mariana se sobrepõem num pequeno canto (definidas de forma independente
    no Plano 2), então a mesma calçada é devolvida por mais de uma consulta
    de bbox nessa faixa — sem dedup ela entraria duas vezes em `calcada_sp`.
    `linhas`, gravado em `etl_execucao`, é a contagem **bruta** (antes do
    dedup): o que valida a ausência de truncamento do WFS é a soma de
    feições recebidas bater com `numberMatched`, não o total após dedup.
    """
    execucao_id = registrar_execucao(engine, "geosampa")
    try:
        sessao = requests.Session()
        vistas: dict[str, dict] = {}
        sem_identificador: list[dict] = []
        esperado_total = 0
        recebidas_total = 0

        for bbox in AREA_PILOTO.values():
            esperado_total += contar(bbox, sessao=sessao)
            for feature in paginar(bbox, sessao=sessao):
                recebidas_total += 1
                registro = _mapear_feature(feature)
                chave = registro["cd_identificador_calcada"]
                if chave is None:
                    sem_identificador.append(registro)
                else:
                    vistas[chave] = registro

        registros = _dentro_da_area_piloto([*vistas.values(), *sem_identificador])
        fid = fonte_id(engine, "geosampa")
        for registro in registros:
            registro["fonte_id"] = fid
            registro["data_referencia"] = DATA_REFERENCIA

        gdf = gpd.GeoDataFrame(registros, geometry="geometry", crs="EPSG:4326")
        gdf = gdf.rename_geometry("geom")

        with engine.begin() as conexao:
            conexao.execute(text("DELETE FROM calcada_sp"))
            gdf.to_postgis("calcada_sp", conexao, if_exists="append", index=False)

        resultado = {"calcadas": len(gdf), "esperado": esperado_total}
        concluir_execucao(
            engine, execucao_id, "ok", linhas=recebidas_total, esperado=esperado_total
        )
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
