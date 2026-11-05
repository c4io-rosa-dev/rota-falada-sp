# Design — Camada colaborativa (Plano 6, backend)

**Data:** 02/11/2026 · **Plano:** 6 (camada colaborativa) · **Branch:** `feat/backend` (sobre o geocode, ainda não mergeado)
**Spec-mãe:** `2026-09-08-rotas-acessiveis-sp-design.md` (persona Sr. Antônio; tabela de severidade da seção 6; riscos "vandalismo" e "LGPD"; decisão 5, licença ODbL das contribuições)

## 1. Objetivo

Permitir que a pessoa logada cadastre uma barreira, que outras pessoas a confirmem, contestem ou marquem como resolvida, e que a rota mude quando a barreira é validada. É o critério de saída do Plano 6: "usuário cadastra barreira e a rota muda". A camada colaborativa nunca é cortada (spec-mãe, ordem de corte).

## 2. Decisões tomadas (02/11/2026)

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Escopo inclui a foto opcional** | Decisão do dono. A foto continua opcional: exigi-la excluiria o usuário cego de colaborar |
| D2 | **Login por código de 6 dígitos no e-mail** (OTP do Supabase Auth), sem senha, uma conta por e-mail | Torna o voto único real (contas não são grátis de criar); o código é legível por leitor de tela; com a sessão salva, o reporte seguinte volta a 3 toques |
| D3 | **Papel `admin`** com poder de decisão (validar, rejeitar, resolver, remover, reverter), sempre auditado | Demo ("a barreira foi validada e a rota mudou") e retirada imediata de barreira falsa denunciada |
| D4 | **Conta de admin de teste: `caiorosa2006@gmail.com`**, promovida pelo script `promover_admin` depois do primeiro login | Pedido do dono |
| D5 | **Regras de moderação** da seção 6.2, aceitas como propostas | Seguem o spec-mãe onde ele já fixa números (2 confirmações para intransponível, 1 para dificulta) |
| D6 | **Moderação em Python (função pura) + expiração calculada na leitura** + comando `expirar` que grava status e evento | Testável sem banco, determinístico, sem infraestrutura nova; a rota nunca usa barreira vencida |
| D7 | **Severidade derivada da categoria** (lista fechada) | Um toque a menos e impossível escolher severidade errada; spec-mãe pede categoria por lista fechada |
| D8 | **Foto passa pelo backend e é reprocessada** (Pillow → WebP sem metadados) antes de ir ao Supabase Storage | Única forma de garantir que o GPS do EXIF some (LGPD); as imagens são servidas pela CDN do Supabase, não pelo Render (5 GB/mês de saída) |
| D9 | **Nenhuma resposta pública expõe autor ou votantes** | LGPD; só a auditoria de admin mostra ids de usuário |

## 3. Dados — migration `008_colaborativo`

### 3.1 `usuario` (nova)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `uuid` PK | O `sub` do token do Supabase |
| `papel` | `text` NOT NULL DEFAULT `'colaborador'`, CHECK em (`colaborador`, `admin`) | |
| `criado_em` | `timestamptz` NOT NULL DEFAULT `now()` | |

Não guarda e-mail (o Supabase já guarda; menos dado pessoal aqui). A linha nasce no primeiro acesso autenticado.

### 3.2 `barreira_colaborativa` (alterada; criada mínima na 004)

Colunas novas:

| Coluna | Tipo | Observação |
|---|---|---|
| `autor_id` | `uuid` REFERENCES `usuario(id)` | NULL nas linhas antigas da 004 |
| `chave_idempotencia` | `uuid` | `UNIQUE (autor_id, chave_idempotencia)` |
| `ultima_confirmacao_em` | `timestamptz` | Atualizada a cada voto `confirma` |
| `foto_caminho` | `text` | Caminho no bucket; NULL sem foto |
| `foto_descricao` | `text` | Texto alternativo; CHECK: ambos nulos ou ambos preenchidos |

O CHECK de `status` passa a aceitar também `removida`. O CHECK de `categoria` passa a ser a lista fechada abaixo (as linhas da 004 que não estiverem na lista são migradas para `outro`). Toda escrita atualiza `atualizado_em`, que entra no hash de invalidação de `barreira_geom.hash_barreiras`.

### 3.3 Categorias e severidade (D7)

| Severidade | Categorias |
|---|---|
| `intransponivel` | `escada`, `sem_rampa`, `elevador_quebrado`, `obstaculo_bloqueando` |
| `dificulta` | `calcada_estreita`, `rampa_ingreme`, `buraco`, `piso_irregular` |
| `informativo` | `sem_piso_tatil`, `outro` |

O mapa vive em Python (`services/moderacao.py`), e a coluna `severidade` é gravada a partir dele na criação.

### 3.4 `confirmacao` (nova)

`barreira_id` (FK), `usuario_id` (FK), `voto` text CHECK em (`confirma`, `contesta`, `resolvida`), `criado_em`, `atualizado_em`; `UNIQUE (barreira_id, usuario_id)`.

### 3.5 `barreira_evento` (nova, só inserção)

`id` bigserial, `barreira_id` (FK, NULL permitido para eventos de usuário), `usuario_id` (FK, NULL para o comando `expirar`), `tipo` text CHECK em (`criada`, `voto`, `status`, `foto`, `admin`, `promocao`), `de_status`, `para_status`, `detalhe` jsonb, `criado_em`. Um trigger recusa `UPDATE` e `DELETE`.

RLS ligado em todas as tabelas novas, como desde a 005.

## 4. Login e permissões

1. `app/auth.py`, dependência `usuario_atual`: lê `Authorization: Bearer`; verifica ES256 com o JWKS de `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cliente com cache em memória; recarrega ao ver `kid` desconhecido); exige `aud = "authenticated"`, `iss = {SUPABASE_URL}/auth/v1` e `exp` válido; faz upsert em `usuario`; devolve `UsuarioAtual(id, papel)`.
2. `exigir_admin`: `usuario_atual` + `papel = 'admin'`.
3. Sem token, token inválido ou vencido → 401 (`"Faça login para continuar."`). Logado sem permissão → 403.
4. Configuração nova: `SUPABASE_URL` (pública) e `SUPABASE_SERVICE_ROLE_KEY` (segredo, só no Render, só para o Storage). Dependência nova: `PyJWT[crypto]`.
5. Testes: chave EC gerada no teste, tokens assinados com ela, fonte de chaves substituída por injeção de dependência. Nenhum teste acessa a rede.
6. `python -m scripts.promover_admin --email <e-mail>` (lê `auth.users`; só existe no Supabase) ou `--id <uuid>` (qualquer banco). Grava `papel = 'admin'` e um evento `promocao`.
7. CORS passa a permitir `PUT` e `DELETE` além de `GET` e `POST`.

## 5. API

Routers só validam e traduzem erros; lógica em `services/barreiras.py`, `services/moderacao.py` (pura) e `services/fotos.py`.

### 5.1 Públicas

- `GET /api/barreiras?lat=&lon=&raio_m=` — `raio_m` de 10 a 500 (padrão 200). Devolve `list[BarreiraOut]`, ordenada por distância e depois `id`. Não lista `removida`.
- `GET /api/barreiras/{id}` — um `BarreiraOut`; 404 se não existe ou está `removida`.

`BarreiraOut`: `id`, `categoria`, `severidade`, `status` (efetivo, já com a expiração da seção 6.3), `votos` (`confirma`, `contesta`, `resolvida`), `descricao`, `lat`, `lon`, `criada_em`, `ultima_confirmacao_em`, `foto_url`, `foto_descricao`. **Sem autor nem votantes.**

### 5.2 Com login

- `POST /api/barreiras` — corpo `{categoria, lat, lon, descricao?, chave_idempotencia}`; `descricao` até 500 caracteres; ponto fora de `area_piloto` → 422. Cria com status `pendente` (ou `validada` se `informativo`) e evento `criada`. Mesma `chave_idempotencia` do mesmo autor → 200 com a existente; nova → 201. Mais de 20 criações do mesmo autor nas últimas 24 h → 429.
- `PUT /api/barreiras/{id}/voto` — corpo `{voto}`. Barreira inexistente ou `removida` → 404 (removida não existe para o público, como no `GET`). Autor → 403. Status efetivo `contestada`, `resolvida` ou `expirada` → 409. Devolve o `BarreiraOut` atualizado.
- `POST /api/barreiras/{id}/foto` — multipart: `arquivo` + `descricao` (5 a 300 caracteres). Só autor ou admin (senão 403).
- `DELETE /api/barreiras/{id}/foto` — só autor ou admin.

### 5.3 Admin

- `POST /api/admin/barreiras/{id}/status` — corpo `{status, motivo}` (`motivo` obrigatório, 3 a 300 caracteres); qualquer status, inclusive `removida` e de volta.
- `GET /api/admin/barreiras/{id}/eventos` — auditoria completa, com ids de usuário.

## 6. Moderação, expiração e cache

### 6.1 Fluxo de um voto (uma transação)

1. `SELECT ... FOR UPDATE` na barreira (votos simultâneos ficam em fila).
2. Upsert em `confirmacao`; recontagem dos três tipos de voto.
3. `decidir_status(...)` (pura).
4. Atualiza `status`, `confirmacoes` (= total de `confirma`), `ultima_confirmacao_em` (só em voto `confirma`) e `atualizado_em`.
5. Eventos: `voto` sempre; `status` se mudou.
6. Se "afeta rota" mudou (status `validada` com severidade `intransponivel` ou `dificulta`), chama `cache_rota.invalidar_regiao(ponto)`.

### 6.2 `decidir_status` (ordem de avaliação)

1. Status atual `removida`, `contestada`, `resolvida` ou `expirada` → não muda (só admin muda).
2. `contesta >= 2` → `contestada`.
3. `resolvida >= 2` → `resolvida`.
4. `confirma >= limiar(severidade)` com limiar `intransponivel` 2, `dificulta` 1, `informativo` 0 → `validada`.
5. Senão → `pendente` (inclusive se uma troca de voto derrubar a contagem abaixo do limiar).

### 6.3 Expiração calculada na leitura

Uma expressão SQL única (em `services/barreiras.py`, reaproveitada por `barreira_geom.py`) trata como `expirada`:
- `pendente` com `criado_em` há mais de 30 dias;
- `validada` com `coalesce(ultima_confirmacao_em, criado_em)` há mais de 180 dias.

`barreira_geom._SQL_CANDIDATOS` passa a ignorar barreiras expiradas. `python -m scripts.expirar` grava `status = 'expirada'`, atualiza `atualizado_em`, grava evento `status` sem usuário e invalida o cache da região; roda à mão ou, depois, junto com o ETL semanal.

### 6.4 Determinismo

O horário (`agora`) é parâmetro de todo o serviço, como em `services/rota.py`; os testes fixam a data.

## 7. Foto (`services/fotos.py`)

1. Aceita JPEG, PNG ou WebP de até 5 MB (maior → 413; outro tipo → 415). O formato é verificado abrindo com Pillow, não pelo `Content-Type`. Acima de 40 megapixels → 415.
2. Reprocessa sempre: `ImageOps.exif_transpose`, RGB, lado maior ≤ 1600 px, salva WebP qualidade 80 sem metadados.
3. Envia para o bucket público `fotos-barreiras` do Supabase Storage em `{barreira_id}/{uuid}.webp` via HTTP (httpx) com a chave de serviço; foto nova apaga a anterior; evento `foto`.
4. `foto_url = {SUPABASE_URL}/storage/v1/object/public/fotos-barreiras/{foto_caminho}`.
5. Sem `SUPABASE_SERVICE_ROLE_KEY` → 503 `"Envio de foto indisponível no momento."`; o resto da API segue funcionando.
6. O armazenamento é uma interface (`ArmazenamentoFotos`) com implementação Supabase e uma falsa em memória para testes.
7. Dependência nova: `Pillow`.

## 8. Erros

401 sem login · 403 sem permissão · 404 inexistente/removida · 409 voto em barreira encerrada · 413/415 foto inválida · 422 dado inválido ou fora da área · 429 limite diário · 503 banco ou Storage indisponível. Mensagens em português.

## 9. Testes (TDD, sem rede)

1. `decidir_status`: tabela de casos cobrindo cada regra e a precedência.
2. Auth: token válido, vencido, assinatura errada, `aud` errado, sem token; 403 de não admin.
3. Serviço e API (transação revertida): idempotência (200 sem duplicar), voto único e troca de voto, autor não vota (403), 409 em barreira encerrada, limite de 20/dia (429), admin muda status e grava evento, nenhuma resposta pública contém autor ou votantes, expiração aos 30 e 180 dias com data fixa, invalidação do cache.
4. Integração com a rota: intransponível validada por 2 votos passa a sair de `poligonos_para_evitar`/`barreiras_no_corredor`; expirada deixa de sair.
5. Foto: imagem com GPS no EXIF sai sem metadados; 413, 415 e 503 cobertos; Storage falso em memória.
6. Trigger: `UPDATE` e `DELETE` em `barreira_evento` falham.
7. Migration 008: tabelas, CHECKs, UNIQUEs, RLS, migração de categorias antigas para `outro`.

## 10. Passos de produção (só com ordem do dono)

1. Configurar SMTP próprio no Supabase Auth (o envio padrão só entrega a membros da organização e com poucos envios por hora). Até lá, só contas de membros recebem o código.
2. Criar o bucket público `fotos-barreiras` no Supabase Storage.
2a. Desligar o login anônimo do Supabase (o backend também recusa tokens com `is_anonymous: true`) e agendar `scripts/expirar.py` diariamente.
3. Pôr `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no Render.
4. Depois do deploy (migrations 006, 007 e 008 + ETL `tudo` do geocode): `caiorosa2006@gmail.com` entra uma vez pelo app e roda-se `promover_admin --email caiorosa2006@gmail.com` contra produção.

Os passos do frontend estão na seção 16 de `2026-11-05-frontend-planos-5-6-design.md` (spec de 05/11/2026).

## 11. Fora de escopo

Formulário no frontend; fila offline (Plano 7); SMTP próprio (passo de produção); notificações; edição da barreira pelo autor depois de criada (ele pode trocar a foto ou pedir ao admin).

## 12. Limitações conhecidas

- A expiração calculada na leitura não muda `atualizado_em`; uma rota em cache (TTL de 6 h) pode continuar desviando de uma barreira recém-vencida até o cache expirar ou até `expirar` rodar.
- Em área piloto pequena, poucas pessoas votam; o admin cobre a demo e casos de vandalismo.
- Fotos podem conter rostos ou placas; não há borramento automático (seria IA, proibida pelo projeto). O admin remove fotos denunciadas.
