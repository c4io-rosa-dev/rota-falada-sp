"""Teste unitário do orquestrador `python -m etl.cli tudo`.

Cada fonte já registra sua própria linha em `etl_execucao` (inclusive em caso
de erro, dentro do próprio `executar`) e relança a exceção; o orquestrador só
precisa rodar as cinco em sequência (osm, geosampa, sp156, gtfs e, por
último, conflacao — Plano 3, Task 3), continuar mesmo se uma falhar e
devolver código de saída 1 quando alguma fonte falhou.
"""

from unittest.mock import call

import pytest

from etl import cli


@pytest.fixture(autouse=True)
def _sem_engine_real(monkeypatch):
    # `engine()` normalmente abriria uma conexão de verdade; nos testes
    # unitários basta um objeto qualquer para provar que foi repassado.
    monkeypatch.setattr(cli, "_engine_para_tudo", lambda: "engine-falso")


def test_tudo_roda_as_cinco_fontes_em_ordem_e_devolve_zero(monkeypatch):
    chamadas = []
    for nome in ("osm", "geosampa", "sp156", "gtfs", "conflacao"):
        atributo = (
            "_executar_conflacao_tudo" if nome == "conflacao" else f"_executar_{nome}"
        )
        monkeypatch.setattr(
            cli,
            atributo,
            lambda engine, nome=nome: (
                chamadas.append(call(nome, engine)) or {"ok": True}
            ),
        )

    codigo = cli.main(["tudo"])

    assert codigo == 0
    assert chamadas == [
        call("osm", "engine-falso"),
        call("geosampa", "engine-falso"),
        call("sp156", "engine-falso"),
        call("gtfs", "engine-falso"),
        call("conflacao", "engine-falso"),
    ]


def test_tudo_continua_apos_uma_fonte_falhar_e_devolve_um(monkeypatch, capsys):
    chamadas = []

    def _osm_falha(engine):
        chamadas.append("osm")
        raise RuntimeError("download falhou")

    def _ok(nome):
        def _fn(engine):
            chamadas.append(nome)
            return {"ok": True}

        return _fn

    monkeypatch.setattr(cli, "_executar_osm", _osm_falha)
    monkeypatch.setattr(cli, "_executar_geosampa", _ok("geosampa"))
    monkeypatch.setattr(cli, "_executar_sp156", _ok("sp156"))
    monkeypatch.setattr(cli, "_executar_gtfs", _ok("gtfs"))
    monkeypatch.setattr(cli, "_executar_conflacao_tudo", _ok("conflacao"))

    codigo = cli.main(["tudo"])

    assert codigo == 1
    # as outras quatro fontes rodaram mesmo com o osm falhando
    assert chamadas == ["osm", "geosampa", "sp156", "gtfs", "conflacao"]
    saida_erro = capsys.readouterr().err
    assert "osm" in saida_erro
    assert "download falhou" in saida_erro


def test_tudo_devolve_um_quando_todas_falham(monkeypatch):
    def _falha(engine):
        raise RuntimeError("erro")

    for nome in ("osm", "geosampa", "sp156", "gtfs"):
        monkeypatch.setattr(cli, f"_executar_{nome}", _falha)
    monkeypatch.setattr(cli, "_executar_conflacao_tudo", _falha)

    assert cli.main(["tudo"]) == 1
