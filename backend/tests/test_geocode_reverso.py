"""`reverso()` do geocode local (spec 2026-11-02-geocode-design.md, 4.2). Usa
uma `area_piloto` de teste longe das reais, dentro de transação revertida."""

import pytest
from sqlalchemy import text

from app.services.geocode import (
    MSG_FORA_DA_AREA,
    MSG_NADA_POR_PERTO,
    ReversoNaoEncontrado,
    reverso,
)

pytestmark = pytest.mark.integration

NO_A, NO_B = 900_000_101, 900_000_102  # ids sentinela de no_pedestre


def _inserir_via(db, nome: str, lon_a: float, lat_a: float, lon_b: float, lat_b: float):
    fid = db.execute(text("SELECT id FROM fonte_dados WHERE chave = 'osm'")).scalar_one()
    for no, lon, lat in ((NO_A, lon_a, lat_a), (NO_B, lon_b, lat_b)):
        db.execute(
            text(
                "INSERT INTO no_pedestre (id, geom, fonte_id, data_referencia) VALUES "
                "(:id, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :fid, CURRENT_DATE)"
            ),
            {"id": no, "lon": lon, "lat": lat, "fid": fid},
        )
    db.execute(
        text(
            "INSERT INTO via_pedestre (osmid, source, target, highway, esquema_calcada, nome, "
            "comprimento_m, custo_acessivel, custo_reverso, geom, fonte_id, data_referencia) "
            "VALUES (900000001, :a, :b, 'footway', 'geometria_propria', :nome, 100, 100, 100, "
            "ST_SetSRID(ST_MakeLine(ST_MakePoint(:lon_a, :lat_a), ST_MakePoint(:lon_b, :lat_b)),"
            " 4326), :fid, CURRENT_DATE)"
        ),
        {
            "a": NO_A,
            "b": NO_B,
            "nome": nome,
            "lon_a": lon_a,
            "lat_a": lat_a,
            "lon_b": lon_b,
            "lat_b": lat_b,
            "fid": fid,
        },
    )


def test_fora_da_area_atendida(db_geocode, area_teste):
    with pytest.raises(ReversoNaoEncontrado) as erro:
        reverso(db_geocode, lat=-25.0, lon=-46.0)
    assert str(erro.value) == MSG_FORA_DA_AREA


def test_devolve_o_endereco_mais_proximo(db_geocode, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco(
        "endereco",
        "Rua Perto, 20 · Teste",
        "rua perto 20",
        *deslocar(lon, lat, 20, 0),
        "Rua Perto",
        "20",
        20,
    )
    semear_endereco(
        "endereco",
        "Rua Perto, 40 · Teste",
        "rua perto 40",
        *deslocar(lon, lat, 40, 0),
        "Rua Perto",
        "40",
        40,
    )
    resultado = reverso(db_geocode, lat=lat, lon=lon)
    assert resultado.rotulo == "Rua Perto, 20 · Teste"
    assert resultado.tipo == "endereco"


def test_nada_a_50_m(db_geocode, area_teste, semear_endereco, deslocar):
    lon, lat = area_teste
    semear_endereco(
        "endereco",
        "Rua Longe, 80 · Teste",
        "rua longe 80",
        *deslocar(lon, lat, 80, 0),
        "Rua Longe",
        "80",
        80,
    )
    with pytest.raises(ReversoNaoEncontrado) as erro:
        reverso(db_geocode, lat=lat, lon=lon)
    assert str(erro.value) == MSG_NADA_POR_PERTO


def test_sem_endereco_cai_na_via_nomeada_e_devolve_o_ponto_da_via(
    db_geocode, area_teste, semear_endereco, deslocar
):
    lon, lat = area_teste
    lon_a, lat_via = deslocar(lon, lat, -100, 10)
    lon_b, _ = deslocar(lon, lat, 100, 10)
    _inserir_via(db_geocode, "Rua Sentinela Geocode", lon_a, lat_via, lon_b, lat_via)
    semear_endereco(
        "logradouro",
        "Rua Sentinela Geocode · Teste",
        "rua sentinela geocode",
        lon_a,
        lat_via,
        logradouro="Rua Sentinela Geocode",
    )

    resultado = reverso(db_geocode, lat=lat, lon=lon)

    assert resultado.rotulo == "Rua Sentinela Geocode · Teste"
    assert resultado.tipo == "logradouro"
    assert resultado.lat == pytest.approx(lat_via, abs=1e-9)
    assert resultado.lon == pytest.approx(lon, abs=1e-9)


def test_endereco_tem_prioridade_sobre_via_mais_perto(
    db_geocode, area_teste, semear_endereco, deslocar
):
    lon, lat = area_teste
    lon_a, lat_via = deslocar(lon, lat, -100, 5)
    lon_b, _ = deslocar(lon, lat, 100, 5)
    _inserir_via(db_geocode, "Rua Sentinela Geocode", lon_a, lat_via, lon_b, lat_via)
    semear_endereco(
        "logradouro",
        "Rua Sentinela Geocode · Teste",
        "rua sentinela geocode",
        lon_a,
        lat_via,
        logradouro="Rua Sentinela Geocode",
    )
    semear_endereco(
        "endereco",
        "Rua Perto, 30 · Teste",
        "rua perto 30",
        *deslocar(lon, lat, 30, 0),
        "Rua Perto",
        "30",
        30,
    )

    assert reverso(db_geocode, lat=lat, lon=lon).rotulo == "Rua Perto, 30 · Teste"
