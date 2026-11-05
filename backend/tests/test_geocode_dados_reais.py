"""Geocode contra os dados reais do ETL (pulado no CI, que não roda o ETL).
Orçamento de latência do spec-mãe: geocode p95 ≤ 300 ms."""

import math
import time

import pytest
from sqlalchemy import text

from app.db import SessionLocal
from app.services.geocode import buscar, reverso

pytestmark = [pytest.mark.integration, pytest.mark.dados_reais]


@pytest.fixture(scope="module")
def db():
    sessao = SessionLocal()
    total = sessao.execute(text("SELECT count(*) FROM endereco")).scalar_one()
    if total == 0:
        sessao.close()
        pytest.skip("endereco vazia; rode `docker compose --profile etl run --rm etl enderecos`")
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def test_fatec_ipiranga_e_encontrada(db):
    resultado = buscar(db, "FATEC Ipiranga", 8)
    assert any("fatec" in r.rotulo.lower() for r in resultado), [r.rotulo for r in resultado]


def test_rua_vergueiro_com_numero_traz_um_endereco_da_vergueiro(db):
    resultado = buscar(db, "rua vergueiro 3000", 8)
    assert resultado, "nenhum resultado para 'rua vergueiro 3000'"
    assert resultado[0].tipo in ("endereco", "lugar")
    assert "vergueiro" in resultado[0].rotulo.lower()


def test_reverso_sobre_um_endereco_real_devolve_um_endereco(db):
    lon, lat = db.execute(
        text(
            "SELECT ST_X(geom), ST_Y(geom) FROM endereco "
            "WHERE tipo = 'endereco' ORDER BY id LIMIT 1"
        )
    ).one()
    resultado = reverso(db, lat=lat, lon=lon)
    assert resultado.tipo == "endereco"


def test_p95_da_busca_abaixo_de_300_ms(db):
    textos = [
        linha[0]
        for linha in db.execute(
            text("SELECT texto_busca FROM endereco WHERE tipo = 'logradouro' ORDER BY id LIMIT 25")
        )
    ]
    consultas = [t[:5] for t in textos] + [f"{t} 100" for t in textos]
    buscar(db, consultas[0], 8)  # aquece conexão e planos
    tempos = []
    for consulta in consultas:
        inicio = time.perf_counter()
        buscar(db, consulta, 8)
        tempos.append(time.perf_counter() - inicio)
    tempos.sort()
    p95 = tempos[math.ceil(0.95 * len(tempos)) - 1]
    assert p95 < 0.300, f"p95 = {p95 * 1000:.0f} ms em {len(tempos)} buscas"
