"""As duas cópias da normalização (backend e ETL) e os dois arquivos de casos
precisam ser idênticos byte a byte: o ETL grava `texto_busca` com uma cópia e
o backend busca com a outra."""

from pathlib import Path

_RAIZ = Path(__file__).resolve().parents[2]


def _bytes(caminho_relativo: str) -> bytes:
    return (_RAIZ / caminho_relativo).read_bytes()


def test_modulos_de_normalizacao_identicos():
    assert _bytes("backend/app/services/normalizacao.py") == _bytes("etl/etl/normalizacao.py"), (
        "etl/etl/normalizacao.py divergiu: copie backend/app/services/normalizacao.py por cima"
    )


def test_casos_de_normalizacao_identicos():
    assert _bytes("backend/tests/normalizacao_casos.json") == _bytes(
        "etl/tests/normalizacao_casos.json"
    ), "etl/tests/normalizacao_casos.json divergiu do arquivo do backend"
