from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import criar_config_auth
from app.config import settings
from app.routers import admin, barreiras, fontes, geocode, health, rotas
from app.services.fotos import criar_armazenamento
from app.services.ors_client import criar_cliente


def create_app() -> FastAPI:
    app = FastAPI(title="Rota Falada SP API", version=health.VERSAO)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_lista,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )
    # único cliente ORS do processo (ver routers/rotas.py::obter_cliente_ors):
    # POST /api/rotas e GET /health compartilham o mesmo EstadoCota.
    app.state.cliente_ors = criar_cliente(settings)
    # única ConfigAuth do processo (JWKS em cache); None sem SUPABASE_URL
    app.state.config_auth = criar_config_auth(settings.supabase_url)
    # None sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: upload de foto responde 503
    app.state.armazenamento_fotos = criar_armazenamento(
        settings.supabase_url, settings.supabase_service_role_key
    )
    app.include_router(health.router)
    app.include_router(fontes.router)
    app.include_router(rotas.router)
    app.include_router(geocode.router)
    app.include_router(barreiras.router)
    app.include_router(admin.router)
    return app


app = create_app()
