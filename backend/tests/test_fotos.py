"""Foto da barreira (spec 2026-11-02-colaborativo-design.md, 7)."""

import io
import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import respx
from PIL import Image

from app.config import settings
from app.schemas.barreira import BarreiraIn
from app.services import barreiras, fotos
from app.services.erros import (
    DescricaoFotoInvalida,
    FotoFormato,
    FotoGrande,
    SemPermissao,
    StorageIndisponivel,
)

AGORA = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
DESCRICAO = "Escada de três degraus na entrada"


def _jpeg(largura=300, altura=200, orientacao=None) -> bytes:
    imagem = Image.new("RGB", (largura, altura), (120, 80, 40))
    exif = Image.Exif()
    exif[0x010F] = "CameraTeste"  # Make
    if orientacao is not None:
        exif[0x0112] = orientacao  # Orientation
    saida = io.BytesIO()
    imagem.save(saida, "JPEG", exif=exif.tobytes())
    return saida.getvalue()


def _png(largura, altura) -> bytes:
    saida = io.BytesIO()
    Image.new("1", (largura, altura)).save(saida, "PNG")  # 1 bit: barato de gerar
    return saida.getvalue()


# --- reprocessar (puro) ---------------------------------------------------------


def test_reprocessar_remove_metadados_e_gera_webp():
    original = _jpeg()
    assert Image.open(io.BytesIO(original)).info.get("exif")
    resultado = Image.open(io.BytesIO(fotos.reprocessar(original)))
    assert resultado.format == "WEBP"
    assert not resultado.info.get("exif")
    assert len(resultado.getexif()) == 0


def test_reprocessar_aplica_a_rotacao_do_exif():
    resultado = Image.open(io.BytesIO(fotos.reprocessar(_jpeg(300, 200, orientacao=6))))
    assert resultado.size == (200, 300)


def test_reprocessar_reduz_para_1600_px():
    resultado = Image.open(io.BytesIO(fotos.reprocessar(_jpeg(4000, 3000))))
    assert resultado.size == (1600, 1200)


def test_arquivo_maior_que_5_mb():
    with pytest.raises(FotoGrande):
        fotos.reprocessar(b"0" * (fotos.TAMANHO_MAX_BYTES + 1))


@pytest.mark.parametrize(
    "conteudo",
    [b"isto nao e imagem", None],
    ids=["texto", "gif"],
)
def test_formato_nao_suportado(conteudo):
    if conteudo is None:
        saida = io.BytesIO()
        Image.new("RGB", (10, 10)).save(saida, "GIF")
        conteudo = saida.getvalue()
    with pytest.raises(FotoFormato):
        fotos.reprocessar(conteudo)


def test_imagem_acima_de_40_megapixels():
    with pytest.raises(FotoFormato):
        fotos.reprocessar(_png(8000, 6000))


# --- ArmazenamentoSupabase (HTTP simulado com respx) -----------------------------


@respx.mock
def test_supabase_envia_com_chave_de_servico():
    rota = respx.post("https://abc.supabase.co/storage/v1/object/fotos-barreiras/7/x.webp").mock(
        return_value=httpx.Response(200, json={"Key": "fotos-barreiras/7/x.webp"})
    )
    fotos.ArmazenamentoSupabase("https://abc.supabase.co/", "segredo").enviar("7/x.webp", b"img")
    pedido = rota.calls.last.request
    assert pedido.headers["authorization"] == "Bearer segredo"
    assert pedido.headers["content-type"] == "image/webp"
    assert pedido.content == b"img"


@respx.mock
def test_supabase_fora_do_ar_vira_storage_indisponivel():
    respx.post(url__startswith="https://abc.supabase.co/storage/").mock(
        return_value=httpx.Response(500)
    )
    with pytest.raises(StorageIndisponivel):
        fotos.ArmazenamentoSupabase("https://abc.supabase.co", "segredo").enviar("7/x.webp", b"i")


@respx.mock
def test_supabase_remove_pelo_prefixo():
    rota = respx.delete("https://abc.supabase.co/storage/v1/object/fotos-barreiras").mock(
        return_value=httpx.Response(200, json=[])
    )
    fotos.ArmazenamentoSupabase("https://abc.supabase.co", "segredo").remover("7/x.webp")
    assert json.loads(rota.calls.last.request.content) == {"prefixes": ["7/x.webp"]}


def test_criar_armazenamento():
    assert fotos.criar_armazenamento(None, "x") is None
    assert fotos.criar_armazenamento("https://abc.supabase.co", None) is None
    assert isinstance(
        fotos.criar_armazenamento("https://abc.supabase.co", "x"), fotos.ArmazenamentoSupabase
    )


# --- anexar/remover (com banco) ---------------------------------------------------


@pytest.fixture
def barreira(db_transacional, criar_usuario):
    autor = criar_usuario()
    entrada = BarreiraIn(
        categoria="escada", lat=-23.59, lon=-46.635, chave_idempotencia=uuid.uuid4()
    )
    return autor, barreiras.criar(db_transacional, autor, entrada, AGORA)[0]


@pytest.mark.integration
def test_autor_anexa_e_troca_foto(db_transacional, barreira, armazenamento_memoria, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://abc.supabase.co")
    autor, b = barreira
    primeira = fotos.anexar_foto(
        db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    assert primeira.foto_descricao == DESCRICAO
    assert primeira.foto_url.startswith(
        f"https://abc.supabase.co/storage/v1/object/public/fotos-barreiras/{b.id}/"
    )
    assert len(armazenamento_memoria.objetos) == 1
    segunda = fotos.anexar_foto(
        db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    assert segunda.foto_url != primeira.foto_url
    assert len(armazenamento_memoria.objetos) == 1  # a anterior foi apagada
    tipos = [e.tipo for e in barreiras.listar_eventos(db_transacional, b.id)]
    assert tipos.count("foto") == 2


@pytest.mark.integration
def test_outra_pessoa_nao_anexa_mas_admin_anexa(
    db_transacional, barreira, armazenamento_memoria, criar_usuario
):
    _, b = barreira
    with pytest.raises(SemPermissao):
        fotos.anexar_foto(
            db_transacional, criar_usuario(), b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
        )
    resultado = fotos.anexar_foto(
        db_transacional,
        criar_usuario("admin"),
        b.id,
        _jpeg(),
        DESCRICAO,
        armazenamento_memoria,
        AGORA,
    )
    assert resultado.foto_descricao == DESCRICAO


@pytest.mark.integration
@pytest.mark.parametrize("descricao", ["abcd", "x" * 301, "    "])
def test_descricao_da_foto_invalida(db_transacional, barreira, armazenamento_memoria, descricao):
    autor, b = barreira
    with pytest.raises(DescricaoFotoInvalida):
        fotos.anexar_foto(
            db_transacional, autor, b.id, _jpeg(), descricao, armazenamento_memoria, AGORA
        )


@pytest.mark.integration
def test_sem_armazenamento_configurado(db_transacional, barreira):
    autor, b = barreira
    with pytest.raises(StorageIndisponivel):
        fotos.anexar_foto(db_transacional, autor, b.id, _jpeg(), DESCRICAO, None, AGORA)


@pytest.mark.integration
def test_remover_foto(db_transacional, barreira, armazenamento_memoria):
    autor, b = barreira
    fotos.anexar_foto(
        db_transacional, autor, b.id, _jpeg(), DESCRICAO, armazenamento_memoria, AGORA
    )
    resultado = fotos.remover_foto(db_transacional, autor, b.id, armazenamento_memoria, AGORA)
    assert (resultado.foto_url, resultado.foto_descricao) == (None, None)
    assert armazenamento_memoria.objetos == {}
