import math
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings


def _banco_disponivel() -> bool:
    try:
        with create_engine(settings.database_url).connect() as conexao:
            conexao.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _dados_carregados() -> bool:
    """O ETL do Plano 2 já populou o grafo? No CI só as migrations rodam."""
    try:
        with create_engine(settings.database_url).connect() as conexao:
            total = conexao.execute(text("SELECT count(*) FROM via_pedestre")).scalar_one()
        return total > 0
    except Exception:
        return False


def pytest_collection_modifyitems(config, items):
    if not _banco_disponivel():
        pular = pytest.mark.skip(
            reason="banco indisponível em DATABASE_URL; rode docker compose up -d"
        )
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(pular)
        return
    if not _dados_carregados():
        pular = pytest.mark.skip(
            reason="ETL não carregado (via_pedestre vazia); rode o Plano 2 antes"
        )
        for item in items:
            if "dados_reais" in item.keywords:
                item.add_marker(pular)


# --- geocode (Plano 5a) --------------------------------------------------------
# Tudo roda dentro de uma transação revertida no fim: nada é commitado e os
# dados reais de `endereco`/`area_piloto` voltam intactos.

# bem fora das area_piloto reais (mesmo ponto-base de test_rotas_api.py)
CENTRO_AREA_TESTE = (-45.98351729900837, -24.048988029889923)


@pytest.fixture
def db_geocode():
    from app.db import SessionLocal

    sessao = SessionLocal()
    sessao.execute(text("DELETE FROM endereco"))
    try:
        yield sessao
    finally:
        sessao.rollback()
        sessao.close()


@pytest.fixture
def semear_endereco(db_geocode):
    fid = db_geocode.execute(text("SELECT id FROM fonte_dados WHERE chave = 'osm'")).scalar_one()

    def _semear(
        tipo: str,
        rotulo: str,
        texto_busca: str,
        lon: float,
        lat: float,
        logradouro: str | None = None,
        numero: str | None = None,
        numero_int: int | None = None,
    ) -> int:
        return db_geocode.execute(
            text(
                "INSERT INTO endereco (tipo, rotulo, logradouro, numero, numero_int, "
                "texto_busca, geom, fonte_id, data_referencia) VALUES (:tipo, :rotulo, "
                ":logradouro, :numero, :numero_int, :texto_busca, "
                "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :fid, CURRENT_DATE) RETURNING id"
            ),
            {
                "tipo": tipo,
                "rotulo": rotulo,
                "logradouro": logradouro,
                "numero": numero,
                "numero_int": numero_int,
                "texto_busca": texto_busca,
                "lon": lon,
                "lat": lat,
                "fid": fid,
            },
        ).scalar_one()

    return _semear


@pytest.fixture
def deslocar():
    def _deslocar(lon: float, lat: float, leste_m: float, norte_m: float) -> tuple[float, float]:
        return (
            lon + leste_m / (111_320.0 * math.cos(math.radians(lat))),
            lat + norte_m / 111_320.0,
        )

    return _deslocar


@pytest.fixture
def area_teste(db_geocode):
    lon, lat = CENTRO_AREA_TESTE
    db_geocode.execute(
        text(
            "INSERT INTO area_piloto (nome, geom) VALUES ('Área de teste do geocode', "
            "ST_MakeEnvelope(:oeste, :sul, :leste, :norte, 4326))"
        ),
        {"oeste": lon - 0.01, "sul": lat - 0.01, "leste": lon + 0.01, "norte": lat + 0.01},
    )
    return lon, lat


# --- camada colaborativa (Plano 6) ---------------------------------------------

EMISSOR_TESTE = "https://projeto-teste.supabase.co/auth/v1"


class _FonteFixa:
    """Fonte de chaves que devolve sempre a mesma chave pública (sem rede)."""

    def __init__(self, chave_publica) -> None:
        self._chave = chave_publica

    def chave_para(self, token: str):
        return self._chave


@pytest.fixture(scope="session")
def chave_teste():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def config_auth_teste(chave_teste):
    from app.auth import ConfigAuth

    return ConfigAuth(emissor=EMISSOR_TESTE, fonte=_FonteFixa(chave_teste.public_key()))


@pytest.fixture
def emitir_token(chave_teste):
    def _emitir(
        sub,
        *,
        validade_s=3600,
        aud="authenticated",
        iss=EMISSOR_TESTE,
        chave=None,
        extra=None,
        sem_exp=False,
    ):
        agora = datetime.now(UTC)
        dados = {
            "sub": str(sub),
            "aud": aud,
            "iss": iss,
            "role": "authenticated",
            "iat": agora,
            "exp": agora + timedelta(seconds=validade_s),
        }
        if sem_exp:
            del dados["exp"]
        dados.update(extra or {})
        return jwt.encode(dados, chave or chave_teste, algorithm="ES256")

    return _emitir


@pytest.fixture
def db_transacional():
    """Sessão dentro de uma transação revertida no fim; `commit()` do código
    testado vira apenas a liberação de um savepoint."""
    from app.db import engine

    conexao = engine.connect()
    transacao = conexao.begin()
    sessao = Session(bind=conexao, join_transaction_mode="create_savepoint")
    try:
        yield sessao
    finally:
        sessao.close()
        transacao.rollback()
        conexao.close()


@pytest.fixture
def criar_usuario(db_transacional):
    from app.auth import UsuarioAtual

    def _criar(papel: str = "colaborador") -> UsuarioAtual:
        usuario_id = uuid.uuid4()
        db_transacional.execute(
            text("INSERT INTO usuario (id, papel) VALUES (:id, :papel)"),
            {"id": usuario_id, "papel": papel},
        )
        return UsuarioAtual(id=usuario_id, papel=papel)

    return _criar


@pytest.fixture
def armazenamento_memoria():
    from app.services.fotos import ArmazenamentoMemoria

    return ArmazenamentoMemoria()


@pytest.fixture
def cliente_api(db_transacional, config_auth_teste, armazenamento_memoria):
    from fastapi.testclient import TestClient

    from app.auth import obter_config_auth
    from app.db import get_db
    from app.main import create_app
    from app.routers.barreiras import obter_armazenamento

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_transacional
    app.dependency_overrides[obter_config_auth] = lambda: config_auth_teste
    app.dependency_overrides[obter_armazenamento] = lambda: armazenamento_memoria
    return TestClient(app)
