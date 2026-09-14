"""Regras puras de classificação e custo do grafo de pedestres do OSM.

Nenhuma função aqui faz I/O (rede, disco ou banco): tudo é testável com
dicionários de tags e listas de valores, o que permite cobrir os casos de
acessibilidade (guia alta, escada, piso ruim) sem subir um banco.
"""

KERB_TRANSPONIVEL = {"lowered", "flush", "no"}
KERB_BARREIRA = {"raised", "rolled"}

VIAS_EXCLUIDAS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "construction",
    "proposed",
    "raceway",
    "bus_guideway",
    "busway",
}

SUPERFICIE_RUIM = {
    "cobblestone",
    "sett",
    "gravel",
    "sand",
    "ground",
    "dirt",
    "grass",
    "unpaved",
    "pebblestone",
}
SMOOTHNESS_RUIM = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
BLOQUEIO = 1_000_000.0


def classificar_kerb(valores: list[str | None]) -> tuple[str | None, bool | None]:
    """Pior caso entre as guias das extremidades da aresta.

    ``kerb=yes`` significa "existe guia de altura indeterminada": é sempre o
    pior caso possível, mesmo diante de uma extremidade `lowered`, porque
    nunca podemos assumir que a guia é transponível.

    raised/rolled -> (valor, False); lowered/flush/no -> (valor, True);
    yes -> ('yes', None); nenhum valor -> (None, None).
    """
    presentes = [v for v in valores if v]
    if not presentes:
        return (None, None)
    if "yes" in presentes:
        return ("yes", None)
    barreiras = [v for v in presentes if v in KERB_BARREIRA]
    if barreiras:
        return (barreiras[0], False)
    transponiveis = [v for v in presentes if v in KERB_TRANSPONIVEL]
    if transponiveis:
        return (transponiveis[0], True)
    # valor desconhecido (fora do vocabulário usual do OSM): mantém o texto,
    # mas não arrisca classificar como acessível.
    return (presentes[0], None)


def esquema_calcada(tags: dict) -> str:
    """Classifica o esquema de mapeamento da calçada usado nesta via.

    footway=sidewalk -> 'geometria_propria' (a calçada é uma via em separado);
    sidewalk em {left,right,both,yes,separate} -> 'atributo_via' (a calçada é
    um atributo da via principal); senão -> 'via_generica'.
    """
    if tags.get("footway") == "sidewalk":
        return "geometria_propria"
    if tags.get("sidewalk") in {"left", "right", "both", "yes", "separate"}:
        return "atributo_via"
    return "via_generica"


def fator_custo(tags: dict, kerb_transponivel: bool | None) -> float:
    """Multiplicador de custo aplicado ao comprimento da aresta.

    steps ou wheelchair=no -> bloqueia (BLOQUEIO); guia intransponível -> 25x;
    piso ruim -> 3x; piso muito irregular (smoothness) -> 5x; os fatores se
    combinam multiplicando; sem nenhum problema -> 1.0.
    """
    if tags.get("highway") == "steps" or tags.get("wheelchair") == "no":
        return BLOQUEIO

    fator = 1.0
    if kerb_transponivel is False:
        fator *= 25.0
    if tags.get("surface") in SUPERFICIE_RUIM:
        fator *= 3.0
    if tags.get("smoothness") in SMOOTHNESS_RUIM:
        fator *= 5.0
    return fator


def eh_via_de_pedestre(tags: dict) -> bool:
    """Diz se a via deve entrar no grafo de pedestres.

    Exige `highway` presente e fora da lista de vias exclusivas de veículo;
    exclui explicitamente `foot=no`, `access=private` e ciclovias sem
    `foot=yes`/`foot=designated`.
    """
    highway = tags.get("highway")
    if not highway or highway in VIAS_EXCLUIDAS:
        return False
    if tags.get("foot") == "no" or tags.get("access") == "private":
        return False
    if highway == "cycleway" and tags.get("foot") not in {"yes", "designated"}:
        return False
    return True
