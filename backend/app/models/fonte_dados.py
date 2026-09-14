from datetime import date

from sqlalchemy import Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FonteDados(Base):
    """Catálogo de proveniência. Alimenta o rodapé e a página /fontes."""

    __tablename__ = "fonte_dados"

    id: Mapped[int] = mapped_column(primary_key=True)
    chave: Mapped[str] = mapped_column(String(40), unique=True)
    nome: Mapped[str] = mapped_column(String(120))
    licenca: Mapped[str] = mapped_column(String(60))
    url: Mapped[str] = mapped_column(Text)
    atribuicao: Mapped[str] = mapped_column(Text)
    data_referencia: Mapped[date | None] = mapped_column(Date, nullable=True)
    data_extracao: Mapped[date | None] = mapped_column(Date, nullable=True)
