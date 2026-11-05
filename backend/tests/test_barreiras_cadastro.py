"""Cadastro e leitura de barreiras colaborativas (spec 2026-11-02, 5.1, 5.2 e 6.3)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.auth import UsuarioAtual
from app.config import settings
from app.schemas.barreira import BarreiraIn, BarreiraOut
from app.services import barreiras
from app.services.erros import ForaDaArea, LimiteDiario, NaoEncontrada

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
LON, LAT = -46.6350, -23.5900  # Vila Mariana, dentro da área piloto


def _entrada(categoria="escada", lon=LON, lat=LAT, descricao=None, chave=None) -> BarreiraIn:
    return BarreiraIn(
        categoria=categoria,
        lat=lat,
        lon=lon,
        descricao=descricao,
        chave_idempotencia=chave or uuid.uuid4(),
    )


def test_criar_barreira_intransponivel_nasce_pendente_com_evento(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira, criada = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert criada is True
    assert barreira.status == "pendente"
    assert barreira.severidade == "intransponivel"
    assert barreira.votos.model_dump() == {"confirma": 0, "contesta": 0, "resolvida": 0}
    assert barreira.lat == pytest.approx(LAT) and barreira.lon == pytest.approx(LON)
    eventos = barreiras.listar_eventos(db_transacional, barreira.id)
    assert [(e.tipo, e.para_status, e.usuario_id) for e in eventos] == [
        ("criada", "pendente", autor.id)
    ]


def test_informativo_nasce_validada(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(db_transacional, criar_usuario(), _entrada("outro"), AGORA)
    assert barreira.status == "validada"


def test_mesma_chave_do_mesmo_autor_devolve_a_existente(db_transacional, criar_usuario):
    autor = criar_usuario()
    chave = uuid.uuid4()
    primeira, criada1 = barreiras.criar(db_transacional, autor, _entrada(chave=chave), AGORA)
    segunda, criada2 = barreiras.criar(db_transacional, autor, _entrada(chave=chave), AGORA)
    assert (criada1, criada2) == (True, False)
    assert segunda.id == primeira.id
    total = db_transacional.execute(
        text("SELECT count(*) FROM barreira_colaborativa WHERE autor_id = :a"), {"a": autor.id}
    ).scalar_one()
    assert total == 1


def test_fora_da_area_piloto(db_transacional, criar_usuario):
    with pytest.raises(ForaDaArea):
        barreiras.criar(db_transacional, criar_usuario(), _entrada(lon=-46.5, lat=-23.5), AGORA)


def test_limite_de_20_por_dia(db_transacional, criar_usuario):
    autor = criar_usuario()
    for _ in range(barreiras.LIMITE_DIARIO):
        barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    with pytest.raises(LimiteDiario):
        barreiras.criar(db_transacional, autor, _entrada(), AGORA)


def test_limite_conta_so_as_ultimas_24_horas(db_transacional, criar_usuario):
    autor = criar_usuario()
    ontem = AGORA - timedelta(hours=25)
    for _ in range(barreiras.LIMITE_DIARIO):
        barreiras.criar(db_transacional, autor, _entrada(), ontem)
    barreira, criada = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert criada is True


def test_descricao_em_branco_vira_nula(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(
        db_transacional, criar_usuario(), _entrada(descricao="   "), AGORA
    )
    assert barreira.descricao is None


def test_obter_inexistente(db_transacional):
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, 987_654_321, AGORA)


def test_removida_some_da_leitura_publica(db_transacional, criar_usuario):
    barreira, _ = barreiras.criar(db_transacional, criar_usuario(), _entrada(), AGORA)
    db_transacional.execute(
        text("UPDATE barreira_colaborativa SET status = 'removida' WHERE id = :id"),
        {"id": barreira.id},
    )
    with pytest.raises(NaoEncontrada):
        barreiras.obter(db_transacional, barreira.id, AGORA)
    assert barreiras.obter(db_transacional, barreira.id, AGORA, incluir_removida=True).status == (
        "removida"
    )
    proximas = barreiras.listar_proximas(db_transacional, LAT, LON, 200, AGORA)
    assert barreira.id not in [b.id for b in proximas]


def test_listar_proximas_ordena_por_distancia_e_respeita_raio(db_transacional, criar_usuario):
    autor = criar_usuario()
    perto, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT), AGORA)
    a_100m, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT + 0.0009), AGORA)
    a_600m, _ = barreiras.criar(db_transacional, autor, _entrada(lat=LAT + 0.0054), AGORA)
    ids = [b.id for b in barreiras.listar_proximas(db_transacional, LAT, LON, 200, AGORA)]
    nossos = [i for i in ids if i in {perto.id, a_100m.id, a_600m.id}]
    assert nossos == [perto.id, a_100m.id]


@pytest.mark.parametrize(
    ("status", "dias_criacao", "esperado"),
    [
        ("pendente", 30, "pendente"),
        ("pendente", 31, "expirada"),
        ("validada", 180, "validada"),
        ("validada", 181, "expirada"),
    ],
)
def test_expiracao_no_sql_igual_a_regra_python(
    db_transacional, criar_usuario, status, dias_criacao, esperado
):
    barreira, _ = barreiras.criar(
        db_transacional, criar_usuario(), _entrada(), AGORA - timedelta(days=dias_criacao)
    )
    db_transacional.execute(
        text("UPDATE barreira_colaborativa SET status = :s WHERE id = :id"),
        {"s": status, "id": barreira.id},
    )
    assert barreiras.obter(db_transacional, barreira.id, AGORA).status == esperado


def test_resposta_publica_nao_expoe_autor(db_transacional, criar_usuario):
    autor = criar_usuario()
    barreira, _ = barreiras.criar(db_transacional, autor, _entrada(), AGORA)
    assert "autor" not in " ".join(BarreiraOut.model_fields)
    assert str(autor.id) not in barreira.model_dump_json()


def test_url_publica_foto(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co/")
    assert barreiras.url_publica_foto(None) is None
    assert barreiras.url_publica_foto("7/x.webp") == (
        "https://abc.supabase.co/storage/v1/object/public/fotos-barreiras/7/x.webp"
    )
    monkeypatch.setattr(settings, "supabase_url", None)
    assert barreiras.url_publica_foto("7/x.webp") is None


def test_violacao_de_fk_nao_e_confundida_com_corrida_de_idempotencia(db_transacional):
    fantasma = UsuarioAtual(id=uuid.uuid4(), papel="colaborador")  # não está em `usuario`
    with pytest.raises(IntegrityError):
        barreiras.criar(db_transacional, fantasma, _entrada(), AGORA)


def test_descricao_e_aparada_antes_do_limite_de_tamanho(db_transacional, criar_usuario):
    texto = "a" * 500
    barreira, _ = barreiras.criar(
        db_transacional, criar_usuario(), _entrada(descricao=f"  {texto}  "), AGORA
    )
    assert barreira.descricao == texto
    with pytest.raises(ValidationError):
        _entrada(descricao="a" * 501)
