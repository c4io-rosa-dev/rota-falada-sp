"""Testes de `normalizar` e `separar_numero` (spec 2026-11-02-geocode-design.md, 3.3)."""

import json
from pathlib import Path

import pytest

from app.services.normalizacao import normalizar, separar_numero

_CASOS = json.loads((Path(__file__).parent / "normalizacao_casos.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("caso", _CASOS, ids=[c["entrada"] for c in _CASOS])
def test_normalizar(caso):
    assert normalizar(caso["entrada"]) == caso["saida"]


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("rua vergueiro 1000", ("rua vergueiro", "1000")),
        ("rua vergueiro 1000a", ("rua vergueiro", "1000a")),
        ("rua vergueiro 1000 a", ("rua vergueiro", "1000a")),
        ("avenida 23 de maio 500", ("avenida 23 de maio", "500")),
        ("rua 25 de marco", ("rua 25 de marco", None)),
        ("rua vergueiro", ("rua vergueiro", None)),
        ("1000", ("1000", None)),
        ("", ("", None)),
    ],
)
def test_separar_numero(texto, esperado):
    assert separar_numero(texto) == esperado
