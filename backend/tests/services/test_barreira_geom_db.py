"""Testes de integração de `barreira_geom`: candidatos reais do banco e o
hash de invalidação do cache. Insere dados sintéticos numa transação que é
sempre revertida ao final — nunca commita, nunca toca dados reais. O
ponto-base fica bem fora das três `area_piloto` (mesmo ponto usado pelos
testes de conflação do ETL), para nenhuma barreira real interferir."""

from datetime import date, timedelta

import pytest
from shapely.geometry import LineString
from sqlalchemy import text

from app.db import SessionLocal
from app.services.barreira_geom import (
    PROJ_31983_4326,
    barreiras_no_corredor,
    corredor,
    hash_barreiras,
    poligonos_para_evitar,
)

pytestmark = pytest.mark.integration

# ids sentinela bem acima do que o ETL real carrega, para nunca colidir.
ID_COLABORATIVA = 900_000_001
ID_OFICIAL_ANTIGA = 900_000_001

_X0, _Y0 = 400_000.0, 7_340_000.0  # bem fora das três area_piloto


def _linha_4326() -> LineString:
    coords_31983 = [(_X0, _Y0), (_X0 + 200.0, _Y0)]
    return LineString([PROJ_31983_4326.transform(x, y) for x, y in coords_31983])


def _ponto_wkt(dx_m: float) -> str:
    lng, lat = PROJ_31983_4326.transform(_X0 + dx_m, _Y0)
    return f"POINT({lng} {lat})"


@pytest.fixture
def db():
    sessao = SessionLocal()
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


def _fonte_id(db, chave: str) -> int:
    return db.execute(
        text("SELECT id FROM fonte_dados WHERE chave = :chave"), {"chave": chave}
    ).scalar_one()


def test_barreiras_no_corredor_so_traz_colaborativa_validada_e_ignora_oficial_expirada(db):
    fid_colab = _fonte_id(db, "colaborativo")
    fid_sp156 = _fonte_id(db, "sp156")
    hoje = date.today()  # noqa: DTZ011 — data_referencia/data_abertura são DATE, sem fuso

    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'buraco', 'intransponivel', 'validada', 2, "
            " ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id)"
        ),
        {"id": ID_COLABORATIVA, "wkt": _ponto_wkt(50.0), "fonte_id": fid_colab},
    )
    # oficial da mesma categoria intransponível, mas aberta há 200 dias: pela
    # regra do spec (Task 3), some do roteamento (não vira nem intransponível
    # nem 'dificulta' — só as "demais categorias" viram 'dificulta').
    db.execute(
        text(
            "INSERT INTO barreira_oficial "
            "(id, categoria, servico, status, data_abertura, geom, fonte_id, data_referencia) "
            "VALUES (:id, 'buraco', 'Tapa-buraco', 'aberta', :data_abertura, "
            " ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id, :data_referencia)"
        ),
        {
            "id": ID_OFICIAL_ANTIGA,
            "data_abertura": hoje - timedelta(days=200),
            "wkt": _ponto_wkt(100.0),
            "fonte_id": fid_sp156,
            "data_referencia": hoje,
        },
    )

    linha = _linha_4326()
    poligono_corredor = corredor(linha, largura_m=50.0)
    candidatas = barreiras_no_corredor(db, poligono_corredor)

    assert [c.id for c in candidatas if c.origem == "colaborativa"] == [ID_COLABORATIVA]
    assert [c.id for c in candidatas if c.origem == "oficial"] == []

    # e só a colaborativa vira polígono a evitar.
    poligonos = poligonos_para_evitar(candidatas, linha, teto=15, buffer_m=8.0)
    assert poligonos is not None
    assert len(poligonos["coordinates"]) == 1


def test_hash_barreiras_muda_ao_inserir_outra_barreira_no_corredor(db):
    fid_colab = _fonte_id(db, "colaborativo")

    linha = _linha_4326()
    poligono_corredor = corredor(linha, largura_m=50.0)

    hash_antes = hash_barreiras(db, poligono_corredor)

    db.execute(
        text(
            "INSERT INTO barreira_colaborativa "
            "(id, categoria, severidade, status, confirmacoes, geom, fonte_id) VALUES "
            "(:id, 'buraco', 'dificulta', 'pendente', 0, "
            " ST_SetSRID(ST_GeomFromText(:wkt), 4326), :fonte_id)"
        ),
        {"id": ID_COLABORATIVA, "wkt": _ponto_wkt(20.0), "fonte_id": fid_colab},
    )

    hash_depois = hash_barreiras(db, poligono_corredor)

    assert hash_antes != hash_depois
