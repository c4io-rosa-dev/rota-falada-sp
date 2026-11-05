"""Geocode local no PostGIS (spec docs/superpowers/specs/2026-11-02-geocode-design.md, 4).

Tudo determinístico: mesma entrada, mesma lista, na mesma ordem. Nenhum
serviço externo. `texto_busca` foi gravado pelo ETL com a mesma
`normalizar()` usada aqui.
"""

from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session

from app.schemas.geocode import EnderecoOut
from app.services.normalizacao import normalizar, separar_numero

_COLUNAS = "id, tipo, rotulo, ST_Y(geom) AS lat, ST_X(geom) AS lon"
_DIGITOS = re.compile(r"\d+")

RAIO_REVERSO_M = 50.0
# pré-filtro em graus para usar o índice GiST antes do cálculo em metros:
# 0,0006° ≈ 66 m de latitude e ≈ 61 m de longitude a 23,5° S (> RAIO_REVERSO_M)
_GRAUS_PREFILTRO = 0.0006

MSG_FORA_DA_AREA = "Este ponto está fora da área atendida pelo Rota Falada SP."
MSG_NADA_POR_PERTO = "Nenhum endereço conhecido a até 50 metros deste ponto."


class ReversoNaoEncontrado(Exception):
    """Sem endereço para o ponto; a mensagem vai direto para o usuário."""


# rua das linhas numeradas que melhor casa com a parte da rua digitada
_SQL_RUA = text(
    """
    SELECT logradouro FROM endereco
    WHERE tipo IN ('endereco', 'lugar') AND numero IS NOT NULL AND logradouro IS NOT NULL
      AND :rua <% texto_busca
    ORDER BY word_similarity(:rua, texto_busca) DESC, length(logradouro), logradouro
    LIMIT 1
    """
)

_SQL_NUMERO_EXATO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE logradouro = :logradouro AND tipo IN ('endereco', 'lugar')
      AND regexp_replace(lower(numero), '[^0-9a-z]', '', 'g') = :numero
    ORDER BY CASE tipo WHEN 'endereco' THEN 0 ELSE 1 END, rotulo, id
    LIMIT :limite
    """
)

_SQL_NUMERO_PROXIMO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE logradouro = :logradouro AND tipo IN ('endereco', 'lugar')
      AND numero_int IS NOT NULL
    ORDER BY abs(numero_int - :n), numero_int,
             CASE tipo WHEN 'endereco' THEN 0 ELSE 1 END, id
    LIMIT 1
    """
)

# sem número: só ruas e lugares (endereços numerados inundariam a lista)
_SQL_SEM_NUMERO = text(
    f"""
    SELECT {_COLUNAS} FROM endereco
    WHERE tipo IN ('logradouro', 'lugar')
      AND (:q <% texto_busca OR texto_busca LIKE :prefixo)
    ORDER BY (texto_busca LIKE :prefixo) DESC,
             word_similarity(:q, texto_busca) DESC,
             CASE tipo WHEN 'logradouro' THEN 0 ELSE 1 END,
             rotulo, id
    LIMIT :limite
    """
)


def _saida(linha: Row, aproximado: bool = False) -> EnderecoOut:
    return EnderecoOut(
        id=linha.id,
        tipo=linha.tipo,
        rotulo=linha.rotulo,
        lat=linha.lat,
        lon=linha.lon,
        aproximado=aproximado,
    )


def _buscar_com_numero(db: Session, rua: str, numero: str, limite: int) -> list[EnderecoOut]:
    logradouro = db.execute(_SQL_RUA, {"rua": rua}).scalar_one_or_none()
    if logradouro is None:
        return []
    exatos = db.execute(
        _SQL_NUMERO_EXATO, {"logradouro": logradouro, "numero": numero, "limite": limite}
    ).all()
    if exatos:
        return [_saida(linha) for linha in exatos]
    n = int(_DIGITOS.match(numero).group())
    proximo = db.execute(_SQL_NUMERO_PROXIMO, {"logradouro": logradouro, "n": n}).first()
    return [_saida(proximo, aproximado=True)] if proximo is not None else []


def buscar(db: Session, q: str, limite: int) -> list[EnderecoOut]:
    """Autocomplete: rua + número quando o texto termina em número; senão
    ruas e lugares por trigram/prefixo. Lista vazia quando nada casa."""
    texto = normalizar(q)
    if not texto:
        return []
    rua, numero = separar_numero(texto)
    if numero is not None:
        resultado = _buscar_com_numero(db, rua, numero, limite)
        if resultado:
            return resultado
    linhas = db.execute(
        _SQL_SEM_NUMERO, {"q": texto, "prefixo": f"{texto}%", "limite": limite}
    ).all()
    return [_saida(linha) for linha in linhas]


_SQL_DENTRO_DA_AREA = text(
    """
    SELECT EXISTS (
      SELECT 1 FROM area_piloto
      WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
    )
    """
)

_SQL_ENDERECO_PROXIMO = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g)
    SELECT e.id, e.tipo, e.rotulo, ST_Y(e.geom) AS lat, ST_X(e.geom) AS lon
    FROM endereco e CROSS JOIN p
    WHERE e.tipo = 'endereco'
      AND e.geom && ST_Expand(p.g, :graus)
      AND ST_DWithin(e.geom::geography, p.g::geography, :raio)
    ORDER BY ST_Distance(e.geom::geography, p.g::geography), e.id
    LIMIT 1
    """
)

# via nomeada mais próxima; devolve a linha `logradouro` com esse nome mais
# próxima do usuário, mas com o ponto da via mais próximo dele
_SQL_VIA_PROXIMA = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g),
    via AS (
      SELECT v.nome, ST_ClosestPoint(v.geom, p.g) AS ponto
      FROM via_pedestre v CROSS JOIN p
      WHERE v.nome IS NOT NULL AND btrim(v.nome) <> ''
        AND v.geom && ST_Expand(p.g, :graus)
        AND ST_DWithin(v.geom::geography, p.g::geography, :raio)
      ORDER BY ST_Distance(v.geom::geography, p.g::geography), v.nome
      LIMIT 1
    )
    SELECT e.id, e.tipo, e.rotulo, ST_Y(via.ponto) AS lat, ST_X(via.ponto) AS lon
    FROM via
    JOIN endereco e ON e.tipo = 'logradouro' AND e.logradouro = via.nome
    CROSS JOIN p
    ORDER BY e.geom <-> p.g, e.id
    LIMIT 1
    """
)


def reverso(db: Session, lat: float, lon: float) -> EnderecoOut:
    """Endereço numerado a até `RAIO_REVERSO_M`; senão a rua mais próxima no
    mesmo raio; senão `ReversoNaoEncontrado`."""
    ponto = {"lat": lat, "lon": lon}
    if not db.execute(_SQL_DENTRO_DA_AREA, ponto).scalar_one():
        raise ReversoNaoEncontrado(MSG_FORA_DA_AREA)
    parametros = {**ponto, "graus": _GRAUS_PREFILTRO, "raio": RAIO_REVERSO_M}
    linha = db.execute(_SQL_ENDERECO_PROXIMO, parametros).first()
    if linha is None:
        linha = db.execute(_SQL_VIA_PROXIMA, parametros).first()
    if linha is None:
        raise ReversoNaoEncontrado(MSG_NADA_POR_PERTO)
    return _saida(linha)
