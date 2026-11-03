"""Login com o JWT do Supabase Auth (spec 2026-11-02-colaborativo-design.md, 4).

O token vem em `Authorization: Bearer`, assinado em ES256 com a chave do
projeto (JWKS público em `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`).
Nenhum segredo é necessário para verificar. O papel (`colaborador`/`admin`)
vive na tabela `usuario`, não no token.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

MSG_LOGIN = "Faça login para continuar."
MSG_LOGIN_INDISPONIVEL = "Login indisponível no momento."
MSG_SEM_PERMISSAO = "Você não tem permissão para esta ação."
AUDIENCIA = "authenticated"

_SQL_UPSERT_USUARIO = text(
    "INSERT INTO usuario (id) VALUES (:id) "
    "ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING papel"
)


@dataclass(frozen=True)
class UsuarioAtual:
    id: uuid.UUID
    papel: str

    @property
    def admin(self) -> bool:
        return self.papel == "admin"


class FonteDeChaves(Protocol):
    def chave_para(self, token: str) -> Any: ...


class FonteJwks:
    """Chaves públicas do JWKS do Supabase, em cache; recarrega ao ver `kid` novo."""

    def __init__(self, url_jwks: str) -> None:
        self._cliente = jwt.PyJWKClient(url_jwks, cache_keys=True, lifespan=3600)

    def chave_para(self, token: str) -> Any:
        return self._cliente.get_signing_key_from_jwt(token).key


@dataclass(frozen=True)
class ConfigAuth:
    emissor: str
    fonte: FonteDeChaves


def criar_config_auth(supabase_url: str | None) -> ConfigAuth | None:
    if not supabase_url:
        return None
    base = supabase_url.rstrip("/")
    return ConfigAuth(
        emissor=f"{base}/auth/v1",
        fonte=FonteJwks(f"{base}/auth/v1/.well-known/jwks.json"),
    )


def obter_config_auth(request: Request) -> ConfigAuth | None:
    """A única `ConfigAuth` do processo, criada em `main.create_app`."""
    return request.app.state.config_auth


def _nao_autenticado() -> HTTPException:
    return HTTPException(status_code=401, detail=MSG_LOGIN, headers={"WWW-Authenticate": "Bearer"})


def usuario_atual(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),  # noqa: B008
    config: ConfigAuth | None = Depends(obter_config_auth),  # noqa: B008
) -> UsuarioAtual:
    if config is None:
        raise HTTPException(status_code=503, detail=MSG_LOGIN_INDISPONIVEL)
    if not authorization or not authorization.startswith("Bearer "):
        raise _nao_autenticado()
    token = authorization.removeprefix("Bearer ").strip()
    try:
        chave = config.fonte.chave_para(token)
        dados = jwt.decode(
            token,
            chave,
            algorithms=["ES256"],
            audience=AUDIENCIA,
            issuer=config.emissor,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
        usuario_id = uuid.UUID(dados["sub"])
    except jwt.PyJWKClientConnectionError as erro:
        raise HTTPException(status_code=503, detail=MSG_LOGIN_INDISPONIVEL) from erro
    except (jwt.PyJWTError, ValueError) as erro:
        raise _nao_autenticado() from erro
    papel = db.execute(_SQL_UPSERT_USUARIO, {"id": usuario_id}).scalar_one()
    db.commit()
    return UsuarioAtual(id=usuario_id, papel=papel)


def exigir_admin(usuario: UsuarioAtual = Depends(usuario_atual)) -> UsuarioAtual:  # noqa: B008
    if not usuario.admin:
        raise HTTPException(status_code=403, detail=MSG_SEM_PERMISSAO)
    return usuario
