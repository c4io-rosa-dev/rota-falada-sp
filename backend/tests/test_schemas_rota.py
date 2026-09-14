from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.rota import (
    Aviso,
    BarreiraResumo,
    Coordenada,
    Passo,
    PerfilAcessibilidade,
    RotaIn,
    RotaOut,
)


def test_coordenada_rejeita_latitude_fora_do_intervalo():
    with pytest.raises(ValidationError):
        Coordenada(lat=91, lng=-46.63)


def test_coordenada_rejeita_longitude_fora_do_intervalo():
    with pytest.raises(ValidationError):
        Coordenada(lat=-23.59, lng=-181)


def test_coordenada_aceita_valores_no_limite():
    coordenada = Coordenada(lat=-90, lng=180)
    assert coordenada.lat == -90
    assert coordenada.lng == 180


def test_perfil_acessibilidade_tem_defaults_do_spec():
    perfil = PerfilAcessibilidade()
    assert perfil.inclinacao_max == 6
    assert perfil.guia_max_m == 0.06
    assert perfil.largura_min_m == 0.9
    assert perfil.evitar_degraus is True
    assert perfil.velocidade_kmh == 3.0


def test_perfil_acessibilidade_rejeita_largura_min_fora_do_intervalo():
    with pytest.raises(ValidationError):
        PerfilAcessibilidade(largura_min_m=0.1)


def test_perfil_acessibilidade_rejeita_inclinacao_fora_do_dominio():
    with pytest.raises(ValidationError):
        PerfilAcessibilidade(inclinacao_max=5)


def test_rota_in_usa_perfil_default_quando_omitido():
    entrada = RotaIn(
        origem=Coordenada(lat=-23.59, lng=-46.63),
        destino=Coordenada(lat=-23.60, lng=-46.64),
    )
    assert entrada.perfil == PerfilAcessibilidade()


def test_rota_in_rejeita_latitude_invalida_na_origem():
    with pytest.raises(ValidationError):
        RotaIn(
            origem={"lat": 91, "lng": -46.63},
            destino={"lat": -23.60, "lng": -46.64},
        )


def _passo_exemplo() -> Passo:
    return Passo(
        ordem=1,
        instrucao="Siga pela Rua X por 120 m",
        distancia_m=120.0,
        duracao_s=90.0,
        direcao="reto",
        largura_m=1.2,
        largura_medida=True,
        declividade_pct=3.0,
        declividade_medida=True,
        guia="transponivel",
        is_degrau=False,
        barreiras_proximas=[
            BarreiraResumo(
                id=1,
                origem="oficial",
                categoria="buraco",
                severidade="dificulta",
                distancia_m=8.0,
                confirmacoes=None,
                data_referencia=date(2026, 1, 1),
            )
        ],
        fonte="osm",
        data_referencia=date(2026, 1, 1),
        geometria={"type": "LineString", "coordinates": [[-46.63, -23.59], [-46.64, -23.60]]},
    )


def test_rota_out_serializa_date_como_iso():
    saida = RotaOut(
        passos=[_passo_exemplo()],
        distancia_m=120.0,
        duracao_s=90.0,
        avisos=[Aviso(tipo="trecho_sem_dados", mensagem="sem conflação num trecho")],
        nivel_exigencia_atendido=6,
        motor="ors",
        fontes=["osm", "geosampa"],
        geometria={"type": "LineString", "coordinates": [[-46.63, -23.59], [-46.64, -23.60]]},
        cache=False,
    )
    dado = saida.model_dump(mode="json")
    assert dado["passos"][0]["data_referencia"] == "2026-01-01"
    assert dado["passos"][0]["barreiras_proximas"][0]["data_referencia"] == "2026-01-01"


def test_aviso_rejeita_tipo_fora_do_dominio():
    with pytest.raises(ValidationError):
        Aviso(tipo="inventado", mensagem="x")
