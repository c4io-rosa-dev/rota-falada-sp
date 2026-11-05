"""`buscar()` do geocode local (spec 2026-11-02-geocode-design.md, 4.1).
Linhas sintéticas numa `endereco` esvaziada dentro de transação revertida."""

import pytest

from app.services.geocode import buscar

pytestmark = pytest.mark.integration


@pytest.fixture
def semeado(semear_endereco):
    s = semear_endereco
    s(
        "logradouro",
        "Rua Vergueiro · Vila Mariana",
        "rua vergueiro",
        -46.6350,
        -23.5900,
        logradouro="Rua Vergueiro",
    )
    s(
        "endereco",
        "Rua Vergueiro, 3000 · Vila Mariana",
        "rua vergueiro 3000",
        -46.6351,
        -23.5901,
        "Rua Vergueiro",
        "3000",
        3000,
    )
    s(
        "endereco",
        "Rua Vergueiro, 3010 · Vila Mariana",
        "rua vergueiro 3010",
        -46.6352,
        -23.5902,
        "Rua Vergueiro",
        "3010",
        3010,
    )
    s(
        "endereco",
        "Rua Vergueiro, 3050 · Vila Mariana",
        "rua vergueiro 3050",
        -46.6353,
        -23.5903,
        "Rua Vergueiro",
        "3050",
        3050,
    )
    s(
        "lugar",
        "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana",
        "farmacia central rua vergueiro 3000",
        -46.6351,
        -23.5901,
        "Rua Vergueiro",
        "3000",
        3000,
    )
    s(
        "lugar",
        "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga",
        "fatec ipiranga rua frei joao 59",
        -46.6000,
        -23.5900,
        "Rua Frei João",
        "59",
        59,
    )
    s("lugar", "Padaria Sol · Lapa", "padaria sol", -46.7000, -23.5300)
    s("lugar", "Padaria Sol · Ipiranga", "padaria sol", -46.6000, -23.5950)


def _rotulos(resultado):
    return [r.rotulo for r in resultado]


def test_numero_exato_traz_endereco_antes_do_lugar(db_geocode, semeado):
    resultado = buscar(db_geocode, "Rua Vergueiro, 3000", 8)
    assert _rotulos(resultado) == [
        "Rua Vergueiro, 3000 · Vila Mariana",
        "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana",
    ]
    assert all(r.aproximado is False for r in resultado)


def test_numero_com_abreviacao_e_sem_virgula(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "r. vergueiro 3000", 8))[0] == (
        "Rua Vergueiro, 3000 · Vila Mariana"
    )


def test_numero_inexistente_devolve_o_mais_proximo_marcado_aproximado(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro 3040", 8)
    assert _rotulos(resultado) == ["Rua Vergueiro, 3050 · Vila Mariana"]
    assert resultado[0].aproximado is True


def test_numero_equidistante_desempata_pelo_menor(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro 3030", 8)
    assert _rotulos(resultado) == ["Rua Vergueiro, 3010 · Vila Mariana"]
    assert resultado[0].aproximado is True


def test_sem_numero_traz_a_rua_primeiro_e_nenhum_endereco_numerado(db_geocode, semeado):
    resultado = buscar(db_geocode, "rua vergueiro", 8)
    assert resultado[0].rotulo == "Rua Vergueiro · Vila Mariana"
    assert resultado[0].tipo == "logradouro"
    assert "endereco" not in {r.tipo for r in resultado}
    assert "Farmácia Central — Rua Vergueiro, 3000 · Vila Mariana" in _rotulos(resultado)


def test_erro_de_digitacao(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "fatek ipiranga", 8))[0] == (
        "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    )


def test_prefixo_curto(db_geocode, semeado):
    assert _rotulos(buscar(db_geocode, "fat", 8))[0] == (
        "Fatec Ipiranga — Rua Frei João, 59 · Ipiranga"
    )


def test_empate_ordena_pelo_rotulo_e_e_estavel(db_geocode, semeado):
    primeira = buscar(db_geocode, "padaria sol", 8)
    assert _rotulos(primeira) == ["Padaria Sol · Ipiranga", "Padaria Sol · Lapa"]
    assert buscar(db_geocode, "padaria sol", 8) == primeira


def test_limite(db_geocode, semeado):
    assert len(buscar(db_geocode, "padaria sol", 1)) == 1


def test_rua_desconhecida_com_numero_nao_inventa_resultado(db_geocode, semeado):
    assert buscar(db_geocode, "rua inexistente 10", 8) == []


def test_sem_resultado(db_geocode, semeado):
    assert buscar(db_geocode, "xyzxyzxyz", 8) == []


def test_texto_que_normaliza_para_vazio(db_geocode, semeado):
    assert buscar(db_geocode, "!!!", 8) == []
