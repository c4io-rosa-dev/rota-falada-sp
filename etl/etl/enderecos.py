"""ETL de endereços e lugares do OSM para `endereco` (spec
docs/superpowers/specs/2026-11-02-geocode-design.md, seção 3).

Lê `dados/piloto.osm.pbf` (gerado pela etapa `osm`), filtra com `osmium
tags-filter`, exporta para GeoJSONSeq com `osmium export` e monta em Python
uma linha por endereço numerado ou lugar com nome dentro da área piloto. As
linhas `logradouro` (uma por nome de via e bairro) vêm de `via_pedestre`, já
carregada pela etapa `osm`. Fonte única: OpenStreetMap (ODbL).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape

from etl.config import AREA_PILOTO
from etl.normalizacao import normalizar

# chaves OSM que fazem de um objeto com `name` um "lugar" buscável
CHAVES_LUGAR = (
    "amenity",
    "railway",
    "public_transport",
    "shop",
    "leisure",
    "tourism",
    "office",
    "healthcare",
)
RAIO_DEDUPLICACAO_M = 15.0
_MAX_DIGITOS_NUMERO = 9  # cabe em `integer`
_DIGITOS_INICIAIS = re.compile(r"\s*(\d+)")
_PARA_31983 = Transformer.from_crs("EPSG:4326", "EPSG:31983", always_xy=True)


@dataclass(frozen=True)
class Registro:
    tipo: str
    rotulo: str
    logradouro: str | None
    numero: str | None
    numero_int: int | None
    categoria: str | None
    texto_busca: str
    lon: float
    lat: float
    osm_tipo: str | None
    osm_id: int | None


def bairro_de(lon: float, lat: float) -> str | None:
    """Nome da área piloto que contém o ponto (borda inclusive). Na
    sobreposição (Vila Mariana x Ipiranga), vence a primeira de `AREA_PILOTO`,
    que é a mesma ordem dos ids de `area_piloto` (migration 002)."""
    for nome, (oeste, sul, leste, norte) in AREA_PILOTO.items():
        if oeste <= lon <= leste and sul <= lat <= norte:
            return nome
    return None


def numero_inteiro(numero: str | None) -> int | None:
    """Parte numérica inicial de `addr:housenumber` ("1000-A" -> 1000)."""
    if not numero:
        return None
    casamento = _DIGITOS_INICIAIS.match(numero)
    if casamento is None or len(casamento.group(1)) > _MAX_DIGITOS_NUMERO:
        return None
    return int(casamento.group(1))


def ler_geojsonseq(caminho: Path) -> Iterator[dict]:
    """Uma feature por linha; tolera o separador de registro (0x1E) do RFC 8142."""
    with caminho.open(encoding="utf-8") as arquivo:
        for linha in arquivo:
            linha = linha.strip().lstrip("\x1e").strip()
            if linha:
                yield json.loads(linha)


def _texto(propriedades: dict, chave: str) -> str | None:
    valor = propriedades.get(chave)
    if valor is None:
        return None
    valor = str(valor).strip()
    return valor or None


def _ref_osm(propriedades: dict) -> tuple[str | None, int | None]:
    tipo = str(propriedades.get("@type", ""))[:1].lower()
    identificador = propriedades.get("@id")
    return (
        tipo if tipo in ("n", "w", "r") else None,
        int(identificador) if identificador is not None else None,
    )


def registro_de_feature(feature: dict) -> Registro | None:
    """Endereço numerado (`addr:street` + `addr:housenumber`) ou lugar
    (`name` + uma das `CHAVES_LUGAR`) dentro da área piloto; senão `None`.
    Polígonos viram um ponto garantidamente dentro deles."""
    geometria = feature.get("geometry")
    if not geometria:
        return None
    geom = shape(geometria)
    if geom.is_empty:
        return None
    ponto = geom if geom.geom_type == "Point" else geom.representative_point()
    bairro = bairro_de(ponto.x, ponto.y)
    if bairro is None:
        return None

    propriedades = feature.get("properties") or {}
    rua = _texto(propriedades, "addr:street")
    numero = _texto(propriedades, "addr:housenumber")
    nome = _texto(propriedades, "name")
    categoria = next(
        (_texto(propriedades, c) for c in CHAVES_LUGAR if _texto(propriedades, c)), None
    )
    endereco = f"{rua}, {numero}" if rua and numero else None

    if nome and categoria:
        tipo = "lugar"
        base = f"{nome} — {endereco}" if endereco else nome
    elif endereco:
        tipo = "endereco"
        base = endereco
        categoria = None
    else:
        return None

    texto_busca = normalizar(base)
    if not texto_busca:
        return None
    osm_tipo, osm_id = _ref_osm(propriedades)
    return Registro(
        tipo=tipo,
        rotulo=f"{base} · {bairro}",
        logradouro=rua,
        numero=numero,
        numero_int=numero_inteiro(numero),
        categoria=categoria,
        texto_busca=texto_busca,
        lon=ponto.x,
        lat=ponto.y,
        osm_tipo=osm_tipo,
        osm_id=osm_id,
    )


def deduplicar(registros: Iterable[Registro]) -> list[Registro]:
    """1) Cada objeto OSM entra uma vez só. 2) Mesmo `tipo` e `texto_busca` a
    menos de `RAIO_DEDUPLICACAO_M`: fica o de menor `osm_id`. Saída em ordem
    estável (tipo, texto_busca, osm_id)."""
    vistos: set[tuple[str | None, int]] = set()
    unicos: list[Registro] = []
    for registro in registros:
        if registro.osm_id is not None:
            chave = (registro.osm_tipo, registro.osm_id)
            if chave in vistos:
                continue
            vistos.add(chave)
        unicos.append(registro)

    grupos: dict[tuple[str, str], list[Registro]] = {}
    for registro in sorted(unicos, key=lambda r: (r.osm_id is None, r.osm_id or 0)):
        grupos.setdefault((registro.tipo, registro.texto_busca), []).append(registro)

    raio2 = RAIO_DEDUPLICACAO_M**2
    mantidos: list[Registro] = []
    for grupo in grupos.values():
        pontos: list[tuple[float, float]] = []
        for registro in grupo:
            x, y = _PARA_31983.transform(registro.lon, registro.lat)
            if any((x - px) ** 2 + (y - py) ** 2 < raio2 for px, py in pontos):
                continue
            pontos.append((x, y))
            mantidos.append(registro)
    return sorted(mantidos, key=lambda r: (r.tipo, r.texto_busca, r.osm_id or 0))


def registros_logradouro(linhas: Iterable[tuple[str, str, float, float]]) -> list[Registro]:
    """Uma linha `logradouro` por (nome, bairro, lon, lat) vindo de
    `SQL_LOGRADOUROS`. Descarta nome vazio e ponto fora da área piloto."""
    resultado: list[Registro] = []
    for nome, bairro, lon, lat in linhas:
        nome = nome.strip()
        texto_busca = normalizar(nome)
        if not texto_busca or bairro_de(lon, lat) is None:
            continue
        resultado.append(
            Registro(
                tipo="logradouro",
                rotulo=f"{nome} · {bairro}",
                logradouro=nome,
                numero=None,
                numero_int=None,
                categoria=None,
                texto_busca=texto_busca,
                lon=lon,
                lat=lat,
                osm_tipo=None,
                osm_id=None,
            )
        )
    return resultado
