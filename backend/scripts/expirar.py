"""Grava `expirada` nas barreiras colaborativas vencidas (pendente > 30 dias,
validada sem confirmação > 180 dias), com evento de auditoria.

Uso (a partir de backend/, com o venv do backend):
    python scripts/expirar.py
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ_BACKEND))

from app.db import SessionLocal  # noqa: E402
from app.services.votacao import expirar_vencidas  # noqa: E402


def main() -> int:
    with SessionLocal() as db:
        expiradas = expirar_vencidas(db, datetime.now(UTC))
        db.commit()
    print(f"{len(expiradas)} barreira(s) expirada(s): {expiradas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
