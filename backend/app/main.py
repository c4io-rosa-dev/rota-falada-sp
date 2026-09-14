from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import fontes, health, rotas
from app.services.ors_client import criar_cliente


def create_app() -> FastAPI:
    app = FastAPI(title="Rota Falada SP API", version=health.VERSAO)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_lista,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    # único cliente ORS do processo (ver routers/rotas.py::obter_cliente_ors):
    # POST /api/rotas e GET /health compartilham o mesmo EstadoCota.
    app.state.cliente_ors = criar_cliente(settings)
    app.include_router(health.router)
    app.include_router(fontes.router)
    app.include_router(rotas.router)
    return app


app = create_app()
