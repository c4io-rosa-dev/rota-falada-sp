"""Testes da calibração do buffer de conflação (Task 3 do Plano 3):

- `_classificar`/`detectar_joelho` são funções puras (sem banco) testadas com
  casos sintéticos construídos à mão.
- `ler_gabarito`/`escrever_gabarito` são testados com arquivos temporários
  (`tmp_path`), sem tocar `etl/gabarito_conflacao.csv`.
- `gerar_gabarito`/`_resolver_gabarito` são testes de integração (leitura,
  sem escrita) contra o banco real já populado pelas tasks anteriores — nunca
  gravam nada, só consultam `via_pedestre`/`calcada_sp`/`area_piloto`.
"""

from pathlib import Path

import pytest
from etl.calibracao_conflacao import (
    ORIGENS_VALIDAS,
    _classificar,
    _resolver_gabarito,
    detectar_joelho,
    detectar_pico_cobertura,
    escrever_gabarito,
    gerar_gabarito,
    ler_gabarito,
)
from etl.config import DATABASE_URL
from sqlalchemy import create_engine

# --- funções puras: sem banco, sem arquivo -----------------------------------


def test_classificar_acerto_erro_sem_par_e_invalido():
    # via 1: ligada à calçada certa → acerto
    # via 2: ligada à calçada errada → erro
    # via 3: candidato existe mas não ligou (ambígua) → sem_par
    # via 4: nenhum candidato dentro do buffer (nem aparece em linhas_por_via) → sem_par
    # via 5 (osmid sem correspondência em via_pedestre) → invalido
    # via 6 (cd_identificador do gabarito não existe em calcada_sp) → invalido
    linhas_por_via = {
        1: {"ligada": True, "calcada_id": 10},
        2: {"ligada": True, "calcada_id": 99},
        3: {"ligada": False, "calcada_id": None},
    }
    gabarito_resolvido = [
        {
            "via_osmid": "a",
            "via_ids": [1],
            "calcada_id_esperado": 10,
            "origem": "automatico_contido",
        },
        {
            "via_osmid": "b",
            "via_ids": [2],
            "calcada_id_esperado": 10,
            "origem": "automatico_contido",
        },
        {
            "via_osmid": "c",
            "via_ids": [3],
            "calcada_id_esperado": 10,
            "origem": "automatico_contido",
        },
        {
            "via_osmid": "d",
            "via_ids": [4],
            "calcada_id_esperado": 10,
            "origem": "automatico_contido",
        },
        {
            "via_osmid": "e",
            "via_ids": [],
            "calcada_id_esperado": 10,
            "origem": "automatico_contido",
        },
        {
            "via_osmid": "f",
            "via_ids": [6],
            "calcada_id_esperado": None,
            "origem": "automatico_contido",
        },
    ]

    resultado = _classificar(linhas_por_via, gabarito_resolvido)

    assert resultado == {
        "acertos": 1,
        "erros": 1,
        "sem_par": 2,
        "invalidos": 2,
        "total": 6,
    }


def test_classificar_via_com_osmid_duplicado_prioriza_acerto_sobre_erro():
    # osmid ambíguo (mais de um via_id): se qualquer um dos segmentos bateu
    # com a calçada certa, conta acerto — mesmo que outro segmento do mesmo
    # osmid tenha ligado errado.
    linhas_por_via = {
        101: {"ligada": True, "calcada_id": 5},
        102: {"ligada": True, "calcada_id": 9},
    }
    gabarito_resolvido = [
        {
            "via_osmid": "x",
            "via_ids": [101, 102],
            "calcada_id_esperado": 5,
            "origem": "automatico_contido",
        },
    ]

    resultado = _classificar(linhas_por_via, gabarito_resolvido)

    assert resultado["acertos"] == 1
    assert resultado["erros"] == 0


def test_detectar_joelho_encontra_estabilizacao():
    buffers = [2, 3, 5, 8, 10, 15]
    # acertos sobem forte até o buffer 5 (60 -> 75 -> 90), depois quase param
    # (90 -> 91 -> 91.5 -> 91.8), enquanto erros continuam subindo a partir daí.
    acertos_pct = [60.0, 75.0, 90.0, 91.0, 91.5, 91.8]
    erros_pct = [0.0, 1.0, 2.0, 5.0, 8.0, 12.0]

    joelho, recomendado = detectar_joelho(buffers, acertos_pct, erros_pct)

    assert (
        joelho == 8
    )  # primeiro buffer em que o ganho de acerto cai abaixo de 2pp com erro subindo
    assert recomendado == 5  # buffer anterior — melhor custo-benefício


def test_detectar_joelho_sem_estabilizacao_recomenda_maior_buffer():
    buffers = [2, 3, 5]
    acertos_pct = [10.0, 30.0, 60.0]  # sempre crescendo forte
    erros_pct = [0.0, 0.0, 0.0]

    joelho, recomendado = detectar_joelho(buffers, acertos_pct, erros_pct)

    assert joelho is None
    assert recomendado == 5


def test_detectar_pico_cobertura_acha_o_maximo():
    # cobertura sobe, atinge o pico em 5 (o método 'mesmo_lado' passa a
    # recusar mais empates conforme o buffer cresce, derrubando a cobertura
    # depois do pico) e nunca mais alcança esse valor de novo.
    buffers = [2, 3, 5, 8, 10, 15]
    cobertura_pct = [34.2, 38.7, 43.9, 41.8, 41.9, 42.6]

    assert detectar_pico_cobertura(buffers, cobertura_pct) == 5


def test_detectar_pico_cobertura_empate_prefere_o_menor_buffer():
    buffers = [2, 3, 5]
    cobertura_pct = [50.0, 50.0, 40.0]

    assert detectar_pico_cobertura(buffers, cobertura_pct) == 2


# --- leitura/escrita do CSV: arquivo temporário, sem banco -------------------


def test_escrever_e_ler_gabarito_roundtrip(tmp_path: Path):
    caminho = tmp_path / "gabarito.csv"
    linhas = [
        {
            "via_osmid": "123",
            "calcada_cd_identificador": "SP-1",
            "origem": "automatico_contido",
            "observacao": "gerado automaticamente",
        },
        {
            "via_osmid": "456",
            "calcada_cd_identificador": "SP-2",
            "origem": "manual_streetview",
            "observacao": "conferido no Street View",
        },
    ]

    escrever_gabarito(caminho, linhas)
    lidas = ler_gabarito(caminho)

    assert lidas == linhas
    # separador é ';' (não ',') — confirma o formato exigido pelo plano
    conteudo = caminho.read_text(encoding="utf-8")
    assert (
        conteudo.splitlines()[0]
        == "via_osmid;calcada_cd_identificador;origem;observacao"
    )


def test_ler_gabarito_recusa_origem_invalida(tmp_path: Path):
    caminho = tmp_path / "gabarito_invalido.csv"
    caminho.write_text(
        "via_osmid;calcada_cd_identificador;origem;observacao\n123;SP-1;gerado_por_ia;\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="origem"):
        ler_gabarito(caminho)


def test_origens_validas_contem_as_duas_do_plano():
    assert ORIGENS_VALIDAS == {"automatico_contido", "manual_streetview"}


# --- integração: leitura contra o banco real (nunca escreve) -----------------


@pytest.mark.integration
def test_gerar_gabarito_automatico_contra_banco_real():
    engine = create_engine(DATABASE_URL)
    linhas = gerar_gabarito(engine, por_recorte=20)

    assert linhas  # há pelo menos algum caso inequívoco na área piloto
    assert len(linhas) <= 60
    osmids = [linha["via_osmid"] for linha in linhas]
    assert len(osmids) == len(
        set(osmids)
    )  # osmid único: cada via_osmid aparece uma vez
    for linha in linhas:
        assert linha["origem"] == "automatico_contido"
        assert linha["calcada_cd_identificador"]  # nunca vazio


@pytest.mark.integration
def test_resolver_gabarito_encontra_via_e_calcada_gerados():
    engine = create_engine(DATABASE_URL)
    linhas = gerar_gabarito(engine, por_recorte=5)
    if not linhas:
        pytest.skip("nenhum caso automático inequívoco encontrado nesta base")

    with engine.connect() as conexao:
        resolvido = _resolver_gabarito(conexao, linhas)

    assert len(resolvido) == len(linhas)
    for linha in resolvido:
        assert linha["via_ids"], (
            f"osmid {linha['via_osmid']} não resolveu para nenhum via_id"
        )
        assert linha["calcada_id_esperado"] is not None
