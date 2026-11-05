"""camada colaborativa: usuario, confirmacao, barreira_evento e barreira_colaborativa completa

Spec: docs/superpowers/specs/2026-11-02-colaborativo-design.md, seção 3.
Categorias de barreira viram lista fechada; linhas antigas fora da lista
passam a `outro`. `barreira_evento` é só inserção (trigger). RLS ligado em
todas as tabelas novas, como desde a 005.

Revision ID: 008_colaborativo
Revises: 007_area_ipiranga_fatec
Create Date: 2026-11-02
"""

from alembic import op

revision = "008_colaborativo"
down_revision = "007_area_ipiranga_fatec"
branch_labels = None
depends_on = None

CATEGORIAS = (
    "escada",
    "sem_rampa",
    "elevador_quebrado",
    "obstaculo_bloqueando",
    "calcada_estreita",
    "rampa_ingreme",
    "buraco",
    "piso_irregular",
    "sem_piso_tatil",
    "outro",
)
_LISTA_SQL = ", ".join(f"'{c}'" for c in CATEGORIAS)


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE usuario (
          id uuid PRIMARY KEY,
          papel text NOT NULL DEFAULT 'colaborador' CHECK (papel IN ('colaborador','admin')),
          criado_em timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        f"""
        UPDATE barreira_colaborativa SET categoria = 'outro'
        WHERE categoria NOT IN ({_LISTA_SQL});

        ALTER TABLE barreira_colaborativa
          ADD COLUMN autor_id uuid REFERENCES usuario(id),
          ADD COLUMN chave_idempotencia uuid,
          ADD COLUMN ultima_confirmacao_em timestamptz,
          ADD COLUMN foto_caminho text,
          ADD COLUMN foto_descricao text,
          ADD CONSTRAINT barreira_colaborativa_categoria_check
            CHECK (categoria IN ({_LISTA_SQL})),
          ADD CONSTRAINT barreira_colaborativa_foto_check
            CHECK ((foto_caminho IS NULL) = (foto_descricao IS NULL)),
          ADD CONSTRAINT barreira_colaborativa_idempotencia_key
            UNIQUE (autor_id, chave_idempotencia);

        ALTER TABLE barreira_colaborativa DROP CONSTRAINT barreira_colaborativa_status_check;
        ALTER TABLE barreira_colaborativa ADD CONSTRAINT barreira_colaborativa_status_check
          CHECK (status IN ('pendente','validada','contestada','resolvida','expirada','removida'));

        CREATE INDEX barreira_colaborativa_autor_criado_idx
          ON barreira_colaborativa (autor_id, criado_em);
        """
    )
    op.execute(
        """
        CREATE TABLE confirmacao (
          id bigserial PRIMARY KEY,
          barreira_id bigint NOT NULL REFERENCES barreira_colaborativa(id),
          usuario_id uuid NOT NULL REFERENCES usuario(id),
          voto text NOT NULL CHECK (voto IN ('confirma','contesta','resolvida')),
          criado_em timestamptz NOT NULL DEFAULT now(),
          atualizado_em timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT confirmacao_voto_unico UNIQUE (barreira_id, usuario_id)
        );

        CREATE TABLE barreira_evento (
          id bigserial PRIMARY KEY,
          barreira_id bigint REFERENCES barreira_colaborativa(id),
          usuario_id uuid REFERENCES usuario(id),
          tipo text NOT NULL
            CHECK (tipo IN ('criada','voto','status','foto','admin','promocao')),
          de_status text,
          para_status text,
          detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
          criado_em timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX barreira_evento_barreira_idx ON barreira_evento (barreira_id, id);

        CREATE FUNCTION barreira_evento_imutavel() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'barreira_evento é só inserção (auditoria imutável)';
        END;
        $$;
        CREATE TRIGGER barreira_evento_sem_update_delete
          BEFORE UPDATE OR DELETE ON barreira_evento
          FOR EACH ROW EXECUTE FUNCTION barreira_evento_imutavel();

        ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
        ALTER TABLE confirmacao ENABLE ROW LEVEL SECURITY;
        ALTER TABLE barreira_evento ENABLE ROW LEVEL SECURITY;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE barreira_evento;
        DROP FUNCTION barreira_evento_imutavel();
        DROP TABLE confirmacao;
        UPDATE barreira_colaborativa SET status = 'expirada' WHERE status = 'removida';
        ALTER TABLE barreira_colaborativa DROP CONSTRAINT barreira_colaborativa_status_check;
        ALTER TABLE barreira_colaborativa ADD CONSTRAINT barreira_colaborativa_status_check
          CHECK (status IN ('pendente','validada','contestada','resolvida','expirada'));
        DROP INDEX barreira_colaborativa_autor_criado_idx;
        ALTER TABLE barreira_colaborativa
          DROP CONSTRAINT barreira_colaborativa_idempotencia_key,
          DROP CONSTRAINT barreira_colaborativa_foto_check,
          DROP CONSTRAINT barreira_colaborativa_categoria_check,
          DROP COLUMN foto_descricao,
          DROP COLUMN foto_caminho,
          DROP COLUMN ultima_confirmacao_em,
          DROP COLUMN chave_idempotencia,
          DROP COLUMN autor_id;
        DROP TABLE usuario;
        """
    )
