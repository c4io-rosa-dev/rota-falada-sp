"""Mesmos casos de `backend/tests/test_normalizacao.py`, do lado do ETL (o
ETL grava `endereco.texto_busca` com esta função)."""

import json
from pathlib import Path

import pytest

from etl.normalizacao import normalizar

_CASOS = json.loads(
    (Path(__file__).parent / "normalizacao_casos.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("caso", _CASOS, ids=[c["entrada"] for c in _CASOS])
def test_normalizar(caso):
    assert normalizar(caso["entrada"]) == caso["saida"]
