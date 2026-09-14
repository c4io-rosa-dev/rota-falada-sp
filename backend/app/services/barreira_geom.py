"""Geometria de barreiras para o roteamento acessível: corredor da rota,
polígonos a evitar no ORS (`avoid_polygons`) e hash de invalidação do cache.

Tudo entra e sai em EPSG:4326; os cálculos métricos (buffer, distância,
área) rodam em EPSG:31983 (SIRGAS 2000 / UTM 23S), como o resto do projeto
(ver `etl/etl/geo.py`).

**Buffers sempre em Python com Shapely, nunca `ST_Buffer` no banco.** A
imagem `pgrouting/pgrouting:latest` usada localmente (GEOS 3.9.0, PostGIS
3.5.2) tem o mesmo bug de robustez documentado em `etl/etl/conflacao.py`
para `ST_Intersection`/`ST_Difference` entre `LineString` e
`Polygon`/`MultiPolygon` (devolve geometria vazia mesmo quando uma contém a
outra). Por isso `barreiras_no_corredor` usa só `ST_Intersects` (predicado,
que funciona corretamente nesta instância) e os buffers de 8 m das barreiras
são calculados aqui, em Shapely, nunca no banco.

Regra de severidade efetiva (spec, seção 6, e Global Constraints do Plano
4): uma barreira colaborativa só bloqueia (`intransponivel`) se `validada` e
com pelo menos 2 confirmações; uma oficial só bloqueia se a categoria for
`obstaculo_calcada`, `guia_sem_rebaixamento` ou `buraco`, aberta há menos de
180 dias e sem `data_finalizacao`. Fora isso, colaborativas `validada` com
severidade `dificulta` e oficiais das **demais** categorias (não as três de
cima) viram aviso `dificulta`; uma oficial das três categorias porém já
expirada (>180 dias ou finalizada) não aparece — nem bloqueia nem avisa,
como um problema presumidamente resolvido.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Point, Polygon, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as _transformar_geometria
from shapely.ops import unary_union
from shapely.wkt import loads as _carregar_wkt
from sqlalchemy import text
from sqlalchemy.orm import Session

PROJ_4326_31983 = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)
PROJ_31983_4326 = Transformer.from_crs("EPSG:31983", "EPSG:4326", always_xy=True)

# limites de forma do avoid_polygons do ORS (spec, Global Constraints do Plano 4).
_AREA_MAX_M2 = 200 * 1_000_000.0  # 200 km²
_EXTENSAO_MAX_M = 20_000.0  # 20 km

# categorias de barreira_oficial que, se recentes e não finalizadas, bloqueiam.
_CATEGORIAS_INTRANSPONIVEIS = ("obstaculo_calcada", "guia_sem_rebaixamento", "buraco")


@dataclass
class BarreiraCandidata:
    """Uma barreira (oficial ou colaborativa) dentro do corredor da rota, já
    classificada na severidade efetiva para o roteamento (`intransponivel`
    vira `avoid_polygons`; `dificulta` vira aviso — nunca `informativo`,
    fora do escopo desta função)."""

    id: int
    origem: Literal["oficial", "colaborativa"]
    categoria: str
    severidade: Literal["intransponivel", "dificulta"]
    geom: Point  # EPSG:4326
    confirmacoes: int | None
    data_referencia: date | None


def _para_31983(geom: BaseGeometry) -> BaseGeometry:
    return _transformar_geometria(PROJ_4326_31983.transform, geom)


def _para_4326(geom: BaseGeometry) -> BaseGeometry:
    return _transformar_geometria(PROJ_31983_4326.transform, geom)


def corredor(linha_4326, largura_m: float = 50.0) -> Polygon:
    """Buffer de `largura_m` metros para cada lado da linha, medido em
    EPSG:31983 (métrico), devolvido em EPSG:4326."""
    linha_31983 = _para_31983(linha_4326)
    buffer_31983 = linha_31983.buffer(largura_m)
    return _para_4326(buffer_31983)


_SQL_CANDIDATOS = text(
    """
    WITH todas AS (
        SELECT
            id, 'colaborativa' AS origem, categoria,
            CASE
                WHEN status = 'validada' AND confirmacoes >= 2 AND severidade = 'intransponivel'
                    THEN 'intransponivel'
                WHEN status = 'validada' AND severidade = 'dificulta'
                    THEN 'dificulta'
                ELSE NULL
            END AS severidade_efetiva,
            geom, confirmacoes, data_referencia
        FROM barreira_colaborativa
        WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromText(:corredor_wkt), 4326))

        UNION ALL

        SELECT
            id, 'oficial' AS origem, categoria,
            CASE
                WHEN categoria = ANY(:categorias_intransponiveis)
                     AND data_abertura >= CURRENT_DATE - INTERVAL '180 days'
                     AND data_finalizacao IS NULL
                    THEN 'intransponivel'
                WHEN categoria != ALL(:categorias_intransponiveis)
                    THEN 'dificulta'
                ELSE NULL
            END AS severidade_efetiva,
            geom, NULL::integer AS confirmacoes, data_referencia
        FROM barreira_oficial
        WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromText(:corredor_wkt), 4326))
    )
    SELECT id, origem, categoria, severidade_efetiva, ST_AsText(geom) AS geom_wkt,
           confirmacoes, data_referencia
    FROM todas
    WHERE severidade_efetiva IS NOT NULL
    """
)


def barreiras_no_corredor(db: Session, corredor_4326: Polygon) -> list[BarreiraCandidata]:
    """Barreiras (oficiais e colaborativas) dentro do corredor, já
    classificadas em `intransponivel`/`dificulta` (ver docstring do módulo).
    Usa só `ST_Intersects` — nunca `ST_Intersection`/`ST_Buffer` no banco
    (bug do GEOS desta imagem, ver docstring do módulo)."""
    linhas = (
        db.execute(
            _SQL_CANDIDATOS,
            {
                "corredor_wkt": corredor_4326.wkt,
                "categorias_intransponiveis": list(_CATEGORIAS_INTRANSPONIVEIS),
            },
        )
        .mappings()
        .all()
    )
    return [
        BarreiraCandidata(
            id=linha["id"],
            origem=linha["origem"],
            categoria=linha["categoria"],
            severidade=linha["severidade_efetiva"],
            geom=_carregar_wkt(linha["geom_wkt"]),
            confirmacoes=linha["confirmacoes"],
            data_referencia=linha["data_referencia"],
        )
        for linha in linhas
    ]


def poligonos_para_evitar(
    barreiras: list[BarreiraCandidata],
    linha_4326,
    teto: int = 15,
    buffer_m: float = 8.0,
) -> dict[str, Any] | None:
    """GeoJSON MultiPolygon (EPSG:4326) das barreiras `intransponivel` a
    evitar no ORS, ou `None` se não há nenhuma.

    Só as `teto` mais próximas da rota entram (as demais são descartadas —
    o ORS aceita no máximo esse número de polígonos por requisição, decisão
    do spec); cada uma vira um buffer de `buffer_m` metros, calculado em
    EPSG:31983 com Shapely (nunca `ST_Buffer`, ver docstring do módulo).
    Garante os limites de forma do `avoid_polygons` do ORS (Global
    Constraints do Plano 4: ≤200 km² de área e ≤20 km de extensão),
    descartando as barreiras mais distantes até caber; `None` se nem uma
    única barreira couber (caso degenerado).
    """
    intransponiveis = [b for b in barreiras if b.severidade == "intransponivel"]
    if not intransponiveis:
        return None

    linha_31983 = _para_31983(linha_4326)

    def _distancia_a_linha(barreira: BarreiraCandidata) -> float:
        ponto_31983 = Point(*PROJ_4326_31983.transform(barreira.geom.x, barreira.geom.y))
        return ponto_31983.distance(linha_31983)

    ordenadas = sorted(intransponiveis, key=_distancia_a_linha)
    escolhidas = ordenadas[:teto]

    buffers_31983 = [
        Point(*PROJ_4326_31983.transform(b.geom.x, b.geom.y)).buffer(buffer_m) for b in escolhidas
    ]

    while buffers_31983:
        uniao = unary_union(buffers_31983)
        minx, miny, maxx, maxy = uniao.bounds
        extensao_m = math.hypot(maxx - minx, maxy - miny)
        if uniao.area <= _AREA_MAX_M2 and extensao_m <= _EXTENSAO_MAX_M:
            break
        buffers_31983.pop()  # remove a mais distante da rota (lista ordenada por distância)

    if not buffers_31983:
        return None

    poligono_4326 = _para_4326(uniao)
    multipoligono_4326 = (
        poligono_4326 if isinstance(poligono_4326, MultiPolygon) else MultiPolygon([poligono_4326])
    )
    return mapping(multipoligono_4326)


_SQL_HASH_COLABORATIVAS = text(
    "SELECT count(*), max(atualizado_em) FROM barreira_colaborativa "
    "WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromText(:corredor_wkt), 4326))"
)
_SQL_HASH_OFICIAIS = text(
    "SELECT count(*) FROM barreira_oficial "
    "WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromText(:corredor_wkt), 4326))"
)


def hash_barreiras(db: Session, corredor_4326: Polygon) -> str:
    """sha256 de (nº de colaborativas, última `atualizado_em`, nº de
    oficiais) dentro do corredor — usado na chave do `rota_cache` para
    invalidar quando qualquer barreira no corredor muda (inserção, validação,
    expiração etc.), sem precisar reclassificar severidade aqui."""
    wkt = corredor_4326.wkt
    n_colaborativas, ultima_atualizacao = db.execute(
        _SQL_HASH_COLABORATIVAS, {"corredor_wkt": wkt}
    ).one()
    (n_oficiais,) = db.execute(_SQL_HASH_OFICIAIS, {"corredor_wkt": wkt}).one()

    material = (
        f"{n_colaborativas}|"
        f"{ultima_atualizacao.isoformat() if ultima_atualizacao else ''}|"
        f"{n_oficiais}"
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
