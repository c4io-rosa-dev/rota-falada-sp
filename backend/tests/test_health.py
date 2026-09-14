import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import create_app


class SessaoQuebrada:
    def execute(self, *args, **kwargs):
        raise RuntimeError("sem banco")


def test_health_degradado_quando_banco_cai():
    app = create_app()
    app.dependency_overrides[get_db] = lambda: SessaoQuebrada()
    resposta = TestClient(app).get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "status": "degradado",
        "versao": "0.1.0",
        "banco": "indisponivel",
        "ultimo_etl": None,
    }


@pytest.mark.integration
def test_health_ok_com_banco():
    resposta = TestClient(create_app()).get("/health")
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["status"] == "ok"
    assert corpo["versao"] == "0.1.0"
    assert corpo["banco"] == "ok"
    # None em banco recém-criado; ISO 8601 depois da primeira execução do ETL
    assert corpo["ultimo_etl"] is None or isinstance(corpo["ultimo_etl"], str)
