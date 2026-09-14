from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import create_app
from app.services.ors_client import EstadoCota, OrsClient, OrsFixtureClient


class SessaoQuebrada:
    def execute(self, *args, **kwargs):
        raise RuntimeError("sem banco")


def _app_com_cliente_ors(cliente) -> object:
    """`create_app()` com `app.state.cliente_ors` trocado por `cliente` —
    para o teste não depender do `ORS_API_KEY`/`USE_FIXTURES` reais da
    máquina que roda a suíte."""
    app = create_app()
    app.state.cliente_ors = cliente
    return app


def test_health_degradado_quando_banco_cai():
    app = _app_com_cliente_ors(
        OrsFixtureClient(chave="", base_url="https://x", timeout_s=1.0, estado=EstadoCota())
    )
    app.dependency_overrides[get_db] = lambda: SessaoQuebrada()
    resposta = TestClient(app).get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "status": "degradado",
        "versao": "0.1.0",
        "banco": "indisponivel",
        "ultimo_etl": None,
        "ors_cota_restante": None,
        "ors_cota_reset": None,
        "modo_fixtures": True,
    }


def test_health_expoe_cota_do_ors_do_cliente_real_ja_usado():
    estado = EstadoCota(restante=1234, reset_em=datetime(2026, 9, 15, tzinfo=UTC))
    cliente = OrsClient(
        chave="alguma-chave",
        base_url="https://api.openrouteservice.org",
        timeout_s=15.0,
        estado=estado,
    )
    app = _app_com_cliente_ors(cliente)
    app.dependency_overrides[get_db] = lambda: SessaoQuebrada()
    corpo = TestClient(app).get("/health").json()
    assert corpo["ors_cota_restante"] == 1234
    assert datetime.fromisoformat(corpo["ors_cota_reset"]) == estado.reset_em
    assert corpo["modo_fixtures"] is False


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
    assert corpo["ors_cota_restante"] is None or isinstance(corpo["ors_cota_restante"], int)
    assert corpo["ors_cota_reset"] is None or isinstance(corpo["ors_cota_reset"], str)
    assert isinstance(corpo["modo_fixtures"], bool)
