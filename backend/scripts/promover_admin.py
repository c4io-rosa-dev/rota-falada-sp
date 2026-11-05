"""Promove um usuário a admin.

Uso (a partir de backend/, com o venv do backend):
    python scripts/promover_admin.py --email pessoa@exemplo.com   # só no Supabase
    python scripts/promover_admin.py --id <uuid>                  # qualquer banco

O e-mail precisa ter entrado no app pelo menos uma vez. O banco é o de
DATABASE_URL; para produção, defina DATABASE_URL só neste comando.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_BACKEND))

from app.db import SessionLocal  # noqa: E402
from app.services.admin import (  # noqa: E402
    UsuarioNaoEncontrado,
    buscar_id_por_email,
    promover_admin,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Promove um usuário a admin.")
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--email")
    grupo.add_argument("--id", type=uuid.UUID)
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        try:
            usuario_id = args.id or buscar_id_por_email(db, args.email)
        except UsuarioNaoEncontrado as erro:
            print(f"erro: {erro}", file=sys.stderr)
            return 1
        promover_admin(db, usuario_id, datetime.now(UTC))
        db.commit()
    print(f"ok: {usuario_id} agora é admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
