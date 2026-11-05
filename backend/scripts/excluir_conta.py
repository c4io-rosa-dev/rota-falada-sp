"""Atende um pedido de exclusão de conta (LGPD): as barreiras ficam sem autor.

Uso (a partir de backend/, com o venv do backend):
    python scripts/excluir_conta.py --email pessoa@exemplo.com   # só no Supabase
    python scripts/excluir_conta.py --id <uuid>                  # qualquer banco

Depois, apague a conta no painel do Supabase Auth: é lá que fica o e-mail.
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
    anonimizar_conta,
    buscar_id_por_email,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deixa as barreiras de uma conta sem autor.")
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
        total = anonimizar_conta(db, usuario_id, datetime.now(UTC))
        db.commit()
    print(f"ok: {total} barreira(s) sem autor. Agora apague a conta no painel do Supabase Auth.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
