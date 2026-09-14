"""Cache anônimo de rotas em `rota_cache` (PostGIS): chave determinística,
TTL de 6 h e invalidação espacial por `regiao` (o corredor da rota
cacheada) — usada pelo Plano 6 quando uma barreira nova é validada perto de
uma rota já cacheada.

Nenhuma função aqui commita: como o resto dos serviços deste módulo, quem
decide quando persistir (ou reverter, em teste) é quem segura a `Session`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import text

from app.schemas.rota import RotaOut

if TYPE_CHECKING:
    from shapely.geometry import Point, Polygon
    from sqlalchemy.orm import Session

    from app.schemas.rota import RotaIn


def chave(entrada: RotaIn, hash_barreiras: str) -> str:
    """sha256 de (origem/destino arredondados a 5 casas, perfil serializado,
    `hash_barreiras`) — a chave primária de `rota_cache` (spec, seção 5)."""
    material = {
        "origem": [round(entrada.origem.lat, 5), round(entrada.origem.lng, 5)],
        "destino": [round(entrada.destino.lat, 5), round(entrada.destino.lng, 5)],
        "perfil": entrada.perfil.model_dump(mode="json"),
        "hash_barreiras": hash_barreiras,
    }
    serializado = json.dumps(material, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(serializado.encode("utf-8")).hexdigest()


_SQL_OBTER = text("SELECT resposta, expira_em FROM rota_cache WHERE chave = :chave")


def obter(db: Session, chave_cache: str, agora: datetime) -> RotaOut | None:
    """`RotaOut` cacheado sob `chave_cache`, com `cache=True`, ou `None` se
    não há entrada ou ela já expirou (comparado contra `agora`, nunca
    `now()` do banco — mantém `calcular()` testável sem depender do
    relógio do container)."""
    linha = db.execute(_SQL_OBTER, {"chave": chave_cache}).mappings().first()
    if linha is None:
        return None
    if linha["expira_em"] <= agora:
        return None
    saida = RotaOut.model_validate(linha["resposta"])
    return saida.model_copy(update={"cache": True})


_SQL_GUARDAR = text(
    """
    INSERT INTO rota_cache (chave, resposta, regiao, motor, criado_em, expira_em)
    VALUES (:chave, CAST(:resposta AS jsonb),
            ST_SetSRID(ST_GeomFromText(:regiao_wkt), 4326), :motor, :agora, :expira_em)
    ON CONFLICT (chave) DO UPDATE SET
        resposta = EXCLUDED.resposta,
        regiao = EXCLUDED.regiao,
        motor = EXCLUDED.motor,
        criado_em = EXCLUDED.criado_em,
        expira_em = EXCLUDED.expira_em
    """
)


def guardar(
    db: Session,
    chave_cache: str,
    saida: RotaOut,
    *,
    regiao: Polygon,
    agora: datetime,
    ttl_horas: float = 6.0,
) -> None:
    """Grava (ou substitui) a entrada de `chave_cache`. `saida` é gravada tal
    como calculada (`cache=False`) — é `obter()` que marca `cache=True` na
    leitura seguinte; `regiao` é o corredor da rota, usada só para
    invalidação espacial (`invalidar_regiao`), nunca lida de volta."""
    expira_em = agora + timedelta(hours=ttl_horas)
    db.execute(
        _SQL_GUARDAR,
        {
            "chave": chave_cache,
            "resposta": json.dumps(saida.model_dump(mode="json"), ensure_ascii=False),
            "regiao_wkt": regiao.wkt,
            "motor": saida.motor,
            "agora": agora,
            "expira_em": expira_em,
        },
    )


_SQL_INVALIDAR_REGIAO = text(
    "DELETE FROM rota_cache WHERE ST_Intersects(regiao, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))"
)


def invalidar_regiao(db: Session, ponto_4326: Point) -> None:
    """Apaga toda entrada de `rota_cache` cuja `regiao` (corredor) contém
    `ponto_4326` — chamada pelo Plano 6 ao validar uma barreira nova, para
    que rotas já cacheadas perto dela sejam recalculadas na próxima
    consulta."""
    db.execute(_SQL_INVALIDAR_REGIAO, {"lng": ponto_4326.x, "lat": ponto_4326.y})
