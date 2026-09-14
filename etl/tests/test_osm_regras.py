from etl.osm_regras import (
    BLOQUEIO,
    classificar_kerb,
    eh_via_de_pedestre,
    esquema_calcada,
    fator_custo,
)


class TestClassificarKerb:
    def test_yes_e_guia_de_altura_indeterminada_nunca_acessivel(self):
        assert classificar_kerb(["yes"]) == ("yes", None)

    def test_pior_caso_entre_extremidades_raised_vence_lowered(self):
        assert classificar_kerb(["lowered", "raised"]) == ("raised", False)

    def test_flush_e_none_e_transponivel(self):
        assert classificar_kerb(["flush", None]) == ("flush", True)

    def test_lista_vazia_e_desconhecido(self):
        assert classificar_kerb([]) == (None, None)

    def test_somente_none_e_desconhecido(self):
        assert classificar_kerb([None, None]) == (None, None)

    def test_no_e_transponivel(self):
        assert classificar_kerb(["no"]) == ("no", True)

    def test_rolled_e_barreira(self):
        assert classificar_kerb(["rolled"]) == ("rolled", False)

    def test_yes_vence_lowered_pois_e_o_pior_caso(self):
        # kerb=yes é "existe guia, altura indeterminada": nunca pode virar acessível,
        # mesmo que a outra extremidade seja lowered.
        assert classificar_kerb(["lowered", "yes"]) == ("yes", None)


class TestEsquemaCalcada:
    def test_footway_sidewalk_e_geometria_propria(self):
        assert esquema_calcada({"footway": "sidewalk"}) == "geometria_propria"

    def test_sidewalk_both_e_atributo_via(self):
        assert esquema_calcada({"highway": "residential", "sidewalk": "both"}) == "atributo_via"

    def test_sidewalk_left_e_atributo_via(self):
        assert esquema_calcada({"highway": "residential", "sidewalk": "left"}) == "atributo_via"

    def test_sem_footway_nem_sidewalk_e_via_generica(self):
        assert esquema_calcada({"highway": "residential"}) == "via_generica"

    def test_sidewalk_none_e_via_generica(self):
        assert esquema_calcada({"highway": "residential", "sidewalk": "none"}) == "via_generica"


class TestFatorCusto:
    def test_steps_bloqueia(self):
        assert fator_custo({"highway": "steps"}, None) == BLOQUEIO

    def test_wheelchair_no_bloqueia(self):
        assert fator_custo({"highway": "footway", "wheelchair": "no"}, True) == BLOQUEIO

    def test_kerb_e_surface_ruim_combinam_multiplicando(self):
        assert fator_custo({"highway": "footway", "surface": "cobblestone"}, False) == 75.0

    def test_kerb_transponivel_false_sozinho(self):
        assert fator_custo({"highway": "footway"}, False) == 25.0

    def test_surface_ruim_sozinho(self):
        assert fator_custo({"highway": "footway", "surface": "gravel"}, True) == 3.0

    def test_smoothness_ruim_sozinho(self):
        assert fator_custo({"highway": "footway", "smoothness": "bad"}, True) == 5.0

    def test_padrao_sem_nenhum_problema(self):
        assert fator_custo({"highway": "footway"}, True) == 1.0

    def test_padrao_sem_kerb_informado(self):
        assert fator_custo({"highway": "footway"}, None) == 1.0


class TestEhViaDePedestre:
    def test_motorway_e_falso(self):
        assert eh_via_de_pedestre({"highway": "motorway"}) is False

    def test_cycleway_com_foot_yes_e_verdadeiro(self):
        assert eh_via_de_pedestre({"highway": "cycleway", "foot": "yes"}) is True

    def test_cycleway_sem_foot_e_falso(self):
        assert eh_via_de_pedestre({"highway": "cycleway"}) is False

    def test_cycleway_com_foot_designated_e_verdadeiro(self):
        assert eh_via_de_pedestre({"highway": "cycleway", "foot": "designated"}) is True

    def test_footway_e_verdadeiro(self):
        assert eh_via_de_pedestre({"highway": "footway"}) is True

    def test_foot_no_e_falso(self):
        assert eh_via_de_pedestre({"highway": "residential", "foot": "no"}) is False

    def test_access_private_e_falso(self):
        assert eh_via_de_pedestre({"highway": "residential", "access": "private"}) is False

    def test_sem_highway_e_falso(self):
        assert eh_via_de_pedestre({}) is False

    def test_construction_e_falso(self):
        assert eh_via_de_pedestre({"highway": "construction"}) is False

    def test_trunk_link_e_falso(self):
        assert eh_via_de_pedestre({"highway": "trunk_link"}) is False
