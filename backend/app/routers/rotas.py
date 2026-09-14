"""`POST /api/rotas`: valida a entrada (Pydantic, `RotaIn`) e delega para
`services.rota.calcular`, que orquestra as duas passadas no ORS, o fallback
progressivo de inclinação, o fallback determinístico em pgRouting e o
cache. O router não sabe nada de ORS, barreiras ou pgRouting — só traduz
`RotaNaoEncontrada` para o código HTTP certo.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.rota import RotaIn, RotaOut
from app.services.ors_client import OrsClient
from app.services.rota import RotaNaoEncontrada, calcular

router = APIRouter(prefix="/api", tags=["rotas"])


def obter_cliente_ors(request: Request) -> OrsClient:
    """O único `OrsClient`/`OrsFixtureClient` do processo, criado em
    `main.create_app` e guardado em `app.state.cliente_ors`.

    Precisa ser o mesmo objeto em toda requisição (não um novo
    `criar_cliente(settings)` a cada chamada) porque o `EstadoCota` que ele
    carrega é o que `/health` lê para expor `ors_cota_restante`/
    `ors_cota_reset` — um cliente novo por requisição sempre teria cota
    "nunca observada" e `/health` nunca saberia a cota real do dia."""
    return request.app.state.cliente_ors


@router.post("/rotas", response_model=RotaOut)
def criar_rota(
    entrada: RotaIn,
    db: Session = Depends(get_db),  # noqa: B008
    cliente: OrsClient = Depends(obter_cliente_ors),  # noqa: B008
) -> RotaOut:
    agora = datetime.now(UTC)
    try:
        saida = calcular(db, entrada, cliente, agora)
    except RotaNaoEncontrada as erro:
        db.rollback()
        if erro.erro_ors is not None:
            # o ORS não esgotou os níveis por decisão própria (cota diária/
            # por minuto ou indisponibilidade) e o pgRouting, subsidiário,
            # também não achou rota: é uma falha de serviço, não "não existe
            # rota acessível entre esses pontos".
            raise HTTPException(status_code=503, detail=str(erro)) from erro
        raise HTTPException(status_code=404, detail=str(erro)) from erro
    db.commit()
    return saida
