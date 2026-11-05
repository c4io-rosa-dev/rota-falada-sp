"""Votação, decisão do admin e expiração (spec 2026-11-02-colaborativo-design.md, 6)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from shapely.geometry import LineString
from sqlalchemy import text

from app.schemas.barreira import BarreiraIn
from app.services import barreiras, votacao
from app.services.barreira_geom import barreiras_no_corredor, corredor
from app.services.erros import AutorNaoVota, BarreiraEncerrada, NaoEncontrada

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
LON, LAT = -46.6350, -23.5900


def _criar(db, autor, categoria="escada", agora=AGORA):
    entrada = BarreiraIn(categoria=categoria, lat=LAT, lon=LON, chave_idempotencia=uuid.uuid4())
    return barreiras.criar(db, autor, entrada, agora)[0]


def _tipos_de_evento(db, barreira_id):
    return [(e.tipo, e.de_status, e.para_status) for e in barreiras.listar_eventos(db, barreira_id)]


def _rota_em_cache_sobre_o_ponto(db) -> str:
    chave = f"teste-{uuid.uuid4()}"
    db.execute(
        text(
            "INSERT INTO rota_cache (chave, resposta, regiao, motor, criado_em, expira_em) "
            "VALUES (:chave, '{}'::jsonb, ST_MakeEnvelope(:o, :s, :l, :n, 4326), 'teste', "
            ":agora, :expira)"
        ),
        {
            "chave": chave,
            "o": LON - 0.001,
            "s": LAT - 0.001,
            "l": LON + 0.001,
            "n": LAT + 0.001,
            "agora": AGORA,
            "expira": AGORA + timedelta(hours=6),
        },
    )
    return chave


def _cache_existe(db, chave) -> bool:
    return db.execute(
        text("SELECT EXISTS (SELECT 1 FROM rota_cache WHERE chave = :c)"), {"c": chave}
    ).scalar_one()


def test_autor_nao_vota(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira = _criar(db_transacional, autor)
    with pytest.raises(AutorNaoVota):
        votacao.votar(db_transacional, autor, barreira.id, "confirma", AGORA)


def test_barreira_inexistente(db_transacional, criar_usuario):
    with pytest.raises(NaoEncontrada):
        votacao.votar(db_transacional, criar_usuario(), 987_654_321, "confirma", AGORA)


def test_intransponivel_valida_com_duas_confirmacoes_e_registra_eventos(
    db_transacional, criar_usuario
):
    barreira = _criar(db_transacional, criar_usuario())
    um, dois = criar_usuario(), criar_usuario()
    assert votacao.votar(db_transacional, um, barreira.id, "confirma", AGORA).status == "pendente"
    depois = votacao.votar(db_transacional, dois, barreira.id, "confirma", AGORA)
    assert depois.status == "validada"
    assert depois.votos.confirma == 2
    assert depois.ultima_confirmacao_em == AGORA
    assert _tipos_de_evento(db_transacional, barreira.id) == [
        ("criada", None, "pendente"),
        ("voto", None, None),
        ("voto", None, None),
        ("status", "pendente", "validada"),
    ]


def test_dificulta_valida_com_uma_confirmacao(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert resultado.status == "validada"


def test_troca_de_voto_mantem_um_voto_por_pessoa(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    eleitor = criar_usuario()
    votacao.votar(db_transacional, eleitor, barreira.id, "confirma", AGORA)
    resultado = votacao.votar(db_transacional, eleitor, barreira.id, "contesta", AGORA)
    assert resultado.votos.model_dump() == {"confirma": 0, "contesta": 1, "resolvida": 0}
    assert resultado.status == "pendente"


def test_duas_contestacoes_encerram_e_bloqueiam_novos_votos(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    for _ in range(2):
        resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "contesta", AGORA)
    assert resultado.status == "contestada"
    with pytest.raises(BarreiraEncerrada):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)


def test_dois_votos_resolvida(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    for _ in range(2):
        resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "resolvida", AGORA)
    assert resultado.status == "resolvida"


def test_pendente_vencida_nao_recebe_voto(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario(), agora=AGORA - timedelta(days=31))
    with pytest.raises(BarreiraEncerrada):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)


def test_cache_so_e_invalidado_quando_passa_a_afetar_a_rota(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    chave = _rota_em_cache_sobre_o_ponto(db_transacional)
    votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert _cache_existe(db_transacional, chave)  # ainda pendente: rota não muda
    votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert not _cache_existe(db_transacional, chave)  # validada: rota precisa mudar


def test_confirmacao_nao_desfaz_validacao_do_admin(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    votacao.mudar_status_admin(
        db_transacional, criar_usuario("admin"), barreira.id, "validada", "conferido", AGORA
    )
    chave = _rota_em_cache_sobre_o_ponto(db_transacional)
    depois_do_voto = AGORA + timedelta(days=1)
    resultado = votacao.votar(
        db_transacional, criar_usuario(), barreira.id, "confirma", depois_do_voto
    )
    assert resultado.status == "validada"
    assert resultado.votos.confirma == 1
    assert resultado.ultima_confirmacao_em == depois_do_voto
    assert _cache_existe(db_transacional, chave)  # continua afetando a rota: nada a recalcular
    assert ("status", "validada", "pendente") not in _tipos_de_evento(db_transacional, barreira.id)


def test_confirmacao_nao_desfaz_restauracao_com_contestacoes_antigas(
    db_transacional, criar_usuario
):
    barreira = _criar(db_transacional, criar_usuario(), "buraco")
    for _ in range(2):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "contesta", AGORA)
    votacao.mudar_status_admin(
        db_transacional, criar_usuario("admin"), barreira.id, "validada", "conferido", AGORA
    )
    resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", AGORA)
    assert resultado.status == "validada"


def test_contestacao_ainda_recalcula_validacao_do_admin(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    votacao.mudar_status_admin(
        db_transacional, criar_usuario("admin"), barreira.id, "validada", "conferido", AGORA
    )
    resultado = votacao.votar(db_transacional, criar_usuario(), barreira.id, "contesta", AGORA)
    assert resultado.status == "pendente"


def test_admin_remove_e_restaura_com_auditoria(db_transacional, criar_usuario):
    barreira = _criar(db_transacional, criar_usuario())
    admin = criar_usuario("admin")
    removida = votacao.mudar_status_admin(
        db_transacional, admin, barreira.id, "removida", "denúncia de barreira falsa", AGORA
    )
    assert removida.status == "removida"
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, barreira.id, AGORA)
    restaurada = votacao.mudar_status_admin(
        db_transacional, admin, barreira.id, "validada", "conferido no local", AGORA
    )
    assert restaurada.status == "validada"
    assert restaurada.ultima_confirmacao_em == AGORA
    eventos = barreiras.listar_eventos(db_transacional, barreira.id)
    admin_eventos = [e for e in eventos if e.tipo == "admin"]
    assert [(e.de_status, e.para_status, e.usuario_id) for e in admin_eventos] == [
        ("pendente", "removida", admin.id),
        ("removida", "validada", admin.id),
    ]
    assert admin_eventos[0].detalhe == {"motivo": "denúncia de barreira falsa"}


def test_expirar_vencidas_grava_status_e_evento(db_transacional, criar_usuario):
    autor = criar_usuario()
    velha_pendente = _criar(db_transacional, autor, agora=AGORA - timedelta(days=31))
    velha_validada = _criar(db_transacional, autor, "outro", agora=AGORA - timedelta(days=181))
    nova = _criar(db_transacional, autor)
    expiradas = votacao.expirar_vencidas(db_transacional, AGORA)
    assert {velha_pendente.id, velha_validada.id} <= set(expiradas)
    assert nova.id not in expiradas
    status = db_transacional.execute(
        text("SELECT status FROM barreira_colaborativa WHERE id = :id"),
        {"id": velha_pendente.id},
    ).scalar_one()
    assert status == "expirada"
    ultimo = barreiras.listar_eventos(db_transacional, velha_pendente.id)[-1]
    assert (ultimo.tipo, ultimo.para_status, ultimo.usuario_id) == ("status", "expirada", None)


def test_roteamento_usa_validada_e_ignora_expirada(db_transacional, criar_usuario):
    agora_real = datetime.now(UTC)  # barreira_geom usa now(); evita bomba-relógio
    barreira = _criar(db_transacional, criar_usuario(), agora=agora_real)
    for _ in range(2):
        votacao.votar(db_transacional, criar_usuario(), barreira.id, "confirma", agora_real)
    faixa = corredor(LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)]))

    def _nossas():
        return [
            b
            for b in barreiras_no_corredor(db_transacional, faixa)
            if b.origem == "colaborativa" and b.id == barreira.id
        ]

    assert [b.severidade for b in _nossas()] == ["intransponivel"]
    db_transacional.execute(
        text(
            "UPDATE barreira_colaborativa SET ultima_confirmacao_em = now() - interval '181 days', "
            "criado_em = now() - interval '200 days' WHERE id = :id"
        ),
        {"id": barreira.id},
    )
    assert _nossas() == []
