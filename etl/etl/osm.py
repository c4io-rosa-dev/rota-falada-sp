"""ETL do grafo de pedestres do OpenStreetMap para `no_pedestre`/`via_pedestre`.

Não usamos `osm2pgsql` porque ele não divide as vias nos cruzamentos (sem
`source`/`target` por nó, exigido pelo pgRouting); o grafo é montado com
`osmium` (recorte e filtro de tags, em C++, rápido no PBF inteiro) seguido de
`osmnx` (topologia). Ver `docs/adr/002-grafo-com-osmnx.md`.
"""

import math
import subprocess
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path

import geopandas as gpd
import networkx as nx
import osmnx as ox
import requests
from shapely.ops import unary_union
from sqlalchemy import Engine, text

from etl.config import AREA_PILOTO, BBOX_UNIAO, DIR_DADOS, UA, URL_GEOFABRIK
from etl.db import concluir_execucao, fonte_id, registrar_execucao
from etl.download import baixar
from etl.geo import bbox_para_poligono, comprimento_m
from etl.osm_regras import (
    classificar_kerb,
    eh_via_de_pedestre,
    esquema_calcada,
    fator_custo,
)

# Tags relevantes para acessibilidade: osmnx descarta qualquer outra tag ao
# ler o XML, o que mantém o grafo pequeno.
TAGS_UTEIS_VIA = [
    "highway",
    "footway",
    "sidewalk",
    "wheelchair",
    "surface",
    "smoothness",
    "width",
    "incline",
    "name",
    "foot",
    "access",
    "step_count",
    "ramp",
    "ramp:wheelchair",
    "crossing",
    "tactile_paving",
    "lit",
]
TAGS_UTEIS_NO = ["highway", "kerb", "tactile_paving", "crossing", "wheelchair", "barrier"]

# atributos que, ao diferirem entre segmentos consecutivos, impedem o osmnx de
# fundi-los num único trecho simplificado (perderíamos informação de
# acessibilidade se um trecho com guia baixa fosse fundido com um sem guia).
ATRIBUTOS_QUE_DIFEREM = [
    "highway",
    "footway",
    "sidewalk",
    "wheelchair",
    "surface",
    "smoothness",
    "width",
    "incline",
    "name",
]

PBF_PADRAO = "sudeste-latest.osm.pbf"


def _valor(x):
    """Osmnx guarda como lista o valor de tags que variaram na simplificação
    de um trecho (várias vias originais viraram uma aresta); usamos sempre o
    primeiro valor, e `None`/NaN vira `None`."""
    if isinstance(x, list):
        return x[0] if x else None
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return None
    except TypeError:
        pass
    return x


def _parse_width(valor) -> float | None:
    """Converte a tag `width` (ex.: "1.5", "1,5", "1.5 m") em metros."""
    valor = _valor(valor)
    if not valor:
        return None
    texto = str(valor).strip().lower().replace(",", ".").replace("m", "").strip()
    try:
        return float(texto)
    except ValueError:
        return None


def _data_referencia_pbf(url: str) -> date:
    """Data do PBF pelo cabeçalho `Last-Modified`; hoje se indisponível."""
    try:
        resposta = requests.head(url, headers={"User-Agent": UA}, timeout=30, allow_redirects=True)
        ultima_modificacao = resposta.headers.get("Last-Modified")
        if ultima_modificacao:
            return parsedate_to_datetime(ultima_modificacao).date()
    except requests.RequestException:
        pass
    return date.today()  # noqa: DTZ011 — data_referencia é DATE (sem fuso), não timestamp


def _executar_osmium(*args: str) -> None:
    subprocess.run(["osmium", *args], check=True, capture_output=True, text=True)


def _extrair_piloto(pbf_completo: Path) -> Path:
    """Recorta o PBF do sudeste para a área piloto e converte para XML.

    `osmium extract -s smart` mantém inteiras as vias que cruzam a borda do
    recorte (deixa "sobras" fora da área piloto exata, removidas depois pelo
    filtro geométrico com `area_piloto`). `tags-filter w/highway` descarta
    tudo que não é via (e mantém os nós referenciados pelas vias mantidas).
    """
    bbox_str = ",".join(str(v) for v in BBOX_UNIAO)
    piloto_pbf = DIR_DADOS / "piloto.osm.pbf"
    piloto_vias_pbf = DIR_DADOS / "piloto-vias.osm.pbf"
    piloto_xml = DIR_DADOS / "piloto-vias.osm"

    _executar_osmium(
        "extract",
        "--bbox",
        bbox_str,
        "-s",
        "smart",
        str(pbf_completo),
        "-o",
        str(piloto_pbf),
        "--overwrite",
    )
    _executar_osmium(
        "tags-filter",
        str(piloto_pbf),
        "w/highway",
        "-o",
        str(piloto_vias_pbf),
        "--overwrite",
    )
    _executar_osmium("cat", str(piloto_vias_pbf), "-o", str(piloto_xml), "--overwrite")
    return piloto_xml


def _montar_grafo(caminho_xml: Path) -> nx.MultiDiGraph:
    ox.settings.useful_tags_way = TAGS_UTEIS_VIA
    ox.settings.useful_tags_node = TAGS_UTEIS_NO

    grafo = ox.graph_from_xml(caminho_xml, bidirectional=True, simplify=False, retain_all=True)

    arestas_fora_do_pedestre = [
        (u, v, k)
        for u, v, k, dados in grafo.edges(keys=True, data=True)
        if not eh_via_de_pedestre({chave: _valor(valor) for chave, valor in dados.items()})
    ]
    grafo.remove_edges_from(arestas_fora_do_pedestre)
    grafo.remove_nodes_from(list(nx.isolates(grafo)))

    return ox.simplification.simplify_graph(grafo, edge_attrs_differ=ATRIBUTOS_QUE_DIFEREM)


def _preencher_colunas(df, colunas: list[str]) -> None:
    for coluna in colunas:
        if coluna not in df.columns:
            df[coluna] = None


def _recortar_para_area_piloto(nos: gpd.GeoDataFrame, arestas: gpd.GeoDataFrame):
    """Mantém só nós dentro da área piloto e arestas cujas duas extremidades
    sobreviveram ao recorte — garante que todo `source`/`target` gravado tem
    o nó correspondente em `no_pedestre` e que nenhuma coordenada escapa da
    área piloto (o `-s smart` do osmium traz sobras fora dela)."""
    uniao_piloto = unary_union([bbox_para_poligono(bbox) for bbox in AREA_PILOTO.values()])

    nos_no_piloto = nos[nos.geometry.within(uniao_piloto)]
    arestas_no_piloto = arestas[
        arestas["u"].isin(nos_no_piloto.index) & arestas["v"].isin(nos_no_piloto.index)
    ]
    return nos_no_piloto, arestas_no_piloto


def _gdf_nos(nos: gpd.GeoDataFrame, fid: int, data_ref: date) -> gpd.GeoDataFrame:
    _preencher_colunas(nos, TAGS_UTEIS_NO)
    registros = gpd.GeoDataFrame(
        {
            "id": [int(osmid) for osmid in nos.index],
            "kerb": [_valor(v) for v in nos["kerb"]],
            "tactile_paving": [_valor(v) for v in nos["tactile_paving"]],
            "crossing": [_valor(v) for v in nos["crossing"]],
            "wheelchair": [_valor(v) for v in nos["wheelchair"]],
            "barrier": [_valor(v) for v in nos["barrier"]],
            "fonte_id": fid,
            "data_referencia": data_ref,
        },
        geometry=list(nos.geometry),
        crs="EPSG:4326",
    )
    # a coluna geométrica das tabelas oficiais chama-se `geom`, não o padrão
    # `geometry` do GeoDataFrame — sem isso o `to_postgis` grava na coluna
    # errada (e falha, pois `geometry` não existe na tabela).
    return registros.rename_geometry("geom")


def _gdf_arestas(
    arestas: gpd.GeoDataFrame, nos: gpd.GeoDataFrame, fid: int, data_ref: date
) -> gpd.GeoDataFrame:
    _preencher_colunas(arestas, [*ATRIBUTOS_QUE_DIFEREM, "osmid", "foot", "access"])

    linhas = []
    for _, linha in arestas.iterrows():
        tags = {
            "highway": _valor(linha["highway"]),
            "footway": _valor(linha["footway"]),
            "sidewalk": _valor(linha["sidewalk"]),
            "wheelchair": _valor(linha["wheelchair"]),
            "surface": _valor(linha["surface"]),
            "smoothness": _valor(linha["smoothness"]),
        }
        kerb_u = _valor(nos.loc[linha["u"], "kerb"])
        kerb_v = _valor(nos.loc[linha["v"], "kerb"])
        kerb, kerb_transponivel = classificar_kerb([kerb_u, kerb_v])
        comprimento = comprimento_m(linha.geometry)
        custo = comprimento * fator_custo(tags, kerb_transponivel)

        linhas.append(
            {
                "osmid": _valor(linha["osmid"]),
                "source": int(linha["u"]),
                "target": int(linha["v"]),
                "highway": tags["highway"],
                "footway": tags["footway"],
                "sidewalk": tags["sidewalk"],
                "esquema_calcada": esquema_calcada(tags),
                "is_degrau": tags["highway"] == "steps",
                "kerb": kerb,
                "kerb_transponivel": kerb_transponivel,
                "wheelchair": tags["wheelchair"],
                "surface": tags["surface"],
                "smoothness": tags["smoothness"],
                "incline": _valor(linha["incline"]),
                "width_m": _parse_width(linha["width"]),
                "nome": _valor(linha["name"]),
                "comprimento_m": comprimento,
                "custo_acessivel": custo,
                "custo_reverso": custo,
                "fonte_id": fid,
                "data_referencia": data_ref,
                "geometry": linha.geometry,
            }
        )

    gdf = gpd.GeoDataFrame(linhas, geometry="geometry", crs="EPSG:4326")
    return gdf.rename_geometry("geom")


def executar(engine: Engine, *, pbf: Path | None = None) -> dict:
    """Baixa (ou reaproveita) o PBF do Geofabrik, recorta para a área piloto
    com `osmium`, monta o grafo de pedestres com `osmnx` e carrega
    `no_pedestre`/`via_pedestre`. `pbf` pula o download (usado em testes com
    um recorte pequeno)."""
    execucao_id = registrar_execucao(engine, "osm")
    try:
        if pbf is None:
            pbf_completo = baixar(
                URL_GEOFABRIK, DIR_DADOS / PBF_PADRAO, tamanho_minimo=500_000_000
            )
            data_ref = _data_referencia_pbf(URL_GEOFABRIK)
        else:
            pbf_completo = pbf
            data_ref = date.today()  # noqa: DTZ011 — idem

        caminho_xml = _extrair_piloto(pbf_completo)
        grafo = _montar_grafo(caminho_xml)
        nos, arestas = ox.graph_to_gdfs(grafo)
        arestas = arestas.reset_index()

        # o grafo é bidirecional (mesma calçada nos dois sentidos): grava-se
        # uma única aresta por par, mantendo o custo igual nos dois sentidos.
        pares = set(zip(arestas["u"], arestas["v"], strict=True))
        arestas = arestas[
            (arestas["u"] < arestas["v"])
            | ~arestas.apply(lambda linha: (linha["v"], linha["u"]) in pares, axis=1)
        ]

        nos, arestas = _recortar_para_area_piloto(nos, arestas)

        fid = fonte_id(engine, "osm")
        gdf_nos = _gdf_nos(nos, fid, data_ref)
        gdf_arestas = _gdf_arestas(arestas, nos, fid, data_ref)

        with engine.begin() as conexao:
            conexao.execute(text("DELETE FROM via_pedestre"))
            conexao.execute(text("DELETE FROM no_pedestre"))
            gdf_nos.to_postgis("no_pedestre", conexao, if_exists="append", index=False)
            gdf_arestas.to_postgis("via_pedestre", conexao, if_exists="append", index=False)

        resultado = {"nos": len(gdf_nos), "vias": len(gdf_arestas)}
        concluir_execucao(engine, execucao_id, "ok", linhas=resultado["vias"])
        return resultado
    except Exception as exc:
        concluir_execucao(engine, execucao_id, "erro", detalhe=str(exc)[:2000])
        raise
