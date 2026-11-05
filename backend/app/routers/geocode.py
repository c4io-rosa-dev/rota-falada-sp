"""`GET /api/geocode` e `GET /api/geocode/reverso`: validam a entrada e
delegam para `services.geocode`. O router não sabe nada de SQL; só traduz
`ReversoNaoEncontrado` em 404 e banco indisponível em 503."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.geocode import EnderecoOut
from app.services.geocode import ReversoNaoEncontrado, buscar, reverso

router = APIRouter(prefix="/api", tags=["geocode"])

# os dados só mudam quando o ETL roda (semanal)
CACHE_CONTROL = "public, max-age=86400"
# após um deploy `endereco` pode estar vazia até o ETL rodar; [] em cache a esconderia por 24 h
CACHE_CONTROL_VAZIO = "no-store"
MSG_INDISPONIVEL = "Busca de endereços indisponível no momento."
MSG_TAMANHO_Q = "O texto da busca precisa ter de 3 a 100 caracteres."


@router.get("/geocode", response_model=list[EnderecoOut])
def geocode(
    response: Response,
    q: str,
    limite: Annotated[int, Query(ge=1, le=10)] = 8,
    db: Session = Depends(get_db),  # noqa: B008
) -> list[EnderecoOut]:
    texto = q.strip()
    if "\x00" in texto or not 3 <= len(texto) <= 100:
        raise HTTPException(status_code=422, detail=MSG_TAMANHO_Q)
    try:
        resultado = buscar(db, texto, limite)
    except OperationalError as erro:
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    response.headers["Cache-Control"] = CACHE_CONTROL if resultado else CACHE_CONTROL_VAZIO
    return resultado


@router.get("/geocode/reverso", response_model=EnderecoOut)
def geocode_reverso(
    response: Response,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    db: Session = Depends(get_db),  # noqa: B008
) -> EnderecoOut:
    try:
        resultado = reverso(db, lat=lat, lon=lon)
    except ReversoNaoEncontrado as erro:
        raise HTTPException(status_code=404, detail=str(erro)) from erro
    except OperationalError as erro:
        raise HTTPException(status_code=503, detail=MSG_INDISPONIVEL) from erro
    response.headers["Cache-Control"] = CACHE_CONTROL
    return resultado
