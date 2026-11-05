"""Promoção de usuário a admin (spec 2026-11-02-colaborativo-design.md, 4.6).
O e-mail vive só no Supabase (`auth.users`); localmente, use o id."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.barreiras import registrar_evento


class UsuarioNaoEncontrado(Exception):
    pass


def buscar_id_por_email(db: Session, email: str) -> uuid.UUID:
    tem_auth = db.execute(text("SELECT to_regclass('auth.users') IS NOT NULL")).scalar_one()
    if not tem_auth:
        raise UsuarioNaoEncontrado(
            "auth.users não existe neste banco (só no Supabase); use --id <uuid>."
        )
    usuario_id = db.execute(
        text("SELECT id FROM auth.users WHERE lower(email) = lower(:email)"), {"email": email}
    ).scalar_one_or_none()
    if usuario_id is None:
        raise UsuarioNaoEncontrado(
            f"Nenhum usuário com o e-mail {email}; ele precisa entrar no app uma vez antes."
        )
    return usuario_id


def promover_admin(db: Session, usuario_id: uuid.UUID, agora: datetime) -> None:
    db.execute(
        text(
            "INSERT INTO usuario (id, papel) VALUES (:id, 'admin') "
            "ON CONFLICT (id) DO UPDATE SET papel = 'admin'"
        ),
        {"id": usuario_id},
    )
    registrar_evento(
        db, tipo="promocao", agora=agora, usuario_id=usuario_id, detalhe={"papel": "admin"}
    )


def anonimizar_conta(db: Session, usuario_id: uuid.UUID, agora: datetime) -> int:
    """Exclusão de conta (LGPD): as barreiras continuam públicas, sem autor. A linha de
    `usuario`, os votos e a auditoria (imutável) ficam só com o id, que deixa de levar a
    alguém quando a conta é apagada no Supabase Auth. Devolve quantas barreiras ficaram
    sem autor."""
    barreiras = db.execute(
        text(
            "UPDATE barreira_colaborativa SET autor_id = NULL, chave_idempotencia = NULL "
            "WHERE autor_id = :id"
        ),
        {"id": usuario_id},
    ).rowcount
    registrar_evento(
        db,
        tipo="admin",
        agora=agora,
        usuario_id=usuario_id,
        detalhe={"acao": "conta_excluida", "barreiras_sem_autor": barreiras},
    )
    return barreiras
