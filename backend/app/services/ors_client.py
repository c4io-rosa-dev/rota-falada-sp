"""Cliente do OpenRouteService (perfil wheelchair) com cotas, erros mapeados e fixtures.

A chave do ORS nunca sai do servidor. Todas as chamadas são POST, conforme a API do ORS
exige para o corpo com `options` (avoid_polygons, profile_params etc.).
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from app.config import Settings

DIRETORIO_FIXTURES_PADRAO = Path(__file__).resolve().parent.parent / "fixtures" / "ors"

# codigo -> mensagem padrão de OrsErro, para logs e depuração.
_MENSAGENS_ERRO = {
    "sem_rota": "O ORS não encontrou rota acessível para os pontos e restrições pedidos.",
    "cota_diaria": "Cota diária do ORS esgotada.",
    "cota_minuto": "Cota por minuto do ORS esgotada (limite de 40 requisições/min).",
    "entrada_invalida": "O ORS rejeitou a requisição (entrada inválida).",
    "indisponivel": "O ORS está indisponível no momento (timeout ou erro do servidor).",
}


@dataclass
class EstadoCota:
    """Estado mutável e compartilhado da cota do ORS.

    Atualizado a cada resposta do ORS e lido pelo endpoint /health.
    """

    restante: int | None = None
    reset_em: datetime | None = None
    atualizado_em: datetime | None = None


class OrsErro(Exception):
    """Erro do ORS já traduzido para um código estável do domínio.

    codigo: 'sem_rota' | 'cota_diaria' | 'cota_minuto' | 'entrada_invalida' | 'indisponivel'
    """

    def __init__(self, codigo: str, mensagem: str | None = None):
        self.codigo = codigo
        super().__init__(mensagem or _MENSAGENS_ERRO.get(codigo, codigo))


class OrsClient:
    """Cliente HTTP real do OpenRouteService, perfil `wheelchair`."""

    def __init__(self, chave: str, base_url: str, timeout_s: float, estado: EstadoCota):
        self.chave = chave
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.estado = estado

    def rota(
        self,
        coords: list[tuple[float, float]],
        *,
        restricoes: dict,
        evitar_degraus: bool,
        avoid_polygons: dict | None,
    ) -> dict:
        """POST /v2/directions/wheelchair/geojson.

        coords: lista de (lng, lat), na ordem já usada pelo ORS.
        Body: {"coordinates": [[lng,lat],...], "elevation": true, "instructions": true,
               "language": "pt", "extra_info": ["steepness","surface","waytype"], "units": "m",
               "options": {"avoid_features": ["steps"] se evitar_degraus,
                           "profile_params": {"restrictions": restricoes},
                           "avoid_polygons": avoid_polygons (omitido se None)}}
        Sempre atualiza self.estado.restante/reset_em/atualizado_em a partir dos headers
        x-ratelimit-remaining/x-ratelimit-reset (quando presentes na resposta).
        Mapeia: 403->cota_diaria, 429->cota_minuto, 404 com error.code 2009/2010 -> sem_rota,
        400/406 -> entrada_invalida, timeout/5xx -> indisponivel.
        """
        opcoes: dict[str, Any] = {"profile_params": {"restrictions": restricoes}}
        if evitar_degraus:
            opcoes["avoid_features"] = ["steps"]
        if avoid_polygons is not None:
            opcoes["avoid_polygons"] = avoid_polygons

        corpo = {
            "coordinates": [[lng, lat] for lng, lat in coords],
            "elevation": True,
            "instructions": True,
            "language": "pt",
            "extra_info": ["steepness", "surface", "waytype"],
            "units": "m",
            "options": opcoes,
        }
        cabecalhos = {"Authorization": self.chave, "Content-Type": "application/json"}
        url = f"{self.base_url}/v2/directions/wheelchair/geojson"

        try:
            resposta = httpx.post(url, json=corpo, headers=cabecalhos, timeout=self.timeout_s)
        except httpx.TimeoutException as exc:
            raise OrsErro("indisponivel") from exc
        except httpx.HTTPError as exc:
            raise OrsErro("indisponivel") from exc

        self._atualizar_cota(resposta.headers)

        if resposta.status_code == 200:
            return resposta.json()
        if resposta.status_code == 403:
            raise OrsErro("cota_diaria")
        if resposta.status_code == 429:
            raise OrsErro("cota_minuto")
        if resposta.status_code == 404:
            codigo_ors = _codigo_erro_ors(resposta)
            if codigo_ors in (2009, 2010):
                raise OrsErro("sem_rota")
            raise OrsErro("indisponivel")
        if resposta.status_code in (400, 406):
            raise OrsErro("entrada_invalida")
        raise OrsErro("indisponivel")

    def _atualizar_cota(self, headers: httpx.Headers) -> None:
        restante = headers.get("x-ratelimit-remaining")
        reset = headers.get("x-ratelimit-reset")
        if restante is not None:
            self.estado.restante = int(restante)
        if reset is not None:
            self.estado.reset_em = datetime.fromtimestamp(int(reset), tz=UTC)
        self.estado.atualizado_em = datetime.now(UTC)


def _codigo_erro_ors(resposta: httpx.Response) -> int | None:
    try:
        corpo = resposta.json()
    except ValueError:
        return None
    if not isinstance(corpo, dict):
        return None
    erro = corpo.get("error")
    if not isinstance(erro, dict):
        return None
    return erro.get("code")


class OrsFixtureClient(OrsClient):
    """Cliente de fixtures: nunca chama a rede. Usado quando USE_FIXTURES=true ou sem ORS_API_KEY.

    Escolhe o arquivo `<nome>.json` pelo arredondamento (5 casas) das coordenadas de
    origem/destino + a inclinação pedida. Se não houver fixture exata, usa a fixture
    'generica.json' transladada (translação linear de lng/lat) para as coordenadas
    pedidas, mantendo a forma (distâncias relativas) da geometria original.
    """

    def __init__(
        self,
        chave: str,
        base_url: str,
        timeout_s: float,
        estado: EstadoCota,
        diretorio_fixtures: Path | None = None,
    ):
        super().__init__(chave, base_url, timeout_s, estado)
        self.diretorio_fixtures = diretorio_fixtures or DIRETORIO_FIXTURES_PADRAO

    def rota(
        self,
        coords: list[tuple[float, float]],
        *,
        restricoes: dict,
        evitar_degraus: bool,
        avoid_polygons: dict | None,
    ) -> dict:
        origem = coords[0]
        destino = coords[-1]
        inclinacao = restricoes.get("maximum_incline", "any")

        nome = _nome_fixture(origem, destino, inclinacao)
        caminho = self.diretorio_fixtures / f"{nome}.json"
        if caminho.exists():
            conteudo = json.loads(caminho.read_text(encoding="utf-8"))
        else:
            caminho_generica = self.diretorio_fixtures / "generica.json"
            conteudo = json.loads(caminho_generica.read_text(encoding="utf-8"))
            conteudo = _traduzir_feature_collection(conteudo, origem)

        codigo_erro = conteudo.get("erro_codigo") if isinstance(conteudo, dict) else None
        if codigo_erro is not None:
            raise OrsErro(codigo_erro)
        return conteudo


def _nome_fixture(
    origem: tuple[float, float], destino: tuple[float, float], inclinacao: int | str
) -> str:
    lng_o, lat_o = origem
    lng_d, lat_d = destino
    return f"{round(lat_o, 5)}_{round(lng_o, 5)}_{round(lat_d, 5)}_{round(lng_d, 5)}_{inclinacao}"


def _traduzir_feature_collection(colecao: dict, origem: tuple[float, float]) -> dict:
    """Translada (lng, lat) de toda a geometria da 1ª feature para que comece em `origem`.

    Mantém a forma (distâncias relativas) da fixture genérica; a elevação (3ª coordenada)
    não é alterada.
    """
    nova = copy.deepcopy(colecao)
    coordenadas = nova["features"][0]["geometry"]["coordinates"]
    lng_origem_fixture, lat_origem_fixture = coordenadas[0][0], coordenadas[0][1]
    delta_lng = origem[0] - lng_origem_fixture
    delta_lat = origem[1] - lat_origem_fixture

    nova["features"][0]["geometry"]["coordinates"] = [
        [ponto[0] + delta_lng, ponto[1] + delta_lat, *ponto[2:]] for ponto in coordenadas
    ]
    return nova


def criar_cliente(settings: Settings) -> OrsClient:
    """Fábrica: OrsFixtureClient se USE_FIXTURES=true ou sem ORS_API_KEY; senão OrsClient real."""
    estado = EstadoCota()
    if settings.use_fixtures or not settings.ors_api_key:
        return OrsFixtureClient(
            chave=settings.ors_api_key or "",
            base_url=settings.ors_base_url,
            timeout_s=settings.ors_timeout_s,
            estado=estado,
        )
    return OrsClient(
        chave=settings.ors_api_key,
        base_url=settings.ors_base_url,
        timeout_s=settings.ors_timeout_s,
        estado=estado,
    )
