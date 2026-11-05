# Frontend dos Planos 5 e 6 (rota, mapa, login, colaboração e moderação) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pessoa escolhe origem e destino por autocomplete ou GPS, recebe a rota como lista de passos com fonte e data, abre o mapa se quiser, entra com código de 6 dígitos, registra barreira em 3 toques, vota, e a moderação decide com motivo auditado. Tudo só por teclado e NVDA.

**Architecture:** Uma camada HTTP (`api/http.ts`) espera o Render acordar por `GET /health` (`api/servidor.ts`) e traduz todo erro em `ErroApi`. Estado de tela em reducers puros (`campoEstado.ts`, `rotaEstado.ts`), busca em `sessionStorage` e nunca na URL. Leaflet e `@supabase/auth-js` em chunks sob demanda. A região viva continua única. No backend entram só `GET /api/eu`, a fila do admin e duas correções.

**Tech Stack:** React 19, TypeScript, Vite, react-router 7, CSS puro com tokens, Leaflet 1.9.4, `@supabase/auth-js` 2.119.0, Vitest, Testing Library, vitest-axe, Playwright, `@axe-core/playwright`, Lighthouse. Backend: FastAPI, SQLAlchemy `text()`, pytest.

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-planos-5-6-design.md`. Em caso de dúvida, o spec manda. As decisões em aberto estão na seção 18 dele; este plano segue a recomendação de cada uma até ordem em contrário.

**Evidência:** o código deste plano foi executado num protótipo fora do repositório em 05/11/2026. As contagens de "Expected" são as medidas lá: 164 testes ao fim do Bloco A e 289 ao fim do Bloco B, 14 e 21 cenários de E2E. Depois da revisão adversarial de 05/11/2026, o protótipo foi corrigido e rodado de novo (Vitest, `tsc`, ESLint, Playwright, orçamento e Lighthouse), e o plano foi regerado a partir dele. A exceção é o backend: os testes de `Task 12` a `Task 14` foram coletados, mas **nunca executados**, porque o Docker estava desligado. Se um deles falhar, confie no teste e investigue; não ajuste o teste para passar.

## Global Constraints

- **Commits e pushes só quando o dono mandar.** Nenhum passo faz commit; cada task termina com verificação. Nenhuma ação em produção: merge, deploy, Supabase, SMTP, ETL.
- WCAG 2.2 AA. Texto primeiro, nenhum dado só no mapa; mapa como `role="img"` remetendo à lista; nunca arrastar como única via (2.5.7); alvos de 44 px; sem rolagem horizontal a 320 px nem a 400%.
- **Uma única região viva.** Nunca criar outro `aria-live`, `role="status"` ou `role="alert"`. `src/test/regiaoUnica.test.ts` falha se isso acontecer. Se o foco muda, não anuncia; se não muda, usa `useAnuncio()`. `focarOuAnunciar` (`a11y/foco.ts`) decide isso, porque focar o campo que já tem o foco não faz o leitor falar nada.
- **O foco nunca cai no `body`.** Elemento focado que sai da tela tem um destino definido; o `PortaoLogin` exige `refRetorno`. Se a pessoa saiu dali durante a espera (`focoPerdido()` falso), o foco fica e a região anuncia.
- **`aria-disabled` não bloqueia clique:** toda ação com `aria-disabled` tem guarda no handler (`DESIGN.md`, Botões).
- Conforto sensorial: nada se move sem ação, um só movimento, sem cor saturada, `setView` e `fitBounds` com `animate: false`, nunca `flyTo`.
- `DESIGN.md` é vinculante: quatro tamanhos de fonte (`--t-1` a `--t-4`), três pesos (400, 600, 800), canto vivo, sem sombra, óxido só em ação ou estado ativo e nunca como cor de texto nem para marcar erro, pictogramas SVG autorais na grade 24 com traço 2, sem caixa dentro de caixa, espaço do ritmo `--e-1` a `--e-6`. Nenhuma cor nova.
- Sem IA em runtime. LGPD: sem histórico de trajetos por usuário; `GET /api/geocode*` e `POST /api/rotas` nunca levam `Authorization`; origem e destino nunca vão para URL nem `localStorage`.
- Texto: nunca "garante"; dizer "evita" e "não sabemos". Fora da área piloto a interface diz que não atende. Terminologia em português: barreira, passo, trecho, calçada, guia rebaixada, fonte, área piloto.
- Nenhuma chave secreta no frontend. Só `VITE_SUPABASE_PUBLISHABLE_KEY` com prefixo `sb_publishable_`. Nunca usar `DATABASE_URL_PROD` como `DATABASE_URL` local. Nenhum teste acessa a rede.
- TDD: teste falhando antes do código em todo passo que produz código.
- Lint: `npm run lint` com `jsx-a11y` strict e `ruff check` e `ruff format --check` no backend.
- Ambiente local: Docker Desktop aberto só para os testes do backend; banco em `localhost:5433`. No PowerShell deste ambiente, comandos com `rm` ou com o texto `/*` são bloqueados: crie `frontend/public/_headers` com a ferramenta de escrita de arquivos, não pelo terminal.

## Como rodar as coisas

- Instalar (a partir de `frontend/`): `npm ci`
- Um teste (a partir de `frontend/`): `npx vitest --run src/test/<arquivo>`
- Todos os testes: `npx vitest --run`
- Tipos e lint: `npx tsc -b ; npm run lint`
- Tipos do E2E: `npx tsc -p tsconfig.e2e.json`
- E2E (sobe o build sozinho; usa o Chrome instalado): `npx playwright test`
- Orçamento de bundle (depois de `npm run build`): `npm run orcamento`
- Lighthouse: em outro terminal `npm run preview -- --port 4173 --strictPort`; depois `node scripts/gate-lighthouse.mjs`
- Backend (a partir de `backend/`): `.venv/Scripts/python.exe -m pytest <alvo> -v` e `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
- Tipos gerados: em `backend/`, `.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (o OpenAPI não toca o banco); em `frontend/`, `npm run gerar-tipos`

## Mapa de arquivos

Caminhos relativos a `frontend/`, salvo indicação.

| Arquivo | Ação | Task | Responsabilidade |
|---|---|---|---|
| `src/api/base.ts`, `servidor.ts`, `http.ts`, `useConsulta.ts` | criar | 1 | erro, espera do servidor, ponto de saída, leitura |
| `src/a11y/foco.ts` | criar | 1 | foco ou anúncio, nunca os dois |
| `src/api/client.ts` | substituir | 1 | operações sem token |
| `src/componentes/RegiaoViva.tsx`, `useAnuncio.ts` | substituir | 1 | throttle por chave |
| `src/componentes/useEsperaServidor.ts` | criar | 1 | texto de espera, um anúncio por estágio |
| `src/pages/Fontes.tsx`, `src/test/Fontes.test.tsx`, `RegiaoViva.test.tsx`, `setup.ts` | substituir | 1 | sai a deriva de regiões vivas |
| `src/test/apiFalsa.ts`, `http.test.ts`, `servidor.test.tsx` | criar | 1 | |
| `src/App.tsx` | substituir | 2, 16 a 22 | páginas sob demanda, menu, rotas |
| `src/componentes/ErroDePagina.tsx`, `src/pages/NaoEncontrada.tsx`, `src/test/regiaoUnica.test.ts`, `ErroDePagina.test.tsx` | criar | 2 | |
| `src/index.css` | modificar | 2, 8 | `.carregando-pagina`, nota de contraste |
| `src/test/App.test.tsx`, `Inicio.test.tsx` | modificar | 2 | procurar o CTA dentro de `main` |
| `src/test/Rota.test.tsx` | apagar, recriar | 2, 9 | o esqueleto sai |
| `src/dados/categorias.ts`, `rotaGeo.ts`, `sessaoRota.ts`, `src/test/dadosRota.test.ts`, `fixturasRota.ts` | criar | 3 | |
| `src/dados/passo.ts`, `src/test/passo.test.ts` | modificar | 3 | textos novos |
| `src/componentes/TabelaPassos.tsx`, `FichaRota.tsx`, `BarreirasDoPasso.tsx` | criar | 4, 23 | extraídos de `Inicio` |
| `src/pages/Inicio.tsx` | modificar | 4 | usa os extraídos |
| `src/componentes/campoEstado.ts`, `src/pages/rotaEstado.ts`, `src/test/rotaEstado.test.ts` | criar | 5 | reducers |
| `src/componentes/useBuscaEndereco.ts`, `CampoEndereco.tsx`, `src/estilos/rota.css`, `src/test/CampoEndereco.test.tsx` | criar | 6 | autocomplete |
| `src/componentes/pictogramas.ts` | modificar | 6 | 8 desenhos novos |
| `src/dados/localizacao.ts`, `src/componentes/BotaoMinhaLocalizacao.tsx`, `src/test/Localizacao.test.tsx` | criar | 7 | GPS |
| `src/componentes/mapa/opcoesMapa.ts`, `MapaLeaflet.tsx`, `MapaRota.tsx`, `mapa.css`, `src/test/Mapa.test.tsx` | criar | 8 | mapa |
| `src/vite-env.d.ts` | modificar | 8, 16 | variáveis |
| `src/pages/Rota.tsx` | substituir | 9 | a tela real |
| `src/componentes/ResultadoRota.tsx` | criar | 9, 23 | |
| `src/componentes/Placa.tsx` | modificar | 9 | aceita `ref` |
| `public/_headers`, `playwright.config.ts`, `tsconfig.e2e.json`, `.env.e2e`, `.env.example`, `e2e/apoio.ts`, `e2e/rota.spec.ts`, `e2e/csp.spec.ts`, `scripts/orcamento-bundle.mjs`, `scripts/gate-lighthouse.mjs` | criar | 10 | |
| `package.json`, `vite.config.ts`, `.gitignore`, `../.github/workflows/ci.yml` | modificar | 8, 10, 16 | dependências e CI |
| `../DESIGN.md`, `../PRODUCT.md`, `../README.md` | modificar | 11, 24 | documentação |
| `../backend/app/schemas/barreira.py`, `routers/barreiras.py`, `routers/admin.py`, `services/barreiras.py`, `services/barreira_geom.py` | modificar | 12 a 14 | backend |
| `../backend/tests/test_eu_api.py`, `test_admin_fila_api.py` | criar | 12 a 14 | |
| `src/api/types.gen.ts` | regenerar | 15 | |
| `src/api/colaboracao.ts`, `src/dados/barreira.ts`, `rascunho.ts`, `src/test/barreira.test.ts` | criar | 15 | |
| `src/auth/*`, `src/test/auth.test.ts`, `authCliente.test.ts` | criar | 16 | login e ciclo de token (`comSessao`) |
| `src/componentes/FluxoCodigo.tsx`, `PortaoLogin.tsx`, `src/pages/Entrar.tsx`, `Conta.tsx`, `src/estilos/colaborar.css`, `src/test/Entrar.test.tsx`, `apoioColaboracao.tsx`, `clienteFalso.ts` | criar | 17 | |
| `src/componentes/EscolhaLocal.tsx`, `mapa/PontoNoMapa.tsx`, `src/test/EscolhaLocal.test.tsx` | criar | 18 | |
| `src/pages/Barreiras.tsx`, `src/test/Barreiras.test.tsx` | criar | 19 | |
| `src/pages/Barreira.tsx`, `src/componentes/Votacao.tsx`, `FotoBarreira.tsx`, `src/test/FichaBarreira.test.tsx` | criar | 20 | |
| `src/pages/NovaBarreira.tsx`, `src/test/NovaBarreira.test.tsx` | criar | 21 | |
| `src/pages/admin/Fila.tsx`, `admin/Decisao.tsx`, `src/test/Admin.test.tsx` | criar | 22 | |
| `src/test/Ligacao.test.tsx` | criar | 23 | |
| `e2e/colaboracao.spec.ts` | criar | 24 | |

**Não paralelizar entre si:** tasks que tocam `src/App.tsx` (2, 16 a 22), `src/componentes/TabelaPassos.tsx` (4, 23), `package.json` (8, 10, 16) e `types.gen.ts` (15).

---

# Bloco A — Plano 5: a rota

### Task 1: Camada HTTP, espera do servidor e região viva com throttle

**Files:**
- Create: `frontend/src/a11y/foco.ts`, `frontend/src/api/base.ts`, `frontend/src/api/servidor.ts`, `frontend/src/api/http.ts`, `frontend/src/api/useConsulta.ts`, `frontend/src/componentes/useEsperaServidor.ts`, `frontend/src/test/apiFalsa.ts`, `frontend/src/test/http.test.ts`, `frontend/src/test/servidor.test.tsx`
- Replace: `frontend/src/api/client.ts`, `frontend/src/componentes/useAnuncio.ts`, `frontend/src/componentes/RegiaoViva.tsx`, `frontend/src/pages/Fontes.tsx`, `frontend/src/test/setup.ts`, `frontend/src/test/Fontes.test.tsx`, `frontend/src/test/RegiaoViva.test.tsx`

**Interfaces:**
- Consumes: `/health` (`HealthOut.banco`), `components` de `types.gen.ts`.
- Produces: `ErroApi(tipo, mensagem, status?, campos?)`, `TipoErro`, `ehCancelamento`, `apiUrl`, `MSG_*` (`base.ts`); `garantirAcordado(sinal?)`, `aquecerServidor()`, `useEstadoServidor()`, `reiniciarServidor()`, constantes de tempo (`servidor.ts`); `pedir<T>(caminho, opcoes)` (`http.ts`); `listarFontes`, `buscarEnderecos`, `enderecoDoPonto`, `calcularRota`, tipos `Fonte`, `Endereco`, `RotaIn`, `RotaOut`, `TEMPO_ROTA_MS`, `MSG_ROTA_INDISPONIVEL` (`client.ts`); `useConsulta(chave, buscar)` → `{ dados, erro, carregando, recarregar, atualizar }`, com `dados` e `erro` valendo só para a chave atual; `Anunciar = (mensagem, { chave?, intervaloMs? }?) => void`, `useCancelarAnuncio()` → `(chave) => void`; `focoPerdido()`, `focarOuAnunciar(campo, texto, anunciar)` (`a11y/foco.ts`); `useEsperaServidor(ativo)` → `string | null`, `TEXTO_ACORDANDO`, `TEXTO_DEMORANDO`, `reiniciarAnuncioDeEspera()`; `apiFalsa(tabela)`, `erroApi(status, detail)`.

- [ ] **Step 1: Escrever os testes e o apoio**

`frontend/src/test/apiFalsa.ts`:

```ts
import { vi } from 'vitest'

type Saida = Response | (() => Response | Promise<Response>)

function responder(saida: Saida): Promise<Response> | Response {
  return typeof saida === 'function' ? saida() : saida.clone()
}

/**
 * fetch falso por tabela: 'GET /api/geocode' -> resposta. `/health` responde ok salvo
 * indicação. Rota fora da tabela lança erro, para o teste não passar por acidente. O
 * falso respeita o `signal`, como o de verdade.
 */
export function apiFalsa(tabela: Record<string, Saida>) {
  const chamadas: { metodo: string; caminho: string; url: string; init: RequestInit }[] = []
  const falso = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const metodo = init.method ?? 'GET'
    const chave = `${metodo} ${u.pathname}`
    chamadas.push({ metodo, caminho: u.pathname, url, init })
    if (init.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (chave === 'GET /health' && !tabela[chave]) return Response.json({ status: 'ok', banco: 'ok' })
    const saida = tabela[chave]
    if (!saida) throw new Error(`apiFalsa: rota não prevista: ${chave}`)
    return responder(saida)
  })
  vi.stubGlobal('fetch', falso)
  return { chamadas, falso, de: (chave: string) => chamadas.filter((c) => `${c.metodo} ${c.caminho}` === chave) }
}

export function erroApi(status: number, detail: unknown) {
  return Response.json({ detail }, { status })
}
```

`frontend/src/test/http.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { ehCancelamento, ErroApi, MSG_INDISPONIVEL, MSG_REDE, MSG_TEMPO } from '../api/base'
import { calcularRota, MSG_ROTA_INDISPONIVEL, type RotaIn } from '../api/client'
import { pedir } from '../api/http'
import { useConsulta } from '../api/useConsulta'
import { apiFalsa, erroApi } from './apiFalsa'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function erroDe(p: Promise<unknown>): Promise<ErroApi> {
  try {
    await p
  } catch (e) {
    return e as ErroApi
  }
  throw new Error('deveria ter falhado')
}

describe('pedir', () => {
  it.each([
    [401, 'sessao'],
    [403, 'permissao'],
    [404, 'nao_encontrado'],
    [409, 'conflito'],
    [413, 'foto'],
    [415, 'foto'],
    [429, 'limite'],
    [503, 'indisponivel'],
  ])('traduz %i com detail em texto para o tipo %s', async (status, tipo) => {
    apiFalsa({ 'GET /x': erroApi(status, 'Mensagem do domínio.') })
    const e = await erroDe(pedir('/x'))
    expect(e).toBeInstanceOf(ErroApi)
    expect(e.tipo).toBe(tipo)
    expect(e.message).toBe('Mensagem do domínio.')
    expect(e.status).toBe(status)
  })

  it('422 com detail em texto usa o texto; com lista nunca mostra o inglês do Pydantic', async () => {
    apiFalsa({ 'GET /x': erroApi(422, 'Fora da área.') })
    expect((await erroDe(pedir('/x'))).message).toBe('Fora da área.')
    apiFalsa({ 'GET /x': erroApi(422, [{ loc: ['body', 'categoria'], msg: 'Field required', type: 'missing' }]) })
    const e = await erroDe(pedir('/x'))
    expect(e.tipo).toBe('validacao')
    expect(e.message).toBe('Confira os dados informados.')
    expect(e.campos).toEqual([{ campo: 'categoria', codigo: 'missing' }])
  })

  it('5xx sem JSON e 200 com HTML viram indisponível', async () => {
    apiFalsa({ 'GET /a': new Response('<html>', { status: 502 }) })
    expect(await erroDe(pedir('/a'))).toMatchObject({ tipo: 'indisponivel', message: MSG_INDISPONIVEL })
    apiFalsa({ 'GET /b': new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
    expect(await erroDe(pedir('/b'))).toMatchObject({ tipo: 'indisponivel', message: MSG_INDISPONIVEL })
  })

  it('TypeError do fetch vira erro de rede', async () => {
    apiFalsa({
      'GET /x': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(await erroDe(pedir('/x'))).toMatchObject({ tipo: 'rede', message: MSG_REDE })
  })

  it('cancelar não vira erro para a pessoa', async () => {
    apiFalsa({ 'GET /x': Response.json({}) })
    const controle = new AbortController()
    controle.abort()
    expect(ehCancelamento(await erroDe(pedir('/x', { sinal: controle.signal })))).toBe(true)
  })

  it('estoura o teto com erro de tempo', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.endsWith('/health')) return Response.json({ banco: 'ok' })
        return new Promise((_r, rejeitar) => {
          init.signal?.addEventListener('abort', () => rejeitar(new DOMException('x', 'AbortError')))
        })
      }),
    )
    const pendente = erroDe(pedir('/lento', { tempoMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1001)
    expect(await pendente).toMatchObject({ tipo: 'tempo', message: MSG_TEMPO })
  })

  it('monta a consulta, anexa token só quando pedido e deixa o FormData definir o Content-Type', async () => {
    const api = apiFalsa({ 'GET /a': Response.json([]), 'POST /b': Response.json({}), 'POST /c': Response.json({}) })
    await pedir('/a', { consulta: { q: 'rua x', nada: undefined } })
    expect(api.de('GET /a')[0].url).toBe('http://localhost:8000/a?q=rua+x')
    expect(api.de('GET /a')[0].init.headers).toEqual({})
    await pedir('/b', { metodo: 'POST', corpo: { a: 1 }, token: 'tkn' })
    expect(api.de('POST /b')[0].init.headers).toEqual({ Authorization: 'Bearer tkn', 'Content-Type': 'application/json' })
    await pedir('/c', { metodo: 'POST', corpo: new FormData() })
    expect(api.de('POST /c')[0].init.headers).toEqual({})
  })
})

describe('calcularRota', () => {
  const pedido = {} as RotaIn

  it('503 nunca mostra o detail, que repete o texto do 404', async () => {
    apiFalsa({ 'POST /api/rotas': erroApi(503, 'Não encontramos rota acessível entre esses pontos.') })
    expect(await erroDe(calcularRota(pedido))).toMatchObject({ tipo: 'indisponivel', message: MSG_ROTA_INDISPONIVEL })
  })

  it('404 mantém o detail do backend', async () => {
    apiFalsa({ 'POST /api/rotas': erroApi(404, 'Não encontramos rota acessível entre esses pontos.') })
    expect(await erroDe(calcularRota(pedido))).toMatchObject({
      tipo: 'nao_encontrado',
      message: 'Não encontramos rota acessível entre esses pontos.',
    })
  })
})

describe('useConsulta', () => {
  it('trocar a chave nunca mostra os dados da chave anterior, nem por um commit', async () => {
    const vistos: { chave: string; dados: string | null }[] = []
    const buscas: Record<string, (v: string) => void> = {}
    const { result, rerender } = renderHook(
      ({ chave }) => {
        const c = useConsulta<string>(chave, () => new Promise((r) => (buscas[chave] = r)))
        vistos.push({ chave, dados: c.dados })
        return c
      },
      { initialProps: { chave: 'a' } },
    )
    await act(async () => buscas.a('dados de a'))
    expect(result.current.dados).toBe('dados de a')
    vistos.length = 0
    rerender({ chave: 'b' })
    expect(vistos.filter((v) => v.chave === 'b' && v.dados !== null)).toEqual([])
    expect(result.current.carregando).toBe(true)
  })

  it('chave nula não guarda nada: sem dados, sem erro e sem "carregando"', async () => {
    let chamadas = 0
    const { result, rerender } = renderHook(({ chave }: { chave: string | null }) => useConsulta<string>(chave, () => Promise.resolve(`v${++chamadas}`)), {
      initialProps: { chave: 'a' as string | null },
    })
    await waitFor(() => expect(result.current.dados).toBe('v1'))
    rerender({ chave: null })
    expect(result.current).toMatchObject({ dados: null, erro: null, carregando: false })
  })

  it('resposta de consulta cancelada é descartada, mesmo se a promessa resolver', async () => {
    const buscas: Record<string, (v: string) => void> = {}
    const { result, rerender } = renderHook(({ chave }) => useConsulta<string>(chave, () => new Promise((r) => (buscas[chave] = r))), {
      initialProps: { chave: 'a' },
    })
    rerender({ chave: 'b' })
    await act(async () => buscas.b('nova'))
    expect(result.current.dados).toBe('nova')
    await act(async () => buscas.a('velha'))
    expect(result.current).toMatchObject({ dados: 'nova', carregando: false })
  })
})
```

`frontend/src/test/servidor.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { ErroApi, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA } from '../api/base'
import { aquecerServidor, garantirAcordado, TETO_ACORDAR_MS, useEstadoServidor, VALIDADE_CONTATO_MS } from '../api/servidor'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { TEXTO_ACORDANDO, TEXTO_DEMORANDO, useEsperaServidor } from '../componentes/useEsperaServidor'

function saude(banco = 'ok') {
  return Response.json({ status: 'ok', banco })
}

function pendurado() {
  return vi.fn(
    (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_r, rejeitar) => {
        init.signal?.addEventListener('abort', () => rejeitar(new DOMException('x', 'AbortError')))
      }),
  )
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('garantirAcordado', () => {
  it('faz uma só espera para vários pedidos e não refaz logo em seguida', async () => {
    const f = vi.fn(async () => saude())
    vi.stubGlobal('fetch', f)
    await Promise.all([garantirAcordado(), garantirAcordado()])
    await garantirAcordado()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('reconfere depois de 10 minutos sem contato', async () => {
    const f = vi.fn(async () => saude())
    vi.stubGlobal('fetch', f)
    await garantirAcordado()
    vi.setSystemTime(Date.now() + VALIDADE_CONTATO_MS + 1)
    await garantirAcordado()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('tolera HTML com 200, 502 e TypeError até a API responder', async () => {
    const respostas = [
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      () => new Response('x', { status: 502 }),
      () => {
        throw new TypeError('rede')
      },
      () => saude(),
    ]
    const f = vi.fn(async () => respostas.shift()!())
    vi.stubGlobal('fetch', f)
    const espera = garantirAcordado()
    await vi.advanceTimersByTimeAsync(16_000)
    await espera
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('200 com banco indisponível é serviço fora, sem repetir', async () => {
    const f = vi.fn(async () => saude('indisponivel'))
    vi.stubGlobal('fetch', f)
    await expect(garantirAcordado()).rejects.toMatchObject({ tipo: 'indisponivel' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('desiste no teto de 120 s', async () => {
    vi.stubGlobal('fetch', pendurado())
    const espera = garantirAcordado().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(TETO_ACORDAR_MS + 40_000)
    const erro = await espera
    expect(erro).toBeInstanceOf(ErroApi)
    expect(erro).toMatchObject({ tipo: 'indisponivel', message: MSG_SEM_RESPOSTA })
  })

  it('perder a rede durante a espera diz que falta conexão, sem chamar de servidor dormindo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('rede')
    }))
    const espera = garantirAcordado().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    vi.stubGlobal('navigator', { onLine: false })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await espera).toMatchObject({ tipo: 'rede', message: MSG_SEM_INTERNET })
  })

  it('o texto de espera não afirma a causa que não sabe', () => {
    expect(TEXTO_ACORDANDO).not.toMatch(/estava dormindo/)
    expect(TEXTO_ACORDANDO).toMatch(/pode estar acordando/)
    expect(TEXTO_ACORDANDO).toMatch(/sinal pode estar fraco/)
  })

  it('cancelar solta quem chamou, sem derrubar a espera dos outros', async () => {
    let responder: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (responder = r))))
    const controle = new AbortController()
    const cancelada = garantirAcordado(controle.signal).catch((e: unknown) => e)
    const outra = garantirAcordado()
    controle.abort()
    expect(await cancelada).toBeInstanceOf(DOMException)
    responder(saude())
    await expect(outra).resolves.toBeUndefined()
  })

  it('offline falha na hora, sem chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(garantirAcordado()).rejects.toMatchObject({ tipo: 'rede' })
    expect(f).not.toHaveBeenCalled()
  })
})

function Espera({ ativo }: { ativo: boolean }) {
  const texto = useEsperaServidor(ativo)
  const estado = useEstadoServidor()
  return (
    <p data-testid="saida" data-estado={estado}>
      {texto ?? 'sem aviso'}
    </p>
  )
}

describe('useEsperaServidor', () => {
  it('aquecer em silêncio: nada aparece nem é anunciado sem ação da pessoa', async () => {
    vi.stubGlobal('fetch', pendurado())
    aquecerServidor()
    render(
      <RegiaoViva>
        <Espera ativo={false} />
      </RegiaoViva>,
    )
    await act(() => vi.advanceTimersByTimeAsync(4_100))
    expect(screen.getByTestId('saida')).toHaveTextContent('sem aviso')
    expect(screen.getByTestId('saida')).toHaveAttribute('data-estado', 'acordando')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('mostra os dois estágios para quem espera e escreve na região única', async () => {
    vi.stubGlobal('fetch', pendurado())
    aquecerServidor()
    render(
      <RegiaoViva>
        <Espera ativo />
      </RegiaoViva>,
    )
    await act(() => vi.advanceTimersByTimeAsync(4_200))
    expect(screen.getByTestId('saida')).toHaveTextContent(TEXTO_ACORDANDO)
    expect(screen.getByRole('status')).toHaveTextContent(TEXTO_ACORDANDO)
    await act(() => vi.advanceTimersByTimeAsync(36_200))
    expect(screen.getByTestId('saida')).toHaveTextContent(TEXTO_DEMORANDO)
    expect(screen.getByRole('status')).toHaveTextContent(TEXTO_DEMORANDO)
  })
})
```

Em `frontend/src/test/RegiaoViva.test.tsx`, troque o primeiro import e acrescente o bloco no fim do arquivo. O arquivo fica assim:

`frontend/src/test/RegiaoViva.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { useAnuncio, useCancelarAnuncio } from '../componentes/useAnuncio'

function Anunciante({ texto }: { texto: string }) {
  const anunciar = useAnuncio()
  return (
    <button type="button" onClick={() => anunciar(texto)}>
      Anunciar
    </button>
  )
}

describe('RegiaoViva', () => {
  it('monta uma única região viva educada e atômica', async () => {
    const { container } = render(
      <RegiaoViva>
        <p>conteúdo</p>
      </RegiaoViva>,
    )
    const regioes = screen.getAllByRole('status')
    expect(regioes).toHaveLength(1)
    expect(regioes[0]).toHaveAttribute('aria-live', 'polite')
    expect(regioes[0]).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByText('conteúdo')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('useAnuncio escreve a mensagem na região, inclusive quando ela se repete', async () => {
    render(
      <RegiaoViva>
        <Anunciante texto="Leitura interrompida." />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
    // a repetição esvazia a região antes de reescrever, para o leitor de tela anunciar de novo
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(regiao.textContent).toBe('')
    await waitFor(() => expect(regiao).toHaveTextContent('Leitura interrompida.'))
  })

  it('useAnuncio fora da região não quebra', async () => {
    render(<Anunciante texto="nada" />)
    await userEvent.click(screen.getByRole('button', { name: 'Anunciar' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('RegiaoViva com chave', () => {
  afterEach(() => vi.useRealTimers())

  function Contagem() {
    const anunciar = useAnuncio()
    const cancelar = useCancelarAnuncio()
    return (
      <>
        <button type="button" onClick={() => anunciar('sem chave')}>
          sem chave
        </button>
        <button type="button" onClick={() => cancelar('c')}>
          cancelar
        </button>
        <button type="button" onClick={() => anunciar('um', { chave: 'c', intervaloMs: 3000 })}>
          um
        </button>
        <button type="button" onClick={() => anunciar('dois', { chave: 'c', intervaloMs: 3000 })}>
          dois
        </button>
      </>
    )
  }

  it('no máximo um anúncio por intervalo, e vale o último', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    act(() => void vi.advanceTimersByTime(150))
    expect(regiao).toHaveTextContent('um')
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    act(() => void vi.advanceTimersByTime(1000))
    expect(regiao).toHaveTextContent('um')
    act(() => void vi.advanceTimersByTime(2100))
    expect(regiao).toHaveTextContent('dois')
  })

  it('anúncio sem chave cancela a contagem pendente: nada de lista depois da escolha', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    act(() => void vi.advanceTimersByTime(150))
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    fireEvent.click(screen.getByRole('button', { name: 'sem chave' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao).toHaveTextContent('sem chave')
  })

  it('cancelar a chave cala o pendente, inclusive o que estava na pausa antes de escrever', () => {
    vi.useFakeTimers()
    render(
      <RegiaoViva>
        <Contagem />
      </RegiaoViva>,
    )
    const regiao = screen.getByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'um' }))
    fireEvent.click(screen.getByRole('button', { name: 'cancelar' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'dois' }))
    fireEvent.click(screen.getByRole('button', { name: 'cancelar' }))
    act(() => void vi.advanceTimersByTime(4000))
    expect(regiao.textContent).toBe('')
  })
})
```

Em `frontend/src/test/Fontes.test.tsx`, a chamada passa a ter opções e o erro deixa de usar `role=alert`. O arquivo fica assim:

`frontend/src/test/Fontes.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'

const FONTES = [
  {
    chave: 'geosampa',
    nome: 'GeoSampa / Prefeitura de São Paulo',
    licenca: 'CC-BY-SA 4.0',
    url: 'https://geosampa.prefeitura.sp.gov.br',
    atribuicao: 'Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021',
    data_referencia: '2021-08-13',
    data_extracao: null,
  },
  {
    chave: 'osm',
    nome: 'OpenStreetMap',
    licenca: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    atribuicao: 'Dados do mapa © colaboradores do OpenStreetMap (ODbL)',
    data_referencia: null,
    data_extracao: null,
  },
]

function renderizarFontes() {
  return render(
    <MemoryRouter initialEntries={['/fontes']}>
      <App />
    </MemoryRouter>,
  )
}

describe('página /fontes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lista cada fonte com link, licença, data de referência e atribuição', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(FONTES)))
    const { container } = renderizarFontes()

    expect(await screen.findByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
    expect(screen.getByText(/licença ODbL 1\.0/)).toBeInTheDocument()
    expect(screen.getByText(/Dados de 13\/08\/2021/)).toBeInTheDocument()
    expect(screen.getByText('Calçadas: GeoSampa/PMSP (CC-BY-SA 4.0), diagnóstico de 2021')).toBeInTheDocument()
    expect(document.title).toBe('Fontes de dados e licenças · Rota Falada SP')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('chama a API no endereço configurado', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    renderizarFontes()
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))).toContain('http://localhost:8000/api/fontes'),
    )
  })

  it('mostra o erro em texto e anuncia pela região única quando a API falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/health') ? Response.json({ banco: 'ok' }) : new Response('erro', { status: 503 }),
      ),
    )
    renderizarFontes()
    const texto = 'O serviço não respondeu agora. Tente de novo em alguns minutos.'
    expect(await screen.findByText(texto)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(texto))
    expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `npx vitest --run src/test/http.test.ts src/test/servidor.test.tsx src/test/RegiaoViva.test.tsx src/test/Fontes.test.tsx`
Expected: FAIL (`Failed to resolve import "../api/base"`, e o teste de throttle de `RegiaoViva` falhando).

- [ ] **Step 3: Implementar**

`frontend/src/a11y/foco.ts`:

```ts
import type { Anunciar } from '../componentes/useAnuncio'

/** O foco caiu no body porque o elemento focado saiu da tela (WCAG 2.4.3). */
export function focoPerdido(): boolean {
  const ativo = document.activeElement
  return ativo === null || ativo === document.body
}

/**
 * Foco ou anúncio, nunca os dois: no NVDA eles se sobrepõem. Focar o campo que já tem o foco
 * não faz o leitor falar nada, e por isso, nesse caso, a mensagem vai para a região viva.
 * A mensagem precisa estar no DOM antes (flushSync), para o foco ler a descrição nova.
 */
export function focarOuAnunciar(campo: HTMLElement | null | undefined, texto: string, anunciar: Anunciar): void {
  if (!campo || document.activeElement === campo) anunciar(texto)
  else campo.focus()
}
```

`frontend/src/api/base.ts`:

```ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function apiUrl(caminho: string): string {
  return BASE + caminho
}

export type TipoErro =
  | 'rede'
  | 'tempo'
  | 'sessao'
  | 'permissao'
  | 'nao_encontrado'
  | 'conflito'
  | 'validacao'
  | 'limite'
  | 'foto'
  | 'indisponivel'
  | 'inesperado'

export type CampoInvalido = { campo: string; codigo: string }

/** Todo erro da API chega à interface nesta forma; `message` já está em português. */
export class ErroApi extends Error {
  readonly tipo: TipoErro
  readonly status?: number
  readonly campos?: CampoInvalido[]

  constructor(tipo: TipoErro, mensagem: string, status?: number, campos?: CampoInvalido[]) {
    super(mensagem)
    this.name = 'ErroApi'
    this.tipo = tipo
    this.status = status
    this.campos = campos
  }
}

export const MSG_SEM_INTERNET = 'Sem conexão com a internet. Confira o sinal e tente de novo.'
export const MSG_REDE = 'Não conseguimos falar com o servidor. Confira sua conexão e tente de novo.'
export const MSG_TEMPO = 'Demorou demais. Tente de novo.'
export const MSG_INDISPONIVEL = 'O serviço não respondeu agora. Tente de novo em alguns minutos.'
export const MSG_SEM_RESPOSTA = 'O servidor não respondeu. Confira o sinal e tente de novo em alguns minutos.'
export const MSG_VALIDACAO = 'Confira os dados informados.'
export const MSG_INESPERADO = 'Algo não saiu como esperado. Tente de novo.'

/** Cancelamento pedido por quem chamou: nunca é erro para a pessoa. */
export function ehCancelamento(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === 'AbortError'
}
```

`frontend/src/api/servidor.ts`:

```ts
import { useSyncExternalStore } from 'react'
import { apiUrl, ErroApi, MSG_INDISPONIVEL, MSG_SEM_INTERNET, MSG_SEM_RESPOSTA } from './base'

/**
 * O Render Free dorme aos 15 min e leva cerca de 1 min para acordar. Toda chamada à API
 * passa por garantirAcordado(): há uma só espera por vez, por GET /health (simples, sem
 * preflight). O pedido de verdade só sai depois disso e nunca é repetido automaticamente.
 */
export type EstadoServidor = 'desconhecido' | 'acordado' | 'acordando' | 'demorando' | 'fora'

export const LIMIAR_ACORDANDO_MS = 4_000
export const LIMIAR_DEMORANDO_MS = 40_000
export const INTERVALO_TENTATIVA_MS = 5_000
export const TEMPO_TENTATIVA_MS = 30_000
export const TETO_ACORDAR_MS = 120_000
/** O servidor dorme aos 15 min; depois de 10 min sem contato, reconfere. */
export const VALIDADE_CONTATO_MS = 10 * 60 * 1000

let estado: EstadoServidor = 'desconhecido'
let ultimoContato = 0
let promessa: Promise<void> | null = null
const ouvintes = new Set<() => void>()

function mudar(novo: EstadoServidor) {
  if (novo === estado) return
  estado = novo
  ouvintes.forEach((o) => o())
}

function esperar(ms: number) {
  return new Promise<void>((resolver) => setTimeout(resolver, ms))
}

type Tentativa = 'ok' | 'banco_fora' | 'sem_resposta'

async function tentarHealth(): Promise<Tentativa> {
  const controle = new AbortController()
  const limite = setTimeout(() => controle.abort(), TEMPO_TENTATIVA_MS)
  try {
    const resposta = await fetch(apiUrl('/health'), { signal: controle.signal })
    // dormindo, o proxy pode devolver HTML com 200, 502 ou 503 sem JSON
    if (!resposta.ok || !resposta.headers.get('content-type')?.includes('json')) return 'sem_resposta'
    const corpo = (await resposta.json()) as { banco?: string }
    return corpo.banco === 'indisponivel' ? 'banco_fora' : 'ok'
  } catch {
    // servidor dormindo sem CORS e falta de sinal chegam iguais aqui: a interface não afirma a causa
    return 'sem_resposta'
  } finally {
    clearTimeout(limite)
  }
}

async function despertar(): Promise<void> {
  const inicio = Date.now()
  const marcaAcordando = setTimeout(() => mudar('acordando'), LIMIAR_ACORDANDO_MS)
  const marcaDemorando = setTimeout(() => mudar('demorando'), LIMIAR_DEMORANDO_MS)
  try {
    for (;;) {
      const tentativa = await tentarHealth()
      if (tentativa === 'ok') {
        ultimoContato = Date.now()
        mudar('acordado')
        return
      }
      if (tentativa === 'banco_fora') {
        mudar('fora')
        throw new ErroApi('indisponivel', MSG_INDISPONIVEL)
      }
      if (navigator.onLine === false) {
        mudar('fora')
        throw new ErroApi('rede', MSG_SEM_INTERNET)
      }
      if (Date.now() - inicio >= TETO_ACORDAR_MS) {
        mudar('fora')
        throw new ErroApi('indisponivel', MSG_SEM_RESPOSTA)
      }
      await esperar(INTERVALO_TENTATIVA_MS)
    }
  } finally {
    clearTimeout(marcaAcordando)
    clearTimeout(marcaDemorando)
  }
}

function cancelavel(espera: Promise<void>, sinal?: AbortSignal): Promise<void> {
  if (!sinal) return espera
  return new Promise<void>((resolver, rejeitar) => {
    const aoAbortar = () => rejeitar(new DOMException('Cancelado', 'AbortError'))
    if (sinal.aborted) return aoAbortar()
    sinal.addEventListener('abort', aoAbortar, { once: true })
    espera.then(resolver, rejeitar).finally(() => sinal.removeEventListener('abort', aoAbortar))
  })
}

/** Resolve com o servidor acordado. Cancelar só solta quem chamou; a espera segue para os outros. */
export function garantirAcordado(sinal?: AbortSignal): Promise<void> {
  if (navigator.onLine === false) return Promise.reject(new ErroApi('rede', MSG_SEM_INTERNET))
  if (estado === 'acordado' && Date.now() - ultimoContato < VALIDADE_CONTATO_MS) return Promise.resolve()
  promessa ??= despertar().finally(() => {
    promessa = null
  })
  return cancelavel(promessa, sinal)
}

/** Acorda antes de a pessoa precisar. Sem aviso na tela: nada aparece sem ação dela. */
export function aquecerServidor(): void {
  garantirAcordado().catch(() => {})
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

export function useEstadoServidor(): EstadoServidor {
  return useSyncExternalStore(assinar, () => estado)
}

/** Só para testes: volta ao estado de uma carga nova da aplicação. */
export function reiniciarServidor() {
  estado = 'desconhecido'
  ultimoContato = 0
  promessa = null
  ouvintes.clear()
}
```

`frontend/src/api/http.ts`:

```ts
import {
  apiUrl,
  ehCancelamento,
  ErroApi,
  MSG_INDISPONIVEL,
  MSG_INESPERADO,
  MSG_REDE,
  MSG_TEMPO,
  MSG_VALIDACAO,
  type CampoInvalido,
  type TipoErro,
} from './base'
import { garantirAcordado } from './servidor'

export type OpcoesPedido = {
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  corpo?: unknown
  consulta?: Record<string, string | number | undefined>
  sinal?: AbortSignal
  tempoMs?: number
  /** Só api/colaboracao.ts passa token: rota e geocode nunca se ligam a uma conta (LGPD). */
  token?: string
  /** Para quem precisa distinguir 200 de 201 (cadastro idempotente). */
  aoStatus?: (status: number) => void
}

export const TEMPO_PADRAO_MS = 30_000

const TIPO_POR_STATUS: Record<number, TipoErro> = {
  401: 'sessao',
  403: 'permissao',
  404: 'nao_encontrado',
  409: 'conflito',
  413: 'foto',
  415: 'foto',
  422: 'validacao',
  429: 'limite',
  503: 'indisponivel',
}

function montarUrl(caminho: string, consulta?: OpcoesPedido['consulta']): string {
  const parametros = new URLSearchParams()
  for (const [nome, valor] of Object.entries(consulta ?? {})) {
    if (valor !== undefined) parametros.set(nome, String(valor))
  }
  const texto = parametros.toString()
  return apiUrl(caminho) + (texto ? `?${texto}` : '')
}

async function lerJson(resposta: Response): Promise<unknown | undefined> {
  if (!resposta.headers.get('content-type')?.includes('json')) return undefined
  try {
    return await resposta.json()
  } catch {
    return undefined
  }
}

function erroDeResposta(status: number, corpo: unknown): ErroApi {
  if (corpo === undefined) return new ErroApi('indisponivel', MSG_INDISPONIVEL, status)
  const tipo = TIPO_POR_STATUS[status] ?? (status >= 500 ? 'indisponivel' : 'inesperado')
  const detalhe = (corpo as { detail?: unknown }).detail
  if (typeof detalhe === 'string') return new ErroApi(tipo, detalhe, status)
  if (Array.isArray(detalhe)) {
    // lista do Pydantic: o msg vem em inglês e nunca vai para a tela
    const campos: CampoInvalido[] = detalhe.map((d: { loc?: unknown[]; type?: string }) => ({
      campo: String(d.loc?.at(-1) ?? ''),
      codigo: String(d.type ?? ''),
    }))
    return new ErroApi('validacao', MSG_VALIDACAO, status, campos)
  }
  return new ErroApi(tipo, MSG_INESPERADO, status)
}

/** Único ponto de saída para a API: espera o servidor acordar, aplica o teto e traduz os erros. */
export async function pedir<T>(caminho: string, opcoes: OpcoesPedido = {}): Promise<T> {
  const { metodo = 'GET', corpo, consulta, sinal, tempoMs = TEMPO_PADRAO_MS, token, aoStatus } = opcoes
  await garantirAcordado(sinal)

  const controle = new AbortController()
  let expirou = false
  const limite = setTimeout(() => {
    expirou = true
    controle.abort()
  }, tempoMs)
  const repassar = () => controle.abort()
  if (sinal?.aborted) repassar()
  sinal?.addEventListener('abort', repassar, { once: true })

  const cabecalhos: Record<string, string> = {}
  if (token) cabecalhos.Authorization = `Bearer ${token}`
  const multipart = corpo instanceof FormData
  // FormData define o próprio Content-Type, com o boundary
  if (corpo !== undefined && !multipart) cabecalhos['Content-Type'] = 'application/json'

  try {
    const resposta = await fetch(montarUrl(caminho, consulta), {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : multipart ? corpo : JSON.stringify(corpo),
      signal: controle.signal,
    })
    const dados = await lerJson(resposta)
    if (!resposta.ok) throw erroDeResposta(resposta.status, dados)
    // 200 com HTML: proxy do Render, não a API
    if (dados === undefined) throw new ErroApi('indisponivel', MSG_INDISPONIVEL, resposta.status)
    aoStatus?.(resposta.status)
    return dados as T
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro
    if (sinal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (expirou) throw new ErroApi('tempo', MSG_TEMPO)
    if (ehCancelamento(erro)) throw erro
    throw new ErroApi('rede', MSG_REDE)
  } finally {
    clearTimeout(limite)
    sinal?.removeEventListener('abort', repassar)
  }
}
```

`frontend/src/api/client.ts`:

```ts
import type { components } from './types.gen'
import { ErroApi } from './base'
import { pedir } from './http'

export { apiUrl } from './base'

export type Fonte = components['schemas']['FonteOut']
export type Endereco = components['schemas']['EnderecoOut']
export type RotaIn = components['schemas']['RotaIn']
export type RotaOut = components['schemas']['RotaOut']

/** Teto do POST depois de o servidor acordar: ORS tem 15 s por chamada e o fallback é local. */
export const TEMPO_ROTA_MS = 60_000
export const MSG_ROTA_INDISPONIVEL =
  'O serviço de rotas não respondeu agora. Isso não quer dizer que a rota não existe.'

export function listarFontes(sinal?: AbortSignal): Promise<Fonte[]> {
  return pedir('/api/fontes', { sinal })
}

export function buscarEnderecos(q: string, sinal?: AbortSignal): Promise<Endereco[]> {
  return pedir('/api/geocode', { consulta: { q }, sinal })
}

export function enderecoDoPonto(lat: number, lon: number, sinal?: AbortSignal): Promise<Endereco> {
  return pedir('/api/geocode/reverso', { consulta: { lat, lon }, sinal })
}

export async function calcularRota(pedido: RotaIn, sinal?: AbortSignal): Promise<RotaOut> {
  try {
    return await pedir<RotaOut>('/api/rotas', { metodo: 'POST', corpo: pedido, sinal, tempoMs: TEMPO_ROTA_MS })
  } catch (erro) {
    // o detail do 503 de rota repete o texto do 404 (services/rota.py); nunca exibir
    if (erro instanceof ErroApi && erro.tipo === 'indisponivel') {
      throw new ErroApi('indisponivel', MSG_ROTA_INDISPONIVEL, erro.status)
    }
    throw erro
  }
}
```

`frontend/src/api/useConsulta.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from './base'

type Estado<T> = { chave: string | null; dados: T | null; erro: ErroApi | null; carregando: boolean }

/**
 * Consulta de leitura: refaz quando `chave` muda, cancela a anterior e nunca refaz sozinha
 * (nada se move sem ação). `chave` nula não consulta. Dados e erro valem só para a chave
 * atual: no commit da troca, quem lê o hook já não vê o resultado da chave anterior.
 */
export function useConsulta<T>(chave: string | null, buscar: (sinal: AbortSignal) => Promise<T>) {
  const [estado, setEstado] = useState<Estado<T>>({ chave, dados: null, erro: null, carregando: chave !== null })
  const [rodada, setRodada] = useState(0)
  const buscarRef = useRef(buscar)
  useEffect(() => {
    buscarRef.current = buscar
  })

  useEffect(() => {
    if (chave === null) return
    const controle = new AbortController()
    setEstado((e) => ({ chave, dados: e.chave === chave ? e.dados : null, erro: null, carregando: true }))
    buscarRef
      .current(controle.signal)
      .then((dados) => {
        if (!controle.signal.aborted) setEstado({ chave, dados, erro: null, carregando: false })
      })
      .catch((erro: unknown) => {
        if (controle.signal.aborted || ehCancelamento(erro)) return
        const erroApi = erro instanceof ErroApi ? erro : new ErroApi('inesperado', MSG_INESPERADO)
        setEstado({ chave, dados: null, erro: erroApi, carregando: false })
      })
    return () => controle.abort()
  }, [chave, rodada])

  const recarregar = useCallback(() => setRodada((r) => r + 1), [])
  const atualizar = useCallback((dados: T) => setEstado((e) => ({ ...e, dados })), [])
  const atual = estado.chave === chave
  return {
    dados: atual ? estado.dados : null,
    erro: atual ? estado.erro : null,
    carregando: chave !== null && (!atual || estado.carregando),
    recarregar,
    atualizar,
  }
}
```

`frontend/src/componentes/useAnuncio.ts`:

```ts
import { createContext, useContext } from 'react'

export type OpcoesAnuncio = {
  /** Com chave, no máximo um anúncio por intervalo; vale o último. */
  chave?: string
  intervaloMs?: number
}

export type Anunciar = (mensagem: string, opcoes?: OpcoesAnuncio) => void

const nada: Anunciar = () => {}

/** Contexto da região viva única do app (montada uma vez em App.tsx). */
export const ContextoAnuncio = createContext<Anunciar>(nada)

/** Cancela o anúncio pendente de uma chave: o que ele diz deixou de ser verdade. */
export const ContextoCancelarAnuncio = createContext<(chave: string) => void>(() => {})

/** Devolve a função que escreve na região viva única. Fora dela, não faz nada. */
export function useAnuncio(): Anunciar {
  return useContext(ContextoAnuncio)
}

export function useCancelarAnuncio(): (chave: string) => void {
  return useContext(ContextoCancelarAnuncio)
}
```

`frontend/src/componentes/RegiaoViva.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ContextoAnuncio, ContextoCancelarAnuncio, type OpcoesAnuncio } from './useAnuncio'

/** Intervalo entre esvaziar e reescrever a região, para repetir o mesmo anúncio. */
const PAUSA_MS = 100
const INTERVALO_PADRAO_MS = 3000

type Limite = { ultimo: number; pendente?: ReturnType<typeof setTimeout> }

/**
 * A única região viva do app: role=status, educada e atômica. Componentes anunciam
 * por useAnuncio(); ninguém mais cria aria-live, para os anúncios não competirem.
 */
export function RegiaoViva({ children }: { children: ReactNode }) {
  const [mensagem, setMensagem] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chaveNaPausa = useRef<string | undefined>(undefined)
  const limites = useRef(new Map<string, Limite>())

  const escrever = useCallback((texto: string, chave?: string) => {
    clearTimeout(timer.current)
    chaveNaPausa.current = chave
    setMensagem('')
    timer.current = setTimeout(() => {
      chaveNaPausa.current = undefined
      setMensagem(texto)
    }, PAUSA_MS)
  }, [])

  const anunciar = useCallback(
    (texto: string, opcoes?: OpcoesAnuncio) => {
      if (!opcoes?.chave) {
        // um fato novo: nada que estava na fila com chave ainda vale
        limites.current.forEach((l) => clearTimeout(l.pendente))
        escrever(texto)
        return
      }
      const chave = opcoes.chave
      const intervalo = opcoes.intervaloMs ?? INTERVALO_PADRAO_MS
      const limite = limites.current.get(chave) ?? { ultimo: -Infinity }
      limites.current.set(chave, limite)
      clearTimeout(limite.pendente)
      const restante = limite.ultimo + intervalo - Date.now()
      if (restante <= 0) {
        limite.ultimo = Date.now()
        escrever(texto, chave)
        return
      }
      limite.pendente = setTimeout(() => {
        limite.ultimo = Date.now()
        escrever(texto, chave)
      }, restante)
    },
    [escrever],
  )

  const cancelar = useCallback((chave: string) => {
    clearTimeout(limites.current.get(chave)?.pendente)
    if (chaveNaPausa.current === chave) {
      clearTimeout(timer.current)
      chaveNaPausa.current = undefined
    }
  }, [])

  useEffect(() => {
    const mapa = limites.current
    return () => {
      clearTimeout(timer.current)
      mapa.forEach((l) => clearTimeout(l.pendente))
    }
  }, [])

  return (
    <ContextoAnuncio.Provider value={anunciar}>
      <ContextoCancelarAnuncio.Provider value={cancelar}>{children}</ContextoCancelarAnuncio.Provider>
      <div role="status" aria-live="polite" aria-atomic="true" className="visualmente-oculto">
        {mensagem}
      </div>
    </ContextoAnuncio.Provider>
  )
}
```

`frontend/src/componentes/useEsperaServidor.ts`:

```ts
import { useEffect } from 'react'
import { useEstadoServidor } from '../api/servidor'
import { useAnuncio } from './useAnuncio'

export const TEXTO_ACORDANDO =
  'Ainda sem resposta. O servidor gratuito pode estar acordando, o que leva cerca de 1 minuto, ou o sinal pode estar fraco. Você pode continuar preenchendo; nada se perde.'
export const TEXTO_DEMORANDO = 'Continuamos tentando. O pedido sai assim que o servidor responder.'

let ultimoAnunciado: string | null = null

/** Só para testes. */
export function reiniciarAnuncioDeEspera() {
  ultimoAnunciado = null
}

function textoDe(estado: string): string | null {
  if (estado === 'acordando') return TEXTO_ACORDANDO
  if (estado === 'demorando') return TEXTO_DEMORANDO
  return null
}

/**
 * Texto de espera para quem está de fato aguardando (`ativo`), anunciado uma vez por
 * estágio em toda a página. Sem spinner nem contador: o texto muda, nada se move.
 */
export function useEsperaServidor(ativo: boolean): string | null {
  const estado = useEstadoServidor()
  const anunciar = useAnuncio()
  const texto = ativo ? textoDe(estado) : null

  useEffect(() => {
    if (estado === 'acordado') ultimoAnunciado = null
    if (texto && texto !== ultimoAnunciado) {
      ultimoAnunciado = texto
      anunciar(texto)
    }
  }, [texto, estado, anunciar])

  return texto
}
```

`frontend/src/pages/Fontes.tsx`:

```tsx
import { useEffect } from 'react'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { listarFontes } from '../api/client'
import { useConsulta } from '../api/useConsulta'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { formatarData } from '../dados/passo'

export function Fontes() {
  const h1 = usePaginaAcessivel('Fontes de dados e licenças')
  const { dados: fontes, erro, carregando } = useConsulta('fontes', listarFontes)
  const espera = useEsperaServidor(carregando)
  const anunciar = useAnuncio()

  useEffect(() => {
    if (erro) anunciar(erro.message)
  }, [erro, anunciar])

  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Fontes de dados e licenças
      </h1>
      <p>
        Toda informação exibida no Rota Falada SP declara de onde veio e de quando é. Esta
        página lista as fontes, suas licenças e a atribuição obrigatória de cada uma.
      </p>
      {erro && <p>{erro.message}</p>}
      {carregando && <p>{espera ?? 'Carregando fontes…'}</p>}
      {fontes && (
        <ul>
          {fontes.map((f) => (
            <li key={f.chave}>
              <a href={f.url}>{f.nome}</a>, licença {f.licenca}.{' '}
              {f.data_referencia && <>Dados de {formatarData(f.data_referencia)}. </>}
              <span>{f.atribuicao}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import { beforeEach, expect } from 'vitest'
import { reiniciarEstadoDeNavegacao } from '../a11y/usePaginaAcessivel'
import { reiniciarServidor } from '../api/servidor'
import { reiniciarAnuncioDeEspera } from '../componentes/useEsperaServidor'

expect.extend(axeMatchers)

// cada teste começa como uma carga nova da aplicação (sem foco no h1 no primeiro render)
beforeEach(() => {
  reiniciarEstadoDeNavegacao()
  reiniciarServidor()
  reiniciarAnuncioDeEspera()
  sessionStorage.clear()
  localStorage.clear()
})
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/http.test.ts src/test/servidor.test.tsx src/test/RegiaoViva.test.tsx src/test/Fontes.test.tsx`
Expected: PASS, 39 testes (19, 11, 6 e 3).

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 15 arquivos, 80 testes passando.

---

### Task 2: Páginas sob demanda, menu e restrições verificadas no código

**Files:**
- Create: `frontend/src/componentes/ErroDePagina.tsx`, `frontend/src/pages/NaoEncontrada.tsx`, `frontend/src/test/regiaoUnica.test.ts`, `frontend/src/test/ErroDePagina.test.tsx`
- Replace: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`, `frontend/src/test/App.test.tsx`, `frontend/src/test/Inicio.test.tsx`
- Delete: `frontend/src/test/Rota.test.tsx` (fixa o esqueleto com `getBy` síncrono; o teste real volta na Task 9)

**Interfaces:**
- Produces: `ErroDePagina` (limite remontado a cada rota por `key={pathname}`; não afirma a causa, foca o h1 e troca o título da aba); `NaoEncontrada`; menu com "Planejar rota"; rota `*`.

- [ ] **Step 1: Escrever o teste das restrições e adaptar os testes do menu**

`frontend/src/test/regiaoUnica.test.ts`:

```ts
const CRUS = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('restrições verificadas no código-fonte', () => {
  const fontes = Object.entries(CRUS)
    .map(([caminho, texto]) => ({ caminho: caminho.replace('../', ''), texto }))
    .filter((f) => !f.caminho.startsWith('./'))

  it('lê o código de verdade', () => {
    expect(fontes.map((f) => f.caminho)).toContain('componentes/RegiaoViva.tsx')
  })

  it('só RegiaoViva.tsx cria região viva', () => {
    const achados = fontes
      .filter((f) => f.caminho !== 'componentes/RegiaoViva.tsx')
      .filter((f) => /aria-live|role="status"|role="alert"|role='status'|role='alert'/.test(f.texto))
      .map((f) => f.caminho)
    expect(achados).toEqual([])
  })

  it('nenhuma interface diz "garante": diz "evita" e "não sabemos"', () => {
    const achados = fontes
      .filter((f) => !f.caminho.endsWith('types.gen.ts'))
      .filter((f) => /\bgarant(e|em|ia|ias|imos|ido|ida|ir)\b/i.test(f.texto))
      .map((f) => f.caminho)
    expect(achados).toEqual([])
  })

  it('mapa nunca voa: setView e fitBounds, sem flyTo', () => {
    expect(fontes.filter((f) => /flyTo/.test(f.texto)).map((f) => f.caminho)).toEqual([])
  })
})
```

`frontend/src/test/ErroDePagina.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { ErroDePagina } from '../componentes/ErroDePagina'

function Quebra(): never {
  throw new Error('chunk')
}

describe('ErroDePagina', () => {
  afterEach(() => vi.restoreAllMocks())

  it('não afirma a causa, leva o foco ao h1 e troca o título da aba', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErroDePagina>
        <Quebra />
      </ErroDePagina>,
    )
    const titulo = screen.getByRole('heading', { level: 1, name: 'Não conseguimos abrir esta página' })
    expect(titulo).toHaveFocus()
    expect(document.title).toBe('Não conseguimos abrir esta página · Rota Falada SP')
    expect(screen.getByText(/Confira o sinal e recarregue/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/recebeu uma versão nova/)
    expect(screen.getByRole('button', { name: 'Recarregar a página' })).toBeInTheDocument()
  })
})
```

Em `frontend/src/test/App.test.tsx`, no teste "abre /rota pelo CTA da página inicial", troque a linha do clique:

```tsx
await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Planejar rota' }))
```

No teste "tem a marca ligada ao início e a navegação principal com os três links", acrescente:

```tsx
expect(within(nav).getByRole('link', { name: 'Planejar rota' })).toHaveAttribute('href', '/rota')
```

E acrescente antes do último teste:

```tsx
  it('endereço inexistente tem página própria com h1', async () => {
    renderizar('/nao-existe')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planejar uma rota' })).toHaveAttribute('href', '/rota')
  })
```

Em `frontend/src/test/Inicio.test.tsx`, no primeiro teste, troque a verificação do CTA, porque o menu passa a ter um link com o mesmo nome:

```tsx
expect(within(screen.getByRole('main')).getByRole('link', { name: 'Planejar rota' })).toHaveAttribute('href', '/rota')
```

Apague `frontend/src/test/Rota.test.tsx`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/App.test.tsx src/test/ErroDePagina.test.tsx`
Expected: FAIL nos dois testes do menu e da página inexistente (`Unable to find an accessible element with the role "link" and name "Planejar rota"`) e em `ErroDePagina.test` (`Failed to resolve import "../componentes/ErroDePagina"`).

`regiaoUnica.test.ts` já passa, porque a deriva de `Fontes.tsx` saiu na Task 1. É uma trava para o futuro.

- [ ] **Step 3: Implementar**

`frontend/src/componentes/ErroDePagina.tsx`:

```tsx
import { Component, createRef, type ReactNode } from 'react'
import { Placa } from './Placa'

type Props = { children: ReactNode }
type Estado = { falhou: boolean }

const TITULO = 'Não conseguimos abrir esta página'

/**
 * Página que não carregou: sem sinal, ou um chunk antigo depois de um deploy (o Workers
 * devolve index.html com 200 e o import() rejeita). Não dá para saber qual; o texto não
 * afirma a causa. A App remonta este limite a cada troca de rota (key = pathname).
 */
export class ErroDePagina extends Component<Props, Estado> {
  state: Estado = { falhou: false }
  private readonly titulo = createRef<HTMLHeadingElement>()

  static getDerivedStateFromError(): Estado {
    return { falhou: true }
  }

  private anunciarFalha() {
    document.title = `${TITULO} · Rota Falada SP`
    this.titulo.current?.focus()
  }

  componentDidMount() {
    if (this.state.falhou) this.anunciarFalha()
  }

  componentDidUpdate(_props: Props, anterior: Estado) {
    if (this.state.falhou && !anterior.falhou) this.anunciarFalha()
  }

  render() {
    if (!this.state.falhou) return this.props.children
    return (
      <div className="folha">
        <h1 ref={this.titulo} tabIndex={-1}>
          {TITULO}
        </h1>
        <p>Pode ser falta de sinal ou uma versão nova do site. Confira o sinal e recarregue.</p>
        <Placa onClick={() => window.location.reload()}>Recarregar a página</Placa>
      </div>
    )
  }
}
```

`frontend/src/pages/NaoEncontrada.tsx`:

```tsx
import { Link } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'

export function NaoEncontrada() {
  const h1 = usePaginaAcessivel('Página não encontrada')
  return (
    <>
      <h1 ref={h1} tabIndex={-1}>
        Página não encontrada
      </h1>
      <p>Este endereço não existe no Rota Falada SP.</p>
      <p>
        <Link to="/rota">Planejar uma rota</Link>
      </p>
    </>
  )
}
```

`frontend/src/App.tsx`:

```tsx
import { lazy, Suspense } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { ErroDePagina } from './componentes/ErroDePagina'
import { Pictograma } from './componentes/Pictograma'
import { RegiaoViva } from './componentes/RegiaoViva'
import { Inicio } from './pages/Inicio'

// a landing fica na entrada (é a primeira dobra); o resto vem sob demanda
const Rota = lazy(() => import('./pages/Rota').then((m) => ({ default: m.Rota })))
const Fontes = lazy(() => import('./pages/Fontes').then((m) => ({ default: m.Fontes })))
const Acessibilidade = lazy(() => import('./pages/Acessibilidade').then((m) => ({ default: m.Acessibilidade })))
const NaoEncontrada = lazy(() => import('./pages/NaoEncontrada').then((m) => ({ default: m.NaoEncontrada })))

export default function App() {
  const { pathname } = useLocation()
  return (
    <RegiaoViva>
      <SkipLink />
      <header className="faixa faixa--topo">
        <div className="faixa__miolo">
          <Link className="alvo marca" to="/">
            <Pictograma nome="marca" tamanho={28} />
            <span className="letreiro">Rota Falada SP</span>
          </Link>
          <nav aria-label="Principal">
            <ul className="menu">
              <li>
                <NavLink className="alvo" to="/" end>
                  Início
                </NavLink>
              </li>
              <li>
                <NavLink className="alvo" to="/rota">
                  Planejar rota
                </NavLink>
              </li>
              <li>
                <NavLink className="alvo" to="/fontes">
                  Fontes
                </NavLink>
              </li>
              <li>
                <NavLink className="alvo" to="/acessibilidade">
                  Acessibilidade
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1}>
        <ErroDePagina key={pathname}>
          <Suspense fallback={<p className="carregando-pagina">Carregando…</p>}>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/rota" element={<Rota />} />
              <Route
                path="/fontes"
                element={
                  <div className="folha">
                    <Fontes />
                  </div>
                }
              />
              <Route
                path="/acessibilidade"
                element={
                  <div className="folha">
                    <Acessibilidade />
                  </div>
                }
              />
              <Route
                path="*"
                element={
                  <div className="folha">
                    <NaoEncontrada />
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </ErroDePagina>
      </main>
      <footer className="faixa faixa--base">
        <div className="faixa__miolo">
          <p>
            Dados do mapa © colaboradores do OpenStreetMap. Veja{' '}
            <Link to="/fontes">todas as fontes e licenças</Link>.
          </p>
        </div>
      </footer>
    </RegiaoViva>
  )
}
```

Em `frontend/src/index.css`, antes do comentário `/* ---------- celular e tablet: patamares empilhados ---------- */`, acrescente:

```css
.carregando-pagina {
  max-width: var(--largura-max);
  margin: var(--e-5) auto;
  padding: var(--e-2) var(--calha);
  background: var(--placa);
}

```

- [ ] **Step 4: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 16 arquivos, 85 testes passando (`regiaoUnica` soma 4, `App.test` soma 1, `ErroDePagina.test` soma 1, o `Rota.test` antigo sai).

Confira no dev server (`npm run dev`) que `/`, `/rota`, `/fontes` e `/acessibilidade` abrem, e que um endereço inexistente mostra "Página não encontrada".

---

### Task 3: Textos e dados da rota

**Files:**
- Create: `frontend/src/dados/categorias.ts`, `frontend/src/dados/rotaGeo.ts`, `frontend/src/dados/sessaoRota.ts`, `frontend/src/test/fixturasRota.ts`, `frontend/src/test/dadosRota.test.ts`
- Replace: `frontend/src/dados/passo.ts`
- Modify: `frontend/src/test/passo.test.ts`

**Interfaces:**
- Consumes: `components['schemas']` para `Passo`, `BarreiraResumo`, `RotaOut`, `BarreiraIn`; `Endereco`, `RotaOut` de `client.ts`.
- Produces: `CATEGORIAS`, `Categoria`, `rotuloCategoria` (`categorias.ts`); em `passo.ts`, além do que já existe, `textoInstrucao`, `textoDuracao`, `textoExigencia`, `textoMotor`, `textoSobreARota`, `textoFontePasso`, `textoDataPasso`, `textoBarreira`, `textosDeAviso`, tipo `BarreiraResumo`; `PontoLatLng`, `linhaDoGeoJson`, `distanciaM`, `meioDaLinha` (`rotaGeo.ts`); `SessaoRota` (com `rotaDe`), `BuscaFeita`, `Inclinacao`, `PerfilForm`, `PERFIL_FORM_PADRAO`, `VALIDADE_ROTA_MS`, `lerSessaoRota(agora?)`, `gravarSessaoRota`, `apagarSessaoRota` (`sessaoRota.ts`); `LINHA`, `ROTA`, `passo(ordem, extras)`, `endereco(id, rotulo, extras)` (`fixturasRota.ts`).

- [ ] **Step 1: Escrever os testes**

`frontend/src/test/fixturasRota.ts`:

```ts
import type { Endereco, RotaOut } from '../api/client'
import type { Passo } from '../dados/passo'

export const LINHA = {
  type: 'LineString',
  coordinates: [
    [-46.635, -23.59],
    [-46.634, -23.59],
  ],
}

export function passo(ordem: number, extras: Partial<Passo> = {}): Passo {
  return {
    ordem,
    instrucao: `Siga por Rua ${ordem}`,
    distancia_m: 100,
    duracao_s: 120,
    direcao: 'siga',
    largura_m: 1.5,
    largura_medida: true,
    declividade_pct: 3,
    declividade_medida: true,
    guia: 'transponivel',
    is_degrau: false,
    barreiras_proximas: [],
    fonte: 'osm',
    data_referencia: '2026-10-12',
    geometria: LINHA,
    ...extras,
  }
}

export const ROTA: RotaOut = {
  passos: [passo(1), passo(2)],
  distancia_m: 200,
  duracao_s: 240,
  avisos: [],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: LINHA,
  cache: false,
}

export function endereco(id: number, rotulo: string, extras: Partial<Endereco> = {}): Endereco {
  return { id, tipo: 'endereco', rotulo, lat: -23.59 + id / 1000, lon: -46.635, aproximado: false, ...extras }
}
```

`frontend/src/test/dadosRota.test.ts`:

```ts
import { apagarSessaoRota, gravarSessaoRota, lerSessaoRota, PERFIL_FORM_PADRAO, VALIDADE_ROTA_MS, type SessaoRota } from '../dados/sessaoRota'
import { rotuloCategoria } from '../dados/categorias'
import {
  letreiroDoPasso,
  nomeFonte,
  separarInstrucao,
  textoBarreira,
  textoDataPasso,
  textoDuracao,
  textoExigencia,
  textoFalado,
  textoFontePasso,
  textoInstrucao,
  textoLargura,
  textoMotor,
  textoSobreARota,
  textosDeAviso,
} from '../dados/passo'
import { linhaDoGeoJson, meioDaLinha } from '../dados/rotaGeo'
import { LINHA, passo, ROTA } from './fixturasRota'

const DIFICULTA = {
  id: 7,
  origem: 'colaborativa' as const,
  categoria: 'calcada_estreita',
  severidade: 'dificulta',
  distancia_m: 12.4,
  confirmacoes: 1,
  data_referencia: '2026-11-03',
}

describe('textos do passo', () => {
  it('entende a instrução do pgRouting', () => {
    expect(separarInstrucao('Siga por Rua X')).toEqual({ acao: 'Siga', rua: 'Rua X' })
    expect(separarInstrucao('Vire à direita e siga por Rua X')).toEqual({ acao: 'Vire à direita', rua: 'Rua X' })
    expect(separarInstrucao('Siga por a via')).toEqual({ acao: 'Siga', rua: null })
  })

  it('instrução vazia nunca vira passo mudo', () => {
    expect(textoInstrucao(passo(1, { instrucao: '' }))).toBe('Siga o trecho')
    expect(letreiroDoPasso(passo(1, { instrucao: ' ' }))).toBe('Siga o trecho')
  })

  it('largura sem medição é "sem dado", mesmo com valor', () => {
    expect(textoLargura(passo(1, { largura_m: 0, largura_medida: false }))).toBe('sem dado')
  })

  it('duração, exigência e motor em texto', () => {
    expect(textoDuracao(30)).toBe('cerca de 1 minuto a pé')
    expect(textoDuracao(900)).toBe('cerca de 15 minutos a pé')
    expect(textoExigencia('any')).toBe('qualquer inclinação')
    expect(textoExigencia(6)).toBe('até 6%')
    expect(textoMotor('ors')).toBe('openrouteservice.org by HeiGIT')
    expect(textoMotor('pgrouting')).toBe('roteamento local (pgRouting)')
    expect(textoMotor('fixture')).toBe('rota gravada para demonstração, não calculada agora')
  })

  it('a frase da ficha só promete o que cada motor faz', () => {
    expect(textoSobreARota('ors')).toBe(
      'Rota sugerida com os dados disponíveis. Ela evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado.',
    )
    // o pgRouting usa só o custo gravado pelo ETL: desvia de escada da base, nunca de barreira registrada
    expect(textoSobreARota('pgrouting')).toContain('não desvia das barreiras registradas')
    expect(textoSobreARota('pgrouting')).toContain('Não sabemos o que não foi registrado')
    expect(textoSobreARota('fixture')).toContain('Ela não muda com as barreiras registradas')
  })

  it('fonte e data dizem de onde vem cada coisa', () => {
    expect(nomeFonte('colaborativo')).toBe('colaboradores')
    expect(textoFontePasso(passo(1))).toBe('OpenStreetMap; largura: GeoSampa')
    expect(textoFontePasso(passo(1, { largura_medida: false, largura_m: null }))).toBe('OpenStreetMap')
    expect(textoDataPasso(passo(1))).toBe('12/10/2026 (trecho no OSM)')
    expect(textoDataPasso(passo(1, { largura_medida: false, data_referencia: null }))).toBe('sem dado')
  })

  it('barreira em português, sem o slug cru', () => {
    expect(textoBarreira(DIFICULTA)).toBe(
      'Calçada estreita, a 12 m. Dificulta a passagem, não bloqueia a rota. 1 confirmação. Fonte: colaboradores, 03/11/2026.',
    )
    expect(textoBarreira({ ...DIFICULTA, origem: 'oficial', categoria: 'poda_de_arvore', confirmacoes: null })).toBe(
      'Poda de arvore, a 12 m. Dificulta a passagem, não bloqueia a rota. Fonte: SP156, 03/11/2026.',
    )
    expect(rotuloCategoria('escada')).toBe('Escada')
  })

  it('aviso barreira_dificulta sai de barreiras_proximas; os outros usam a mensagem', () => {
    const textos = textosDeAviso({
      avisos: [
        { tipo: 'trecho_sem_dados', mensagem: 'Sem dados.' },
        { tipo: 'barreira_dificulta', mensagem: "Barreira 'calcada_estreita' a 12 m" },
      ],
      passos: [passo(3, { barreiras_proximas: [DIFICULTA] })],
    })
    expect(textos[0]).toBe('Sem dados.')
    expect(textos[1]).toMatch(/^Passo 3: Calçada estreita/)
    expect(textos.join()).not.toContain('calcada_estreita')
  })

  it('a voz avisa da barreira do passo', () => {
    expect(textoFalado(passo(3, { barreiras_proximas: [DIFICULTA] }))).toContain('Atenção: barreira, Calçada estreita, a 12 metros.')
  })
})

describe('geometria', () => {
  it('inverte [lng, lat] e recusa o que não é linha', () => {
    expect(linhaDoGeoJson(LINHA)).toEqual([
      [-23.59, -46.635],
      [-23.59, -46.634],
    ])
    for (const invalida of [{}, null, { type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[1, 2]] }, { type: 'LineString', coordinates: [[1], [2]] }]) {
      expect(linhaDoGeoJson(invalida)).toBeNull()
    }
  })

  it('acha o meio da linha ao longo dela', () => {
    const [lat, lon] = meioDaLinha([
      [0, 0],
      [0, 2],
    ])
    expect(lat).toBeCloseTo(0)
    expect(lon).toBeCloseTo(1)
  })
})

describe('sessão da busca', () => {
  const sessao: SessaoRota = {
    versao: 1,
    origem: null,
    destino: null,
    perfil: PERFIL_FORM_PADRAO,
    rota: ROTA,
    rotaDe: { pedido: { origem: { lat: 1, lng: 2 }, destino: { lat: 3, lng: 4 }, perfil: { inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 } }, origem: 'Rua A', destino: 'Rua B' },
    calculadaEm: '2026-11-05T12:00:00.000Z',
  }
  const agora = Date.parse('2026-11-05T12:00:00.000Z')

  afterEach(() => vi.restoreAllMocks())

  it('restaura sem rede e apaga', () => {
    gravarSessaoRota(sessao)
    expect(lerSessaoRota(agora)?.rota?.passos).toHaveLength(2)
    apagarSessaoRota()
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('rota com mais de 6 h cai, os pontos ficam', () => {
    gravarSessaoRota(sessao)
    const lida = lerSessaoRota(agora + VALIDADE_ROTA_MS + 1)
    expect(lida?.rota).toBeNull()
    expect(lida?.rotaDe).toBeNull()
    expect(lida?.perfil).toEqual(PERFIL_FORM_PADRAO)
  })

  it('formato estranho é ignorado', () => {
    sessionStorage.setItem('rf-busca', '{"versao":9}')
    expect(lerSessaoRota(agora)).toBeNull()
    sessionStorage.setItem('rf-busca', 'não é json')
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('armazenamento que lança não derruba a tela', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => gravarSessaoRota(sessao)).not.toThrow()
    expect(lerSessaoRota(agora)).toBeNull()
  })

  it('nunca grava em localStorage', () => {
    gravarSessaoRota(sessao)
    expect(localStorage.length).toBe(0)
  })
})
```

Em `frontend/src/test/passo.test.ts`, duas expectativas mudam, porque sob o ORS o valor representa uma classe de inclinação:

```ts
expect(textoDeclividade(p4)).toBe('cerca de 3%')
```

```ts
'Passo 4. Vire à direita. 13,1 metros. Largura da calçada: 1,67 metro. Declividade: cerca de 3 por cento. Guia não rebaixada.',
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/dadosRota.test.ts src/test/passo.test.ts`
Expected: FAIL (`Failed to resolve import "../dados/sessaoRota"`; `passo.test` com `expected '3%' to be 'cerca de 3%'`).

- [ ] **Step 3: Implementar**

`frontend/src/dados/categorias.ts`:

```ts
import type { components } from '../api/types.gen'

export type Categoria = components['schemas']['BarreiraIn']['categoria']

/** A lista fechada do spec colaborativo; o compilador acusa categoria faltando. */
export const CATEGORIAS: Record<Categoria, { rotulo: string; dica: string }> = {
  escada: { rotulo: 'Escada', dica: 'Degraus sem rampa ao lado.' },
  sem_rampa: { rotulo: 'Sem rampa', dica: 'Desnível sem rampa nem guia rebaixada.' },
  elevador_quebrado: { rotulo: 'Elevador quebrado', dica: 'Elevador ou plataforma fora de uso.' },
  obstaculo_bloqueando: { rotulo: 'Obstáculo bloqueando', dica: 'Algo fecha a passagem inteira.' },
  calcada_estreita: { rotulo: 'Calçada estreita', dica: 'Passa com dificuldade.' },
  rampa_ingreme: { rotulo: 'Rampa íngreme', dica: 'Existe rampa, mas é muito inclinada.' },
  buraco: { rotulo: 'Buraco', dica: 'Buraco ou trecho afundado.' },
  piso_irregular: { rotulo: 'Piso irregular', dica: 'Pedras soltas, raízes ou desníveis pequenos.' },
  sem_piso_tatil: { rotulo: 'Sem piso tátil', dica: 'Falta ou está interrompido o piso tátil.' },
  outro: { rotulo: 'Outro', dica: 'Descreva no campo de texto.' },
}

/** Categoria em português; o que não está na lista (SP156) só troca "_" por espaço. */
export function rotuloCategoria(chave: string): string {
  const conhecida = CATEGORIAS[chave as Categoria]
  if (conhecida) return conhecida.rotulo
  const texto = chave.replaceAll('_', ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
```

`frontend/src/dados/passo.ts`:

```ts
import type { components } from '../api/types.gen'
import { rotuloCategoria } from './categorias'

export type Passo = components['schemas']['Passo']
export type Guia = Passo['guia']
export type BarreiraResumo = components['schemas']['BarreiraResumo']
type RotaOut = components['schemas']['RotaOut']

const SEM_DADO = 'sem dado'
const SEPARADOR_RUA = ' em direção a '
// formato do fallback pgRouting (services/pgrouting.py): "Siga por X", "Vire à direita e siga por X"
const SEPARADOR_PGROUTING = ' e siga por '
const PREFIXO_PGROUTING = 'Siga por '
const VIA_SEM_NOME = 'a via'

const umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const ateDuasCasas = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

function ruaOuNula(rua: string): string | null {
  return rua === VIA_SEM_NOME ? null : rua
}

/** "Vire à direita em direção a Rua X" → { acao: "Vire à direita", rua: "Rua X" }. */
export function separarInstrucao(instrucao: string): { acao: string; rua: string | null } {
  let i = instrucao.indexOf(SEPARADOR_RUA)
  if (i >= 0) return { acao: instrucao.slice(0, i), rua: instrucao.slice(i + SEPARADOR_RUA.length) }
  i = instrucao.indexOf(SEPARADOR_PGROUTING)
  if (i >= 0) return { acao: instrucao.slice(0, i), rua: ruaOuNula(instrucao.slice(i + SEPARADOR_PGROUTING.length)) }
  if (instrucao.startsWith(PREFIXO_PGROUTING)) {
    return { acao: 'Siga', rua: ruaOuNula(instrucao.slice(PREFIXO_PGROUTING.length)) }
  }
  return { acao: instrucao, rua: null }
}

/** A instrução vazia existe (services/rota.py); a lista nunca mostra um passo mudo. */
export function textoInstrucao(passo: Passo): string {
  return passo.instrucao.trim() || 'Siga o trecho'
}

/** O nome gravado no vão: a rua quando a instrução a traz, senão a própria instrução. */
export function letreiroDoPasso(passo: Passo): string {
  return separarInstrucao(passo.instrucao).rua ?? textoInstrucao(passo)
}

export function formatarDistancia(metros: number): string {
  return `${umaCasa.format(metros)} m`
}

export function textoDuracao(segundos: number): string {
  const minutos = Math.max(1, Math.round(segundos / 60))
  return `cerca de ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} a pé`
}

export function textoExigencia(nivel: RotaOut['nivel_exigencia_atendido']): string {
  return nivel === 'any' ? 'qualquer inclinação' : `até ${nivel}%`
}

export function textoMotor(motor: RotaOut['motor']): string {
  if (motor === 'ors') return 'openrouteservice.org by HeiGIT'
  if (motor === 'pgrouting') return 'roteamento local (pgRouting)'
  return 'rota gravada para demonstração, não calculada agora'
}

/**
 * A frase fixa da ficha. Só diz o que o motor faz: o ORS desvia e o pgRouting usa o custo
 * gravado pelo ETL, que bloqueia escada da base de ruas e não lê barreira registrada. E, sob
 * o pgRouting, `barreiras_proximas` traz só `dificulta`: a que bloqueia nem aparece no passo.
 */
export function textoSobreARota(motor: RotaOut['motor']): string {
  if (motor === 'pgrouting') {
    return 'Rota sugerida pelo roteamento local de reserva. Ele evita as escadas da base de ruas, mas não desvia das barreiras registradas, e as que bloqueiam a passagem podem não aparecer nos passos. Confira as barreiras perto de cada passo. Não sabemos o que não foi registrado.'
  }
  if (motor === 'fixture') {
    return 'Rota gravada para demonstração. Ela não muda com as barreiras registradas, e não sabemos o que não foi registrado.'
  }
  return 'Rota sugerida com os dados disponíveis. Ela evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam. Relatos ainda sem confirmação não mudam a rota, e não sabemos o que não foi registrado.'
}

export function textoLargura(passo: Passo): string {
  return passo.largura_m === null || !passo.largura_medida ? SEM_DADO : `${ateDuasCasas.format(passo.largura_m)} m`
}

/** Sob o ORS o valor representa uma classe de inclinação, não uma medição: daí o "cerca de". */
export function textoDeclividade(passo: Passo): string {
  return passo.declividade_pct === null ? SEM_DADO : `cerca de ${ateDuasCasas.format(passo.declividade_pct)}%`
}

export function textoGuia(guia: Guia): string {
  if (guia === 'transponivel') return 'rebaixada'
  if (guia === 'nao_transponivel') return 'não rebaixada'
  return SEM_DADO
}

export function textoDegrau(degrau: boolean): string {
  return degrau ? 'com degrau' : 'sem degrau'
}

const FONTES: Record<string, string> = {
  osm: 'OpenStreetMap',
  geosampa: 'GeoSampa',
  sp156: 'SP156',
  sptrans: 'SPTrans',
  ors: 'openrouteservice',
  colaborativo: 'colaboradores',
}

export function nomeFonte(chave: string): string {
  return FONTES[chave] ?? chave
}

/** `fonte` é a da via; a largura medida só pode ter vindo do GeoSampa e a lista diz isso. */
export function textoFontePasso(passo: Passo): string {
  const base = nomeFonte(passo.fonte)
  return passo.largura_medida && passo.fonte !== 'geosampa' ? `${base}; largura: GeoSampa` : base
}

/** ISO "2026-10-12" → "12/10/2026", sem passar por Date (evita deslocamento de fuso). */
export function formatarData(iso: string | null): string {
  if (!iso) return SEM_DADO
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

/** A data do passo é a do trecho no OSM, mesmo quando a largura vem do GeoSampa. */
export function textoDataPasso(passo: Passo): string {
  const data = formatarData(passo.data_referencia)
  return passo.largura_medida && passo.data_referencia ? `${data} (trecho no OSM)` : data
}

function metros(valor: number): string {
  return `${ateDuasCasas.format(valor)} ${valor < 2 ? 'metro' : 'metros'}`
}

/** "Buraco, a 12 m. Dificulta a passagem, não bloqueia a rota. 1 confirmação. Fonte: colaboradores, 03/11/2026." */
export function textoBarreira(b: BarreiraResumo): string {
  const partes = [`${rotuloCategoria(b.categoria)}, a ${Math.round(b.distancia_m)} m.`, 'Dificulta a passagem, não bloqueia a rota.']
  if (b.confirmacoes !== null) partes.push(`${b.confirmacoes} ${b.confirmacoes === 1 ? 'confirmação' : 'confirmações'}.`)
  const fonte = b.origem === 'colaborativa' ? 'colaboradores' : 'SP156'
  partes.push(`Fonte: ${fonte}, ${formatarData(b.data_referencia)}.`)
  return partes.join(' ')
}

/** Avisos em texto: `barreira_dificulta` traz a chave crua, então sai de barreiras_proximas. */
export function textosDeAviso(rota: Pick<RotaOut, 'avisos' | 'passos'>): string[] {
  const gerais = rota.avisos.filter((a) => a.tipo !== 'barreira_dificulta').map((a) => a.mensagem)
  const barreiras = rota.passos.flatMap((p) => p.barreiras_proximas.map((b) => `Passo ${p.ordem}: ${textoBarreira(b)}`))
  return [...gerais, ...new Set(barreiras)]
}

/** Texto lido pela síntese de voz. Determinístico: só dados do passo. */
export function textoFalado(passo: Passo): string {
  const partes = [
    `Passo ${passo.ordem}.`,
    `${textoInstrucao(passo)}.`,
    `${metros(passo.distancia_m)}.`,
    `Largura da calçada: ${passo.largura_m === null || !passo.largura_medida ? SEM_DADO : metros(passo.largura_m)}.`,
    `Declividade: ${passo.declividade_pct === null ? SEM_DADO : `cerca de ${ateDuasCasas.format(passo.declividade_pct)} por cento`}.`,
    `Guia ${textoGuia(passo.guia)}.`,
  ]
  if (passo.is_degrau) partes.push('Atenção: degrau.')
  for (const b of passo.barreiras_proximas) {
    partes.push(`Atenção: barreira, ${rotuloCategoria(b.categoria)}, a ${Math.round(b.distancia_m)} metros.`)
  }
  return partes.join(' ')
}
```

`frontend/src/dados/rotaGeo.ts`:

```ts
/** Latitude e longitude, na ordem do Leaflet. O GeoJSON vem como [lng, lat]. */
export type PontoLatLng = [number, number]

function ehPosicao(p: unknown): p is [number, number] {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
}

/** `geometria` é dict sem tipo no contrato. Devolve os pontos, ou null se não for uma linha válida. */
export function linhaDoGeoJson(geometria: unknown): PontoLatLng[] | null {
  const g = geometria as { type?: unknown; coordinates?: unknown } | null | undefined
  if (g?.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null
  if (!g.coordinates.every(ehPosicao)) return null
  return (g.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng])
}

const RAIO_TERRA_M = 6_371_000

/** Distância em metros (haversine). */
export function distanciaM(a: PontoLatLng, b: PontoLatLng): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b[0] - a[0])
  const dLon = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * RAIO_TERRA_M * Math.asin(Math.sqrt(h))
}

/** O ponto no meio da linha, medido ao longo dela. */
export function meioDaLinha(linha: PontoLatLng[]): PontoLatLng {
  const trechos = linha.slice(1).map((p, i) => distanciaM(linha[i], p))
  let falta = trechos.reduce((soma, d) => soma + d, 0) / 2
  for (let i = 0; i < trechos.length; i++) {
    if (falta <= trechos[i]) {
      const f = trechos[i] === 0 ? 0 : falta / trechos[i]
      return [linha[i][0] + (linha[i + 1][0] - linha[i][0]) * f, linha[i][1] + (linha[i + 1][1] - linha[i][1]) * f]
    }
    falta -= trechos[i]
  }
  return linha[linha.length - 1]
}
```

`frontend/src/dados/sessaoRota.ts`:

```ts
import type { Endereco, RotaIn, RotaOut } from '../api/client'

export type Inclinacao = 3 | 6 | 10 | 'any'
export type PerfilForm = { inclinacao_max: Inclinacao; evitar_degraus: boolean }

/** O que gerou a rota. Fica junto dela: os campos podem mudar sem recalcular (WCAG 3.2.2). */
export type BuscaFeita = { pedido: RotaIn; origem: string; destino: string }

export type SessaoRota = {
  versao: 1
  /** O que está nos campos agora. */
  origem: Endereco | null
  destino: Endereco | null
  perfil: PerfilForm
  rota: RotaOut | null
  rotaDe: BuscaFeita | null
  calculadaEm: string | null
}

const CHAVE = 'rf-busca'
/** O mesmo TTL do cache de rotas no backend. */
export const VALIDADE_ROTA_MS = 6 * 60 * 60 * 1000

export const PERFIL_FORM_PADRAO: PerfilForm = { inclinacao_max: 6, evitar_degraus: true }

function ehSessao(valor: unknown): valor is SessaoRota {
  const s = valor as Partial<SessaoRota> | null
  return !!s && s.versao === 1 && typeof s.perfil === 'object' && s.perfil !== null && 'origem' in s && 'destino' in s
}

/**
 * Fica só nesta aba: sobrevive a recarregar, a descartar a aba e a ir a /barreiras e voltar,
 * sem rede. Fechar a aba apaga. Nunca URL nem localStorage: seria histórico de trajetos.
 */
export function lerSessaoRota(agora = Date.now()): SessaoRota | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    if (!bruto) return null
    const sessao: unknown = JSON.parse(bruto)
    if (!ehSessao(sessao)) return null
    const vencida = sessao.calculadaEm !== null && agora - Date.parse(sessao.calculadaEm) > VALIDADE_ROTA_MS
    return vencida ? { ...sessao, rota: null, rotaDe: null, calculadaEm: null } : sessao
  } catch {
    return null
  }
}

export function gravarSessaoRota(sessao: SessaoRota): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(sessao))
  } catch {
    // sem armazenamento a tela funciona igual, só não restaura
  }
}

export function apagarSessaoRota(): void {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // idem
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/dadosRota.test.ts src/test/passo.test.ts`
Expected: PASS, 22 testes (16 e 6).

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 17 arquivos, 101 testes passando.

---

### Task 4: Extrair a tabela de passos e a ficha de `Inicio`

**Files:**
- Create: `frontend/src/componentes/TabelaPassos.tsx`, `frontend/src/componentes/FichaRota.tsx`, `frontend/src/componentes/BarreirasDoPasso.tsx`
- Modify: `frontend/src/pages/Inicio.tsx`

**Interfaces:**
- Consumes: `dados/passo.ts`, `Placa`, `Pictograma`.
- Produces: `TabelaPassos({ passos, passoAtivo, rotulo, aoVerNoMapa?, passoNoMapa? })`, com `<ol id="lista-passos">` e `<li id="passo-N">`; `FichaRota({ resumo, dados, avisos, solta?, children? })`; `BarreirasDoPasso({ barreiras })`.

É refatoração: o teste que protege é o `Inicio.test.tsx`, que já existe e precisa continuar verde.

- [ ] **Step 1: Confirmar a linha de base**

Run: `npx vitest --run src/test/Inicio.test.tsx`
Expected: PASS, 6 testes.

- [ ] **Step 2: Criar os componentes**

`frontend/src/componentes/BarreirasDoPasso.tsx`:

```tsx
import { textoBarreira, type BarreiraResumo } from '../dados/passo'

/**
 * Só `dificulta` chega ao passo: intransponível vira desvio e pendente não entra na rota.
 * Por isso a lista vazia não vira "sem barreiras".
 */
export function BarreirasDoPasso({ barreiras }: { barreiras: BarreiraResumo[] }) {
  if (barreiras.length === 0) return null
  return (
    <ul className="barreiras-passo">
      {barreiras.map((b) => (
        <li key={`${b.origem}-${b.id}`}>{textoBarreira(b)}</li>
      ))}
    </ul>
  )
}
```

`frontend/src/componentes/TabelaPassos.tsx`:

```tsx
import {
  formatarDistancia,
  textoDataPasso,
  textoDeclividade,
  textoFontePasso,
  textoGuia,
  textoInstrucao,
  textoLargura,
  type Passo,
} from '../dados/passo'
import { BarreirasDoPasso } from './BarreirasDoPasso'
import { Placa } from './Placa'

const CAMPOS = ['Distância', 'Largura', 'Declividade', 'Guia', 'Degrau', 'Fonte', 'Data']

type Props = {
  passos: Passo[]
  passoAtivo: number | null
  rotulo: string
  /** Com o mapa aberto, cada passo ganha "Ver o passo N no mapa". O texto dirige o mapa. */
  aoVerNoMapa?: (ordem: number) => void
  passoNoMapa?: number | null
}

/** A lista canônica de passos (`id="lista-passos"`). Tudo o que o mapa mostra está aqui. */
export function TabelaPassos({ passos, passoAtivo, rotulo, aoVerNoMapa, passoNoMapa }: Props) {
  return (
    <div className="tabela-passos">
      {/* cabeçalho só visual, alinhado pelo subgrid; cada linha mantém seus <dt> para o leitor de tela */}
      <div className="tabela-passos__cabecalho" aria-hidden="true">
        <span />
        {CAMPOS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <ol id="lista-passos" className="placas" aria-label={rotulo} tabIndex={-1}>
        {passos.map((p) => {
          const ativo = p.ordem === passoAtivo
          return (
            <li
              key={p.ordem}
              id={`passo-${p.ordem}`}
              className={ativo ? 'placa-passo placa-passo--ativa' : 'placa-passo'}
              aria-current={ativo ? 'step' : undefined}
            >
              <span className="placa-passo__ordem letreiro">{p.ordem}</span>
              <p className="placa-passo__instrucao">{textoInstrucao(p)}</p>
              <dl className="placa-passo__dados">
                <div>
                  <dt className="rotulo-campo">Distância</dt>
                  <dd className="medida">{formatarDistancia(p.distancia_m)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Largura</dt>
                  <dd className="medida">{textoLargura(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Declividade</dt>
                  <dd className="medida">{textoDeclividade(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Guia</dt>
                  <dd className={p.guia === 'nao_transponivel' ? 'alerta' : undefined}>{textoGuia(p.guia)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Degrau</dt>
                  <dd className={p.is_degrau ? 'alerta' : undefined}>{p.is_degrau ? 'sim' : 'não'}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Fonte</dt>
                  <dd>{textoFontePasso(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Data</dt>
                  <dd className="medida">{textoDataPasso(p)}</dd>
                </div>
              </dl>
              <BarreirasDoPasso barreiras={p.barreiras_proximas} />
              {aoVerNoMapa && (
                <div className="placa-passo__acoes">
                  <Placa aria-current={p.ordem === passoNoMapa ? 'true' : undefined} onClick={() => aoVerNoMapa(p.ordem)}>
                    Ver o passo {p.ordem} no mapa
                  </Placa>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
```

`frontend/src/componentes/FichaRota.tsx`:

```tsx
import { Fragment, type ReactNode } from 'react'
import { Pictograma } from './Pictograma'

type Props = {
  resumo: ReactNode
  dados: { rotulo: string; valor: ReactNode }[]
  avisos: string[]
  /** Fixa só na landing; em /rota nada fixo pode cobrir o foco. */
  solta?: boolean
  children?: ReactNode
}

export function FichaRota({ resumo, dados, avisos, solta = false, children }: Props) {
  return (
    <div className={solta ? 'ficha ficha--solta' : 'ficha'}>
      <p className="ficha__resumo">{resumo}</p>
      <dl className="ficha__dados">
        {dados.map((d) => (
          <Fragment key={d.rotulo}>
            <dt>{d.rotulo}</dt>
            <dd>{d.valor}</dd>
          </Fragment>
        ))}
      </dl>
      {avisos.map((texto, i) => (
        // avisos podem repetir o tipo: a chave é a posição
        <p key={i} className="aviso">
          <Pictograma nome="fonte" />
          <span>{texto}</span>
        </p>
      ))}
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Usar em `Inicio.tsx`**

Troque o import de `../dados/passo` por:

```tsx
import { FichaRota } from '../componentes/FichaRota'
import { TabelaPassos } from '../componentes/TabelaPassos'
import { formatarData, formatarDistancia, nomeFonte, textoExigencia, textoFalado, textosDeAviso } from '../dados/passo'
```

Troque as constantes `EXIGENCIA` e `CAMPOS` por uma só:

```tsx
const EXIGENCIA = textoExigencia(ROTA_EXEMPLO.nivel_exigencia_atendido)
```

Troque todo o conteúdo de `<div className="exemplo">` por:

```tsx
        <div className="exemplo">
          <FichaRota
            resumo={
              <>
                {ROTA_EXEMPLO_META.origem} até {ROTA_EXEMPLO_META.destino}, em {ROTA_EXEMPLO_META.bairro}:{' '}
                <span className="medida">{DISTANCIA}</span> em {PASSOS.length} passos, cerca de {MINUTOS} minutos a pé.
              </>
            }
            dados={[
              { rotulo: 'Calculada por', valor: `${MOTOR}, em produção` },
              { rotulo: 'Exigência atendida', valor: EXIGENCIA },
              { rotulo: 'Fontes', valor: ROTA_EXEMPLO.fontes.map(nomeFonte).join(', ') },
              { rotulo: 'Gravada em', valor: formatarData('2026-10-12') },
            ]}
            avisos={textosDeAviso(ROTA_EXEMPLO)}
          >
            <BotaoOuvir passos={PASSOS} aoMudarPasso={setPassoAtivo} />
          </FichaRota>
          <TabelaPassos passos={PASSOS} passoAtivo={passoAtivo} rotulo="Os 11 passos da rota de exemplo" />
        </div>
```

- [ ] **Step 4: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 17 arquivos, 101 testes passando, `Inicio.test` inclusive. O `rg "CAMPOS" src/pages/Inicio.tsx` não acha nada.

---

### Task 5: Reducers do campo e da rota

**Files:**
- Create: `frontend/src/componentes/campoEstado.ts`, `frontend/src/pages/rotaEstado.ts`, `frontend/src/test/rotaEstado.test.ts`

**Interfaces:**
- Consumes: `Endereco`, `RotaIn`, `RotaOut`, `BuscaFeita`, `PerfilForm`, `formatarDistancia`, `textoDuracao`.
- Produces: `EstadoCampo`, `AcaoCampo`, `ViaEscolha`, `MINIMO_BUSCA`, `estadoInicialCampo`, `reduzirCampo`, `textoDoCampo`, `escolhaDoCampo`, `textoForaDaArea`, `textoRetorno`, `textoDaLista` (`campoEstado.ts`); `EstadoRota` (cada fase guarda a `busca` que a gerou), `AcaoRota`, `MSG_SEM_PASSOS`, `reduzirRota`, `montarPedido`, `mesmoPonto`, `resumoDaRota`, `focoVaiParaResultado(ativo, focoNoEnvio)`, `horaDe` (`rotaEstado.ts`).

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/rotaEstado.test.ts`:

```ts
import { estadoInicialCampo, reduzirCampo, textoDaLista, textoDoCampo, textoRetorno, type EstadoCampo } from '../componentes/campoEstado'
import { focoVaiParaResultado, mesmoPonto, montarPedido, reduzirRota, resumoDaRota, type EstadoRota } from '../pages/rotaEstado'
import { endereco, passo, ROTA } from './fixturasRota'

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')

function comLista(ativo = -1): EstadoCampo {
  return { fase: 'lista', texto: 'rua', opcoes: [A, B], ativo, aberta: true }
}

describe('reduzirCampo', () => {
  it('digitar em branco volta a vazio; digitar depois de escolher invalida a escolha', () => {
    expect(reduzirCampo({ fase: 'digitando', texto: 'r' }, { tipo: 'digitar', texto: '  ' })).toEqual({ fase: 'vazio' })
    const escolhido = estadoInicialCampo(A)
    expect(escolhido).toMatchObject({ fase: 'escolhido', via: 'restauro' })
    expect(reduzirCampo(escolhido, { tipo: 'digitar', texto: 'Rua A, ' })).toEqual({ fase: 'digitando', texto: 'Rua A, ' })
  })

  it('resposta de busca velha é ignorada', () => {
    const buscando: EstadoCampo = { fase: 'buscando', texto: 'rua b' }
    expect(reduzirCampo(buscando, { tipo: 'resultado', texto: 'rua a', opcoes: [A] })).toBe(buscando)
    expect(reduzirCampo({ fase: 'digitando', texto: 'x' }, { tipo: 'falhou', texto: 'x', mensagem: 'm' })).toEqual({ fase: 'digitando', texto: 'x' })
  })

  it('lista vazia é o "fora da área" da digitação', () => {
    const e = reduzirCampo({ fase: 'buscando', texto: 'rua z' }, { tipo: 'resultado', texto: 'rua z', opcoes: [] })
    expect(e).toEqual({ fase: 'sem_resultado', texto: 'rua z' })
    expect(textoRetorno(e)).toContain('fora dessa área o Rota Falada SP ainda não atende')
  })

  it('setas andam em volta; fechar tira o ativo e mantém o texto', () => {
    expect(reduzirCampo(comLista(-1), { tipo: 'mover', passo: 1 })).toMatchObject({ ativo: 0 })
    expect(reduzirCampo(comLista(1), { tipo: 'mover', passo: 1 })).toMatchObject({ ativo: 0 })
    expect(reduzirCampo(comLista(0), { tipo: 'mover', passo: -1 })).toMatchObject({ ativo: 1 })
    expect(reduzirCampo(comLista(-1), { tipo: 'mover', passo: -1 })).toMatchObject({ ativo: 1 })
    const fechado = reduzirCampo(comLista(1), { tipo: 'fechar' })
    expect(fechado).toMatchObject({ aberta: false, ativo: -1 })
    expect(textoDoCampo(fechado)).toBe('rua')
    expect(reduzirCampo(fechado, { tipo: 'abrir', ativo: 'ultimo' })).toMatchObject({ aberta: true, ativo: 1 })
  })

  it('aproximado continua dito depois de escolhido', () => {
    expect(textoRetorno(estadoInicialCampo({ ...A, aproximado: true }))).toContain('número mais próximo')
    expect(textoRetorno(estadoInicialCampo(A))).toBeNull()
  })

  it('o anúncio da lista só instrui na primeira vez e não promete o total quando vem cheia', () => {
    expect(textoDaLista([A, B], 'Origem', true)).toBe('2 endereços para Origem. Seta para baixo para escolher.')
    expect(textoDaLista([A, B], 'Origem', false)).toBe('2 endereços para Origem.')
    expect(textoDaLista(Array(8).fill(A), 'Destino', false)).toBe('Os 8 primeiros endereços para Destino.')
    expect(textoDaLista([{ ...A, aproximado: true }], 'Origem', true)).toContain('1 endereço aproximado')
  })
})

describe('reduzirRota', () => {
  const pedido = montarPedido(A, B, { inclinacao_max: 6, evitar_degraus: true })
  const busca = { pedido, origem: A.rotulo, destino: B.rotulo }
  const calculando: EstadoRota = { fase: 'calculando', busca, lento: false }

  it('monta o pedido no contrato: lng, perfil inteiro e inclinação numérica', () => {
    expect(pedido.origem).toEqual({ lat: A.lat, lng: A.lon })
    expect(pedido.perfil).toEqual({ inclinacao_max: 6, guia_max_m: 0.06, largura_min_m: 0.9, evitar_degraus: true, velocidade_kmh: 3 })
  })

  it('segue o ciclo do cálculo', () => {
    expect(reduzirRota({ fase: 'ocioso' }, { tipo: 'calcular', busca })).toEqual(calculando)
    expect(reduzirRota(calculando, { tipo: 'demorou' })).toMatchObject({ lento: true })
    expect(reduzirRota(calculando, { tipo: 'chegou', rota: ROTA, calculadaEm: 'x' })).toMatchObject({ fase: 'resultado', busca, restaurada: false })
    expect(reduzirRota(calculando, { tipo: 'sem_rota', detalhe: 'd' })).toMatchObject({ fase: 'sem_rota', detalhe: 'd' })
    expect(reduzirRota(calculando, { tipo: 'falhou', mensagem: 'm' })).toMatchObject({ fase: 'indisponivel', mensagem: 'm' })
    expect(reduzirRota(calculando, { tipo: 'cancelar' })).toEqual({ fase: 'ocioso' })
  })

  it('zero passos não é rota', () => {
    expect(reduzirRota(calculando, { tipo: 'chegou', rota: { ...ROTA, passos: [] }, calculadaEm: 'x' })).toMatchObject({ fase: 'sem_rota' })
  })

  it('resposta depois de cancelar é ignorada', () => {
    expect(reduzirRota({ fase: 'ocioso' }, { tipo: 'chegou', rota: ROTA, calculadaEm: 'x' })).toEqual({ fase: 'ocioso' })
  })

  it('mesmo ponto a 5 casas', () => {
    expect(mesmoPonto(A, { ...A, lat: A.lat + 0.000001 })).toBe(true)
    expect(mesmoPonto(A, B)).toBe(false)
  })

  it('resume a rota', () => {
    expect(resumoDaRota(ROTA)).toBe('200,0 m em 2 passos, cerca de 4 minutos a pé, sem avisos')
    expect(resumoDaRota({ ...ROTA, passos: [passo(1)], avisos: [{ tipo: 'motor_fallback', mensagem: 'm' }] })).toContain('em 1 passo,')
  })

  it('o foco só vai ao resultado se a pessoa não saiu de onde enviou', () => {
    const botao = document.createElement('button')
    const campo = document.createElement('input')
    const outro = document.createElement('a')
    expect(focoVaiParaResultado(botao, botao)).toBe(true)
    expect(focoVaiParaResultado(campo, campo)).toBe(true) // Enter no campo escolhido
    expect(focoVaiParaResultado(document.body, botao)).toBe(true)
    expect(focoVaiParaResultado(outro, botao)).toBe(false)
    expect(focoVaiParaResultado(campo, botao)).toBe(false) // voltou a editar durante a espera
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/rotaEstado.test.ts`
Expected: FAIL (`Failed to resolve import "../componentes/campoEstado"`).

- [ ] **Step 3: Implementar**

`frontend/src/componentes/campoEstado.ts`:

```ts
import type { Endereco } from '../api/client'

export type ViaEscolha = 'lista' | 'gps' | 'restauro'

export type EstadoCampo =
  | { fase: 'vazio' }
  | { fase: 'digitando'; texto: string }
  | { fase: 'buscando'; texto: string }
  | { fase: 'lista'; texto: string; opcoes: Endereco[]; ativo: number; aberta: boolean }
  | { fase: 'sem_resultado'; texto: string }
  | { fase: 'erro'; texto: string; mensagem: string }
  | { fase: 'escolhido'; escolha: Endereco; via: ViaEscolha }

export type AcaoCampo =
  | { tipo: 'digitar'; texto: string }
  | { tipo: 'buscar'; texto: string }
  | { tipo: 'resultado'; texto: string; opcoes: Endereco[] }
  | { tipo: 'falhou'; texto: string; mensagem: string }
  | { tipo: 'abrir'; ativo?: 'primeiro' | 'ultimo' }
  | { tipo: 'fechar' }
  | { tipo: 'mover'; passo: 1 | -1 }
  | { tipo: 'escolher'; escolha: Endereco; via: ViaEscolha }
  | { tipo: 'limpar' }

export const MINIMO_BUSCA = 3

export function estadoInicialCampo(escolha: Endereco | null): EstadoCampo {
  return escolha ? { fase: 'escolhido', escolha, via: 'restauro' } : { fase: 'vazio' }
}

export function reduzirCampo(estado: EstadoCampo, acao: AcaoCampo): EstadoCampo {
  switch (acao.tipo) {
    case 'digitar':
      return acao.texto.trim() === '' ? { fase: 'vazio' } : { fase: 'digitando', texto: acao.texto }
    case 'buscar':
      return { fase: 'buscando', texto: acao.texto }
    case 'resultado':
      // resposta de uma busca que a digitação já invalidou é ignorada
      if (estado.fase !== 'buscando' || estado.texto !== acao.texto) return estado
      return acao.opcoes.length === 0
        ? { fase: 'sem_resultado', texto: acao.texto }
        : { fase: 'lista', texto: acao.texto, opcoes: acao.opcoes, ativo: -1, aberta: true }
    case 'falhou':
      if (estado.fase !== 'buscando' || estado.texto !== acao.texto) return estado
      return { fase: 'erro', texto: acao.texto, mensagem: acao.mensagem }
    case 'abrir': {
      if (estado.fase !== 'lista') return estado
      if (!acao.ativo) return { ...estado, aberta: true }
      return { ...estado, aberta: true, ativo: acao.ativo === 'primeiro' ? 0 : estado.opcoes.length - 1 }
    }
    case 'fechar':
      return estado.fase === 'lista' ? { ...estado, aberta: false, ativo: -1 } : estado
    case 'mover': {
      if (estado.fase !== 'lista' || !estado.aberta) return estado
      const n = estado.opcoes.length
      const atual = estado.ativo < 0 && acao.passo === -1 ? 0 : estado.ativo
      return { ...estado, ativo: (atual + acao.passo + n) % n }
    }
    case 'escolher':
      return { fase: 'escolhido', escolha: acao.escolha, via: acao.via }
    case 'limpar':
      return { fase: 'vazio' }
  }
}

export function textoDoCampo(estado: EstadoCampo): string {
  if (estado.fase === 'vazio') return ''
  if (estado.fase === 'escolhido') return estado.escolha.rotulo
  return estado.texto
}

export function escolhaDoCampo(estado: EstadoCampo): Endereco | null {
  return estado.fase === 'escolhido' ? estado.escolha : null
}

export function textoForaDaArea(texto: string): string {
  return `Não encontramos "${texto.trim()}" na área piloto (Vila Mariana, Lapa e Ipiranga). Confira a grafia; fora dessa área o Rota Falada SP ainda não atende.`
}

/** A linha de retorno visível do campo, ligada por aria-describedby. */
export function textoRetorno(estado: EstadoCampo): string | null {
  switch (estado.fase) {
    case 'buscando':
      return 'Buscando…'
    case 'sem_resultado':
      return textoForaDaArea(estado.texto)
    case 'erro':
      return estado.mensagem
    case 'escolhido':
      return estado.escolha.aproximado
        ? 'Este é o número mais próximo que conhecemos, não o que você digitou. Confira.'
        : null
    default:
      return null
  }
}

/** O anúncio da lista: curto, e a instrução de teclas só na primeira vez de cada campo. */
export function textoDaLista(opcoes: Endereco[], rotulo: string, primeiraVez: boolean): string {
  if (opcoes.length === 1 && opcoes[0].aproximado) {
    return '1 endereço aproximado: o número digitado não existe; este é o mais próximo.'
  }
  const inicio =
    opcoes.length >= 8
      ? `Os ${opcoes.length} primeiros endereços`
      : opcoes.length === 1
        ? '1 endereço'
        : `${opcoes.length} endereços`
  return `${inicio} para ${rotulo}.${primeiraVez ? ' Seta para baixo para escolher.' : ''}`
}
```

`frontend/src/pages/rotaEstado.ts`:

```ts
import type { Endereco, RotaIn, RotaOut } from '../api/client'
import type { BuscaFeita, PerfilForm } from '../dados/sessaoRota'
import { formatarDistancia, textoDuracao } from '../dados/passo'

export type EstadoRota =
  | { fase: 'ocioso' }
  | { fase: 'calculando'; busca: BuscaFeita; lento: boolean }
  | { fase: 'resultado'; busca: BuscaFeita; rota: RotaOut; calculadaEm: string; restaurada: boolean }
  | { fase: 'sem_rota'; busca: BuscaFeita; detalhe: string }
  | { fase: 'indisponivel'; busca: BuscaFeita; mensagem: string }

export type AcaoRota =
  | { tipo: 'calcular'; busca: BuscaFeita }
  | { tipo: 'demorou' }
  | { tipo: 'chegou'; rota: RotaOut; calculadaEm: string }
  | { tipo: 'sem_rota'; detalhe: string }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'cancelar' }
  | { tipo: 'limpar' }

export const MSG_SEM_PASSOS = 'Não encontramos rota acessível entre esses pontos.'

export function reduzirRota(estado: EstadoRota, acao: AcaoRota): EstadoRota {
  switch (acao.tipo) {
    case 'calcular':
      return { fase: 'calculando', busca: acao.busca, lento: false }
    case 'demorou':
      return estado.fase === 'calculando' ? { ...estado, lento: true } : estado
    case 'chegou':
      if (estado.fase !== 'calculando') return estado
      // lista vazia não é rota: a interface nunca mostra um resultado sem passos
      return acao.rota.passos.length === 0
        ? { fase: 'sem_rota', busca: estado.busca, detalhe: MSG_SEM_PASSOS }
        : { fase: 'resultado', busca: estado.busca, rota: acao.rota, calculadaEm: acao.calculadaEm, restaurada: false }
    case 'sem_rota':
      return estado.fase === 'calculando' ? { fase: 'sem_rota', busca: estado.busca, detalhe: acao.detalhe } : estado
    case 'falhou':
      return estado.fase === 'calculando' ? { fase: 'indisponivel', busca: estado.busca, mensagem: acao.mensagem } : estado
    case 'cancelar':
    case 'limpar':
      return { fase: 'ocioso' }
  }
}

/** O contrato exige o perfil inteiro; `inclinacao_max` é número, não a string do rádio. */
export function montarPedido(origem: Endereco, destino: Endereco, perfil: PerfilForm): RotaIn {
  return {
    origem: { lat: origem.lat, lng: origem.lon },
    destino: { lat: destino.lat, lng: destino.lon },
    perfil: {
      inclinacao_max: perfil.inclinacao_max,
      guia_max_m: 0.06,
      largura_min_m: 0.9,
      evitar_degraus: perfil.evitar_degraus,
      velocidade_kmh: 3,
    },
  }
}

/** 5 casas, como a chave do cache de rotas: abaixo disso é o mesmo ponto. */
export function mesmoPonto(a: Endereco, b: Endereco): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lon.toFixed(5) === b.lon.toFixed(5)
}

export function resumoDaRota(rota: Pick<RotaOut, 'distancia_m' | 'duracao_s' | 'passos' | 'avisos'>): string {
  const n = rota.passos.length
  const avisos = rota.avisos.length
  const textoAvisos = avisos === 0 ? 'sem avisos' : avisos === 1 ? '1 aviso' : `${avisos} avisos`
  return `${formatarDistancia(rota.distancia_m)} em ${n} ${n === 1 ? 'passo' : 'passos'}, ${textoDuracao(rota.duracao_s)}, ${textoAvisos}`
}

/**
 * Fim do cálculo. Se o foco ainda está de onde o envio partiu, seja o botão ou o campo do
 * Enter (ou caiu no body porque "Cancelar" sumiu), vai para o h2, que traz o resumo: a 400% de
 * zoom e no celular com teclado o resultado está fora da vista. Se a pessoa saiu dali durante
 * a espera, o foco fica onde está e a região anuncia. Nunca os dois.
 */
export function focoVaiParaResultado(ativo: Element | null, focoNoEnvio: Element | null): boolean {
  return ativo === null || ativo === document.body || ativo === focoNoEnvio
}

const FORMATO_HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export function horaDe(iso: string): string {
  return FORMATO_HORA.format(new Date(iso))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/rotaEstado.test.ts`
Expected: PASS, 13 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 18 arquivos, 114 testes passando.

---

### Task 6: Autocomplete de endereço

**Files:**
- Create: `frontend/src/componentes/useBuscaEndereco.ts`, `frontend/src/componentes/CampoEndereco.tsx`, `frontend/src/estilos/rota.css`, `frontend/src/test/CampoEndereco.test.tsx`
- Modify: `frontend/src/componentes/pictogramas.ts`

**Interfaces:**
- Consumes: `buscarEnderecos`, `campoEstado.ts`, `useAnuncio`, `useEsperaServidor`.
- Produces: `DEBOUNCE_MS`, `useBuscaEndereco(rotulo, inicial?, aoEscolher?)` → `BuscaEndereco` `{ estado, texto, escolha, aoDigitar, aoTecla, escolher, limpar, aoComporInicio, aoComporFim }`; `CampoEndereco({ id, rotulo, busca, erro?, aoEditar?, dica?, children? })`; pictogramas `localizacao`, `alerta`, `mais`, `menos`, `enquadrar`, `origem`, `destino`, `foto`.

Marcação: `DESIGN.md`, Inputs. Campo em `vao`, junta forte, 48 px; rótulo em 600; dica em `--t-1` e `--tinta-2`. A lista fica em fluxo, opções de 48 px sobre `vao`, junta de 1 px, ativa com contorno em óxido e pictograma `siga` como segundo sinal. Erro: borda de 2 px em tinta e pictograma `alerta`, nunca óxido.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/CampoEndereco.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { CampoEndereco } from '../componentes/CampoEndereco'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { DEBOUNCE_MS, useBuscaEndereco } from '../componentes/useBuscaEndereco'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')

function Formulario({ aoEnviar = () => {} }: { aoEnviar?: () => void }) {
  const busca = useBuscaEndereco('Origem')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        aoEnviar()
      }}
    >
      <CampoEndereco id="origem" rotulo="Origem" busca={busca} />
      <p data-testid="escolha">{busca.escolha?.rotulo ?? 'nada'}</p>
    </form>
  )
}

function montar(aoEnviar?: () => void) {
  render(
    <RegiaoViva>
      <main>
        <Formulario aoEnviar={aoEnviar} />
      </main>
    </RegiaoViva>,
  )
  return screen.getByRole('combobox', { name: 'Origem' }) as HTMLInputElement
}

async function digitar(campo: HTMLInputElement, texto: string) {
  fireEvent.change(campo, { target: { value: texto } })
  await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1))
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CampoEndereco', () => {
  it('não busca com menos de 3 letras nem antes do debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'ru')
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    fireEvent.change(campo, { target: { value: 'rua' } })
    await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1))
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    await act(() => vi.advanceTimersByTimeAsync(2))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
    expect(new URL(api.de('GET /api/geocode')[0].url).searchParams.get('q')).toBe('rua')
  })

  it('cada tecla aborta a busca anterior', async () => {
    const sinais: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith('/health')) return Promise.resolve(Response.json({ banco: 'ok' }))
        sinais.push(init.signal!)
        return new Promise<Response>(() => {})
      }),
    )
    const campo = montar()
    await digitar(campo, 'rua')
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(sinais).toHaveLength(1)
    fireEvent.change(campo, { target: { value: 'rua a' } })
    expect(sinais[0].aborted).toBe(true)
  })

  it('composição (acentos) suspende o debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    fireEvent.compositionStart(campo)
    await digitar(campo, 'rua á')
    expect(api.de('GET /api/geocode')).toHaveLength(0)
    fireEvent.compositionEnd(campo, { target: { value: 'rua á' } })
    await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
  })

  it('segue a tabela de teclas: setas, Enter sem ativo não escolhe às cegas, Esc mantém o texto', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    expect(campo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(2)

    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-0')

    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-1')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(campo, { key: 'Escape' })
    expect(campo).toHaveAttribute('aria-expanded', 'false')
    expect(campo.value).toBe('rua')

    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    expect(campo).toHaveAttribute('aria-activedescendant', 'origem-op-0')
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(screen.getByTestId('escolha')).toHaveTextContent('Rua A, 1')
    expect(campo.value).toBe(A.rotulo)
  })

  it('Enter nunca envia o formulário sem escolha; escolhido sem edição envia', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const aoEnviar = vi.fn()
    const campo = montar(aoEnviar)
    fireEvent.change(campo, { target: { value: 'ru' } })
    // fireEvent não dispara o submit implícito; o preventDefault é o que o impede
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('Digite ao menos 3 letras.')
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(true)
  })

  it('Enter busca na hora, sem esperar o debounce', async () => {
    const api = apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(api.de('GET /api/geocode')).toHaveLength(1)
  })

  it('Tab fecha sem escolher', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'rua')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Tab' })
    expect(campo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
  })

  it('anuncia a contagem pela região única e diz "fora da área" na lista vazia', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('2 endereços para Origem. Seta para baixo para escolher.')
    apiFalsa({ 'GET /api/geocode': Response.json([]) })
    await digitar(campo, 'rua inexistente')
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.getByRole('status')).toHaveTextContent('na área piloto')
    expect(document.getElementById('origem-retorno')).toHaveTextContent('fora dessa área')
    expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
  })

  it('opção aproximada diz isso e nunca é escolhida sozinha', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([{ ...A, aproximado: true }]) })
    const campo = montar()
    await digitar(campo, 'rua a 99')
    expect(screen.getByRole('option')).toHaveTextContent('número aproximado')
    expect(screen.getByTestId('escolha')).toHaveTextContent('nada')
  })

  it('503 mostra a mensagem do servidor e permite tentar com Enter', async () => {
    const api = apiFalsa({ 'GET /api/geocode': erroApi(503, 'Busca de endereços indisponível no momento.') })
    const campo = montar()
    await digitar(campo, 'rua')
    expect(document.getElementById('origem-retorno')).toHaveTextContent('Busca de endereços indisponível')
    fireEvent.keyDown(campo, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(api.de('GET /api/geocode')).toHaveLength(2)
  })

  it('clique escolhe e não tira o foco do campo', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const campo = montar()
    await digitar(campo, 'rua')
    const opcao = screen.getByRole('option')
    expect(fireEvent.mouseDown(opcao)).toBe(false)
    fireEvent.click(opcao)
    expect(screen.getByTestId('escolha')).toHaveTextContent('Rua A')
  })

  it('passa no axe com a lista aberta', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const campo = montar()
    await digitar(campo, 'rua')
    vi.useRealTimers()
    expect(await axe(document.body)).toHaveNoViolations()
    expect(campo).toHaveAttribute('aria-expanded', 'true')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/CampoEndereco.test.tsx`
Expected: FAIL (`Failed to resolve import "../componentes/CampoEndereco"`).

- [ ] **Step 3: Implementar**

Em `frontend/src/componentes/pictogramas.ts`, acrescente antes do comentário `// duas torres e a passarela entre elas`:

```ts
  // mira: o ponto onde o GPS colocou a pessoa
  localizacao: ['M12 2V7', 'M12 17V22', 'M2 12H7', 'M17 12H22', 'M8 8H16V16H8Z'],
  alerta: ['M12 3L22 21H2Z', 'M12 10V15', 'M12 17V19'],
  mais: ['M5 12H19', 'M12 5V19'],
  menos: ['M5 12H19'],
  enquadrar: ['M3 9V3H9', 'M15 3H21V9', 'M21 15V21H15', 'M9 21H3V15'],
  origem: ['M5 5H19V19H5Z', 'M10 10H14V14H10Z'],
  destino: ['M6 3V21', 'M6 4H19L15 9L19 14H6'],
  foto: ['M3 7H21V20H3Z', 'M8 7V4H16V7', 'M9 11H15V16H9Z'],
```

`frontend/src/componentes/useBuscaEndereco.ts`:

```ts
import { useCallback, useEffect, useReducer, useRef, type KeyboardEvent } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { buscarEnderecos, type Endereco } from '../api/client'
import {
  escolhaDoCampo,
  estadoInicialCampo,
  MINIMO_BUSCA,
  reduzirCampo,
  textoDaLista,
  textoDoCampo,
  textoForaDaArea,
  type ViaEscolha,
} from './campoEstado'
import { useAnuncio, useCancelarAnuncio } from './useAnuncio'

/** spec-mãe: 800 ms. Com 300 ms, o eco do NVDA atrapalha quem digita pausado. */
export const DEBOUNCE_MS = 800

/** A contagem espera na fila da região viva; escolher, digitar ou sair a torna falsa. */
const CHAVE_CONTAGEM = 'contagem'

/**
 * Quem passa `aoEscolher` responde pelo anúncio da escolha: em EscolhaLocal o campo sai da
 * tela e o foco é que lê o local. A via `gps` também: o botão sabe o que dizer.
 */

export function useBuscaEndereco(rotulo: string, inicial: Endereco | null = null, aoEscolher?: (escolha: Endereco) => void) {
  const [estado, despachar] = useReducer(reduzirCampo, inicial, estadoInicialCampo)
  const anunciar = useAnuncio()
  const cancelarAnuncio = useCancelarAnuncio()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const controle = useRef<AbortController | null>(null)
  const compondo = useRef(false)
  const jaInstruiu = useRef(false)
  const aoEscolherRef = useRef(aoEscolher)
  useEffect(() => {
    aoEscolherRef.current = aoEscolher
  })

  const interromper = useCallback(() => {
    clearTimeout(timer.current)
    controle.current?.abort()
    controle.current = null
    cancelarAnuncio(CHAVE_CONTAGEM)
  }, [cancelarAnuncio])

  useEffect(() => interromper, [interromper])

  const buscarAgora = useCallback(
    (texto: string) => {
      interromper()
      const pedido = new AbortController()
      controle.current = pedido
      despachar({ tipo: 'buscar', texto })
      buscarEnderecos(texto.trim(), pedido.signal)
        .then((opcoes) => {
          despachar({ tipo: 'resultado', texto, opcoes })
          if (opcoes.length === 0) {
            anunciar(textoForaDaArea(texto))
            return
          }
          anunciar(textoDaLista(opcoes, rotulo, !jaInstruiu.current), { chave: CHAVE_CONTAGEM, intervaloMs: 3000 })
          jaInstruiu.current = true
        })
        .catch((erro: unknown) => {
          if (ehCancelamento(erro)) return
          const mensagem = erro instanceof ErroApi ? erro.message : MSG_INESPERADO
          despachar({ tipo: 'falhou', texto, mensagem })
          anunciar(mensagem)
        })
    },
    [anunciar, interromper, rotulo],
  )

  const aoDigitar = useCallback(
    (texto: string) => {
      interromper()
      despachar({ tipo: 'digitar', texto })
      if (compondo.current || texto.trim().length < MINIMO_BUSCA) return
      timer.current = setTimeout(() => buscarAgora(texto), DEBOUNCE_MS)
    },
    [buscarAgora, interromper],
  )

  const escolher = useCallback(
    (escolha: Endereco, via: ViaEscolha = 'lista') => {
      interromper()
      despachar({ tipo: 'escolher', escolha, via })
      if (via !== 'gps' && !aoEscolherRef.current) anunciar(`${rotulo}: ${escolha.rotulo}.`)
      aoEscolherRef.current?.(escolha)
    },
    [anunciar, interromper, rotulo],
  )

  const limpar = useCallback(() => {
    interromper()
    despachar({ tipo: 'limpar' })
  }, [interromper])

  /** A tabela de teclas do spec, seção 7.2. */
  function aoTecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (estado.fase !== 'lista') return
      e.preventDefault()
      if (e.altKey) {
        despachar(e.key === 'ArrowDown' ? { tipo: 'abrir' } : { tipo: 'fechar' })
      } else if (!estado.aberta) {
        despachar({ tipo: 'abrir', ativo: e.key === 'ArrowDown' ? 'primeiro' : 'ultimo' })
      } else {
        despachar({ tipo: 'mover', passo: e.key === 'ArrowDown' ? 1 : -1 })
      }
    } else if (e.key === 'Escape') {
      if (estado.fase === 'lista' && estado.aberta) {
        e.preventDefault()
        despachar({ tipo: 'fechar' })
      }
    } else if (e.key === 'Enter') {
      if (estado.fase === 'escolhido') return // envia o formulário
      e.preventDefault()
      if (estado.fase === 'lista' && estado.aberta) {
        if (estado.ativo >= 0) escolher(estado.opcoes[estado.ativo])
        else despachar({ tipo: 'mover', passo: 1 })
        return
      }
      const texto = textoDoCampo(estado)
      if (texto.trim().length >= MINIMO_BUSCA) buscarAgora(texto)
      else anunciar(`Digite ao menos ${MINIMO_BUSCA} letras.`)
    } else if (e.key === 'Tab') {
      despachar({ tipo: 'fechar' })
    }
  }

  return {
    estado,
    texto: textoDoCampo(estado),
    escolha: escolhaDoCampo(estado),
    aoDigitar,
    aoTecla,
    escolher,
    limpar,
    aoComporInicio: () => {
      compondo.current = true
    },
    aoComporFim: (texto: string) => {
      compondo.current = false
      aoDigitar(texto)
    },
  }
}

export type BuscaEndereco = ReturnType<typeof useBuscaEndereco>
```

`frontend/src/componentes/CampoEndereco.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import '../estilos/rota.css'
import { textoRetorno } from './campoEstado'
import { Pictograma } from './Pictograma'
import type { BuscaEndereco } from './useBuscaEndereco'
import { useEsperaServidor } from './useEsperaServidor'

type Props = {
  id: string
  rotulo: string
  busca: BuscaEndereco
  /** Erro do formulário ("Escolha um endereço da lista."); tem precedência sobre o retorno. */
  erro?: string | null
  /** Digitar invalida o erro: quem guarda o erro limpa aqui, para o retorno voltar a aparecer. */
  aoEditar?: () => void
  dica?: string
  /** Fica depois da lista: o botão de localização, na origem. */
  children?: ReactNode
}

const DICA_PADRAO = 'Digite ao menos 3 letras da rua ou do lugar e escolha na lista.'

/**
 * Combobox editável ARIA 1.2 com lista e seleção manual. A lista fica em fluxo, nunca
 * flutuante: resolve 320 px, zoom de 400% e foco coberto (WCAG 2.4.11) de uma vez.
 */
export function CampoEndereco({ id, rotulo, busca, erro, aoEditar, dica = DICA_PADRAO, children }: Props) {
  const { estado } = busca
  const aberta = estado.fase === 'lista' && estado.aberta
  const ativo = estado.fase === 'lista' ? estado.ativo : -1
  const espera = useEsperaServidor(estado.fase === 'buscando')
  const lista = useRef<HTMLDivElement>(null)
  const retorno = erro ?? espera ?? textoRetorno(estado)

  useEffect(() => {
    if (ativo >= 0) lista.current?.children[ativo]?.scrollIntoView?.({ block: 'nearest' })
  }, [ativo])

  return (
    <div className="campo campo-endereco">
      <label htmlFor={id}>{rotulo}</label>
      <p id={`${id}-dica`} className="campo__dica">
        {dica}
      </p>
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        maxLength={100}
        aria-autocomplete="list"
        aria-expanded={aberta}
        aria-controls={`${id}-lista`}
        aria-activedescendant={ativo >= 0 ? `${id}-op-${ativo}` : undefined}
        aria-invalid={erro ? true : undefined}
        aria-describedby={`${id}-dica ${id}-retorno`}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint={estado.fase === 'escolhido' ? 'go' : 'search'}
        value={busca.texto}
        onChange={(e) => {
          aoEditar?.()
          busca.aoDigitar(e.target.value)
        }}
        onKeyDown={busca.aoTecla}
        onCompositionStart={busca.aoComporInicio}
        onCompositionEnd={(e) => busca.aoComporFim(e.currentTarget.value)}
      />
      <p id={`${id}-retorno`} className={erro ? 'campo__retorno campo__retorno--erro' : 'campo__retorno'}>
        {erro && <Pictograma nome="alerta" />}
        <span>{retorno}</span>
      </p>
      <div ref={lista} id={`${id}-lista`} role="listbox" aria-label={`Sugestões para ${rotulo.toLowerCase()}`} hidden={!aberta} className="sugestoes">
        {estado.fase === 'lista' &&
          estado.opcoes.map((op, i) => (
            // o teclado fica no campo (aria-activedescendant); o clique mantém o foco nele
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
              key={op.id}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === ativo}
              className="sugestao"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => busca.escolher(op)}
            >
              <span>{op.rotulo}</span>
              {op.aproximado && <span className="sugestao__nota">número aproximado: o mais próximo do que você digitou</span>}
              {i === ativo && <Pictograma nome="siga" tamanho={20} className="sugestao__marca" />}
            </div>
          ))}
      </div>
      {children}
    </div>
  )
}
```

`frontend/src/estilos/rota.css`:

```css
/* /rota: autocomplete, resultado e mapa. Tokens do DESIGN.md; nada de tamanho ou peso novo. */

.campo-endereco {
  min-width: 0;
}

.campo__retorno {
  display: flex;
  gap: var(--e-1);
  align-items: flex-start;
  margin: 0.25rem 0 0;
  font-size: var(--t-1);
  color: var(--tinta-2);
}

.campo__retorno p {
  margin: 0 0 var(--e-1);
}

.campo__retorno:empty,
.campo__retorno > span:empty {
  display: none;
}

/* erro: borda de 2 px em tinta e pictograma; óxido não marca erro (DESIGN.md, Óxido de Estado) */
.campo__retorno--erro {
  color: var(--tinta);
  font-weight: 600;
}

.campo [aria-invalid='true'] {
  border: 2px solid var(--tinta);
}

/* a lista em fluxo: empurra o conteúdo, nunca flutua */
.sugestoes {
  list-style: none;
  margin: var(--e-1) 0 0;
  padding: 0;
  max-height: 24rem;
  overflow-y: auto;
  border: 1px solid var(--junta);
}

.sugestoes[hidden] {
  display: none;
}

.sugestao {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--e-1);
  min-height: 48px;
  padding: 0.5rem 0.75rem;
  background: var(--vao);
  cursor: pointer;
}

.sugestao + .sugestao {
  border-top: 1px solid var(--junta);
}

.sugestao:hover {
  outline: 1px solid var(--tinta);
  outline-offset: -1px;
}

/* ativa: borda óxido (estado ativo) e pictograma como segundo sinal */
.sugestao[aria-selected='true'] {
  outline: 2px solid var(--oxido);
  outline-offset: -2px;
  font-weight: 600;
}

.sugestao__nota {
  flex-basis: 100%;
  font-size: var(--t-1);
  color: var(--tinta-2);
}

.sugestao__marca {
  margin-left: auto;
}

.localizacao {
  display: grid;
  gap: 0.25rem;
  justify-items: start;
  margin-top: var(--e-2);
}

.estado-calculo,
.formulario__limpar {
  display: grid;
  gap: var(--e-1);
  justify-items: start;
  margin-top: var(--e-2);
}

.estado-calculo p {
  margin: 0;
}

.rota__aviso {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--e-2);
  background: var(--vao);
  font-weight: 600;
}

/* resultado: largura total depois do formulário, ordem do DOM = ordem visual */
.resultado {
  grid-column: 1 / -1;
  display: grid;
  gap: var(--e-4);
  min-width: 0;
}

.resultado__titulo {
  display: grid;
  gap: var(--e-1);
  margin: 0;
  font-size: var(--t-3);
  font-weight: 800;
}

.resultado__titulo .medida {
  font-size: var(--t-2);
  font-weight: 600;
}

h2.resultado__titulo.letreiro {
  font-size: var(--t-3);
}

.resultado--falha {
  gap: var(--e-2);
  padding: clamp(1.5rem, 3vw, 2.5rem);
  background: var(--placa);
  border: 1px solid var(--junta);
  justify-items: start;
}

.resultado--falha p {
  margin: 0;
  max-width: 68ch;
}

.resultado__topo {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--e-4);
  align-items: start;
}

.resultado__topo > .ficha {
  max-width: 48rem;
}

.ficha.ficha--solta {
  position: static;
}

.mapa-rota,
.mapa-rota__corpo {
  display: grid;
  gap: var(--e-2);
  min-width: 0;
  justify-items: stretch;
}

.mapa-rota > .placa {
  justify-self: start;
}

.mapa-rota__titulo {
  margin: 0;
  font-size: var(--t-2);
}

.mapa-rota__controles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e-1);
}

.mapa-rota__legenda {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mapa-rota__volta {
  margin: 0;
}

.placa-passo__acoes {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--e-1) var(--e-3);
  margin-top: 0.75rem;
}

.barreiras-passo {
  grid-column: 2;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--t-1);
  font-weight: 600;
}

.barreiras-passo li + li {
  margin-top: var(--e-1);
}

/* ação isolada, não link de frase: 44 px, em bloco próprio */
.barreiras-passo__link {
  display: flex;
  width: fit-content;
  padding-left: 0;
}

/* o passo que o mapa está mostrando: mesmo sinal da placa pressionada */
.placa[aria-current='true'] {
  background: var(--vao);
  border-color: var(--tinta);
}

@media (min-width: 1024px) {
  .resultado__topo--mapa {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  }
}

@media (min-width: 1200px) {
  .placa-passo__acoes,
  .barreiras-passo {
    grid-column: 2 / -1;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/CampoEndereco.test.tsx`
Expected: PASS, 12 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 19 arquivos, 126 testes passando.

---

### Task 7: "Usar minha localização"

**Files:**
- Create: `frontend/src/dados/localizacao.ts`, `frontend/src/componentes/BotaoMinhaLocalizacao.tsx`, `frontend/src/test/Localizacao.test.tsx`

**Interfaces:**
- Consumes: `enderecoDoPonto`, `Placa`, `useAnuncio`, `useEsperaServidor`.
- Produces: `Posicao`, `PRECISAO_ACEITAVEL_M`, `FORA_DA_AREA`, `ErroLocalizacao`, `temGeolocalizacao()`, `obterPosicao()`, `arredondar4()`; `BotaoMinhaLocalizacao({ aoEscolher, idCampo, valorCampo })`: se o texto do campo mudar durante a espera, o GPS é descartado.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/Localizacao.test.tsx`:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Endereco } from '../api/client'
import { BotaoMinhaLocalizacao } from '../componentes/BotaoMinhaLocalizacao'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { arredondar4, FORA_DA_AREA } from '../dados/localizacao'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const A = endereco(1, 'Rua A, 1 · Vila Mariana')

function comGps(implementacao: (ok: PositionCallback, erro: PositionErrorCallback, op?: PositionOptions) => void) {
  const getCurrentPosition = vi.fn(implementacao)
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return getCurrentPosition
}

function posicao(accuracy = 20) {
  return (ok: PositionCallback) => ok({ coords: { latitude: -23.590123456, longitude: -46.635987654, accuracy } } as GeolocationPosition)
}

function Tela({ aoEscolher }: { aoEscolher: (e: Endereco) => void }) {
  const [valor, setValor] = useState('')
  return (
    <RegiaoViva>
      <input aria-label="Origem" id="campo" value={valor} onChange={(e) => setValor(e.target.value)} />
      <BotaoMinhaLocalizacao idCampo="campo" valorCampo={valor} aoEscolher={aoEscolher} />
    </RegiaoViva>
  )
}

function montar() {
  const aoEscolher = vi.fn()
  render(<Tela aoEscolher={aoEscolher} />)
  return aoEscolher
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('Usar minha localização', () => {
  it('sem suporte, vira uma frase', () => {
    montar()
    expect(screen.getByText(/não informa a localização. Digite o endereço/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('só pede permissão no clique, arredonda a 4 casas e usa o endereço devolvido', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    const gps = comGps(posicao())
    const aoEscolher = montar()
    expect(gps).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(aoEscolher).toHaveBeenCalledWith(A))
    expect(gps.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
    const url = new URL(api.de('GET /api/geocode/reverso')[0].url)
    expect(url.searchParams.get('lat')).toBe('-23.5901')
    expect(url.searchParams.get('lon')).toBe('-46.636')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Confira se é onde você está.'))
    expect(arredondar4(-23.590123456)).toBe(-23.5901)
  })

  it('impreciso não preenche sozinho', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps(posicao(350))
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/a margem é de cerca de 350 m/)).toBeInTheDocument()
    expect(aoEscolher).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Usar este endereço' }))
    expect(aoEscolher).toHaveBeenCalledWith(A)
    // o botão sumiu: o foco vai ao campo preenchido, não ao body
    expect(screen.getByRole('textbox', { name: 'Origem' })).toHaveFocus()
  })

  it('acionar diz que está buscando, porque o GPS leva até 15 s', async () => {
    comGps(() => {})
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Buscando sua localização.'))
  })

  it('aria-disabled bloqueia de verdade: a segunda pressão não dispara outra busca', async () => {
    const gps = comGps(() => {})
    montar()
    const botao = screen.getByRole('button', { name: 'Usar minha localização' })
    await userEvent.click(botao)
    await userEvent.click(botao)
    expect(gps).toHaveBeenCalledTimes(1)
  })

  it('GPS que responde depois de a pessoa digitar é descartado: nada se perde', async () => {
    let responder: PositionCallback = () => {}
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps((ok) => {
      responder = ok
    })
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Origem' }), 'rua')
    expect(screen.queryByText('Buscando sua localização…')).toBeNull()
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await new Promise((r) => setTimeout(r, 20))
    expect(aoEscolher).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Origem' })).toHaveValue('rua')
  })

  it('reverso pendente ao digitar é cancelado', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': () => new Promise<Response>(() => {}) })
    comGps(posicao())
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(api.de('GET /api/geocode/reverso')).toHaveLength(1))
    await userEvent.type(screen.getByRole('textbox', { name: 'Origem' }), 'r')
    expect(api.de('GET /api/geocode/reverso')[0].init.signal?.aborted).toBe(true)
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it.each([
    [1, /não autorizou a localização. Digite o endereço; a rota funciona igual/],
    [2, /Não conseguimos sua localização agora/],
    [3, /Não conseguimos sua localização agora/],
  ])('erro %i do GPS orienta a digitar', async (codigo, texto) => {
    comGps((_ok, erro) => erro({ code: codigo } as GeolocationPositionError))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(texto)).toBeInTheDocument()
  })

  it('404 do reverso usa o detail do backend, fora da área inclusive', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, FORA_DA_AREA) })
    comGps(posicao())
    const aoEscolher = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(`${FORA_DA_AREA} Digite o endereço.`)).toBeInTheDocument()
    expect(aoEscolher).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Localizacao.test.tsx`
Expected: FAIL (`Failed to resolve import "../componentes/BotaoMinhaLocalizacao"`).

- [ ] **Step 3: Implementar**

`frontend/src/dados/localizacao.ts`:

```ts
export type Posicao = { lat: number; lon: number; precisaoM: number }

/** Duas vezes o raio do reverso (50 m). Escolha de projeto; ajustar depois do teste em campo. */
export const PRECISAO_ACEITAVEL_M = 100

export const FORA_DA_AREA = 'Este ponto está fora da área atendida pelo Rota Falada SP.'

export class ErroLocalizacao extends Error {
  readonly codigo: number

  constructor(codigo: number) {
    super(codigo === 1 ? 'O navegador não autorizou a localização.' : 'Não conseguimos sua localização agora.')
    this.name = 'ErroLocalizacao'
    this.codigo = codigo
  }
}

export function temGeolocalizacao(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && !!navigator.geolocation
}

/** Só chamar a partir de um clique: é aqui que o navegador pede permissão. */
export function obterPosicao(): Promise<Posicao> {
  return new Promise((resolver, rejeitar) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lon: p.coords.longitude, precisaoM: p.coords.accuracy }),
      (e) => rejeitar(new ErroLocalizacao(e.code)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  })
}

/** 4 casas (cerca de 11 m): as coordenadas viram URL e cache, e o raio de busca é 50 m. */
export function arredondar4(valor: number): number {
  return Math.round(valor * 10_000) / 10_000
}
```

`frontend/src/componentes/BotaoMinhaLocalizacao.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ErroApi, ehCancelamento, MSG_INESPERADO } from '../api/base'
import { enderecoDoPonto, type Endereco } from '../api/client'
import { arredondar4, ErroLocalizacao, obterPosicao, PRECISAO_ACEITAVEL_M, temGeolocalizacao } from '../dados/localizacao'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'
import { useEsperaServidor } from './useEsperaServidor'

type Props = {
  /** Recebe o endereço devolvido pelo reverso: a rota parte do endereço anunciado, não do GPS bruto. */
  aoEscolher: (endereco: Endereco) => void
  /** O campo que este botão preenche: recebe o foco quando "Usar este endereço" some. */
  idCampo: string
  /** O texto do campo agora. A espera diz que nada se perde: se ele mudar, o GPS é descartado. */
  valorCampo: string
}

type Estado =
  | { fase: 'ocioso' }
  | { fase: 'buscando' }
  | { fase: 'impreciso'; endereco: Endereco; precisaoM: number }
  | { fase: 'mensagem'; texto: string }

const NEGADO = 'O navegador não autorizou a localização. Digite o endereço; a rota funciona igual.'
const SEM_POSICAO = 'Não conseguimos sua localização agora. Digite o endereço.'

export function BotaoMinhaLocalizacao({ aoEscolher, idCampo, valorCampo }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: 'ocioso' })
  const anunciar = useAnuncio()
  const espera = useEsperaServidor(estado.fase === 'buscando')
  const dica = useId()
  const pedido = useRef<{ controle: AbortController; valor: string } | null>(null)

  useEffect(() => () => pedido.current?.controle.abort(), [])

  useEffect(() => {
    if (pedido.current && pedido.current.valor !== valorCampo) {
      pedido.current.controle.abort()
      pedido.current = null
      setEstado({ fase: 'ocioso' })
    }
  }, [valorCampo])

  if (!temGeolocalizacao()) {
    return <p className="campo__dica">Este navegador não informa a localização. Digite o endereço.</p>
  }

  function avisar(texto: string) {
    setEstado({ fase: 'mensagem', texto })
    anunciar(texto)
  }

  async function localizar() {
    if (estado.fase === 'buscando') return
    const controle = new AbortController()
    pedido.current = { controle, valor: valorCampo }
    setEstado({ fase: 'buscando' })
    anunciar('Buscando sua localização.')
    try {
      const posicao = await obterPosicao()
      if (controle.signal.aborted) return
      const endereco = await enderecoDoPonto(arredondar4(posicao.lat), arredondar4(posicao.lon), controle.signal)
      if (controle.signal.aborted) return
      pedido.current = null
      if (posicao.precisaoM > PRECISAO_ACEITAVEL_M) {
        setEstado({ fase: 'impreciso', endereco, precisaoM: Math.round(posicao.precisaoM) })
        anunciar(`Achamos ${endereco.rotulo}, mas a margem é de cerca de ${Math.round(posicao.precisaoM)} metros.`)
        return
      }
      setEstado({ fase: 'ocioso' })
      aoEscolher(endereco)
      anunciar(`Origem: ${endereco.rotulo}. Confira se é onde você está.`)
    } catch (erro) {
      if (controle.signal.aborted || ehCancelamento(erro)) return
      pedido.current = null
      if (erro instanceof ErroLocalizacao) avisar(erro.codigo === 1 ? NEGADO : SEM_POSICAO)
      else if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado') avisar(`${erro.message} Digite o endereço.`)
      else avisar(erro instanceof ErroApi ? erro.message : MSG_INESPERADO)
    }
  }

  return (
    <div className="localizacao">
      <Placa pictograma="localizacao" onClick={localizar} aria-describedby={dica} aria-disabled={estado.fase === 'buscando' || undefined}>
        Usar minha localização
      </Placa>
      <p id={dica} className="campo__dica">
        Usa o GPS do aparelho uma vez, só quando você aciona.
      </p>
      {estado.fase === 'buscando' && <p className="campo__retorno">{espera ?? 'Buscando sua localização…'}</p>}
      {estado.fase === 'mensagem' && <p className="campo__retorno">{estado.texto}</p>}
      {estado.fase === 'impreciso' && (
        <div className="campo__retorno">
          <p>
            Achamos {estado.endereco.rotulo}, mas a margem é de cerca de {estado.precisaoM} m. Se não for aí, digite o
            endereço.
          </p>
          <Placa
            onClick={() => {
              // o botão some: o foco vai ao campo, que lê o endereço escolhido
              flushSync(() => {
                aoEscolher(estado.endereco)
                setEstado({ fase: 'ocioso' })
              })
              document.getElementById(idCampo)?.focus()
            }}
          >
            Usar este endereço
          </Placa>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Localizacao.test.tsx`
Expected: PASS, 11 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 20 arquivos, 137 testes passando.

---

### Task 8: Mapa redundante

**Files:**
- Create: `frontend/src/componentes/mapa/opcoesMapa.ts`, `frontend/src/componentes/mapa/MapaLeaflet.tsx`, `frontend/src/componentes/mapa/MapaRota.tsx`, `frontend/src/componentes/mapa/mapa.css`, `frontend/src/test/Mapa.test.tsx`
- Modify: `frontend/package.json`, `frontend/src/vite-env.d.ts`, `frontend/src/index.css`

**Interfaces:**
- Consumes: `linhaDoGeoJson`, `DESENHOS`, `Passarela`, `Placa`, `useAnuncio`, `RotaOut`.
- Produces: `URL_TILES`, `MAX_ZOOM`, `LIMITE_FALHAS_TILE`, `TEMPO_TILES_MS`, `opcoesMapa(ponteiroFino)`, `ponteiroEhFino()`, `vigiarTiles(tiles, aoFalhar)`; `ControleMapa`, `MapaLeaflet` (export default); `MapaRota({ rota, origem, destino, aberto, aoAlternar, passoSelecionado, rodadaPasso, passoEmLeitura })`, que só chama `aoAlternar(true)` com o mapa aberto de verdade.

Em jsdom o Leaflet fica com contêiner de tamanho zero, então `MapaLeaflet` é simulado aqui e testado de verdade no E2E da Task 10 (cenário E7).

- [ ] **Step 1: Instalar**

Run (em `frontend/`): `npm i --save-exact leaflet@1.9.4 ; npm i -D --save-exact @types/leaflet@1.9.21`
Expected: `package.json` e `package-lock.json` atualizados.

- [ ] **Step 2: Escrever o teste**

`frontend/src/test/Mapa.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MapaRota } from '../componentes/mapa/MapaRota'
import { opcoesMapa } from '../componentes/mapa/opcoesMapa'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { ROTA } from './fixturasRota'

const chunk = vi.hoisted(() => ({ falhar: true }))

vi.mock('../componentes/mapa/MapaLeaflet', () => {
  if (chunk.falhar) {
    chunk.falhar = false
    throw new Error('chunk')
  }
  return { default: ({ descricao }: { descricao: string }) => <div role="img" aria-label={descricao} /> }
})

function Tela() {
  const [aberto, setAberto] = useState(false)
  return (
    <RegiaoViva>
      <MapaRota rota={ROTA} origem="Rua A" destino="Rua B" aberto={aberto} aoAlternar={setAberto} passoSelecionado={null} rodadaPasso={0} passoEmLeitura={null} />
    </RegiaoViva>
  )
}

describe('opcoesMapa', () => {
  it('nada focável, nenhum movimento e arrastar só com ponteiro fino', () => {
    expect(opcoesMapa(false)).toMatchObject({
      keyboard: false,
      attributionControl: false,
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      scrollWheelZoom: false,
      touchZoom: false,
      dragging: false,
    })
    expect(opcoesMapa(true).dragging).toBe(true)
  })
})

describe('MapaRota', () => {
  // o primeiro import do arquivo falha: vi.hoisted acima
  it('chunk que falha: o mapa não fica "aberto", e tentar de novo leva o foco ao botão do mapa', async () => {
    const aoAlternar = vi.fn()
    render(
      <RegiaoViva>
        <MapaRota rota={ROTA} origem="Rua A" destino="Rua B" aberto={false} aoAlternar={aoAlternar} passoSelecionado={null} rodadaPasso={0} passoEmLeitura={null} />
      </RegiaoViva>,
    )
    const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
    await userEvent.click(botao)
    expect(await screen.findByText(/Não foi possível abrir o mapa/)).toBeInTheDocument()
    expect(aoAlternar).not.toHaveBeenCalledWith(true)
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(botao).toHaveFocus()
    await waitFor(() => expect(aoAlternar).toHaveBeenCalledWith(true))
  })

  it('anuncia a abertura enquanto o chunk não chega', async () => {
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar mapa' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Abrindo o mapa\.|Mapa aberto\./))
  })

  it('nada carrega antes do clique; ao abrir, anuncia e fica role=img com a atribuição fora dele', async () => {
    render(<Tela />)
    expect(screen.queryByRole('img')).toBeNull()
    const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(botao)
    const mapa = await screen.findByRole('img', { name: /Mapa ilustrativo da rota de Rua A até Rua B, 200,0 m em 2 passos/ })
    expect(botao).toHaveAttribute('aria-pressed', 'true')
    const link = screen.getByRole('link', { name: 'OpenStreetMap' })
    expect(mapa).not.toContainElement(link)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa aberto.'))
    expect(screen.getByRole('link', { name: 'Ir para a lista de passos' })).toHaveAttribute('href', '#lista-passos')
    await userEvent.click(botao)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest --run src/test/Mapa.test.tsx`
Expected: FAIL (`Failed to resolve import "../componentes/mapa/MapaRota"`).

- [ ] **Step 4: Implementar**

`frontend/src/componentes/mapa/opcoesMapa.ts`:

```ts
import type { MapOptions, TileLayer } from 'leaflet'

export const URL_TILES = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const MAX_ZOOM = 19
export const LIMITE_FALHAS_TILE = 3
export const TEMPO_TILES_MS = 8_000

/**
 * Nada focável dentro do role="img" (axe: nested-interactive) e nenhum movimento: sem
 * animação em nenhuma preferência, sem roda do mouse e, no toque, sem arrastar nem pinçar,
 * para a página rolar e a pinça ampliar a página. Arrastar nunca é a única via (2.5.7).
 */
export function opcoesMapa(ponteiroFino: boolean): MapOptions {
  return {
    keyboard: false,
    attributionControl: false,
    zoomControl: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    scrollWheelZoom: false,
    boxZoom: false,
    touchZoom: false,
    doubleClickZoom: false,
    dragging: ponteiroFino,
    maxZoom: MAX_ZOOM,
  }
}

/**
 * Avisa uma vez se o fundo não carrega: várias falhas ou nenhum `load` no prazo. Devolve a
 * limpeza. Fica aqui para os dois mapas tratarem a falha do mesmo jeito.
 */
export function vigiarTiles(tiles: TileLayer, aoFalhar: () => void): () => void {
  let falhas = 0
  let avisou = false
  const avisar = () => {
    if (!avisou) aoFalhar()
    avisou = true
  }
  const semCarga = setTimeout(avisar, TEMPO_TILES_MS)
  tiles.on('tileerror', () => {
    falhas += 1
    if (falhas >= LIMITE_FALHAS_TILE) avisar()
  })
  tiles.on('load', () => clearTimeout(semCarga))
  return () => clearTimeout(semCarga)
}

export function ponteiroEhFino(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches
}
```

`frontend/src/componentes/mapa/MapaLeaflet.tsx`:

```tsx
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { RotaOut } from '../../api/client'
import { linhaDoGeoJson, type PontoLatLng } from '../../dados/rotaGeo'
import { DESENHOS, type NomePictograma } from '../pictogramas'
import './mapa.css'
import { MAX_ZOOM, opcoesMapa, ponteiroEhFino, URL_TILES, vigiarTiles } from './opcoesMapa'

export type ControleMapa = {
  aproximar: () => void
  afastar: () => void
  rotaInteira: () => void
  recarregarTiles: () => void
}

type Props = {
  ref?: Ref<ControleMapa>
  rota: RotaOut
  descricao: string
  /** Passo enquadrado e destacado. */
  passoSelecionado: number | null
  /** Sobe a cada "Ver o passo N", para enquadrar de novo depois de a pessoa mover o mapa. */
  rodadaPasso: number
  /** Passo em leitura em voz alta: só troca o destaque, nunca move o mapa. */
  passoEmLeitura: number | null
  aoFalharTiles: () => void
  aoMudarZoom: (noMinimo: boolean, noMaximo: boolean) => void
}

function iconeDe(nome: NomePictograma): L.DivIcon {
  const tracos = DESENHOS[nome].map((d) => `<path d="${d}"/>`).join('')
  return L.divIcon({
    className: 'mapa__marcador',
    html: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${tracos}</svg>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

export default function MapaLeaflet({ ref, rota, descricao, passoSelecionado, rodadaPasso, passoEmLeitura, aoFalharTiles, aoMudarZoom }: Props) {
  const contêiner = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  const destaqueRef = useRef<L.Polyline[]>([])
  const avisos = useRef({ aoFalharTiles, aoMudarZoom })
  useEffect(() => {
    avisos.current = { aoFalharTiles, aoMudarZoom }
  })

  const linha = linhaDoGeoJson(rota.geometria) as PontoLatLng[]

  useEffect(() => {
    const el = contêiner.current
    if (!el) return
    const mapa = L.map(el, opcoesMapa(ponteiroEhFino()))
    mapaRef.current = mapa
    // o MapContainer do react-leaflet só repassa className/id/style; o contêiner é nosso
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', descricao)

    const tiles = L.tileLayer(URL_TILES, { maxZoom: MAX_ZOOM })
    const pararVigia = vigiarTiles(tiles, () => avisos.current.aoFalharTiles())
    tiles.addTo(mapa)
    tilesRef.current = tiles

    L.polyline(linha, { className: 'mapa__casing', interactive: false }).addTo(mapa)
    L.polyline(linha, { className: 'mapa__linha', interactive: false }).addTo(mapa)
    L.marker(linha[0], { icon: iconeDe('origem'), keyboard: false, interactive: false }).addTo(mapa)
    L.marker(linha[linha.length - 1], { icon: iconeDe('destino'), keyboard: false, interactive: false }).addTo(mapa)

    const notificarZoom = () => avisos.current.aoMudarZoom(mapa.getZoom() <= mapa.getMinZoom(), mapa.getZoom() >= MAX_ZOOM)
    mapa.on('zoomend', notificarZoom)
    mapa.fitBounds(linha, { animate: false, padding: [24, 24] })
    notificarZoom()

    return () => {
      pararVigia()
      mapa.remove()
      mapaRef.current = null
    }
    // o mapa é recriado só com outra rota; a descrição acompanha a rota
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota])

  useImperativeHandle(
    ref,
    () => ({
      aproximar: () => mapaRef.current?.zoomIn(1, { animate: false }),
      afastar: () => mapaRef.current?.zoomOut(1, { animate: false }),
      rotaInteira: () => mapaRef.current?.fitBounds(linhaDoGeoJson(rota.geometria) as PontoLatLng[], { animate: false, padding: [24, 24] }),
      recarregarTiles: () => tilesRef.current?.redraw(),
    }),
    [rota],
  )

  // o destaque (óxido) acompanha a leitura; o enquadramento só o passo escolhido
  const ordemDestaque = passoEmLeitura ?? passoSelecionado
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa) return
    destaqueRef.current.forEach((c) => c.remove())
    destaqueRef.current = []
    const passo = rota.passos.find((p) => p.ordem === ordemDestaque)
    const trecho = passo ? linhaDoGeoJson(passo.geometria) : null
    if (!trecho) return
    destaqueRef.current = [
      L.polyline(trecho, { className: 'mapa__casing mapa__casing--ativo', interactive: false }).addTo(mapa),
      L.polyline(trecho, { className: 'mapa__linha mapa__linha--ativa', interactive: false }).addTo(mapa),
    ]
  }, [rota, ordemDestaque])

  useEffect(() => {
    const passo = rota.passos.find((p) => p.ordem === passoSelecionado)
    const trecho = passo ? linhaDoGeoJson(passo.geometria) : null
    if (trecho) mapaRef.current?.fitBounds(trecho, { animate: false, padding: [48, 48], maxZoom: 18 })
  }, [rota, passoSelecionado, rodadaPasso])

  return <div ref={contêiner} className="mapa__leaflet" />
}
```

`frontend/src/componentes/mapa/MapaRota.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import type { RotaOut } from '../../api/client'
import { formatarDistancia } from '../../dados/passo'
import { Passarela } from '../Passarela'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
import type { ControleMapa } from './MapaLeaflet'

type PropsLeaflet = {
  ref?: React.Ref<ControleMapa>
  rota: RotaOut
  descricao: string
  passoSelecionado: number | null
  rodadaPasso: number
  passoEmLeitura: number | null
  aoFalharTiles: () => void
  aoMudarZoom: (noMinimo: boolean, noMaximo: boolean) => void
}

type Props = {
  rota: RotaOut
  origem: string
  destino: string
  aberto: boolean
  aoAlternar: (aberto: boolean) => void
  passoSelecionado: number | null
  /** Sobe a cada pressão em "Ver o passo N": pressionar de novo enquadra e fala outra vez. */
  rodadaPasso: number
  passoEmLeitura: number | null
}

const MSG_TILES = 'O fundo do mapa não carregou. A linha da rota e a lista continuam.'

/**
 * Casca do mapa: o chunk do Leaflet e os tiles só saem por ação da pessoa. import() à mão
 * porque React.lazy guarda a rejeição, e "Tentar de novo" precisa de uma nova tentativa.
 */
export function MapaRota({ rota, origem, destino, aberto, aoAlternar, passoSelecionado, rodadaPasso, passoEmLeitura }: Props) {
  const [Leaflet, setLeaflet] = useState<ComponentType<PropsLeaflet> | null>(null)
  const [fase, setFase] = useState<'fechado' | 'carregando' | 'pronto' | 'falhou'>('fechado')
  const [tilesFalharam, setTilesFalharam] = useState(false)
  const [zoom, setZoom] = useState({ noMinimo: false, noMaximo: false })
  const controle = useRef<ControleMapa>(null)
  const legenda = useRef<HTMLOListElement>(null)
  const botaoMapa = useRef<HTMLButtonElement>(null)
  const dica = useId()
  const anunciar = useAnuncio()

  async function abrir() {
    if (fase === 'carregando') return
    setFase('carregando')
    anunciar('Abrindo o mapa.')
    try {
      const modulo = await import('./MapaLeaflet')
      setLeaflet(() => modulo.default as ComponentType<PropsLeaflet>)
      setFase('pronto')
      // só agora o mapa existe: os passos só ganham "Ver no mapa" com ele aberto de verdade
      aoAlternar(true)
      anunciar('Mapa aberto. A lista de passos continua completa.')
    } catch {
      setFase('falhou')
      anunciar('Não foi possível abrir o mapa. A lista de passos está completa.')
    }
  }

  function fechar() {
    aoAlternar(false)
    setFase('fechado')
    setTilesFalharam(false)
    anunciar('Mapa fechado.')
  }

  const passo = rota.passos.find((p) => p.ordem === passoSelecionado) ?? null

  // "Ver o passo N": com o mapa fora da vista, o foco vai à legenda, que diz o passo; senão, a
  // região anuncia. Nunca os dois.
  useEffect(() => {
    if (passoSelecionado === null) return
    const caixa = legenda.current?.getBoundingClientRect()
    if (caixa && (caixa.top < 0 || caixa.bottom > window.innerHeight)) legenda.current?.focus()
    else anunciar(`Mapa no passo ${passoSelecionado}.`)
  }, [passoSelecionado, rodadaPasso, anunciar])

  const descricao = `Mapa ilustrativo da rota de ${origem} até ${destino}, ${formatarDistancia(rota.distancia_m)} em ${rota.passos.length} passos. Tudo o que ele mostra está na lista de passos desta página.`

  return (
    <div className="mapa-rota">
      <Placa ref={botaoMapa} pictograma="enquadrar" aria-pressed={aberto} aria-describedby={dica} aria-disabled={fase === 'carregando' || undefined} onClick={aberto ? fechar : abrir}>
        Mostrar mapa
      </Placa>
      <p id={dica} className="campo__dica">
        Mostrar o mapa baixa imagens do OpenStreetMap, que recebe o endereço IP do seu aparelho e a região vista. A lista
        de passos já traz tudo.
      </p>

      {fase === 'carregando' && <p className="campo__retorno">Abrindo o mapa…</p>}
      {fase === 'falhou' && (
        <div className="campo__retorno">
          <p>Não foi possível abrir o mapa. A lista de passos está completa.</p>
          <Placa
            onClick={() => {
              botaoMapa.current?.focus()
              void abrir()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}

      {fase === 'pronto' && Leaflet && (
        <section aria-labelledby="titulo-mapa" className="mapa-rota__corpo">
          <h3 id="titulo-mapa" className="letreiro mapa-rota__titulo">
            Mapa da rota
          </h3>
          <figure className="mapa">
            <Leaflet
              ref={controle}
              rota={rota}
              descricao={descricao}
              passoSelecionado={passoSelecionado}
              rodadaPasso={rodadaPasso}
              passoEmLeitura={passoEmLeitura}
              aoFalharTiles={() => {
                setTilesFalharam(true)
                anunciar(MSG_TILES)
              }}
              aoMudarZoom={(noMinimo, noMaximo) => setZoom({ noMinimo, noMaximo })}
            />
            <figcaption className="mapa__atribuicao">
              © colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
            </figcaption>
          </figure>
          {tilesFalharam && (
            <div className="aviso">
              <span>{MSG_TILES}</span>
              <Placa
                onClick={() => {
                  botaoMapa.current?.focus()
                  setTilesFalharam(false)
                  controle.current?.recarregarTiles()
                }}
              >
                Tentar de novo
              </Placa>
            </div>
          )}
          <div role="group" aria-label="Controles do mapa" className="mapa-rota__controles">
            <Placa pictograma="mais" aria-disabled={zoom.noMaximo || undefined} onClick={() => !zoom.noMaximo && controle.current?.aproximar()}>
              Aproximar
            </Placa>
            <Placa pictograma="menos" aria-disabled={zoom.noMinimo || undefined} onClick={() => !zoom.noMinimo && controle.current?.afastar()}>
              Afastar
            </Placa>
            <Placa pictograma="enquadrar" onClick={() => controle.current?.rotaInteira()}>
              Rota inteira
            </Placa>
          </div>
          {passo && (
            <ol ref={legenda} start={passo.ordem} className="mapa-rota__legenda" tabIndex={-1} aria-label={`Mapa no passo ${passo.ordem}`}>
              <Passarela passo={passo} ativo />
            </ol>
          )}
          <p className="mapa-rota__volta">
            <a className="alvo" href={passo ? `#passo-${passo.ordem}` : '#lista-passos'}>
              {passo ? `Voltar ao passo ${passo.ordem} na lista` : 'Ir para a lista de passos'}
            </a>
          </p>
        </section>
      )}
    </div>
  )
}
```

`frontend/src/componentes/mapa/mapa.css`:

```css
/* Mapa redundante: tokens do DESIGN.md, nenhum tamanho de fonte novo, canto vivo, sem sombra.
   Contrastes novos anotados em index.css. */

.mapa {
  position: relative;
  margin: 0;
  border: 1px solid var(--junta);
  background: var(--vao);
}

.mapa__leaflet {
  height: clamp(16rem, 50svh, 32rem);
  background: var(--vao);
  font-family: var(--fonte);
  font-size: var(--t-1);
}

.mapa__leaflet.leaflet-container {
  background: var(--vao);
  font: inherit;
  font-size: var(--t-1);
}

/* fundo apagado: conforto sensorial; fatores de partida, ajustar contra captura real */
.mapa__leaflet .leaflet-tile-pane {
  filter: grayscale(1) contrast(0.9);
}

@media (prefers-color-scheme: dark) {
  .mapa__leaflet .leaflet-tile-pane {
    filter: grayscale(1) invert(1) brightness(0.85) contrast(0.85);
  }
}

.mapa__leaflet path.mapa__casing {
  stroke: var(--placa);
  stroke-width: 8;
  stroke-opacity: 1;
  stroke-linecap: butt;
  stroke-linejoin: miter;
  fill: none;
}

.mapa__leaflet path.mapa__linha {
  stroke: var(--tinta);
  stroke-width: 4;
  stroke-opacity: 1;
  stroke-linecap: butt;
  stroke-linejoin: miter;
  fill: none;
}

/* óxido só no passo ativo; o segundo sinal é o número na legenda */
.mapa__leaflet path.mapa__linha--ativa {
  stroke: var(--oxido);
  stroke-width: 6;
}

.mapa__leaflet path.mapa__casing--ativo {
  stroke-width: 10;
}

.mapa__marcador {
  display: grid;
  place-items: center;
  color: var(--tinta);
  background: var(--placa);
  border: 2px solid var(--tinta);
}

/* sobre o mapa, como a política de tiles pede; fora do role="img", legível por leitor de tela */
.mapa__atribuicao {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 500;
  max-width: 100%;
  padding: 0.25rem 0.5rem;
  background: var(--placa);
  border-top: 1px solid var(--junta);
  border-left: 1px solid var(--junta);
  font-size: var(--t-1);
}

@media (forced-colors: active) {
  .mapa__leaflet path.mapa__linha,
  .mapa__leaflet path.mapa__linha--ativa {
    stroke: CanvasText;
  }
}

/* escolher um ponto: mira fixa no centro, nunca marcador arrastável */
.mapa__mira {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 500;
  transform: translate(-50%, -50%);
  color: var(--tinta);
  pointer-events: none;
}
```

Em `frontend/src/vite-env.d.ts`, acrescente em `ImportMetaEnv`:

```ts
  readonly VITE_TILE_URL?: string
```

Em `frontend/src/index.css`, no comentário do cabeçalho, antes da linha `TEXTURA do chão`, anote (`DESIGN.md`, "anotar o contraste"):

```text
   MAPA (Planos 5 e 6): nenhuma cor nova. Linha tinta sobre casing placa 13,37 (claro) e 11,52
     (escuro); passo ativo óxido sobre casing placa 5,41 (claro) e 4,10 (escuro); marcador
     tinta sobre placa, contorno de 2 px em tinta. Tiles em cinza por filtro CSS.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest --run src/test/Mapa.test.tsx`
Expected: PASS, 4 testes.

- [ ] **Step 6: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 21 arquivos, 141 testes passando.

---

### Task 9: A tela `/rota`

**Files:**
- Create: `frontend/src/componentes/ResultadoRota.tsx`, `frontend/src/test/Rota.test.tsx`
- Replace: `frontend/src/pages/Rota.tsx`
- Modify: `frontend/src/componentes/Placa.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 8.
- Produces: `Rota` (a tela), `ResultadoRota({ rota, origem, destino, exigenciaPedida, calculadaEm, desatualizada, tituloRef })`, em que `origem` e `destino` são os rótulos da busca que gerou a rota, nunca os campos vivos; `Placa` aceita `ref`.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/Rota.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { montarPedido } from '../pages/rotaEstado'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco, ROTA } from './fixturasRota'

vi.mock('../componentes/mapa/MapaLeaflet', () => ({
  default: ({ descricao }: { descricao: string }) => <div role="img" aria-label={descricao} />,
}))

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')
const C = endereco(3, 'Rua C, 3 · Lapa')
const INATIVO = { 'GET /api/geocode': Response.json([A, B]) }
const ROTA_DE = { pedido: montarPedido(A, B, PERFIL_FORM_PADRAO), origem: A.rotulo, destino: B.rotulo }

function abrir() {
  return render(
    <MemoryRouter initialEntries={['/rota']}>
      <App />
    </MemoryRouter>,
  )
}

/** Escolhe por teclado: digita, Enter busca na hora, seta e Enter escolhem. */
async function escolher(user: ReturnType<typeof userEvent.setup>, nome: 'Origem' | 'Destino', indice: number) {
  const campo = await screen.findByRole('combobox', { name: nome })
  await user.click(campo)
  await user.keyboard('rua{Enter}')
  await screen.findAllByRole('option')
  await user.keyboard('{ArrowDown}'.repeat(indice + 1) + '{Enter}')
}

async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await escolher(user, 'Origem', 0)
  await escolher(user, 'Destino', 1)
}

const botaoCalcular = () => screen.findByRole('button', { name: 'Calcular rota' })

describe('página /rota', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tem o formulário real e aquece o servidor sem aviso na tela', async () => {
    const api = apiFalsa(INATIVO)
    const { container } = abrir()
    expect(await screen.findByRole('heading', { level: 1, name: 'Planejar rota' })).toBeInTheDocument()
    expect(document.title).toBe('Planejar rota · Rota Falada SP')
    expect(screen.getByRole('combobox', { name: 'Origem' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Destino' })).toBeInTheDocument()
    const exigencia = screen.getByRole('group', { name: 'Exigência' })
    expect(within(exigencia).getByRole('radio', { name: 'até 6%' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Evitar degraus' })).toBeChecked()
    const calcular = await botaoCalcular()
    expect(calcular).not.toHaveAttribute('aria-disabled')
    await waitFor(() => expect(api.de('GET /health')).toHaveLength(1))
    expect(api.de('POST /api/rotas')).toHaveLength(0)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('calcular sem escolha foca o campo e nunca adivinha', async () => {
    const api = apiFalsa(INATIVO)
    const user = userEvent.setup()
    abrir()
    await user.click(await botaoCalcular())
    const origem = screen.getByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveFocus()
    expect(origem).toHaveAttribute('aria-invalid', 'true')
    expect(origem).toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    expect(api.de('POST /api/rotas')).toHaveLength(0)
  })

  it('origem igual ao destino é erro no destino', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0)
    await escolher(user, 'Destino', 0)
    await user.click(await botaoCalcular())
    const destino = screen.getByRole('combobox', { name: 'Destino' })
    expect(destino).toHaveFocus()
    expect(destino).toHaveAccessibleDescription(expect.stringContaining('mesmo ponto'))
  })

  it('fluxo por teclado: POST no contrato, sem token, foco no h2 com o resumo e título sem rua', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, avisos: [{ tipo: 'trecho_sem_dados', mensagem: 'Sem dados aqui.' }] }) })
    const user = userEvent.setup()
    const { container } = abrir()
    await preencher(user)
    await user.click(await botaoCalcular())

    const titulo = await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(titulo).toHaveFocus()
    expect(titulo).toHaveTextContent('200,0 m em 2 passos, cerca de 4 minutos a pé, 1 aviso')
    expect(document.title).toBe('Rota calculada · Rota Falada SP')

    const [{ init }] = api.de('POST /api/rotas')
    const corpo = JSON.parse(String(init.body))
    expect(corpo.origem).toEqual({ lat: A.lat, lng: A.lon })
    expect(corpo.destino).toEqual({ lat: B.lat, lng: B.lon })
    expect(corpo.perfil.inclinacao_max).toBe(6)
    // LGPD: rota e geocode nunca levam Authorization, com ou sem login
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    for (const c of api.de('GET /api/geocode')) expect(c.init.headers).toEqual({})

    const lista = screen.getByRole('list', { name: 'Os 2 passos da rota' })
    expect(lista).toHaveAttribute('id', 'lista-passos')
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Sem dados aqui.')).toBeInTheDocument()
    expect(screen.getByText(/Pedida: até 6%. Atendida: até 6%./)).toBeInTheDocument()
    expect(screen.getByText('openrouteservice.org by HeiGIT')).toBeInTheDocument()
    expect(screen.getByText(/evita as barreiras confirmadas que bloqueiam a passagem e avisa das que só dificultam/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/garant/i)
    expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('se a pessoa saiu do botão durante a espera, o foco fica e a região anuncia', async () => {
    let responder: (r: Response) => void = () => {}
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>((r) => (responder = r)) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    const limparOuLink = screen.getByRole('link', { name: 'Rota Falada SP' })
    limparOuLink.focus()
    responder(Response.json(ROTA))
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(limparOuLink).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Rota encontrada. 200,0 m em 2 passos'))
  })

  it('cancelar volta o foco ao botão, anuncia e ignora a resposta', async () => {
    let responder: (r: Response) => void = () => {}
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>((r) => (responder = r)) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    const calcular = await botaoCalcular()
    await user.click(calcular)
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(calcular).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Cálculo cancelado.'))
    responder(Response.json(ROTA))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
  })

  it('404 mostra o detail e o conselho honesto', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': erroApi(404, 'Não encontramos rota acessível entre esses pontos.') })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Não encontramos rota' })
    expect(titulo).toHaveFocus()
    expect(screen.getByText('Não encontramos rota acessível entre esses pontos.')).toBeInTheDocument()
    expect(screen.getByText(/desmarque Evitar degraus; isso pode incluir degraus/)).toBeInTheDocument()
  })

  it('503 ignora o detail e oferece tentar de novo; o erro de rede também', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': erroApi(503, 'Não encontramos rota acessível entre esses pontos.') })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    expect(await screen.findByRole('heading', { level: 2, name: 'Não foi possível calcular agora' })).toHaveFocus()
    expect(screen.getByText(/Isso não quer dizer que a rota não existe/)).toBeInTheDocument()
    expect(screen.queryByText(/Não encontramos rota acessível/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(api.de('POST /api/rotas')).toHaveLength(2))
    // "Tentar de novo" sumiu: o foco não cai no body durante a espera
    expect(document.activeElement).not.toBe(document.body)
  })

  it('sob o pgRouting a ficha diz que não desvia das barreiras registradas', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, motor: 'pgrouting' }) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    expect(await screen.findByText(/não desvia das barreiras registradas/)).toBeInTheDocument()
    expect(screen.queryByText(/evita as barreiras confirmadas/)).toBeNull()
  })

  it('Enter no campo escolhido envia e leva o foco ao resultado, como o botão', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toHaveFocus()
  })

  it('o campo escolhido troca a tecla do celular: Enter já não busca, envia', async () => {
    apiFalsa(INATIVO)
    const user = userEvent.setup()
    abrir()
    const origem = await screen.findByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveAttribute('enterkeyhint', 'search')
    await escolher(user, 'Origem', 0)
    expect(origem).toHaveAttribute('enterkeyhint', 'go')
  })

  it('ponto repetido com Enter: o foco não muda, então a região anuncia o erro', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0)
    await escolher(user, 'Destino', 0)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('combobox', { name: 'Destino' })).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('A origem e o destino são o mesmo ponto'))
  })

  it('o erro de envio some ao digitar: fora da área e espera voltam a aparecer', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([]) })
    const user = userEvent.setup()
    abrir()
    await user.click(await botaoCalcular())
    const origem = screen.getByRole('combobox', { name: 'Origem' })
    expect(origem).toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    await user.keyboard('xyz{Enter}')
    expect(await screen.findByText(/fora dessa área o Rota Falada SP ainda não atende/)).toBeInTheDocument()
    expect(origem).not.toHaveAccessibleDescription(expect.stringContaining('Escolha um endereço da lista.'))
    expect(origem).not.toHaveAttribute('aria-invalid')
  })

  it('cálculo lento troca o texto e anuncia uma vez', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': () => new Promise<Response>(() => {}) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    const calcular = await botaoCalcular()
    vi.useFakeTimers()
    try {
      fireEvent.click(calcular)
      await act(() => vi.advanceTimersByTimeAsync(15_200))
      expect(screen.getByText('Ainda calculando; o serviço de rotas está lento.')).toBeInTheDocument()
      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(screen.getByRole('status')).toHaveTextContent('Ainda calculando; o serviço de rotas está lento.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('mudar a exigência depois do resultado não recalcula: marca como desatualizada', async () => {
    const api = apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    await user.click(screen.getByRole('radio', { name: 'até 3%' }))
    expect(screen.getByText('Esta rota é da busca anterior. Calcule de novo.')).toBeInTheDocument()
    expect(api.de('POST /api/rotas')).toHaveLength(1)
    // única salvaguarda de 3.2.2 nesta tela: precisa chegar a quem usa leitor de tela
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Esta rota é da busca anterior. Calcule de novo.'))
    expect(screen.getByRole('heading', { level: 2, name: /Rota da busca anterior/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
  })

  it('a ficha e o mapa falam da rota calculada, nunca dos campos vivos', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    await user.click(screen.getByRole('combobox', { name: 'Destino' }))
    await user.keyboard('x')
    const ficha = screen.getByText('Até').closest('dl')!
    expect(within(ficha).getByText(B.rotulo)).toBeInTheDocument()
    expect(within(ficha).queryByText('sem dado')).toBeNull()
  })

  it('recarregar depois de trocar o destino mostra o aviso e os rótulos da rota antiga', async () => {
    apiFalsa(INATIVO)
    gravarSessaoRota({ versao: 1, origem: A, destino: C, perfil: PERFIL_FORM_PADRAO, rota: ROTA, rotaDe: ROTA_DE, calculadaEm: new Date().toISOString() })
    abrir()
    expect(await screen.findByText('Esta rota é da busca anterior. Calcule de novo.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Destino' })).toHaveValue(C.rotulo)
    const ficha = screen.getByText('Até').closest('dl')!
    expect(within(ficha).getByText(B.rotulo)).toBeInTheDocument()
    expect(within(ficha).queryByText(C.rotulo)).toBeNull()
  })

  it('recarregar restaura sem POST e sem mover o foco; Limpar apaga', async () => {
    const api = apiFalsa(INATIVO)
    gravarSessaoRota({ versao: 1, origem: A, destino: B, perfil: PERFIL_FORM_PADRAO, rota: ROTA, rotaDe: ROTA_DE, calculadaEm: new Date().toISOString() })
    const user = userEvent.setup()
    abrir()
    const titulo = await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(titulo).not.toHaveFocus()
    expect(api.de('POST /api/rotas')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue(A.rotulo)
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.queryByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Origem' })).toHaveFocus()
    await waitFor(() => expect(sessionStorage.getItem('rf-busca')).not.toContain('Rua A'))
  })

  it('o trajeto nunca vai para URL nem localStorage', async () => {
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(localStorage.length).toBe(0)
  })

  it('barreira do passo aparece em texto, em português', async () => {
    const barreira = { id: 9, origem: 'oficial', categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: null, data_referencia: '2026-11-03' }
    const rota = { ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira] }] }
    apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(rota) })
    const user = userEvent.setup()
    abrir()
    await preencher(user)
    await user.click(await botaoCalcular())
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    const lista = screen.getByRole('list', { name: 'Os 1 passos da rota' })
    expect(within(lista).getByText(/Buraco, a 12 m. Dificulta a passagem, não bloqueia a rota. Fonte: SP156, 03\/11\/2026./)).toBeInTheDocument()
  })

  describe('mapa', () => {
    it('só carrega por ação, avisa do IP e, aberto, cada passo dirige o mapa', async () => {
      apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json(ROTA) })
      const user = userEvent.setup()
      const { container } = abrir()
      await preencher(user)
      await user.click(await botaoCalcular())
      await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })

      const botao = screen.getByRole('button', { name: 'Mostrar mapa' })
      expect(botao).toHaveAttribute('aria-pressed', 'false')
      expect(botao).toHaveAccessibleDescription(expect.stringContaining('recebe o endereço IP'))
      expect(screen.queryByRole('img', { name: /Mapa ilustrativo/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Ver o passo 1 no mapa' })).toBeNull()

      await user.click(botao)
      const mapa = await screen.findByRole('img', { name: /Mapa ilustrativo da rota de Rua A, 1 · Vila Mariana até Rua B, 2 · Vila Mariana/ })
      expect(mapa).toHaveAccessibleName(expect.stringContaining('Tudo o que ele mostra está na lista de passos'))
      expect(botao).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')

      const verPasso = screen.getByRole('button', { name: 'Ver o passo 2 no mapa' })
      await user.click(verPasso)
      expect(verPasso).toHaveAttribute('aria-current', 'true')
      expect(verPasso).not.toHaveAttribute('aria-pressed')
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa no passo 2.'))
      // pressionar de novo não é mudo: enquadra e anuncia outra vez
      await user.click(verPasso)
      expect(screen.getByRole('status').textContent).toBe('')
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mapa no passo 2.'))
      expect(within(screen.getByRole('list', { name: 'Mapa no passo 2' })).getByRole('listitem')).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('link', { name: 'Voltar ao passo 2 na lista' })).toHaveAttribute('href', '#passo-2')
      expect(document.querySelectorAll('[aria-live],[role=status],[role=alert]')).toHaveLength(1)
      expect(await axe(container)).toHaveNoViolations()
    })

    it('geometria inválida: sem botão de mapa, a lista segue', async () => {
      apiFalsa({ ...INATIVO, 'POST /api/rotas': Response.json({ ...ROTA, geometria: {} }) })
      const user = userEvent.setup()
      abrir()
      await preencher(user)
      await user.click(await botaoCalcular())
      await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
      expect(screen.queryByRole('button', { name: 'Mostrar mapa' })).toBeNull()
      expect(screen.getByRole('list', { name: 'Os 2 passos da rota' })).toBeInTheDocument()
    })
  })

  it('a contagem pendente não é falada depois de escolher a opção', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A, B]) })
    const user = userEvent.setup()
    abrir()
    await escolher(user, 'Origem', 0) // primeira busca: a contagem sai
    await user.click(screen.getByRole('combobox', { name: 'Destino' }))
    await user.keyboard('rua{Enter}')
    await screen.findAllByRole('option') // segunda busca, dentro dos 3 s: a contagem fica pendente
    await user.keyboard('{ArrowDown}{Enter}')
    await new Promise((r) => setTimeout(r, 3200))
    expect(screen.getByRole('status')).toHaveTextContent('Destino: Rua A, 1')
  }, 8000)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Rota.test.tsx`
Expected: FAIL (`Unable to find an accessible element with the role "combobox"`: a tela ainda é o esqueleto).

- [ ] **Step 3: Implementar**

Em `frontend/src/componentes/Placa.tsx`, `ref` passa a ser aceito. Troque o import e o tipo:

```tsx
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
```

```tsx
type PlacaBotao = Comum & { para?: undefined; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>
```

`frontend/src/componentes/ResultadoRota.tsx`:

```tsx
import { useState, type RefObject } from 'react'
import { Link } from 'react-router'
import type { RotaOut } from '../api/client'
import { nomeFonte, textoExigencia, textosDeAviso, textoMotor, textoSobreARota } from '../dados/passo'
import { linhaDoGeoJson } from '../dados/rotaGeo'
import { horaDe, resumoDaRota } from '../pages/rotaEstado'
import { BotaoOuvir } from './BotaoOuvir'
import { FichaRota } from './FichaRota'
import { MapaRota } from './mapa/MapaRota'
import { TabelaPassos } from './TabelaPassos'

type Props = {
  rota: RotaOut
  /** Os rótulos da busca que gerou esta rota, nunca os campos vivos do formulário. */
  origem: string
  destino: string
  exigenciaPedida: 3 | 6 | 10 | 'any'
  calculadaEm: string
  /** Os campos já não são os desta rota: o título precisa dizer isso a quem navega por títulos. */
  desatualizada: boolean
  tituloRef: RefObject<HTMLHeadingElement | null>
}

export function ResultadoRota({ rota, origem, destino, exigenciaPedida, calculadaEm, desatualizada, tituloRef }: Props) {
  const [passoAtivo, setPassoAtivo] = useState<number | null>(null)
  const [mapaAberto, setMapaAberto] = useState(false)
  const [noMapa, setNoMapa] = useState<{ ordem: number; rodada: number } | null>(null)
  const temMapa = linhaDoGeoJson(rota.geometria) !== null
  const degraus = rota.passos.filter((p) => p.is_degrau).map((p) => p.ordem)

  return (
    <section className="resultado" aria-labelledby="titulo-resultado">
      <h2 id="titulo-resultado" ref={tituloRef} tabIndex={-1} className="resultado__titulo">
        <span className="letreiro">{desatualizada ? 'Rota da busca anterior' : 'Rota encontrada'}</span> <span className="medida">{resumoDaRota(rota)}</span>
      </h2>

      <div className={mapaAberto ? 'resultado__topo resultado__topo--mapa' : 'resultado__topo'}>
        <FichaRota
          solta
          resumo={textoSobreARota(rota.motor)}
          dados={[
            { rotulo: 'De', valor: origem },
            { rotulo: 'Até', valor: destino },
            {
              rotulo: 'Exigência',
              valor: `Pedida: ${textoExigencia(exigenciaPedida)}. Atendida: ${textoExigencia(rota.nivel_exigencia_atendido)}.`,
            },
            { rotulo: 'Calculada por', valor: textoMotor(rota.motor) },
            {
              rotulo: 'Calculada às',
              valor: `${horaDe(calculadaEm)}${rota.cache ? '. Reaproveitada de um cálculo das últimas 6 horas' : ''}`,
            },
            {
              rotulo: 'Fontes',
              valor: (
                <>
                  {rota.fontes.map(nomeFonte).join(', ')}. <Link to="/fontes">Licenças</Link>
                </>
              ),
            },
          ]}
          avisos={[
            ...textosDeAviso(rota),
            ...(degraus.length > 0 ? [`Há degrau no ${degraus.length === 1 ? 'passo' : 'passos'} ${degraus.join(', ')}.`] : []),
          ]}
        >
          <BotaoOuvir key={calculadaEm} passos={rota.passos} rotulo="Ouvir a rota" aoMudarPasso={setPassoAtivo} />
        </FichaRota>

        {temMapa && (
          <MapaRota
            rota={rota}
            origem={origem}
            destino={destino}
            aberto={mapaAberto}
            aoAlternar={(aberto) => {
              setMapaAberto(aberto)
              if (!aberto) setNoMapa(null)
            }}
            passoSelecionado={noMapa?.ordem ?? null}
            rodadaPasso={noMapa?.rodada ?? 0}
            passoEmLeitura={passoAtivo}
          />
        )}
      </div>

      <TabelaPassos
        passos={rota.passos}
        passoAtivo={passoAtivo}
        rotulo={`Os ${rota.passos.length} passos da rota`}
        aoVerNoMapa={mapaAberto ? (ordem) => setNoMapa((a) => ({ ordem, rodada: (a?.rodada ?? 0) + 1 })) : undefined}
        passoNoMapa={noMapa?.ordem ?? null}
      />
    </section>
  )
}
```

`frontend/src/pages/Rota.tsx`:

```tsx
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { calcularRota } from '../api/client'
import { aquecerServidor } from '../api/servidor'
import { BotaoMinhaLocalizacao } from '../componentes/BotaoMinhaLocalizacao'
import { CampoEndereco } from '../componentes/CampoEndereco'
import { Placa } from '../componentes/Placa'
import { ResultadoRota } from '../componentes/ResultadoRota'
import { Janela, Torre } from '../componentes/Torre'
import { useAnuncio } from '../componentes/useAnuncio'
import { useBuscaEndereco } from '../componentes/useBuscaEndereco'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import {
  apagarSessaoRota,
  gravarSessaoRota,
  lerSessaoRota,
  PERFIL_FORM_PADRAO,
  type BuscaFeita,
  type Inclinacao,
  type PerfilForm,
} from '../dados/sessaoRota'
import '../estilos/rota.css'
import { focoVaiParaResultado, mesmoPonto, montarPedido, reduzirRota, resumoDaRota, type EstadoRota } from './rotaEstado'

const EXIGENCIAS: { valor: Inclinacao; rotulo: string }[] = [
  { valor: 3, rotulo: 'até 3%' },
  { valor: 6, rotulo: 'até 6%' },
  { valor: 10, rotulo: 'até 10%' },
  { valor: 'any', rotulo: 'qualquer inclinação' },
]

const LIMIAR_LENTO_MS = 15_000
const SUFIXO_TITULO = ' · Rota Falada SP'
const TEXTO_LENTO = 'Ainda calculando; o serviço de rotas está lento.'
const TEXTO_DESATUALIZADA = 'Esta rota é da busca anterior. Calcule de novo.'
const MSG_MESMO_PONTO = 'A origem e o destino são o mesmo ponto. Escolha outro destino.'

/** O pedido vem do que gerou a rota, gravado com ela: os campos podem já ser outros. */
function estadoRestaurado(): EstadoRota {
  const s = lerSessaoRota()
  if (!s?.rota || !s.calculadaEm || !s.rotaDe) return { fase: 'ocioso' }
  return {
    fase: 'resultado',
    busca: s.rotaDe,
    rota: s.rota,
    calculadaEm: s.calculadaEm,
    restaurada: true,
  }
}

export function Rota() {
  const h1 = usePaginaAcessivel('Planejar rota')
  const anunciar = useAnuncio()
  const [restauro] = useState(() => lerSessaoRota())
  const origem = useBuscaEndereco('Origem', restauro?.origem ?? null)
  const destino = useBuscaEndereco('Destino', restauro?.destino ?? null)
  const [perfil, setPerfil] = useState<PerfilForm>(restauro?.perfil ?? PERFIL_FORM_PADRAO)
  const [estado, despachar] = useReducer(reduzirRota, undefined, estadoRestaurado)
  const [erros, setErros] = useState<{ origem?: string; destino?: string }>({})
  const botao = useRef<HTMLButtonElement>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const controle = useRef<AbortController | null>(null)
  const focoNoEnvio = useRef<Element | null>(null)
  const calculando = estado.fase === 'calculando'
  const espera = useEsperaServidor(calculando)

  useEffect(() => {
    aquecerServidor()
    return () => controle.current?.abort()
  }, [])

  // grava na seleção e no resultado, nunca a cada tecla
  const rotaAtual = estado.fase === 'resultado' ? estado : null
  useEffect(() => {
    gravarSessaoRota({
      versao: 1,
      origem: origem.escolha,
      destino: destino.escolha,
      perfil,
      rota: rotaAtual?.rota ?? null,
      rotaDe: rotaAtual?.busca ?? null,
      calculadaEm: rotaAtual?.calculadaEm ?? null,
    })
  }, [origem.escolha, destino.escolha, perfil, rotaAtual])

  // sem nome de rua no título: não gravar trajeto no histórico do navegador
  const temResultado = estado.fase === 'resultado'
  useEffect(() => {
    document.title = (temResultado ? 'Rota calculada' : 'Planejar rota') + SUFIXO_TITULO
  }, [temResultado])

  // fim do cálculo: foco no h2 ou anúncio, nunca os dois. Restaurar não move foco.
  const fase = estado.fase
  const restaurada = estado.fase === 'resultado' && estado.restaurada
  const resumo = estado.fase === 'resultado' ? `Rota encontrada. ${resumoDaRota(estado.rota)}.` : null
  const buscaAtual = useMemo<BuscaFeita | null>(
    () =>
      origem.escolha && destino.escolha
        ? { pedido: montarPedido(origem.escolha, destino.escolha, perfil), origem: origem.escolha.rotulo, destino: destino.escolha.rotulo }
        : null,
    [origem.escolha, destino.escolha, perfil],
  )
  const desatualizada = estado.fase === 'resultado' && JSON.stringify(buscaAtual?.pedido ?? null) !== JSON.stringify(estado.busca.pedido)

  const anterior = useRef(fase)
  useEffect(() => {
    const veioDoCalculo = anterior.current === 'calculando'
    anterior.current = fase
    if (!veioDoCalculo || restaurada) return
    if (fase === 'resultado' || fase === 'sem_rota' || fase === 'indisponivel') {
      // voltou a editar durante o cálculo: não tirar o foco de quem está digitando
      if (!desatualizada && focoVaiParaResultado(document.activeElement, focoNoEnvio.current)) titulo.current?.focus()
      else if (resumo) anunciar(resumo)
      else anunciar(titulo.current?.textContent ?? '')
    }
  }, [fase, restaurada, resumo, desatualizada, anunciar])

  // o aviso é a única salvaguarda de WCAG 3.2.2 aqui: anuncia na transição, nunca a cada tecla
  const avisouDesatualizada = useRef(desatualizada)
  useEffect(() => {
    if (desatualizada && !avisouDesatualizada.current) anunciar(TEXTO_DESATUALIZADA)
    avisouDesatualizada.current = desatualizada
  }, [desatualizada, anunciar])

  const lento = estado.fase === 'calculando' && estado.lento
  const temEspera = espera !== null
  useEffect(() => {
    // o texto de espera do servidor vem antes: só um deles é verdade de cada vez
    if (lento && !temEspera) anunciar(TEXTO_LENTO)
  }, [lento, temEspera, anunciar])

  async function executar(busca: BuscaFeita) {
    const pedidoControle = new AbortController()
    controle.current?.abort()
    controle.current = pedidoControle
    focoNoEnvio.current = document.activeElement
    despachar({ tipo: 'calcular', busca })
    anunciar('Calculando a rota.')
    const limiar = setTimeout(() => despachar({ tipo: 'demorou' }), LIMIAR_LENTO_MS)
    try {
      const rota = await calcularRota(busca.pedido, pedidoControle.signal)
      despachar({ tipo: 'chegou', rota, calculadaEm: new Date().toISOString() })
    } catch (erro) {
      if (ehCancelamento(erro)) return
      if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado') despachar({ tipo: 'sem_rota', detalhe: erro.message })
      else despachar({ tipo: 'falhou', mensagem: erro instanceof ErroApi ? erro.message : MSG_INESPERADO })
    } finally {
      clearTimeout(limiar)
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (calculando) return
    const novos: typeof erros = {}
    if (!origem.escolha) novos.origem = 'Escolha um endereço da lista.'
    if (!destino.escolha) novos.destino = 'Escolha um endereço da lista.'
    if (origem.escolha && destino.escolha && mesmoPonto(origem.escolha, destino.escolha)) {
      novos.destino = MSG_MESMO_PONTO
    }
    flushSync(() => setErros(novos))
    // o foco lê a descrição do campo; com o foco já nele (Enter), a região anuncia
    if (novos.origem) focarOuAnunciar(document.getElementById('origem'), novos.origem, anunciar)
    else if (novos.destino) focarOuAnunciar(document.getElementById('destino'), novos.destino, anunciar)
    else if (buscaAtual) void executar(buscaAtual)
  }

  /** O erro só vale até a pessoa mexer no que ele aponta. */
  function limparErroOrigem() {
    setErros((e) => ({ destino: e.destino === MSG_MESMO_PONTO ? undefined : e.destino }))
  }

  function limparErroDestino() {
    setErros((e) => ({ origem: e.origem }))
  }

  function cancelar() {
    controle.current?.abort()
    despachar({ tipo: 'cancelar' })
    anunciar('Cálculo cancelado.')
    botao.current?.focus()
  }

  function limparBusca() {
    controle.current?.abort()
    origem.limpar()
    destino.limpar()
    setPerfil(PERFIL_FORM_PADRAO)
    setErros({})
    despachar({ tipo: 'limpar' })
    apagarSessaoRota()
    anunciar('Busca apagada.')
    document.getElementById('origem')?.focus()
  }

  return (
    <div className="rota">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Planejar rota
        </h1>
        <p className="subtitulo">
          Diga de onde sai e aonde quer chegar. A rota volta como lista de passos, com a fonte e a data de cada dado.
        </p>
      </div>

      <form className="formulario" aria-label="Planejar rota" onSubmit={enviar} noValidate>
        <CampoEndereco id="origem" rotulo="Origem" busca={origem} erro={origem.escolha ? null : erros.origem} aoEditar={limparErroOrigem}>
          <BotaoMinhaLocalizacao
            idCampo="origem"
            valorCampo={origem.texto}
            aoEscolher={(endereco) => {
              limparErroOrigem()
              origem.escolher(endereco, 'gps')
            }}
          />
        </CampoEndereco>
        <CampoEndereco
          id="destino"
          rotulo="Destino"
          busca={destino}
          erro={erros.destino && (!destino.escolha || erros.destino === MSG_MESMO_PONTO) ? erros.destino : null}
          aoEditar={limparErroDestino}
        />

        <fieldset className="exigencia" aria-describedby="exigencia-dica">
          <legend>Exigência</legend>
          <p id="exigencia-dica" className="campo__dica">
            Inclinação máxima que a calçada pode ter no caminho.
          </p>
          <div className="exigencia__opcoes">
            {EXIGENCIAS.map((o) => (
              <label key={o.valor} className="opcao">
                <input
                  type="radio"
                  name="exigencia"
                  value={o.valor}
                  checked={perfil.inclinacao_max === o.valor}
                  onChange={() => setPerfil((p) => ({ ...p, inclinacao_max: o.valor }))}
                />
                <span>{o.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="opcao">
          <input
            type="checkbox"
            name="evitar_degraus"
            checked={perfil.evitar_degraus}
            onChange={(e) => setPerfil((p) => ({ ...p, evitar_degraus: e.target.checked }))}
          />
          <span>Evitar degraus</span>
        </label>

        <div className="formulario__envio">
          <Placa
            ref={botao}
            type="submit"
            variante="acao"
            pictograma="siga"
            aria-disabled={calculando || undefined}
            aria-describedby={calculando ? 'estado-calculo' : undefined}
          >
            Calcular rota
          </Placa>
          {calculando && (
            <div id="estado-calculo" className="estado-calculo">
              <p>{espera ?? (estado.lento ? TEXTO_LENTO : 'Calculando a rota…')}</p>
              <Placa onClick={cancelar}>Cancelar</Placa>
            </div>
          )}
          {(origem.escolha || destino.escolha || temResultado) && !calculando && (
            <div className="formulario__limpar">
              <Placa onClick={limparBusca}>Limpar busca</Placa>
              <p className="campo__dica">A busca fica só nesta aba e some quando você a fecha.</p>
            </div>
          )}
        </div>
      </form>

      <Torre variante="anexo">
        <Janela area="aviso">
          <h2 className="letreiro">Área piloto</h2>
          <p>
            Os dados de calçada cobrem Vila Mariana, Lapa e Ipiranga. Fora dessa área a rota não existe, e o Rota Falada
            SP diz isso em vez de inventar um caminho.
          </p>
          <p>Sua rota não fica ligada a nenhuma conta, e não guardamos histórico de trajetos.</p>
        </Janela>
      </Torre>

      {estado.fase === 'resultado' && (
        <>
          {desatualizada && (
            <p className="aviso rota__aviso">
              <span>{TEXTO_DESATUALIZADA}</span>
            </p>
          )}
          <ResultadoRota
            rota={estado.rota}
            origem={estado.busca.origem}
            destino={estado.busca.destino}
            exigenciaPedida={estado.busca.pedido.perfil.inclinacao_max}
            calculadaEm={estado.calculadaEm}
            desatualizada={desatualizada}
            tituloRef={titulo}
          />
        </>
      )}

      {estado.fase === 'sem_rota' && (
        <section className="resultado resultado--falha" aria-labelledby="titulo-resultado">
          <h2 id="titulo-resultado" ref={titulo} tabIndex={-1} className="letreiro resultado__titulo">
            Não encontramos rota
          </h2>
          <p>{estado.detalhe}</p>
          <p>Tente outro ponto ou desmarque Evitar degraus; isso pode incluir degraus no caminho.</p>
        </section>
      )}

      {estado.fase === 'indisponivel' && (
        <section className="resultado resultado--falha" aria-labelledby="titulo-resultado">
          <h2 id="titulo-resultado" ref={titulo} tabIndex={-1} className="letreiro resultado__titulo">
            Não foi possível calcular agora
          </h2>
          <p>{estado.mensagem}</p>
          <Placa
            onClick={() => {
              // este botão some com o cálculo: o foco espera em "Calcular rota"
              botao.current?.focus()
              void executar(estado.busca)
            }}
          >
            Tentar de novo
          </Placa>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Rota.test.tsx`
Expected: PASS, 23 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 22 arquivos, 164 testes passando.

---

### Task 10: Navegador real: Playwright, axe, CSP, orçamento e Lighthouse

**Files:**
- Create: `frontend/public/_headers`, `frontend/playwright.config.ts`, `frontend/tsconfig.e2e.json`, `frontend/.env.e2e`, `frontend/.env.example`, `frontend/e2e/apoio.ts`, `frontend/e2e/rota.spec.ts`, `frontend/e2e/csp.spec.ts`, `frontend/scripts/orcamento-bundle.mjs`, `frontend/scripts/gate-lighthouse.mjs`
- Modify: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/.gitignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: scripts `npm run e2e`, `npm run build:e2e`, `npm run orcamento`; `simular(page, extras)`, `semViolacoes`, `semRolagemHorizontal`, `alvosDe44`, `focoNaoCaiu`, `umaRegiaoViva`, `escolherPorTeclado`, `json`, `A`, `B`, `ROTA`, `BARREIRA` (`e2e/apoio.ts`).

- [ ] **Step 1: Instalar e configurar**

Run (em `frontend/`): `npm i -D --save-exact @playwright/test@1.64.1 @axe-core/playwright@4.14.0`

Em `frontend/package.json`, acrescente em `scripts`:

```json
    "build:e2e": "vite build --mode e2e",
    "e2e": "playwright test",
    "orcamento": "node scripts/orcamento-bundle.mjs"
```

Em `frontend/vite.config.ts`, para o Vitest não pegar os testes do Playwright, acrescente em `test`:

```ts
    include: ['src/**/*.test.{ts,tsx}'],
```

Em `frontend/.gitignore`, acrescente depois de `*.local`:

```text
test-results
playwright-report
```

`frontend/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

/** Build de produção com API e Supabase simulados por page.route. Nada sai para a rede. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // localmente usa o Chrome já instalado; no CI, `npx playwright install chromium`
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
```

`frontend/tsconfig.e2e.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["e2e", "playwright.config.ts"]
}
```

`frontend/.env.e2e`:

```text
# Só para o build de E2E: API e Supabase são simulados por page.route.
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://teste.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_teste
```

`frontend/.env.example`:

```text
# Copie para .env.local. As duas de Supabase são públicas por desenho; sem elas, o login some e o resto funciona.
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
# Provedor de tiles; o padrão é o do OpenStreetMap.
VITE_TILE_URL=
```

- [ ] **Step 2: Escrever os cenários**

`frontend/e2e/apoio.ts`:

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route } from '@playwright/test'

export const API = 'http://localhost:8000'

export const A = { id: 1, tipo: 'endereco', rotulo: 'Rua Helen Keller, 100 · Vila Mariana', lat: -23.59, lon: -46.635, aproximado: false }
export const B = { id: 2, tipo: 'endereco', rotulo: 'Rua Ouvidor Peleja, 200 · Vila Mariana', lat: -23.595, lon: -46.64, aproximado: false }

const LINHA = {
  type: 'LineString',
  coordinates: [
    [-46.635, -23.59],
    [-46.637, -23.592],
    [-46.64, -23.595],
  ],
}

export const ROTA = {
  passos: [1, 2, 3].map((ordem) => ({
    ordem,
    instrucao: `Vire à direita em direção a Rua ${ordem}`,
    distancia_m: 100,
    duracao_s: 120,
    direcao: 'siga',
    largura_m: ordem === 2 ? null : 1.67,
    largura_medida: ordem !== 2,
    declividade_pct: 3,
    declividade_medida: true,
    guia: ordem === 3 ? 'nao_transponivel' : 'transponivel',
    is_degrau: false,
    barreiras_proximas: [],
    fonte: 'osm',
    data_referencia: '2026-10-12',
    geometria: LINHA,
  })),
  distancia_m: 300,
  duracao_s: 360,
  avisos: [{ tipo: 'trecho_sem_dados', mensagem: 'Um ou mais trechos da rota não têm calçada conflada do GeoSampa.' }],
  nivel_exigencia_atendido: 6,
  motor: 'ors',
  fontes: ['osm', 'geosampa'],
  geometria: LINHA,
  cache: false,
}

export const BARREIRA = {
  id: 5,
  categoria: 'escada',
  severidade: 'intransponivel',
  status: 'pendente',
  votos: { confirma: 1, contesta: 0, resolvida: 0 },
  descricao: 'Três degraus na entrada',
  lat: -23.59,
  lon: -46.635,
  criada_em: '2026-11-03T12:00:00+00:00',
  ultima_confirmacao_em: null,
  foto_url: null,
  foto_descricao: null,
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

function json(route: Route, corpo: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(corpo) })
}

type Rotas = Record<string, (route: Route) => unknown>

/** API simulada. Tile não sai para a rede: a política do OSM proíbe bots navegando. */
export async function simular(page: Page, extras: Rotas = {}) {
  const tabela: Rotas = {
    'GET /health': (r) => json(r, { status: 'ok', banco: 'ok' }),
    'GET /api/geocode': (r) => json(r, [A, B]),
    'GET /api/geocode/reverso': (r) => json(r, A),
    'POST /api/rotas': (r) => json(r, ROTA),
    'GET /api/fontes': (r) => json(r, []),
    'GET /api/barreiras': (r) => json(r, [BARREIRA]),
    'GET /api/barreiras/5': (r) => json(r, BARREIRA),
    ...extras,
  }
  await page.route(`${API}/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS })
    const chave = `${req.method()} ${new URL(req.url()).pathname}`
    const f = tabela[chave]
    if (!f) throw new Error(`rota não prevista: ${chave}`)
    return f(route)
  })
  // PNG de 1x1: basta para o Leaflet carregar sem sair para a rede
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
}

export { json }

/** Zero críticas e sérias, conforme PRODUCT.md. */
export async function semViolacoes(page: Page, contexto: string) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  const graves = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), contexto).toEqual([])
}

export async function semRolagemHorizontal(page: Page, contexto: string) {
  const excede = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(excede, `${contexto}: rolagem horizontal`).toBeLessThanOrEqual(0)
}

/** Interativos com pelo menos 44 px. Só link dentro de frase é exceção do WCAG 2.5.8; o resto conta. */
export async function alvosDe44(page: Page, contexto: string) {
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a.alvo, a.placa, a:not(p a):not(dd a):not(figcaption a):not(.skip-link), input:not([type=radio]):not([type=checkbox]):not([type=file]), .opcao')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 43.5
      })
      .map((el) => `${el.tagName} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  )
  expect(pequenos, `${contexto}: alvos menores que 44 px`).toEqual([])
}

/** O elemento focado saiu da tela sem levar o foco a lugar nenhum (WCAG 2.4.3). */
export async function focoNaoCaiu(page: Page, contexto: string) {
  const noBody = await page.evaluate(() => document.activeElement === null || document.activeElement === document.body)
  expect(noBody, `${contexto}: o foco caiu no body`).toBe(false)
}

export async function umaRegiaoViva(page: Page) {
  await expect(page.locator('[aria-live],[role=status],[role=alert]')).toHaveCount(1)
}

/** Fluxo só por teclado até a rota aparecer. */
export async function escolherPorTeclado(page: Page) {
  await page.getByRole('combobox', { name: 'Origem' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue(A.rotulo)
  await page.getByRole('combobox', { name: 'Destino' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Destino' })).toHaveValue(B.rotulo)
}
```

`frontend/e2e/rota.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { alvosDe44, B, escolherPorTeclado, focoNaoCaiu, json, ROTA, semRolagemHorizontal, semViolacoes, simular, umaRegiaoViva } from './apoio'

for (const esquema of ['light', 'dark'] as const) {
  test.describe(`tema ${esquema}`, () => {
    test.use({ colorScheme: esquema })

    test('E1 e E2: fluxo só por teclado, axe em cada estado', async ({ page }) => {
      await simular(page)
      await page.goto('/rota')
      await semViolacoes(page, 'vazio')
      await umaRegiaoViva(page)

      await page.getByRole('combobox', { name: 'Origem' }).focus()
      await page.keyboard.type('rua')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('option').first()).toBeVisible()
      await semViolacoes(page, 'lista aberta')
      await page.keyboard.press('Escape')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')

      await page.keyboard.press('Tab') // Usar minha localização
      await page.getByRole('combobox', { name: 'Destino' }).focus()
      await page.keyboard.type('rua')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('option').first()).toBeVisible()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Calcular rota' }).focus()
      await page.keyboard.press('Enter')
      const titulo = page.getByRole('heading', { level: 2, name: /Rota encontrada/ })
      await expect(titulo).toBeFocused()
      await expect(page.getByRole('list', { name: 'Os 3 passos da rota' }).getByRole('listitem')).toHaveCount(3)
      await semViolacoes(page, 'resultado')
      await umaRegiaoViva(page)
    })

    test('E7: mapa real em StrictMode, nada focável dentro do role=img', async ({ page }) => {
      await simular(page)
      await page.goto('/rota')
      await escolherPorTeclado(page)
      await page.getByRole('button', { name: 'Calcular rota' }).click()
      await page.getByRole('button', { name: 'Mostrar mapa' }).click()
      const mapa = page.getByRole('img', { name: /Mapa ilustrativo da rota/ })
      await expect(mapa).toBeVisible()
      await expect(mapa.locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(0)
      await expect(mapa).not.toHaveAttribute('tabindex', '0')
      await expect(page.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible()
      await page.getByRole('button', { name: 'Ver o passo 2 no mapa' }).click()
      // a legenda diz o passo: ou a região anuncia, ou o foco vai a ela. Nunca os dois.
      const legenda = page.getByRole('list', { name: 'Mapa no passo 2' })
      await expect(legenda).toBeVisible()
      await focoNaoCaiu(page, 'ver o passo')
      await expect
        .poll(async () => (await legenda.evaluate((el) => el === document.activeElement)) !== ((await page.getByRole('status').textContent()) === 'Mapa no passo 2.'))
        .toBe(true)
      await page.getByRole('button', { name: 'Aproximar' }).click()
      await page.getByRole('button', { name: 'Rota inteira' }).click()
      await semViolacoes(page, 'mapa aberto')
      await umaRegiaoViva(page)
    })
  })
}

test.describe('reflow e alvos', () => {
  for (const [nome, viewport] of [
    ['celular de 320 px', { width: 320, height: 640 }],
    ['1280 a 400%', { width: 320, height: 256 }],
  ] as const) {
    test(`E3 e E4: ${nome}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await simular(page)
      await page.goto('/rota')
      await semRolagemHorizontal(page, 'vazio')
      await alvosDe44(page, 'vazio')
      await escolherPorTeclado(page)
      await semRolagemHorizontal(page, 'escolhido')
      await page.getByRole('button', { name: 'Calcular rota' }).click()
      await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
      await semRolagemHorizontal(page, 'resultado')
      await alvosDe44(page, 'resultado')
      await page.getByRole('button', { name: 'Mostrar mapa' }).click()
      await expect(page.getByRole('img', { name: /Mapa ilustrativo/ })).toBeVisible()
      await semRolagemHorizontal(page, 'mapa')
      await alvosDe44(page, 'mapa')
    })
  }
})

test('E3: Enter no campo a 320 por 256 traz o resultado à vista', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 })
  await simular(page)
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await expect(page.getByRole('combobox', { name: 'Destino' })).toBeFocused()
  await page.keyboard.press('Enter')
  const titulo = page.getByRole('heading', { level: 2, name: /Rota encontrada/ })
  await expect(titulo).toBeFocused()
  await expect(titulo).toBeInViewport()
})

test('recarregar depois de trocar o destino avisa, e a ficha segue com a rota antiga', async ({ page }) => {
  await simular(page)
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
  await page.getByRole('combobox', { name: 'Destino' }).fill('rua')
  await expect(page.getByRole('heading', { level: 2, name: /Rota da busca anterior/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Esta rota é da busca anterior.')
  await page.reload()
  await expect(page.getByText('Esta rota é da busca anterior. Calcule de novo.')).toBeVisible()
  await expect(page.locator('.ficha__dados')).toContainText(B.rotulo)
})

test.describe('geolocalização', () => {
  test.use({ geolocation: { latitude: -23.5901, longitude: -46.6352, accuracy: 20 }, permissions: ['geolocation'] })

  test('E5: concedida preenche a origem e anuncia', async ({ page }) => {
    await simular(page)
    await page.goto('/rota')
    await page.getByRole('button', { name: 'Usar minha localização' }).click()
    await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue(/Rua Helen Keller/)
    await expect(page.getByRole('status')).toContainText('Confira se é onde você está.')
  })

  test('E5: fora da área mostra o texto do backend', async ({ page }) => {
    await simular(page, {
      'GET /api/geocode/reverso': (r) => json(r, { detail: 'Este ponto está fora da área atendida pelo Rota Falada SP.' }, 404),
    })
    await page.goto('/rota')
    await page.getByRole('button', { name: 'Usar minha localização' }).click()
    await expect(page.getByText('Este ponto está fora da área atendida pelo Rota Falada SP. Digite o endereço.')).toBeVisible()
  })
})

test('E5: localização negada orienta a digitar', async ({ page, context }) => {
  await context.clearPermissions()
  await simular(page)
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, erro) => erro?.({ code: 1 } as GeolocationPositionError)
  })
  await page.goto('/rota')
  await page.getByRole('button', { name: 'Usar minha localização' }).click()
  await expect(page.getByText(/não autorizou a localização/)).toBeVisible()
})

test('E6: servidor dormindo: aviso aparece com a espera, um anúncio, e a rota sai', async ({ page }) => {
  let acordado = false
  await simular(page, {
    'GET /health': async (r) => {
      if (acordado) return json(r, { status: 'ok', banco: 'ok' })
      await new Promise((f) => setTimeout(f, 6000))
      acordado = true
      return r.fulfill({ status: 502, contentType: 'text/html', body: '<html>' })
    },
  })
  await page.goto('/rota')
  await page.getByRole('combobox', { name: 'Origem' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.locator('#origem-retorno')).toContainText('leva cerca de 1 minuto', { timeout: 15_000 })
  await expect(page.getByRole('status')).toContainText('leva cerca de 1 minuto')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 20_000 })
  await umaRegiaoViva(page)
})

test('fim a fim: 404 e 503 falam a verdade', async ({ page }) => {
  let vez = 0
  await simular(page, {
    'POST /api/rotas': (r) =>
      ++vez === 1
        ? json(r, { detail: 'Não encontramos rota acessível entre esses pontos.' }, 404)
        : vez === 2
          ? json(r, { detail: 'Não encontramos rota acessível entre esses pontos.' }, 503)
          : json(r, ROTA),
  })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Não encontramos rota' })).toBeFocused()
  await semViolacoes(page, 'sem rota')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Não foi possível calcular agora' })).toBeFocused()
  await expect(page.getByText(/Isso não quer dizer que a rota não existe/)).toBeVisible()
  await semViolacoes(page, 'indisponível')
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeFocused()
})
```

`frontend/e2e/csp.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { escolherPorTeclado, simular } from './apoio'

/**
 * O `vite preview` não lê public/_headers. Aqui a política de verdade é aplicada ao documento,
 * trocando só os hosts de produção pelos simulados, para ver se Leaflet e o resto convivem com ela.
 */
function politica(): string {
  const linha = readFileSync('public/_headers', 'utf-8')
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy'))!
  return linha
    .replace('Content-Security-Policy:', '')
    .trim()
    .replace('https://rota-falada-api.onrender.com', 'http://localhost:8000')
    .replaceAll('https://fiyuppcpbcdlnptqaigg.supabase.co', 'https://teste.supabase.co')
}

test('a CSP não bloqueia /rota nem o mapa', async ({ page }) => {
  const bloqueios: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) bloqueios.push(m.text())
  })
  await simular(page)
  await page.route('http://localhost:4173/rota', async (route) => {
    const resposta = await route.fetch()
    await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'content-security-policy': politica() } })
  })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await page.getByRole('button', { name: 'Mostrar mapa' }).click()
  await expect(page.getByRole('img', { name: /Mapa ilustrativo/ })).toBeVisible()
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached()
  expect(bloqueios).toEqual([])
})
```

- [ ] **Step 3: Rodar e ver o CSP falhar**

Run: `npx playwright test e2e/csp.spec.ts`
Expected: FAIL (`ENOENT ... public/_headers`).

- [ ] **Step 4: Criar os cabeçalhos e os scripts**

Crie `frontend/public/_headers` com a ferramenta de escrita de arquivos (o PowerShell deste ambiente bloqueia o texto da primeira linha). O arquivo é copiado para `dist/`, e `wrangler.jsonc` não muda. O host do Supabase é público e já está em `render.yaml`.

`frontend/public/_headers`:

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://fiyuppcpbcdlnptqaigg.supabase.co; connect-src 'self' https://rota-falada-api.onrender.com https://fiyuppcpbcdlnptqaigg.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: geolocation=(self)
```

`frontend/scripts/orcamento-bundle.mjs`:

```js
// Compara o gzip de cada chunk de dist/assets com o teto do spec (seção de bundle). Rodar depois do build.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KB = 1024
// os nomes dos chunks compartilhados mudam com o build; o teto vale por arquivo
const TETO_ENTRADA = 95 * KB
const TETO_CHUNK = 50 * KB

const pasta = join('dist', 'assets')
let falhou = false
for (const arquivo of readdirSync(pasta).filter((a) => a.endsWith('.js'))) {
  const tamanho = gzipSync(readFileSync(join(pasta, arquivo))).length
  const excedeu = tamanho > (arquivo.startsWith('index-') ? TETO_ENTRADA : TETO_CHUNK)
  if (excedeu) falhou = true
  console.log(`${excedeu ? 'EXCEDEU' : 'ok'}\t${(tamanho / KB).toFixed(1)} KB\t${arquivo}`)
}
// o Leaflet nunca pode vazar para a entrada
const entrada = readdirSync(pasta).find((a) => a.startsWith('index-') && a.endsWith('.js'))
if (entrada && readFileSync(join(pasta, entrada), 'utf-8').includes('leaflet-container')) {
  console.log('EXCEDEU\tLeaflet no chunk de entrada')
  falhou = true
}
process.exit(falhou ? 1 : 0)
```

`frontend/scripts/gate-lighthouse.mjs`:

```js
// Gate: Lighthouse de acessibilidade >= 95 em cada página. Precisa do `npm run preview` no ar.
// Lighthouse só vê o estado inicial; os outros estados são do axe, nos testes e2e/.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const PAGINAS = (process.env.PAGINAS ?? '/,/rota,/fontes,/acessibilidade,/barreiras,/barreiras/nova,/entrar').split(',')
const META = 95
const SAIDA = 'lighthouse-saida.json'

let falhou = false
for (const pagina of PAGINAS) {
  execFileSync(
    'npx',
    [
      '--yes',
      'lighthouse@12.8.2',
      `${BASE}${pagina}`,
      '--only-categories=accessibility',
      '--output=json',
      `--output-path=${SAIDA}`,
      '--quiet',
      '--chrome-flags=--headless=new',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  )
  const nota = Math.round(JSON.parse(readFileSync(SAIDA, 'utf-8')).categories.accessibility.score * 100)
  if (nota < META) falhou = true
  console.log(`${nota < META ? 'ABAIXO' : 'ok'}\t${nota}\t${pagina}`)
}
rmSync(SAIDA, { force: true })
process.exit(falhou ? 1 : 0)
```

- [ ] **Step 5: Rodar tudo**

Run: `npx tsc -p tsconfig.e2e.json ; npx playwright test`
Expected: sem erros de tipo; 14 cenários passando.

Run: `npm run build ; npm run orcamento`
Expected: código de saída 0, com a entrada em torno de 88 KB em gzip neste ponto (cai para cerca de 76 KB no fim do Bloco B, quando parte do código compartilhado vira chunk próprio) e nenhuma linha `EXCEDEU`.

Em outro terminal, `npm run preview -- --port 4173 --strictPort`. Depois:

Run (PowerShell): `$env:PAGINAS='/,/rota,/fontes,/acessibilidade'; node scripts/gate-lighthouse.mjs`
Expected: `ok` com nota de pelo menos 95 em cada página (100 no protótipo).

- [ ] **Step 6: Levar para o CI**

Em `.github/workflows/ci.yml`, no job `frontend`, depois de `- run: npm run build`, acrescente:

```yaml
      - run: npm run orcamento
```

E acrescente um job novo, depois de `frontend`:

```yaml
  frontend-e2e:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    env:
      CI: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx tsc -p tsconfig.e2e.json
      - run: npx playwright test
```

- [ ] **Step 7: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 22 arquivos, 164 testes passando. O Vitest não coleta nada de `e2e/`.

---

### Task 11: Gate do Plano 5

**Files:**
- Modify: `DESIGN.md`, `PRODUCT.md`

Nenhum código. Esta task é de pessoa: o agente roda o automático e entrega a matriz manual ao dono.

- [ ] **Step 1: Automático**

Run: `npx tsc -b ; npm run lint ; npx vitest --run ; npx playwright test`
Expected: tudo verde, 164 testes e 14 cenários.

- [ ] **Step 2: Manual, com NVDA em Firefox e em Chrome**

Com o backend local (`USE_FIXTURES`) e `npm run dev`, só por teclado:
1. Tab até Origem, digite "rua", pare: o NVDA lê "N endereços para Origem. Seta para baixo para escolher.", sem competir com o eco.
2. Seta baixo lê cada opção; Enter escolhe e lê "Origem: …".
3. Repita em Destino. Calcular rota: lê "Calculando a rota.", depois o foco vai ao h2 e lê o resumo uma só vez. Repita enviando com Enter no campo Destino: o foco vai igual ao h2.
4. Saia do botão durante um cálculo lento (acrescente atraso com as ferramentas do navegador): o foco fica, e a região lê o resumo. Com mais de 15 s, lê "Ainda calculando; o serviço de rotas está lento."
5. Abra o mapa: lê "Abrindo o mapa." e "Mapa aberto."; o mapa é lido como imagem com a descrição. "Ver o passo 2 no mapa" lê "Mapa no passo 2.", ou, com a legenda fora da vista, leva o foco a ela e ela diz o passo: confirme que nunca fala os dois. Pressione de novo: fala de novo.
6. Ouvir a rota: a região lê só o estado, nunca o texto do passo.
7. Zoom de 400% real: nada de rolagem horizontal, foco sempre visível.
8. Com a rota na tela, mude o Destino: lê uma vez "Esta rota é da busca anterior. Calcule de novo.", e o h2 passa a ser "Rota da busca anterior". Recarregue a aba: o aviso continua, sem ser falado, e a ficha mostra os endereços da rota antiga.
9. Enter em Destino igual à Origem: lê o erro pela região. Enter em "Calcular rota" sem escolha: o foco vai ao campo, e o NVDA lê o erro na descrição **uma só vez**. Confira em especial este caso: o código usa `flushSync` para o erro estar no DOM antes do foco, e isso só se confirma com o NVDA real.
10. "Usar minha localização": lê "Buscando sua localização." Digite durante a espera: o GPS que chega depois não sobrescreve.

Registre em `DESIGN.md`, seção "Registro da entrega", a data, as versões e o resultado de cada item. **Não marque o gate como cumprido sem essa rodada.**

- [ ] **Step 3: Rodar contra o backend real**

Com Docker e `USE_FIXTURES=true`, faça o fluxo no navegador e confira que nenhuma resposta real quebra um tipo.

- [ ] **Step 4: Documentação**

Em `DESIGN.md`, na seção Components, acrescente depois de "Tabela gravada de passos":

```markdown
### Autocomplete de endereço
Combobox editável com lista em fluxo, nunca flutuante: empurra o conteúdo e resolve 320 px e zoom de 400%. Opção de 48 px sobre vão, junta de 1 px; ativa com contorno de 2 px em óxido e o pictograma `siga` como segundo sinal.

### Mapa
Só por botão, em `figure` com junta de 1 px. Casing em laje 8 px, linha em tinta 4 px; passo ativo em óxido 6 px, com o número na legenda como segundo sinal. Tiles em cinza por filtro. Marcador `DivIcon` com pictograma, contorno de 2 px em tinta. Nada focável dentro do `role="img"`; a atribuição fica numa `figcaption` sobreposta, fora dele. Nenhuma animação. "Ver o passo N no mapa" usa `aria-current`, com o mesmo sinal da placa pressionada: pressionar de novo não desliga, enquadra e fala de novo.

### Resultado da rota
Depois do formulário, em largura total: h2 com o resumo, ficha solta (nunca fixa em /rota) e mapa lado a lado a partir de 1024 px, tabela gravada em largura total abaixo.
```

Em `DESIGN.md`, nas pendências abertas, remova o trecho sobre `Fontes.tsx` manter `role="alert"` e `role="status"`.

Em `PRODUCT.md`, na seção "Ainda não existe", remova a linha do Plano 5, com a menção a Photon. Em "Existe hoje", acrescente:

```markdown
- Tela `/rota` real: autocomplete local (`GET /api/geocode`), minha localização, lista de passos canônica, região viva única e mapa redundante por botão.
```

---

# Bloco B — Plano 6: login, colaboração e moderação

### Task 12: Backend: `GET /api/eu`

**Files:**
- Create: `backend/tests/test_eu_api.py`
- Modify: `backend/app/schemas/barreira.py`, `backend/app/routers/barreiras.py`

**Interfaces:**
- Consumes: `usuario_atual` (`Usuario` em `routers/barreiras.py`), fixtures `cliente_api`, `emitir_token`, `criar_usuario`.
- Produces: `EuOut(papel)`; `GET /api/eu` → 200 `{"papel": ...}`, 401, 503.

- [ ] **Step 1: Escrever o teste**

`backend/tests/test_eu_api.py`:

```python
"""`GET /api/eu`: só o papel, para o frontend mostrar o painel de moderação."""

import uuid

import pytest

from app.auth import MSG_LOGIN, MSG_LOGIN_INDISPONIVEL, obter_config_auth

pytestmark = pytest.mark.integration


def _auth(emitir_token, sub, **extras) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub, **extras)}"}


def test_sem_token_e_401(cliente_api):
    resposta = cliente_api.get("/api/eu")
    assert resposta.status_code == 401
    assert resposta.json()["detail"] == MSG_LOGIN


def test_token_anonimo_e_401(cliente_api, emitir_token):
    resposta = cliente_api.get(
        "/api/eu", headers=_auth(emitir_token, uuid.uuid4(), extra={"is_anonymous": True})
    )
    assert resposta.status_code == 401


@pytest.mark.parametrize("papel", ["colaborador", "admin"])
def test_devolve_so_o_papel(cliente_api, emitir_token, criar_usuario, papel):
    usuario = criar_usuario(papel)
    resposta = cliente_api.get("/api/eu", headers=_auth(emitir_token, usuario.id))
    assert resposta.status_code == 200
    # nem id nem e-mail: o Supabase já os fornece ao próprio dono
    assert resposta.json() == {"papel": papel}


def test_sem_login_configurado_e_503(cliente_api, emitir_token):
    cliente_api.app.dependency_overrides[obter_config_auth] = lambda: None
    resposta = cliente_api.get("/api/eu", headers=_auth(emitir_token, uuid.uuid4()))
    assert resposta.status_code == 503
    assert resposta.json()["detail"] == MSG_LOGIN_INDISPONIVEL
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `backend/`, com o Docker aberto): `.venv/Scripts/python.exe -m pytest tests/test_eu_api.py -v`
Expected: FAIL (404 em `/api/eu`).

- [ ] **Step 3: Implementar**

Em `backend/app/schemas/barreira.py`, depois de `StatusAdminIn`:

```python
class EuOut(BaseModel):
    """Só o papel: id e e-mail a pessoa já tem pelo Supabase, e não voltam aqui."""

    papel: Literal["colaborador", "admin"]
```

Em `backend/app/routers/barreiras.py`, troque o import do schema e acrescente a rota antes de `listar`:

```python
from app.schemas.barreira import BarreiraIn, BarreiraOut, EuOut, VotoIn
```

```python
@router.get("/eu", response_model=EuOut)
def eu(usuario: Usuario) -> EuOut:
    return EuOut(papel=usuario.papel)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_eu_api.py -v`
Expected: PASS, 5 testes.

- [ ] **Step 5: Verificação**

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: sem erros.

---

### Task 13: Backend: fila e ficha do admin

**Files:**
- Create: `backend/tests/test_admin_fila_api.py`
- Modify: `backend/app/services/barreiras.py`, `backend/app/routers/admin.py`

**Interfaces:**
- Consumes: `_SELECT_FICHA`, `_ficha`, `obter(..., incluir_removida=True)`, `expressao_status_efetivo`, `Admin`, `Db`, `Agora`, `transacao`.
- Produces: `listar_fila(db, agora, status, limite, antes_de)`; `GET /api/admin/barreiras?status=&limite=50&antes_de=` → `list[BarreiraOut]`, id decrescente; `GET /api/admin/barreiras/{id}` → `BarreiraOut`, inclusive removida.

- [ ] **Step 1: Escrever o teste**

`backend/tests/test_admin_fila_api.py`:

```python
"""Fila de moderação: `GET /api/admin/barreiras` e `GET /api/admin/barreiras/{id}`."""

import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.integration

LON, LAT = -46.6350, -23.5900
CAMPOS_PUBLICOS = {
    "id",
    "categoria",
    "severidade",
    "status",
    "votos",
    "descricao",
    "lat",
    "lon",
    "criada_em",
    "ultima_confirmacao_em",
    "foto_url",
    "foto_descricao",
}


def _auth(emitir_token, sub) -> dict[str, str]:
    return {"Authorization": f"Bearer {emitir_token(sub)}"}


@pytest.fixture
def admin(emitir_token, criar_usuario):
    return _auth(emitir_token, criar_usuario("admin").id)


@pytest.fixture
def criar(cliente_api, emitir_token):
    def _criar() -> dict:
        resposta = cliente_api.post(
            "/api/barreiras",
            json={
                "categoria": "escada",
                "lat": LAT,
                "lon": LON,
                "chave_idempotencia": str(uuid.uuid4()),
            },
            headers=_auth(emitir_token, uuid.uuid4()),
        )
        assert resposta.status_code == 201
        return resposta.json()

    return _criar


def _ids(resposta) -> list[int]:
    assert resposta.status_code == 200
    return [b["id"] for b in resposta.json()]


def test_fila_exige_admin(cliente_api, emitir_token, criar_usuario):
    assert cliente_api.get("/api/admin/barreiras").status_code == 401
    comum = _auth(emitir_token, criar_usuario().id)
    assert cliente_api.get("/api/admin/barreiras", headers=comum).status_code == 403


def test_fila_acha_removida_que_o_publico_nao_lista(cliente_api, admin, criar):
    barreira = criar()
    mudou = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "removida", "motivo": "Denúncia de vandalismo"},
        headers=admin,
    )
    assert mudou.status_code == 200
    publica = cliente_api.get("/api/barreiras", params={"lat": LAT, "lon": LON})
    assert barreira["id"] not in _ids(publica)
    fila = cliente_api.get("/api/admin/barreiras", params={"status": "removida"}, headers=admin)
    assert barreira["id"] in _ids(fila)
    pendentes = cliente_api.get(
        "/api/admin/barreiras", params={"status": "pendente"}, headers=admin
    )
    assert barreira["id"] not in _ids(pendentes)


def test_fila_compara_com_o_status_efetivo(cliente_api, admin, criar, db_transacional):
    barreira = criar()
    db_transacional.execute(
        text(
            "UPDATE barreira_colaborativa SET criado_em = now() - interval '31 days' WHERE id = :id"
        ),
        {"id": barreira["id"]},
    )
    expiradas = cliente_api.get(
        "/api/admin/barreiras", params={"status": "expirada"}, headers=admin
    )
    assert barreira["id"] in _ids(expiradas)
    pendentes = cliente_api.get(
        "/api/admin/barreiras", params={"status": "pendente"}, headers=admin
    )
    assert barreira["id"] not in _ids(pendentes)


def test_fila_ordena_limita_e_pagina_por_chave(cliente_api, admin, criar):
    a, b, c = criar()["id"], criar()["id"], criar()["id"]
    pagina = cliente_api.get("/api/admin/barreiras", params={"limite": 2}, headers=admin)
    assert _ids(pagina) == [c, b]
    resto = cliente_api.get(
        "/api/admin/barreiras", params={"limite": 2, "antes_de": b}, headers=admin
    )
    assert _ids(resto)[0] == a


def test_fila_devolve_a_ficha_publica_sem_autor(cliente_api, admin, criar):
    criar()
    resposta = cliente_api.get("/api/admin/barreiras", params={"limite": 1}, headers=admin)
    assert set(resposta.json()[0]) == CAMPOS_PUBLICOS


@pytest.mark.parametrize("parametros", [{"status": "inexistente"}, {"limite": 0}, {"limite": 101}])
def test_fila_recusa_parametro_invalido(cliente_api, admin, parametros):
    resposta = cliente_api.get("/api/admin/barreiras", params=parametros, headers=admin)
    assert resposta.status_code == 422


def test_ficha_admin_abre_removida(cliente_api, admin, emitir_token, criar_usuario, criar):
    barreira = criar()
    url = f"/api/admin/barreiras/{barreira['id']}"
    cliente_api.post(f"{url}/status", json={"status": "removida", "motivo": "Falsa"}, headers=admin)
    assert cliente_api.get(f"/api/barreiras/{barreira['id']}").status_code == 404
    assert cliente_api.get(url).status_code == 401
    comum = _auth(emitir_token, criar_usuario().id)
    assert cliente_api.get(url, headers=comum).status_code == 403
    aberta = cliente_api.get(url, headers=admin)
    assert aberta.status_code == 200
    assert aberta.json()["status"] == "removida"
    assert cliente_api.get("/api/admin/barreiras/999999999", headers=admin).status_code == 404
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_fila_api.py -v`
Expected: FAIL (405 ou 404 em `GET /api/admin/barreiras`).

- [ ] **Step 3: Implementar**

Em `backend/app/services/barreiras.py`, antes de `_SQL_POR_CHAVE`. O `CAST` importa porque o psycopg 3 não infere o tipo de `:x IS NULL`:

```python
# fila de moderação: compara com o status EFETIVO, inclusive `removida`
_SQL_FILA = text(
    _SELECT_FICHA
    + f"""
    WHERE (CAST(:status AS text) IS NULL
           OR {expressao_status_efetivo("b", ":agora")} = CAST(:status AS text))
      AND (CAST(:antes_de AS bigint) IS NULL OR b.id < CAST(:antes_de AS bigint))
    GROUP BY b.id
    ORDER BY b.id DESC
    LIMIT :limite
    """
)
```

No mesmo arquivo, antes de `criar`:

```python
def listar_fila(
    db: Session, agora: datetime, status: str | None, limite: int, antes_de: int | None
) -> list[BarreiraOut]:
    parametros = {"agora": agora, "status": status, "limite": limite, "antes_de": antes_de}
    return [_ficha(linha) for linha in db.execute(_SQL_FILA, parametros).all()]
```

Em `backend/app/routers/admin.py`, troque os imports e acrescente as rotas antes de `mudar_status`:

```python
from fastapi import APIRouter, Depends, Query
```

```python
from app.schemas.barreira import BarreiraOut, EventoOut, StatusAdminIn, StatusBarreira
```

```python
@router.get("/barreiras", response_model=list[BarreiraOut])
def fila(
    db: Db,
    agora: Agora,
    admin: Admin,
    status: StatusBarreira | None = None,
    limite: Annotated[int, Query(ge=1, le=100)] = 50,
    antes_de: int | None = None,
) -> list[BarreiraOut]:
    with transacao(db):
        return barreiras.listar_fila(db, agora, status, limite, antes_de)


@router.get("/barreiras/{barreira_id}", response_model=BarreiraOut)
def obter(barreira_id: int, db: Db, agora: Agora, admin: Admin) -> BarreiraOut:
    with transacao(db):
        return barreiras.obter(db, barreira_id, agora, incluir_removida=True)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_fila_api.py -v`
Expected: PASS, 9 testes.

- [ ] **Step 5: Verificação**

Run: `.venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: sem erros.

---

### Task 14: Backend: admin valida e a rota muda; motivo em branco

**Files:**
- Modify: `backend/tests/test_admin_fila_api.py`, `backend/app/services/barreira_geom.py`, `backend/app/schemas/barreira.py`

**Interfaces:**
- Produces: `barreiras_no_corredor` passa a tratar como `intransponivel` toda colaborativa `validada` com essa severidade, com qualquer número de votos; `StatusAdminIn.motivo` recusa texto em branco.

- [ ] **Step 1: Escrever os testes**

Acrescente no fim de `backend/tests/test_admin_fila_api.py`:

```python
@pytest.mark.parametrize("motivo", ["    ", "  a ", ""])
def test_motivo_em_branco_e_recusado(cliente_api, admin, criar, motivo):
    barreira = criar()
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "validada", "motivo": motivo},
        headers=admin,
    )
    assert resposta.status_code == 422


def test_motivo_vai_sem_espacos_para_a_auditoria(cliente_api, admin, criar):
    barreira = criar()
    url = f"/api/admin/barreiras/{barreira['id']}"
    cliente_api.post(
        f"{url}/status", json={"status": "validada", "motivo": "  Vi no local  "}, headers=admin
    )
    eventos = cliente_api.get(f"{url}/eventos", headers=admin).json()
    assert eventos[-1]["detalhe"]["motivo"] == "Vi no local"


def test_admin_valida_com_zero_votos_e_entra_no_avoid_polygons(
    cliente_api, admin, criar, db_transacional
):
    """D3 do spec colaborativo: o admin decide na hora, e a rota muda."""
    from shapely.geometry import LineString

    from app.services.barreira_geom import barreiras_no_corredor, corredor, poligonos_para_evitar

    rota = LineString([(LON - 0.001, LAT), (LON + 0.001, LAT)])
    barreira = criar()

    def _nossa():
        return [
            b
            for b in barreiras_no_corredor(db_transacional, corredor(rota))
            if b.origem == "colaborativa" and b.id == barreira["id"]
        ]

    assert _nossa() == []
    resposta = cliente_api.post(
        f"/api/admin/barreiras/{barreira['id']}/status",
        json={"status": "validada", "motivo": "Vi no local"},
        headers=admin,
    )
    assert resposta.json()["votos"]["confirma"] == 0
    nossa = _nossa()
    assert [b.severidade for b in nossa] == ["intransponivel"]
    assert poligonos_para_evitar(nossa, rota) is not None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_fila_api.py -v -k "motivo or admin_valida"`
Expected: FAIL (motivo `"    "` e `"  a "` respondem 200; a barreira validada com zero votos não entra em `barreiras_no_corredor`).

- [ ] **Step 3: Implementar**

Em `backend/app/services/barreira_geom.py`, na `_SQL_CANDIDATOS`, troque a condição:

```sql
                WHEN status = 'validada' AND severidade = 'intransponivel'
```

E, na docstring do módulo, troque o trecho sobre a regra colaborativa:

```text
Regra de severidade efetiva (spec colaborativo, D3 e 6.2): uma barreira
colaborativa só bloqueia (`intransponivel`) se `validada`, seja pelos 2 votos
do limiar, seja por decisão do admin; uma oficial só bloqueia se a categoria for
```

`validada` já carrega o limiar: `decidir_status` só chega lá com 2 confirmações, e o outro caminho é a decisão do admin.

Em `backend/app/schemas/barreira.py`, troque os imports e o campo:

```python
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator
```

```python
class StatusAdminIn(BaseModel):
    status: StatusBarreira
    # o strip vem antes do tamanho: "   " não pode virar motivo vazio na auditoria
    motivo: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_fila_api.py tests/test_admin.py tests/test_barreiras_api.py tests/test_colaborativo_rota.py tests/services/test_barreira_geom_db.py tests/services/test_rota.py -v`
Expected: PASS; `test_admin_fila_api.py` com 14 testes. Os outros seguem verdes: as barreiras `validada` de `test_barreira_geom_db.py` e `test_rota.py` já têm 2 confirmações.

- [ ] **Step 5: Verificação**

Run: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: suíte do backend verde.

---

### Task 15: Tipos regenerados, API da colaboração e textos da barreira

**Files:**
- Regenerate: `frontend/src/api/types.gen.ts`
- Create: `frontend/src/api/colaboracao.ts`, `frontend/src/dados/barreira.ts`, `frontend/src/dados/rascunho.ts`, `frontend/src/test/barreira.test.ts`

**Interfaces:**
- Consumes: `pedir` com `token` e `aoStatus`; `components['schemas']['EuOut']` (novo); `distanciaM`; `Endereco`; `Categoria`.
- Produces: em `colaboracao.ts`, `Barreira`, `BarreiraIn`, `Voto`, `StatusBarreira`, `Evento`, `Eu`, `listarProximas`, `obterBarreira`, `obterEu`, `criarBarreira` (→ `{ barreira, nova }`), `votar`, `anexarFoto`, `removerFoto`, `listarFila`, `obterBarreiraAdmin`, `mudarStatus`, `listarEventos`; em `barreira.ts`, `SIGNIFICADO_STATUS`, `STATUS_TODOS`, `ROTULO_VOTO`, `AVISO_ROTA_RESERVA`, `textoStatus`, `votacaoEncerrada`, `textoEfeito`, `explicacaoVoto`, `textoVotos`, `formatarDataHora`, `formatarDia`, `distanciaDirecao`, `textoEvento`, `erroDoArquivo`, `erroDaDescricao`, `erroDoMotivo`; em `rascunho.ts`, `LocalEscolhido`, `Rascunho`, `RASCUNHO_VAZIO`, `AVISO_MEIO_DA_RUA`, `AVISO_NUMERO_APROXIMADO`, `NOTA_SEM_CONFIRMAR`, `ehFalhaDeConexao`, `localDeEndereco`, `lerRascunho`, `gravarRascunho`, `apagarRascunho`, `gerarUuid`, `comEdicao`, `comChave`, `lerMinhas`, `lembrarMinha`, `esquecerMinhas()` (de todas as contas, sem precisar saber qual).

- [ ] **Step 1: Regenerar os tipos**

Em `backend/`: `.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000` (o OpenAPI não toca o banco). Em `frontend/`: `npm run gerar-tipos`. Pare o servidor.
Expected: `types.gen.ts` passa a ter `EuOut` e `fila_api_admin_barreiras_get`.

- [ ] **Step 2: Escrever o teste**

`frontend/src/test/barreira.test.ts`:

```ts
import { criarBarreira } from '../api/colaboracao'
import {
  distanciaDirecao,
  erroDaDescricao,
  erroDoArquivo,
  erroDoMotivo,
  explicacaoVoto,
  formatarDataHora,
  textoEfeito,
  textoEvento,
  textoStatus,
  votacaoEncerrada,
} from '../dados/barreira'
import { CATEGORIAS } from '../dados/categorias'
import {
  apagarRascunho,
  AVISO_MEIO_DA_RUA,
  comChave,
  comEdicao,
  esquecerMinhas,
  gerarUuid,
  gravarRascunho,
  lembrarMinha,
  lerMinhas,
  lerRascunho,
  localDeEndereco,
} from '../dados/rascunho'
import { apiFalsa } from './apiFalsa'
import { endereco } from './fixturasRota'

const VOTOS = { confirma: 0, contesta: 0, resolvida: 0 }

afterEach(() => vi.unstubAllGlobals())

describe('textos da barreira', () => {
  it('as 10 categorias têm rótulo e dica', () => {
    expect(Object.keys(CATEGORIAS)).toHaveLength(10)
    for (const c of Object.values(CATEGORIAS)) {
      expect(c.rotulo).not.toBe('')
      expect(c.dica).not.toBe('')
    }
  })

  it.each([
    ['pendente', 'intransponivel', 'Ainda não muda a rota. Faltam 2 confirmações.'],
    ['pendente', 'dificulta', 'Ainda não muda a rota. Falta 1 confirmação.'],
    ['validada', 'intransponivel', 'A rota evita este ponto.'],
    ['validada', 'dificulta', 'A rota avisa, mas pode passar por aqui.'],
    ['validada', 'informativo', 'Não muda a rota.'],
    ['contestada', 'dificulta', 'Pessoas disseram que não existe. A rota não considera. Votação encerrada.'],
    ['resolvida', 'dificulta', 'Foi consertada, segundo quem votou. Votação encerrada.'],
    ['expirada', 'dificulta', 'Ninguém confirmou no prazo. A rota não considera. Votação encerrada.'],
  ] as const)('%s + %s diz o efeito', (status, severidade, texto) => {
    expect(textoEfeito({ status, severidade, votos: VOTOS })).toBe(texto)
  })

  it('status em texto e votação encerrada', () => {
    expect(textoStatus({ status: 'pendente', severidade: 'dificulta' })).toBe('Aguardando confirmação')
    expect(textoStatus({ status: 'validada', severidade: 'informativo' })).toBe('Informativa')
    expect(votacaoEncerrada({ status: 'validada' })).toBe(false)
    expect(votacaoEncerrada({ status: 'expirada' })).toBe(true)
  })

  it('o voto explica o efeito com o limiar da severidade', () => {
    expect(explicacaoVoto('confirma', { severidade: 'intransponivel' })).toContain('Com 2 confirmações, a rota passa a evitar')
    expect(explicacaoVoto('confirma', { severidade: 'dificulta' })).toContain('Com 1 confirmação, a rota passa a avisar')
    expect(explicacaoVoto('contesta', { severidade: 'dificulta' })).toContain('não existe')
  })

  it('barreira informativa nunca promete efeito na rota: ela nasce validada e fica fora dela', () => {
    expect(explicacaoVoto('confirma', { severidade: 'informativo' })).toBe('Eu vi: a barreira está lá. Isto é só informação: não muda a rota.')
    expect(explicacaoVoto('contesta', { severidade: 'informativo' })).not.toContain('sai das rotas')
    expect(explicacaoVoto('resolvida', { severidade: 'informativo' })).not.toContain('sai das rotas')
  })

  it('distância e direção, sem mapa', () => {
    expect(distanciaDirecao([-23.59, -46.635], { lat: -23.589, lon: -46.635 })).toBe('111 m a norte')
    expect(distanciaDirecao([-23.59, -46.635], { lat: -23.59, lon: -46.635 })).toBe('aqui')
  })

  it('data com hora usa o fuso de São Paulo: 23h30 não vira o dia seguinte', () => {
    expect(formatarDataHora('2026-11-06T02:30:00+00:00')).toBe('05/11/2026, 23:30')
  })

  it('a auditoria é texto determinístico, com a conta abreviada e sem e-mail', () => {
    const base = { id: 1, barreira_id: 1, de_status: null, para_status: null, detalhe: {}, criado_em: '2026-11-06T02:30:00+00:00' }
    const conta = '3f2a91b0-1111-2222-3333-444455556666'
    expect(textoEvento({ ...base, tipo: 'criada', usuario_id: conta, para_status: 'pendente' })).toBe('05/11/2026, 23:30: criada por conta 3f2a91b0, status pendente.')
    expect(textoEvento({ ...base, tipo: 'voto', usuario_id: conta, detalhe: { voto: 'confirma', anterior: 'contesta' } })).toContain('voto confirma (antes: contesta)')
    expect(textoEvento({ ...base, tipo: 'status', usuario_id: null, de_status: 'pendente', para_status: 'expirada', detalhe: { motivo: 'prazo' } })).toContain('de pendente para expirada por prazo, sistema')
    expect(textoEvento({ ...base, tipo: 'admin', usuario_id: conta, de_status: 'pendente', para_status: 'validada', detalhe: { motivo: 'Vi no local' } })).toContain('decisão da moderação, de pendente para validada. Motivo: Vi no local.')
    expect(textoEvento({ ...base, tipo: 'foto', usuario_id: conta })).toContain('foto alterada')
  })

  it('valida foto e motivo antes de gastar o envio', () => {
    expect(erroDoArquivo(new File(['x'], 'a.gif', { type: 'image/gif' }))).toContain('JPEG, PNG ou WebP')
    expect(erroDoArquivo(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.jpg', { type: 'image/jpeg' }))).toContain('5 MB')
    expect(erroDoArquivo(new File(['x'], 'a.webp', { type: 'image/webp' }))).toBeNull()
    expect(erroDaDescricao('    ')).not.toBeNull()
    expect(erroDaDescricao('Escada de três degraus')).toBeNull()
    expect(erroDoMotivo('  a  ')).not.toBeNull()
    expect(erroDoMotivo('Vi no local')).toBeNull()
  })
})

describe('rascunho e idempotência', () => {
  it('a chave é estável na repetição e nova depois de editar', () => {
    const com = comChave({ descricao: '' })
    expect(comChave(com).chave).toBe(com.chave)
    expect(comEdicao(com, { descricao: 'x' }).chave).toBeUndefined()
    expect(comChave(comEdicao(com, { descricao: 'x' })).chave).not.toBe(com.chave)
  })

  it('o rascunho sobrevive à recarga da aba e sai ao apagar', () => {
    gravarRascunho({ descricao: 'buraco fundo', chave: 'c1' })
    expect(lerRascunho()).toEqual({ descricao: 'buraco fundo', chave: 'c1' })
    apagarRascunho()
    expect(lerRascunho()).toEqual({ descricao: '' })
  })

  it('uuid no formato v4, mesmo sem randomUUID', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(gerarUuid()).toMatch(v4)
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    expect(gerarUuid()).toMatch(v4)
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original })
  })

  it('logradouro avisa que o ponto é o meio da rua', () => {
    expect(localDeEndereco(endereco(1, 'Rua A', { tipo: 'logradouro' })).nota).toBe(AVISO_MEIO_DA_RUA)
    expect(localDeEndereco(endereco(1, 'Rua A, 1')).nota).toBeUndefined()
  })

  it('"minhas" é por conta e tudo sai ao sair, sem precisar saber a conta', () => {
    lembrarMinha('conta-a', 7)
    lembrarMinha('conta-a', 7)
    expect(lerMinhas('conta-a')).toEqual([7])
    expect(lerMinhas('conta-b')).toEqual([])
    localStorage.setItem('rf-sessao', 'fica')
    esquecerMinhas()
    expect(lerMinhas('conta-a')).toEqual([])
    expect(localStorage.getItem('rf-sessao')).toBe('fica')
  })

  it('201 é nova e 200 já existia', async () => {
    const entrada = { categoria: 'escada' as const, lat: 0, lon: 0, chave_idempotencia: 'c' }
    apiFalsa({ 'POST /api/barreiras': Response.json({ id: 1 }, { status: 201 }) })
    expect(await criarBarreira('t', entrada)).toMatchObject({ nova: true })
    apiFalsa({ 'POST /api/barreiras': Response.json({ id: 1 }, { status: 200 }) })
    expect(await criarBarreira('t', entrada)).toMatchObject({ nova: false })
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest --run src/test/barreira.test.ts`
Expected: FAIL (`Failed to resolve import "../api/colaboracao"`).

- [ ] **Step 4: Implementar**

`frontend/src/api/colaboracao.ts`:

```ts
import type { components } from './types.gen'
import { pedir } from './http'

export type Barreira = components['schemas']['BarreiraOut']
export type BarreiraIn = components['schemas']['BarreiraIn']
export type Voto = components['schemas']['VotoIn']['voto']
export type StatusBarreira = components['schemas']['BarreiraOut']['status']
export type Evento = components['schemas']['EventoOut']
export type Eu = components['schemas']['EuOut']

const TEMPO_FOTO_MS = 60_000

/** Único módulo que anexa token. As leituras públicas seguem sem ele. */
export function listarProximas(lat: number, lon: number, raio_m: number, sinal?: AbortSignal): Promise<Barreira[]> {
  return pedir('/api/barreiras', { consulta: { lat, lon, raio_m }, sinal })
}

export function obterBarreira(id: number, sinal?: AbortSignal): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}`, { sinal })
}

export function obterEu(token: string): Promise<Eu> {
  return pedir('/api/eu', { token })
}

/** 201 é nova; 200 é a mesma chave de idempotência, já registrada. */
export async function criarBarreira(token: string, entrada: BarreiraIn): Promise<{ barreira: Barreira; nova: boolean }> {
  let nova = true
  const barreira = await pedir<Barreira>('/api/barreiras', {
    metodo: 'POST',
    corpo: entrada,
    token,
    aoStatus: (status) => {
      nova = status === 201
    },
  })
  return { barreira, nova }
}

export function votar(token: string, id: number, voto: Voto): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}/voto`, { metodo: 'PUT', corpo: { voto }, token })
}

export function anexarFoto(token: string, id: number, arquivo: File, descricao: string): Promise<Barreira> {
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  corpo.append('descricao', descricao)
  return pedir(`/api/barreiras/${id}/foto`, { metodo: 'POST', corpo, token, tempoMs: TEMPO_FOTO_MS })
}

export function removerFoto(token: string, id: number): Promise<Barreira> {
  return pedir(`/api/barreiras/${id}/foto`, { metodo: 'DELETE', token })
}

export function listarFila(
  token: string,
  filtros: { status?: StatusBarreira; limite?: number; antes_de?: number },
  sinal?: AbortSignal,
): Promise<Barreira[]> {
  return pedir('/api/admin/barreiras', { consulta: filtros, token, sinal })
}

export function obterBarreiraAdmin(token: string, id: number, sinal?: AbortSignal): Promise<Barreira> {
  return pedir(`/api/admin/barreiras/${id}`, { token, sinal })
}

export function mudarStatus(token: string, id: number, status: StatusBarreira, motivo: string): Promise<Barreira> {
  return pedir(`/api/admin/barreiras/${id}/status`, { metodo: 'POST', corpo: { status, motivo }, token })
}

export function listarEventos(token: string, id: number, sinal?: AbortSignal): Promise<Evento[]> {
  return pedir(`/api/admin/barreiras/${id}/eventos`, { token, sinal })
}
```

`frontend/src/dados/barreira.ts`:

```ts
import type { Barreira, Evento, StatusBarreira, Voto } from '../api/colaboracao'
import { distanciaM } from './rotaGeo'

/** Limiares de services/moderacao.py; o backend decide, a interface só explica. */
const LIMIAR: Record<Barreira['severidade'], number> = { intransponivel: 2, dificulta: 1, informativo: 0 }

const TEXTO_STATUS: Record<StatusBarreira, string> = {
  pendente: 'Aguardando confirmação',
  validada: 'Confirmada',
  contestada: 'Contestada',
  resolvida: 'Resolvida',
  expirada: 'Expirada',
  removida: 'Removida pela moderação',
}

export const SIGNIFICADO_STATUS: Record<StatusBarreira, string> = {
  pendente: 'Ainda não muda a rota.',
  validada: 'Passa a valer para as rotas, conforme a categoria.',
  contestada: 'Não existe, segundo a decisão. A rota não considera. Votação encerrada.',
  resolvida: 'Foi consertada. A rota não considera. Votação encerrada.',
  expirada: 'Venceu o prazo. A rota não considera. Votação encerrada.',
  removida: 'Some do público: é falsa, abusiva ou duplicada.',
}

export const STATUS_TODOS = Object.keys(TEXTO_STATUS) as StatusBarreira[]

export function textoStatus(b: Pick<Barreira, 'status' | 'severidade'>): string {
  return b.status === 'validada' && b.severidade === 'informativo' ? 'Informativa' : TEXTO_STATUS[b.status]
}

export function votacaoEncerrada(b: Pick<Barreira, 'status'>): boolean {
  return b.status === 'contestada' || b.status === 'resolvida' || b.status === 'expirada' || b.status === 'removida'
}

/** O que esta barreira faz com a rota, em texto: "evita" e "avisa", nunca uma promessa. */
export function textoEfeito(b: Pick<Barreira, 'status' | 'severidade' | 'votos'>): string {
  switch (b.status) {
    case 'pendente': {
      const falta = Math.max(1, LIMIAR[b.severidade] - b.votos.confirma)
      return `Ainda não muda a rota. ${falta === 1 ? 'Falta 1 confirmação' : `Faltam ${falta} confirmações`}.`
    }
    case 'validada':
      if (b.severidade === 'intransponivel') return 'A rota evita este ponto.'
      if (b.severidade === 'dificulta') return 'A rota avisa, mas pode passar por aqui.'
      return 'Não muda a rota.'
    case 'contestada':
      return 'Pessoas disseram que não existe. A rota não considera. Votação encerrada.'
    case 'resolvida':
      return 'Foi consertada, segundo quem votou. Votação encerrada.'
    case 'expirada':
      return 'Ninguém confirmou no prazo. A rota não considera. Votação encerrada.'
    case 'removida':
      return 'Removida pela moderação. Não aparece para o público.'
  }
}

/** O pgRouting usa só o custo gravado pelo ETL: a barreira registrada não muda a rota de reserva. */
export const AVISO_ROTA_RESERVA =
  'Exceção: a rota de reserva, usada quando o serviço principal cai, ainda não considera este registro. A ficha da rota diz quando é o caso.'

export function explicacaoVoto(voto: Voto, b: Pick<Barreira, 'severidade'>): string {
  // informativa nasce validada e nunca entra na rota: não há efeito a prometer
  const informativa = b.severidade === 'informativo'
  if (voto === 'confirma') {
    if (informativa) return 'Eu vi: a barreira está lá. Isto é só informação: não muda a rota.'
    const n = LIMIAR[b.severidade]
    const efeito = b.severidade === 'intransponivel' ? 'evitar este ponto' : 'avisar sobre este ponto'
    return `Eu vi: a barreira está lá. Com ${n} ${n === 1 ? 'confirmação' : 'confirmações'}, a rota passa a ${efeito}.`
  }
  const fim = informativa ? 'Com 2 votos, a votação encerra.' : 'Com 2 votos, ela sai das rotas e a votação encerra.'
  return voto === 'contesta' ? `Estive no lugar e essa barreira não existe. ${fim}` : `Existia e foi consertada. ${fim}`
}

export const ROTULO_VOTO: Record<Voto, string> = { confirma: 'Confirmo', contesta: 'Não existe', resolvida: 'Já resolvida' }

export function textoVotos(b: Pick<Barreira, 'votos'>): string {
  const { confirma, contesta, resolvida } = b.votos
  return `${confirma} ${confirma === 1 ? 'confirmação' : 'confirmações'}, ${contesta} ${contesta === 1 ? 'contestação' : 'contestações'}, ${resolvida} ${resolvida === 1 ? 'voto' : 'votos'} de resolvida`
}

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })

/** Com fuso: cortar a string mostraria o dia seguinte à noite. */
export function formatarDataHora(iso: string): string {
  return DATA_HORA.format(new Date(iso))
}

export function formatarDia(iso: string): string {
  return DATA.format(new Date(iso))
}

const RUMOS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste']

export function distanciaDirecao(origem: [number, number], b: Pick<Barreira, 'lat' | 'lon'>): string {
  const m = Math.round(distanciaM(origem, [b.lat, b.lon]))
  if (m < 5) return 'aqui'
  const dLat = b.lat - origem[0]
  const dLon = (b.lon - origem[1]) * Math.cos((origem[0] * Math.PI) / 180)
  const graus = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360
  return `${m} m a ${RUMOS[Math.round(graus / 45) % 8]}`
}

function autorDo(e: Evento): string {
  return e.usuario_id ? `conta ${e.usuario_id.slice(0, 8)}` : 'sistema'
}

/** A auditoria em texto determinístico; o e-mail nunca aparece (D9). */
export function textoEvento(e: Evento): string {
  const quando = formatarDataHora(e.criado_em)
  const quem = autorDo(e)
  const d = e.detalhe as { motivo?: unknown; voto?: unknown; anterior?: unknown; acao?: unknown }
  switch (e.tipo) {
    case 'criada':
      return `${quando}: criada por ${quem}, status ${e.para_status}.`
    case 'voto': {
      const troca = d.anterior ? ` (antes: ${String(d.anterior)})` : ''
      return `${quando}: voto ${String(d.voto)}${troca}, ${quem}.`
    }
    case 'status': {
      const prazo = d.motivo === 'prazo' ? ' por prazo' : ''
      return `${quando}: status de ${e.de_status} para ${e.para_status}${prazo}, ${quem}.`
    }
    case 'foto':
      return `${quando}: foto alterada, ${quem}.`
    case 'admin':
      return `${quando}: decisão da moderação, de ${e.de_status} para ${e.para_status}. Motivo: ${String(d.motivo)}. ${quem}.`
    default:
      return `${quando}: ${e.tipo}, ${quem}.`
  }
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES_FOTO = 5 * 1024 * 1024

/** Os limites de services/fotos.py, antes de gastar o envio. Os 40 megapixels ficam para o servidor. */
export function erroDoArquivo(arquivo: File): string | null {
  if (!TIPOS_FOTO.includes(arquivo.type)) return 'Use uma foto em JPEG, PNG ou WebP.'
  if (arquivo.size > MAX_BYTES_FOTO) return 'A foto passa de 5 MB. Escolha uma menor.'
  return null
}

export function erroDaDescricao(texto: string): string | null {
  const n = texto.trim().length
  return n < 5 || n > 300 ? 'Descreva a foto em 5 a 300 caracteres. Quem não enxerga a foto vai ouvir este texto.' : null
}

export function erroDoMotivo(motivo: string): string | null {
  const n = motivo.trim().length
  return n < 3 || n > 300 ? 'Escreva o motivo, de 3 a 300 caracteres. Ele fica na auditoria.' : null
}
```

`frontend/src/dados/rascunho.ts`:

```ts
import { ErroApi } from '../api/base'
import type { Endereco } from '../api/client'
import type { Categoria } from './categorias'

export type LocalEscolhido = {
  lat: number
  lon: number
  rotulo: string | null
  origem: 'gps' | 'busca' | 'mapa' | 'passo'
  /** Aviso a manter visível: meio da rua, número aproximado, GPS impreciso. */
  nota?: string
}

export type Rascunho = {
  categoria?: Categoria
  local?: LocalEscolhido
  descricao: string
  chave?: string
}

const CHAVE = 'rf-rascunho'

export const AVISO_MEIO_DA_RUA = 'O ponto fica perto do meio da rua. Se puder, digite o número ou marque no mapa.'
export const AVISO_NUMERO_APROXIMADO = 'Este é o número mais próximo que conhecemos, não o que você digitou. Confira.'

/** Sem conexão a coordenada continua valendo; a recusa de "fora da área" é só com resposta. */
export const NOTA_SEM_CONFIRMAR = 'Ponto guardado. Não conseguimos confirmar o endereço agora.'

export function ehFalhaDeConexao(erro: unknown): boolean {
  return erro instanceof ErroApi && (erro.tipo === 'rede' || erro.tipo === 'tempo' || erro.tipo === 'indisponivel')
}

export function localDeEndereco(e: Endereco): LocalEscolhido {
  const nota = e.tipo === 'logradouro' ? AVISO_MEIO_DA_RUA : e.aproximado ? AVISO_NUMERO_APROXIMADO : undefined
  return { lat: e.lat, lon: e.lon, rotulo: e.rotulo, origem: 'busca', nota }
}

export const RASCUNHO_VAZIO: Rascunho = { descricao: '' }

export function lerRascunho(): Rascunho {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    return bruto ? (JSON.parse(bruto) as Rascunho) : RASCUNHO_VAZIO
  } catch {
    return RASCUNHO_VAZIO
  }
}

export function gravarRascunho(rascunho: Rascunho): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(rascunho))
  } catch {
    // sem armazenamento, o rascunho fica só na memória da página
  }
}

export function apagarRascunho(): void {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // idem
  }
}

/** Sem contexto seguro, randomUUID não existe; getRandomValues sim. */
export function gerarUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Editar depois de uma falha gera chave nova: senão o servidor devolveria a barreira
 * antiga, ignorando a correção. O risco é uma duplicata, que a moderação resolve.
 */
export function comEdicao(rascunho: Rascunho, mudanca: Partial<Rascunho>): Rascunho {
  const novo = { ...rascunho, ...mudanca }
  delete novo.chave
  return novo
}

/** A mesma chave vale para repetição, sessão expirada e recarga da aba. */
export function comChave(rascunho: Rascunho): Rascunho & { chave: string } {
  return { ...rascunho, chave: rascunho.chave ?? gerarUuid() }
}

function chaveMinhas(conta: string) {
  return `rf:minhas:${conta}`
}

/** Ids criados neste navegador: só para oferecer a foto e poupar um 403. O servidor continua decidindo. */
export function lerMinhas(conta: string): number[] {
  try {
    const bruto = localStorage.getItem(chaveMinhas(conta))
    return bruto ? (JSON.parse(bruto) as number[]) : []
  } catch {
    return []
  }
}

export function lembrarMinha(conta: string, id: number): void {
  try {
    const atuais = lerMinhas(conta)
    if (!atuais.includes(id)) localStorage.setItem(chaveMinhas(conta), JSON.stringify([...atuais, id]))
  } catch {
    // é conveniência; sem isso o 403 ensina
  }
}

/** Ao sair, de todas as contas: não depende de saber qual, e o aparelho pode ser compartilhado. */
export function esquecerMinhas(): void {
  try {
    for (const chave of Object.keys(localStorage)) {
      if (chave.startsWith('rf:minhas:')) localStorage.removeItem(chave)
    }
  } catch {
    // idem
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest --run src/test/barreira.test.ts`
Expected: PASS, 22 testes.

- [ ] **Step 6: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 23 arquivos, 186 testes passando.

---

### Task 16: Sessão e login no código

**Files:**
- Create: `frontend/src/auth/config.ts`, `frontend/src/auth/cliente.ts`, `frontend/src/auth/erros.ts`, `frontend/src/auth/comSessao.ts`, `frontend/src/auth/useSessao.ts`, `frontend/src/auth/SessaoProvider.tsx`, `frontend/src/auth/LinkConta.tsx`, `frontend/src/auth/useAcaoComLogin.ts`, `frontend/src/test/auth.test.ts`, `frontend/src/test/authCliente.test.ts`
- Replace: `frontend/src/App.tsx`
- Modify: `frontend/package.json`, `frontend/src/vite-env.d.ts`

**Interfaces:**
- Consumes: `@supabase/auth-js` (`AuthClient`), `obterEu`, `ErroApi`, `ehCancelamento`, `esquecerMinhas`, `apagarRascunho`.
- Produces: `lerConfigAuth(ambiente?)`, `MSG_LOGIN_DESLIGADO`, `voltaSegura(valor)`; `CHAVE_SESSAO`, `TETO_AUTH_MS`, `temSessaoSalva()`, `enviarCodigo(email)`, `verificarCodigo(email, codigo)`, `obterToken()`, `renovarToken()`, `lerConta()`, `sair()`, com teto de tempo e sem guardar a falha do import; `comSessao(chamada)`, `ErroSessao`, `motivoDoLogin(erro)`, `MotivoLogin`, o único ciclo de token do front; `mensagemDeErroAuth(erro)`, `normalizarCodigo`, `erroDoCodigo`; `Sessao`, `Conta`, `Papel`, `useSessao()`; `SessaoProvider`; `LinkConta`; `useAcaoComLogin(acao, aoConcluir, montarArgs?)` → `{ estado, executar, concluirLogin, cancelarLogin, limparErro }`, em que `montarArgs` relê o formulário ao concluir o login, com `EstadoAcao = ocioso | enviando | login{motivo} | erro{erro}`.

- [ ] **Step 1: Instalar**

Run (em `frontend/`): `npm i --save-exact @supabase/auth-js@2.119.0`

- [ ] **Step 2: Escrever o teste**

`frontend/src/test/auth.test.ts`:

```ts
import { lerConfigAuth, voltaSegura } from '../auth/config'
import { ErroApi } from '../api/base'
import { erroDoCodigo, mensagemDeErroAuth, MSG_CODIGO_ERRADO, MSG_LIMITE, MSG_REDE_AUTH, MSG_TEMPO_AUTH, normalizarCodigo } from '../auth/erros'

describe('configuração do login', () => {
  it('sem variáveis, ou com chave que não é publishable, o login some', () => {
    expect(lerConfigAuth({})).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOi' })).toBeNull()
    expect(lerConfigAuth({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url: 'https://x.supabase.co',
      chave: 'sb_publishable_abc',
    })
  })

  it('volta só aceita caminho interno', () => {
    expect(voltaSegura('/barreiras/nova')).toBe('/barreiras/nova')
    expect(voltaSegura('//evil.example')).toBe('/conta')
    expect(voltaSegura('https://evil.example')).toBe('/conta')
    expect(voltaSegura(null)).toBe('/conta')
    expect(voltaSegura('/admin?status=removida')).toBe('/admin?status=removida')
    // o navegador normaliza estes para outra origem
    expect(voltaSegura('/' + String.fromCharCode(92) + 'evil.example')).toBe('/conta')
    expect(voltaSegura('/\t/evil.example')).toBe('/conta')
    expect(voltaSegura('/\n/evil.example')).toBe('/conta')
    expect(voltaSegura('javascript:alert(1)')).toBe('/conta')
  })
})

describe('código de 6 dígitos', () => {
  it('colar com espaço ou hífen funciona; zero à esquerda fica', () => {
    expect(normalizarCodigo(' 012 345 ')).toBe('012345')
    expect(normalizarCodigo('012-345')).toBe('012345')
    expect(erroDoCodigo('012345')).toBeNull()
  })

  it('diz quantos dígitos faltam', () => {
    expect(erroDoCodigo('1234')).toBe('O código tem 6 dígitos; você digitou 4.')
    expect(erroDoCodigo('12a456')).toBe('O código tem só números.')
  })

  it.each([
    ['otp_expired', MSG_CODIGO_ERRADO],
    ['over_email_send_rate_limit', MSG_LIMITE],
    ['over_request_rate_limit', MSG_LIMITE],
    ['email_address_not_authorized', 'Este e-mail ainda não pode receber código: o envio está em fase de teste.'],
    ['email_address_invalid', 'Confira o e-mail digitado.'],
    ['validation_failed', 'Confira o e-mail digitado.'],
    ['signup_disabled', 'O login está desligado no momento.'],
    ['otp_disabled', 'O login está desligado no momento.'],
    ['qualquer_outro', MSG_REDE_AUTH],
  ])('código %s tem mensagem própria', (code, texto) => {
    expect(mensagemDeErroAuth({ code })).toBe(texto)
  })

  it('erro já traduzido passa como está', () => {
    expect(mensagemDeErroAuth(new ErroApi('tempo', MSG_TEMPO_AUTH))).toBe(MSG_TEMPO_AUTH)
  })

  it('falha sem código é rede', () => {
    expect(mensagemDeErroAuth(new TypeError('x'))).toBe(MSG_REDE_AUTH)
  })
})
```

`frontend/src/test/authCliente.test.ts`:

```ts
import { MSG_ABRIR_LOGIN, MSG_REDE_AUTH, MSG_TEMPO_AUTH } from '../auth/erros'

type Sessao = { data: { session: unknown }; error: unknown }

const auth = vi.hoisted(() => ({
  falhar: 0,
  otp: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  verificar: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  sessao: vi.fn(async (): Promise<unknown> => ({ data: { session: null }, error: null })),
  renovar: vi.fn(async (): Promise<unknown> => ({ data: { session: null }, error: null })),
  sair: vi.fn(async () => ({ error: null })),
}))

vi.mock('@supabase/auth-js', () => ({
  AuthClient: class {
    constructor() {
      if (auth.falhar > 0) {
        auth.falhar -= 1
        throw new Error('chunk')
      }
    }
    signInWithOtp = auth.otp
    verifyOtp = auth.verificar
    getSession = auth.sessao
    refreshSession = auth.renovar
    signOut = auth.sair
  },
}))

const ERRO_RETENTAVEL = { name: 'AuthRetryableFetchError', message: 'rede' }

async function cliente() {
  vi.resetModules()
  return import('../auth/cliente')
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x')
  auth.falhar = 0
  auth.otp.mockReset().mockResolvedValue({ error: null })
  auth.sessao.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  auth.renovar.mockReset().mockResolvedValue({ data: { session: null }, error: null })
  auth.sair.mockReset().mockResolvedValue({ error: null })
  localStorage.setItem('rf-sessao', '{}')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('auth/cliente', () => {
  it('falha ao abrir a biblioteca não fica gravada: tentar de novo funciona', async () => {
    const c = await cliente()
    auth.falhar = 1
    await expect(c.enviarCodigo('p@e.org')).rejects.toMatchObject({ tipo: 'rede', message: MSG_ABRIR_LOGIN })
    await expect(c.enviarCodigo('p@e.org')).resolves.toBeUndefined()
    expect(auth.otp).toHaveBeenCalledTimes(1)
  })

  it('conexão travada no login tem teto, com mensagem própria', async () => {
    vi.useFakeTimers()
    auth.otp.mockImplementation(() => new Promise(() => {}))
    const c = await cliente()
    const envio = c.enviarCodigo('p@e.org').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(30_100)
    expect(await envio).toMatchObject({ tipo: 'tempo', message: MSG_TEMPO_AUTH })
  })

  it('refresh que falha por rede não vira "deslogado"', async () => {
    const retentavel: Sessao = { data: { session: null }, error: ERRO_RETENTAVEL }
    auth.sessao.mockResolvedValue(retentavel)
    auth.renovar.mockResolvedValue(retentavel)
    const c = await cliente()
    await expect(c.obterToken()).rejects.toMatchObject({ tipo: 'rede', message: MSG_REDE_AUTH })
    await expect(c.lerConta()).rejects.toMatchObject({ tipo: 'rede' })
    await expect(c.renovarToken()).rejects.toMatchObject({ tipo: 'rede' })
  })

  it('refresh recusado pelo servidor é fim de sessão, não falha de rede', async () => {
    auth.sessao.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', message: 'x' } })
    auth.renovar.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', message: 'x' } })
    const c = await cliente()
    await expect(c.obterToken()).resolves.toBeNull()
    await expect(c.lerConta()).resolves.toBeNull()
    await expect(c.renovarToken()).resolves.toBeNull()
  })

  it('sair funciona mesmo sem a biblioteca: a sessão sai deste aparelho', async () => {
    const c = await cliente()
    auth.falhar = 1
    await expect(c.sair()).resolves.toBeUndefined()
    expect(localStorage.getItem('rf-sessao')).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest --run src/test/auth.test.ts src/test/authCliente.test.ts`
Expected: FAIL (`Failed to resolve import "../auth/config"`).

- [ ] **Step 4: Implementar**

`frontend/src/auth/config.ts`:

```ts
export type ConfigAuth = { url: string; chave: string }

type Ambiente = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string }

/**
 * A publishable key é pública por desenho e fica no bundle. Se alguém colar uma chave
 * secreta ou um JWT, o login fica indisponível em vez de publicar o segredo.
 */
export function lerConfigAuth(ambiente: Ambiente = import.meta.env): ConfigAuth | null {
  const url = ambiente.VITE_SUPABASE_URL
  const chave = ambiente.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !chave || !chave.startsWith('sb_publishable_')) return null
  return { url, chave }
}

export const MSG_LOGIN_DESLIGADO =
  'O login não está disponível neste ambiente. Você pode planejar rotas e ver barreiras sem conta.'

/**
 * `volta` só aceita caminho interno. Quem decide é o parser do navegador, com a origem:
 * comparar o texto deixaria passar barra invertida, tab e quebra de linha, que ele normaliza.
 */
export function voltaSegura(valor: string | null): string {
  if (!valor?.startsWith('/')) return '/conta'
  try {
    const url = new URL(valor, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : '/conta'
  } catch {
    return '/conta'
  }
}
```

`frontend/src/auth/cliente.ts`:

```ts
import type { AuthClient } from '@supabase/auth-js'
import { ErroApi } from '../api/base'
import { lerConfigAuth } from './config'
import { MSG_ABRIR_LOGIN, MSG_REDE_AUTH, MSG_TEMPO_AUTH } from './erros'

/** Só a presença desta chave decide "Entrar" ou "Conta" no menu, sem carregar a biblioteca. */
export const CHAVE_SESSAO = 'rf-sessao'

/** O auth-js não tem teto de tempo: com a conexão travada, a tela ficaria esperando para sempre. */
export const TETO_AUTH_MS = 30_000
const TETO_SAIR_MS = 5_000

type ClienteAuth = InstanceType<typeof AuthClient>

let cliente: Promise<ClienteAuth> | null = null

/**
 * Import dinâmico: quem nunca entra não baixa os 25 KB de auth-js. Só /auth/v1, nada de Data
 * API. A rejeição não fica guardada: com sinal ruim, a próxima tentativa precisa importar de novo.
 */
function obterCliente(): Promise<ClienteAuth> {
  const config = lerConfigAuth()
  if (!config) return Promise.reject(new Error('login indisponível'))
  cliente ??= import('@supabase/auth-js')
    .then(
      ({ AuthClient }) =>
        new AuthClient({
          url: `${config.url}/auth/v1`,
          headers: { apikey: config.chave },
          storageKey: CHAVE_SESSAO,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // login por código não passa nada na URL
        }),
    )
    .catch(() => {
      cliente = null
      throw new ErroApi('rede', MSG_ABRIR_LOGIN)
    })
  return cliente
}

function comTeto<T>(promessa: Promise<T>, ms = TETO_AUTH_MS): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const limite = setTimeout(() => rejeitar(new ErroApi('tempo', MSG_TEMPO_AUTH)), ms)
    promessa.then(resolver, rejeitar).finally(() => clearTimeout(limite))
  })
}

/** Refresh que falha por rede ou 5xx deixa a sessão salva: é falta de conexão, não "deslogado". */
function lancarSeTransitorio(erro: { name?: string } | null): void {
  if (erro?.name === 'AuthRetryableFetchError') throw new ErroApi('rede', MSG_REDE_AUTH)
}

export function temSessaoSalva(): boolean {
  try {
    return localStorage.getItem(CHAVE_SESSAO) !== null
  } catch {
    return false
  }
}

export function enviarCodigo(email: string): Promise<void> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { error } = await c.signInWithOtp({ email, options: { shouldCreateUser: true } })
      if (error) throw error
    })(),
  )
}

export function verificarCodigo(email: string, codigo: string): Promise<void> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { error } = await c.verifyOtp({ email, token: codigo, type: 'email' })
      if (error) throw error
    })(),
  )
}

/** Token de acesso válido (renova se preciso), ou null sem sessão. Falha de rede lança ErroApi. */
export async function obterToken(): Promise<string | null> {
  if (!temSessaoSalva()) return null
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.getSession()
      lancarSeTransitorio(error)
      return data.session?.access_token ?? null
    })(),
  )
}

export function renovarToken(): Promise<string | null> {
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.refreshSession()
      lancarSeTransitorio(error)
      return error ? null : (data.session?.access_token ?? null)
    })(),
  )
}

export async function lerConta(): Promise<{ id: string; email: string } | null> {
  if (!temSessaoSalva()) return null
  return comTeto(
    (async () => {
      const c = await obterCliente()
      const { data, error } = await c.getSession()
      lancarSeTransitorio(error)
      const usuario = data.session?.user
      return usuario ? { id: usuario.id, email: usuario.email ?? '' } : null
    })(),
  )
}

/** Sair deste aparelho nunca depende de rede nem da biblioteca ter carregado. */
export async function sair(): Promise<void> {
  try {
    await comTeto(
      (async () => {
        const c = await obterCliente()
        await c.signOut({ scope: 'local' })
      })(),
      TETO_SAIR_MS,
    )
  } catch {
    try {
      localStorage.removeItem(CHAVE_SESSAO)
    } catch {
      // sem armazenamento, não há sessão salva a remover
    }
  }
}
```

`frontend/src/auth/erros.ts`:

```ts
import { ErroApi } from '../api/base'

export const MSG_CODIGO_ERRADO = 'Código incorreto ou vencido. Confira os dígitos ou peça outro.'
export const MSG_LIMITE = 'Muitos pedidos agora. Tente em alguns minutos. O que você escreveu continua aqui.'
export const MSG_REDE_AUTH = 'Não conseguimos falar com o serviço de login. Tente de novo.'
export const MSG_TEMPO_AUTH = 'O serviço de login demorou demais. Confira o sinal e tente de novo.'
export const MSG_ABRIR_LOGIN = 'Não conseguimos abrir o login. Confira o sinal e tente de novo; se continuar, recarregue a página.'

const POR_CODIGO: Record<string, string> = {
  otp_expired: MSG_CODIGO_ERRADO,
  over_email_send_rate_limit: MSG_LIMITE,
  over_request_rate_limit: MSG_LIMITE,
  email_address_not_authorized: 'Este e-mail ainda não pode receber código: o envio está em fase de teste.',
  email_address_invalid: 'Confira o e-mail digitado.',
  validation_failed: 'Confira o e-mail digitado.',
  signup_disabled: 'O login está desligado no momento.',
  otp_disabled: 'O login está desligado no momento.',
}

export function mensagemDeErroAuth(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.message
  const codigo = (erro as { code?: unknown } | null)?.code
  if (typeof codigo === 'string' && POR_CODIGO[codigo]) return POR_CODIGO[codigo]
  return MSG_REDE_AUTH
}

/** Colar "123 456" ou "123-456" funciona; o maxLength cortaria a colagem. */
export function normalizarCodigo(texto: string): string {
  return texto.replace(/[\s-]/g, '')
}

export function erroDoCodigo(codigo: string): string | null {
  if (!/^\d+$/.test(codigo)) return 'O código tem só números.'
  if (codigo.length !== 6) return `O código tem 6 dígitos; você digitou ${codigo.length}.`
  return null
}
```

`frontend/src/auth/comSessao.ts`:

```ts
import { ErroApi } from '../api/base'
import { obterToken, renovarToken } from './cliente'

export type MotivoLogin = 'primeira' | 'expirou'

const MSG_LOGIN = 'Faça login para continuar.'

/** 401 que nem a renovação resolveu: a tela abre o portão, nunca uma frase sem saída. */
export class ErroSessao extends ErroApi {
  readonly motivo: MotivoLogin

  constructor(motivo: MotivoLogin) {
    super('sessao', MSG_LOGIN, 401)
    this.name = 'ErroSessao'
    this.motivo = motivo
  }
}

export function motivoDoLogin(erro: ErroApi): MotivoLogin {
  return erro instanceof ErroSessao ? erro.motivo : 'expirou'
}

/**
 * Único ciclo de token de todo o front: sem sessão, ErroSessao('primeira'); 401 renova e repete
 * uma vez; se não renovar, ErroSessao('expirou'). O 401 sai antes de qualquer gravação no
 * backend, então repetir é seguro. Falha de rede sai como ErroApi('rede'), sem portão.
 */
export async function comSessao<T>(chamada: (token: string) => Promise<T>): Promise<T> {
  const token = await obterToken()
  if (!token) throw new ErroSessao('primeira')
  try {
    return await chamada(token)
  } catch (erro) {
    if (!(erro instanceof ErroApi) || erro.tipo !== 'sessao') throw erro
    const novo = await renovarToken()
    if (!novo) throw new ErroSessao('expirou')
    return chamada(novo)
  }
}
```

`frontend/src/auth/useSessao.ts`:

```ts
import { createContext, useContext } from 'react'

export type Papel = 'colaborador' | 'admin'
export type Conta = { id: string; email: string; papel: Papel | null }

export type Sessao = {
  /** Há VITE_ configuradas: sem elas, rota e leituras seguem e o login some. */
  disponivel: boolean
  logado: boolean
  conta: Conta | null
  /**
   * Publica o e-mail, que é local, e depois busca o papel. Acorda o Render por GET /api/eu,
   * então só as páginas que precisam chamam. Lança ErroApi; 401 sem renovação é ErroSessao.
   */
  carregarConta: () => Promise<Conta | null>
  aoEntrar: () => void
  sair: () => Promise<void>
}

export const ContextoSessao = createContext<Sessao>({
  disponivel: false,
  logado: false,
  conta: null,
  carregarConta: async () => null,
  aoEntrar: () => {},
  sair: async () => {},
})

export function useSessao(): Sessao {
  return useContext(ContextoSessao)
}
```

`frontend/src/auth/SessaoProvider.tsx`:

```tsx
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { obterEu } from '../api/colaboracao'
import { apagarRascunho, esquecerMinhas } from '../dados/rascunho'
import { lerConta, sair as sairDoAuth, temSessaoSalva } from './cliente'
import { comSessao } from './comSessao'
import { lerConfigAuth } from './config'
import { ContextoSessao, type Conta } from './useSessao'

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [disponivel] = useState(() => lerConfigAuth() !== null)
  const [logado, setLogado] = useState(() => disponivel && temSessaoSalva())
  const [conta, setConta] = useState<Conta | null>(null)

  const carregarConta = useCallback(async () => {
    const dados = await lerConta()
    if (!dados) {
      setLogado(false)
      setConta(null)
      return null
    }
    // o e-mail é local: aparece mesmo com a API dormindo ou fora
    setConta((c) => ({ ...dados, papel: c?.id === dados.id ? c.papel : null }))
    const eu = await comSessao((token) => obterEu(token))
    const nova: Conta = { ...dados, papel: eu.papel }
    setConta(nova)
    return nova
  }, [])

  const aoEntrar = useCallback(() => setLogado(true), [])

  const sair = useCallback(async () => {
    // antes de tudo, e sem depender de conta carregada: o aparelho pode ser de outra pessoa
    esquecerMinhas()
    apagarRascunho()
    await sairDoAuth()
    setLogado(false)
    setConta(null)
  }, [])

  const valor = useMemo(
    () => ({ disponivel, logado, conta, carregarConta, aoEntrar, sair }),
    [disponivel, logado, conta, carregarConta, aoEntrar, sair],
  )
  return <ContextoSessao.Provider value={valor}>{children}</ContextoSessao.Provider>
}
```

`frontend/src/auth/LinkConta.tsx`:

```tsx
import { NavLink } from 'react-router'
import { useSessao } from './useSessao'

/** "Entrar" ou "Conta" no menu; sem login configurado, nada. */
export function LinkConta() {
  const { disponivel, logado } = useSessao()
  if (!disponivel) return null
  return (
    <li>
      <NavLink className="alvo" to={logado ? '/conta' : '/entrar'}>
        {logado ? 'Conta' : 'Entrar'}
      </NavLink>
    </li>
  )
}
```

`frontend/src/auth/useAcaoComLogin.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { comSessao, motivoDoLogin, type MotivoLogin } from './comSessao'

export type EstadoAcao =
  | { fase: 'ocioso' }
  | { fase: 'enviando' }
  | { fase: 'login'; motivo: MotivoLogin }
  | { fase: 'erro'; erro: ErroApi }

type Pendente<A extends unknown[]> = { args: A }

/**
 * Executa uma ação que exige login sem desmontar a página: o rascunho, a chave de
 * idempotência e a foto continuam na memória. Se precisar de login, abre o portão na própria
 * página, e concluirLogin refaz a ação.
 *
 * `montarArgs` lê o formulário de novo na hora de refazer: enquanto espera o e-mail a pessoa
 * pode corrigir o texto, e o que vale é o que está na tela. Devolve null se o formulário ficou
 * inválido; nesse caso quem a passa mostra o erro, e o portão só fecha.
 */
export function useAcaoComLogin<A extends unknown[], R>(
  acao: (token: string, ...args: A) => Promise<R>,
  aoConcluir: (resultado: R) => void,
  montarArgs?: () => A | null,
) {
  const [estado, setEstado] = useState<EstadoAcao>({ fase: 'ocioso' })
  const pendente = useRef<Pendente<A> | null>(null)
  const ocupada = useRef(false)
  const refs = useRef({ acao, aoConcluir, montarArgs })
  refs.current = { acao, aoConcluir, montarArgs }

  const rodar = useCallback(async (args: A) => {
    if (ocupada.current) return
    ocupada.current = true
    pendente.current = { args }
    setEstado({ fase: 'enviando' })
    try {
      const resultado = await comSessao((token) => refs.current.acao(token, ...args))
      pendente.current = null
      setEstado({ fase: 'ocioso' })
      refs.current.aoConcluir(resultado)
    } catch (erro) {
      if (ehCancelamento(erro)) {
        setEstado({ fase: 'ocioso' })
      } else if (erro instanceof ErroApi && erro.tipo === 'sessao') {
        setEstado({ fase: 'login', motivo: motivoDoLogin(erro) })
      } else {
        setEstado({ fase: 'erro', erro: erro instanceof ErroApi ? erro : new ErroApi('inesperado', MSG_INESPERADO) })
      }
    } finally {
      ocupada.current = false
    }
  }, [])

  const executar = useCallback((...args: A) => rodar(args), [rodar])

  const concluirLogin = useCallback(() => {
    const p = pendente.current
    if (!p) return
    const args = refs.current.montarArgs ? refs.current.montarArgs() : p.args
    if (args) {
      void rodar(args)
    } else {
      pendente.current = null
      setEstado({ fase: 'ocioso' })
    }
  }, [rodar])

  const cancelarLogin = useCallback(() => {
    pendente.current = null
    setEstado({ fase: 'ocioso' })
  }, [])

  /** A pessoa mexeu no que o erro apontava: ele deixou de valer. */
  const limparErro = useCallback(() => {
    setEstado((e) => (e.fase === 'erro' ? { fase: 'ocioso' } : e))
  }, [])

  return { estado, executar, concluirLogin, cancelarLogin, limparErro }
}
```

Em `frontend/src/vite-env.d.ts`, acrescente em `ImportMetaEnv`:

```ts
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
```

`frontend/src/App.tsx` ganha `SessaoProvider` dentro de `RegiaoViva` e `LinkConta` no menu. As tasks seguintes acrescentam uma linha `lazy` e uma `Route` por página, antes da rota `*`:

`frontend/src/App.tsx`:

```tsx
import { lazy, Suspense } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { SessaoProvider } from './auth/SessaoProvider'
import { LinkConta } from './auth/LinkConta'
import { ErroDePagina } from './componentes/ErroDePagina'
import { Pictograma } from './componentes/Pictograma'
import { RegiaoViva } from './componentes/RegiaoViva'
import { Inicio } from './pages/Inicio'

// a landing fica na entrada (é a primeira dobra); o resto vem sob demanda
const Rota = lazy(() => import('./pages/Rota').then((m) => ({ default: m.Rota })))
const Fontes = lazy(() => import('./pages/Fontes').then((m) => ({ default: m.Fontes })))
const Acessibilidade = lazy(() => import('./pages/Acessibilidade').then((m) => ({ default: m.Acessibilidade })))
const NaoEncontrada = lazy(() => import('./pages/NaoEncontrada').then((m) => ({ default: m.NaoEncontrada })))

export default function App() {
  const { pathname } = useLocation()
  return (
    <RegiaoViva>
      <SessaoProvider>
        <SkipLink />
        <header className="faixa faixa--topo">
          <div className="faixa__miolo">
            <Link className="alvo marca" to="/">
              <Pictograma nome="marca" tamanho={28} />
              <span className="letreiro">Rota Falada SP</span>
            </Link>
            <nav aria-label="Principal">
              <ul className="menu">
                <li>
                  <NavLink className="alvo" to="/" end>
                    Início
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/rota">
                    Planejar rota
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/fontes">
                    Fontes
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/acessibilidade">
                    Acessibilidade
                  </NavLink>
                </li>
                <LinkConta />
              </ul>
            </nav>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1}>
          <ErroDePagina key={pathname}>
            <Suspense fallback={<p className="carregando-pagina">Carregando…</p>}>
              <Routes>
                <Route path="/" element={<Inicio />} />
                <Route path="/rota" element={<Rota />} />
                <Route
                  path="/fontes"
                  element={
                    <div className="folha">
                      <Fontes />
                    </div>
                  }
                />
                <Route
                  path="/acessibilidade"
                  element={
                    <div className="folha">
                      <Acessibilidade />
                    </div>
                  }
                />
                <Route
                  path="*"
                  element={
                    <div className="folha">
                      <NaoEncontrada />
                    </div>
                  }
                />
              </Routes>
            </Suspense>
          </ErroDePagina>
        </main>
        <footer className="faixa faixa--base">
          <div className="faixa__miolo">
            <p>
              Dados do mapa © colaboradores do OpenStreetMap. Veja{' '}
              <Link to="/fontes">todas as fontes e licenças</Link>.
            </p>
          </div>
        </footer>
      </SessaoProvider>
    </RegiaoViva>
  )
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest --run src/test/auth.test.ts src/test/authCliente.test.ts src/test/App.test.tsx`
Expected: PASS, 28 testes (15, 5 e 8). Sem variáveis `VITE_SUPABASE_*`, o menu segue sem "Entrar".

- [ ] **Step 6: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run ; npm run build ; npm run orcamento`
Expected: sem erros; 25 arquivos, 206 testes passando; `auth-js` fora da entrada.

---

### Task 17: `/entrar`, `/conta` e o portão de login

**Files:**
- Create: `frontend/src/componentes/FluxoCodigo.tsx`, `frontend/src/componentes/PortaoLogin.tsx`, `frontend/src/pages/Entrar.tsx`, `frontend/src/pages/Conta.tsx`, `frontend/src/estilos/colaborar.css`, `frontend/src/test/clienteFalso.ts`, `frontend/src/test/apoioColaboracao.tsx`, `frontend/src/test/Entrar.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `auth/*`, `Placa`, `Pictograma`, `useAnuncio`, `useEsperaServidor`, `focarOuAnunciar`.
- Produces: `FluxoCodigo({ aoEntrar })`; `PortaoLogin({ motivo, aoEntrar, aoCancelar, refRetorno })`, com `refRetorno` obrigatório; `Entrar`; `Conta`; para os testes, `clienteFalso`, `mocks`, `A`, `CONTA`, `ficha()`, `logar(papel?)`, `abrir(rota, state?)`, `regioes()`, `prepararColaboracao()`.

Marcação: `Entrar` e `Conta` usam `.folha` (`DESIGN.md`, folha lisa de até 48rem). Portão em laje (`--placa`, junta de 1 px) quando está solto na página; dentro de `.folha` abre só com a junta superior, sem fundo nem borda lateral. Sem modal e sem caixa dentro de caixa.

- [ ] **Step 1: Escrever o apoio e o teste**

`frontend/src/test/clienteFalso.ts`:

```ts
import { vi } from 'vitest'

/** Substitui auth/cliente nos testes: nenhuma rede e nenhum import de auth-js. */
export const CHAVE_SESSAO = 'rf-sessao'
export const temSessaoSalva = vi.fn(() => false)
export const obterToken = vi.fn(async (): Promise<string | null> => null)
export const renovarToken = vi.fn(async (): Promise<string | null> => null)
export const lerConta = vi.fn(async (): Promise<{ id: string; email: string } | null> => null)
export const enviarCodigo = vi.fn(async (): Promise<void> => {})
export const verificarCodigo = vi.fn(async (): Promise<void> => {})
export const sair = vi.fn(async (): Promise<void> => {})
```

`frontend/src/test/apoioColaboracao.tsx`:

```tsx
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Barreira } from '../api/colaboracao'
import App from '../App'
import * as cliente from '../auth/cliente'
import * as config from '../auth/config'
import { endereco } from './fixturasRota'

export const mocks = vi.mocked(cliente)
export const A = endereco(1, 'Rua A, 1 · Vila Mariana')
export const CONTA = { id: '3f2a91b0-1111-2222-3333-444455556666', email: 'pessoa@exemplo.org' }

export function ficha(extras: Partial<Barreira> = {}): Barreira {
  return {
    id: 5,
    categoria: 'escada',
    severidade: 'intransponivel',
    status: 'pendente',
    votos: { confirma: 1, contesta: 0, resolvida: 0 },
    descricao: null,
    lat: -23.59,
    lon: -46.635,
    criada_em: '2026-11-03T12:00:00+00:00',
    ultima_confirmacao_em: null,
    foto_url: null,
    foto_descricao: null,
    ...extras,
  }
}

export function logar(papel: 'colaborador' | 'admin' = 'colaborador') {
  mocks.temSessaoSalva.mockReturnValue(true)
  mocks.obterToken.mockResolvedValue('tkn')
  mocks.lerConta.mockResolvedValue(CONTA)
  return { 'GET /api/eu': Response.json({ papel }) }
}

export function abrir(rota: string, state?: unknown) {
  const [pathname, busca] = rota.split('?')
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: busca ? `?${busca}` : '', state }]}>
      <App />
    </MemoryRouter>,
  )
}

export const regioes = () => document.querySelectorAll('[aria-live],[role=status],[role=alert]')

/** Cada arquivo chama isto: login configurado, sem sessão. */
export function prepararColaboracao() {
  beforeEach(() => {
    vi.spyOn(config, 'lerConfigAuth').mockReturnValue({ url: 'https://x.supabase.co', chave: 'sb_publishable_x' })
    mocks.temSessaoSalva.mockReturnValue(false)
    mocks.obterToken.mockResolvedValue(null)
    mocks.renovarToken.mockResolvedValue(null)
    mocks.lerConta.mockResolvedValue(null)
    mocks.enviarCodigo.mockReset().mockResolvedValue(undefined)
    mocks.verificarCodigo.mockReset().mockResolvedValue(undefined)
    mocks.sair.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}
```

`frontend/src/test/Entrar.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import * as config from '../auth/config'
import { lembrarMinha } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { CONTA, abrir, logar, mocks, regioes, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('sem as variáveis VITE_', () => {
  it('Entrar some, e a tela diz que o login não está disponível', async () => {
    vi.spyOn(config, 'lerConfigAuth').mockReturnValue(null)
    abrir('/entrar')
    expect(await screen.findByText(/O login não está disponível neste ambiente/)).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(nav).queryByRole('link', { name: 'Entrar' })).toBeNull()
    expect(mocks.enviarCodigo).not.toHaveBeenCalled()
  })
})

describe('navegação e foco', () => {
  it('mostra Entrar ou Conta conforme a sessão, sem carregar a biblioteca', () => {
    abrir('/')
    expect(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar')
    expect(mocks.lerConta).not.toHaveBeenCalled()
  })

  it('rota inexistente tem página própria com h1', async () => {
    abrir('/nao-existe')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument()
  })
})

describe('/entrar', () => {
  it('pede o e-mail, foca o código e entra; o código nunca é guardado', async () => {
    const user = userEvent.setup()
    const { container } = abrir('/entrar')
    const email = await screen.findByRole('textbox', { name: 'E-mail' })
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    await user.type(email, 'pessoa@exemplo.org')
    await user.click(screen.getByRole('button', { name: 'Receber código' }))
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    expect(codigo).toHaveFocus()
    expect(codigo).toHaveAttribute('autocomplete', 'one-time-code')
    expect(codigo).toHaveAttribute('inputmode', 'numeric')
    expect(codigo).not.toHaveAttribute('maxlength')
    expect(codigo).toHaveAccessibleDescription(expect.stringContaining('Enviamos para pessoa@exemplo.org'))
    expect(sessionStorage.getItem('rf-login')).toContain('pessoa@exemplo.org')
    expect(await axe(container)).toHaveNoViolations()

    await user.type(codigo, '012 345')
    // o sexto dígito não envia sozinho (WCAG 3.2.2)
    expect(mocks.verificarCodigo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))
    await waitFor(() => expect(mocks.verificarCodigo).toHaveBeenCalledWith('pessoa@exemplo.org', '012345'))
    expect(sessionStorage.getItem('rf-login')).toBeNull()
  })

  it('código curto e código errado explicam, com o foco no campo e sem role=alert', async () => {
    mocks.verificarCodigo.mockRejectedValue({ code: 'otp_expired' })
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234{Enter}')
    expect(codigo).toHaveAttribute('aria-invalid', 'true')
    expect(codigo).toHaveAccessibleDescription(expect.stringContaining('você digitou 4'))
    expect(codigo).toHaveFocus()
    await user.clear(codigo)
    await user.type(codigo, '123456{Enter}')
    expect(await screen.findByText('Código incorreto ou vencido. Confira os dígitos ou peça outro.')).toBeInTheDocument()
    expect(regioes()).toHaveLength(1)
  })

  it('reenviar antes da hora repete a frase, sem contador e sem perder o foco', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const reenviar = await screen.findByRole('button', { name: 'Reenviar código' })
    expect(reenviar).toHaveAttribute('aria-disabled', 'true')
    // a hora de liberar já aparece sem precisar pressionar um botão que parece desativado
    expect(screen.getByText(/Você pode pedir outro código a partir das/)).toBeInTheDocument()
    await user.click(reenviar)
    expect(reenviar).toHaveFocus()
    expect(mocks.enviarCodigo).not.toHaveBeenCalled()
    expect(reenviar).toHaveAccessibleDescription(expect.stringContaining('Você pode pedir outro código a partir das'))
  })
})

describe('/conta', () => {
  it('sem login vai para /entrar', async () => {
    abrir('/conta')
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
  })

  it('o link do painel só aparece para admin; sair limpa "minhas"', async () => {
    apiFalsa(logar('admin'))
    lembrarMinha(CONTA.id, 5)
    const user = userEvent.setup()
    abrir('/conta')
    expect(await screen.findByText('E-mail: pessoa@exemplo.org')).toBeInTheDocument()
    const painel = await screen.findByRole('link', { name: 'Painel de moderação' })
    expect(painel).toHaveAttribute('href', '/admin')
    // o link chega depois: fica abaixo de "Sair" para não empurrar nada (D19)
    expect(screen.getByRole('button', { name: 'Sair' }).compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBeNull()
  })

  it('colaborador não vê o painel', async () => {
    apiFalsa(logar('colaborador'))
    abrir('/conta')
    await screen.findByText('E-mail: pessoa@exemplo.org')
    await waitFor(() => expect(mocks.obterToken).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Painel de moderação' })).toBeNull()
  })
})

describe('/entrar: erros e espera', () => {
  it('Enter com o foco no campo: o foco não muda, então a região anuncia o erro', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234{Enter}')
    expect(codigo).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('O código tem 6 dígitos; você digitou 4.'))
  })

  it('pelo botão o foco vai ao campo, que lê a descrição: sem anúncio por cima', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    const codigo = await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })
    await user.type(codigo, '1234')
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))
    expect(codigo).toHaveFocus()
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('código vencido com Enter é falado', async () => {
    mocks.verificarCodigo.mockRejectedValue({ code: 'otp_expired' })
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now(), reenvios: 0 }))
    const user = userEvent.setup()
    abrir('/entrar')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Código incorreto ou vencido.'))
  })

  it('e-mail inválido com Enter é falado, e o aviso de envio aparece enquanto espera', async () => {
    let soltar: () => void = () => {}
    mocks.enviarCodigo.mockImplementation(() => new Promise<void>((r) => (soltar = r)))
    const user = userEvent.setup()
    abrir('/entrar')
    const email = await screen.findByRole('textbox', { name: 'E-mail' })
    await user.type(email, 'semarroba{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Confira o e-mail digitado.'))
    await user.clear(email)
    await user.type(email, 'p@e.org{Enter}')
    expect(await screen.findByText('Enviando o código…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enviando o código.'))
    soltar()
    expect(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' })).toHaveFocus()
  })

  it('"Reenviar código" libera sozinho na hora marcada, sem contador', async () => {
    sessionStorage.setItem('rf-login', JSON.stringify({ email: 'p@e.org', enviadoEm: Date.now() - 59_700, reenvios: 0 }))
    abrir('/entrar')
    const reenviar = await screen.findByRole('button', { name: 'Reenviar código' })
    expect(reenviar).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(reenviar).not.toHaveAttribute('aria-disabled'), { timeout: 1500 })
    expect(screen.getByText('Você já pode pedir outro código.')).toBeInTheDocument()
  })

  it('não diz que enviou antes de enviar', async () => {
    abrir('/entrar')
    expect(await screen.findByText(/Enviaremos um código de 6 dígitos/)).toBeInTheDocument()
    expect(screen.queryByText(/^Enviamos um código/)).toBeNull()
  })
})

describe('/conta: falhas', () => {
  it('o e-mail é local: aparece mesmo com a API fora, ao lado do erro e de "Tentar de novo"', async () => {
    let vez = 0
    apiFalsa({ ...logar(), 'GET /api/eu': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json({ papel: 'colaborador' })) })
    const user = userEvent.setup()
    abrir('/conta')
    expect(await screen.findByText('E-mail: pessoa@exemplo.org')).toBeInTheDocument()
    expect(screen.queryByText(/carregando…/)).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Sua conta' })).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull())
  })

  it('espera do servidor aparece em /conta', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    logar()
    abrir('/conta')
    expect(await screen.findByText('Carregando os dados da conta…')).toBeInTheDocument()
  })

  it('401 renova e repete; se não renovar, abre o portão em vez de uma frase sem saída', async () => {
    let vez = 0
    const api = apiFalsa({ ...logar(), 'GET /api/eu': () => (++vez === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json({ papel: 'admin' })) })
    mocks.renovarToken.mockResolvedValue('novo')
    abrir('/conta')
    expect(await screen.findByRole('link', { name: 'Painel de moderação' })).toBeInTheDocument()
    expect((api.de('GET /api/eu')[1].init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
  })

  it('401 sem renovação: portão "Sua sessão terminou"', async () => {
    apiFalsa({ ...logar(), 'GET /api/eu': erroApi(401, 'Faça login para continuar.') })
    abrir('/conta')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'E-mail' })).toBeInTheDocument()
  })

  it('sair antes de /api/eu responder apaga os rastros de autoria e o rascunho', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    logar()
    lembrarMinha(CONTA.id, 5)
    lembrarMinha('outra-conta', 6)
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'Três degraus' }))
    const user = userEvent.setup()
    abrir('/conta')
    await user.click(await screen.findByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(mocks.sair).toHaveBeenCalled())
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBeNull()
    expect(localStorage.getItem('rf:minhas:outra-conta')).toBeNull()
    expect(sessionStorage.getItem('rf-rascunho')).toBeNull()
  })

  it('o texto de privacidade diz a verdade sobre a auditoria', async () => {
    apiFalsa(logar())
    abrir('/conta')
    expect(await screen.findByText(/a moderação vê um código da conta, nunca o e-mail/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ninguém vê quem/i)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Entrar.test.tsx`
Expected: FAIL (a rota `/entrar` cai em "Página não encontrada").

- [ ] **Step 3: Implementar**

`frontend/src/componentes/FluxoCodigo.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar } from '../a11y/foco'
import '../estilos/rota.css'
import { enviarCodigo, verificarCodigo } from '../auth/cliente'
import { erroDoCodigo, mensagemDeErroAuth, normalizarCodigo } from '../auth/erros'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'

const CHAVE_PASSO = 'rf-login'
const ESPERA_REENVIO_MS = 60_000
const MAX_REENVIOS = 3

type PassoGravado = { email: string; enviadoEm: number; reenvios: number }

function lerPasso(): PassoGravado | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_PASSO)
    return bruto ? (JSON.parse(bruto) as PassoGravado) : null
  } catch {
    return null
  }
}

function gravarPasso(passo: PassoGravado | null) {
  try {
    if (passo) sessionStorage.setItem(CHAVE_PASSO, JSON.stringify(passo))
    else sessionStorage.removeItem(CHAVE_PASSO)
  } catch {
    // o celular pode descarregar a aba; sem armazenamento, volta ao e-mail
  }
}

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

/**
 * Login por código de 6 dígitos em campo único: seis caixas fazem o NVDA anunciar seis
 * campos e quebram ao colar. Sem envio automático ao sexto dígito (WCAG 3.2.2) e sem
 * contador regressivo (nada se move sem ação). O código nunca é guardado.
 */
export function FluxoCodigo({ aoEntrar }: { aoEntrar: () => void }) {
  const [passo, setPasso] = useState<PassoGravado | null>(lerPasso)
  const [email, setEmail] = useState(passo?.email ?? '')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [esperando, setEsperando] = useState<string | null>(null)
  const [, renderizar] = useState(0)
  const campoCodigo = useRef<HTMLInputElement>(null)
  const campoEmail = useRef<HTMLInputElement>(null)
  const anunciar = useAnuncio()
  const ocupado = esperando !== null
  const liberaEm = passo ? passo.enviadoEm + ESPERA_REENVIO_MS : null

  useEffect(() => {
    if (passo) campoCodigo.current?.focus()
    // só quando troca de passo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo?.email])

  // sem contador: um único render na hora em que o reenvio libera, para o botão não mentir
  useEffect(() => {
    if (liberaEm === null) return
    const resta = liberaEm - Date.now()
    if (resta <= 0) return
    const relogio = setTimeout(() => renderizar((n) => n + 1), resta)
    return () => clearTimeout(relogio)
  }, [liberaEm])

  function esperar(texto: string) {
    setEsperando(`${texto}…`)
    anunciar(`${texto}.`)
  }

  function mostrarErro(texto: string, campo: HTMLInputElement | null) {
    flushSync(() => {
      setErro(texto)
      setEsperando(null)
    })
    focarOuAnunciar(campo, texto, anunciar)
  }

  async function pedirCodigo(e: FormEvent) {
    e.preventDefault()
    if (ocupado) return
    if (!email.includes('@')) {
      mostrarErro('Confira o e-mail digitado.', campoEmail.current)
      return
    }
    esperar('Enviando o código')
    setErro(null)
    try {
      await enviarCodigo(email.trim())
      const novo = { email: email.trim(), enviadoEm: Date.now(), reenvios: 0 }
      gravarPasso(novo)
      setPasso(novo)
      setEsperando(null)
    } catch (falha) {
      mostrarErro(mensagemDeErroAuth(falha), campoEmail.current)
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    if (ocupado || !passo) return
    const limpo = normalizarCodigo(codigo)
    const invalido = erroDoCodigo(limpo)
    if (invalido) {
      mostrarErro(invalido, campoCodigo.current)
      return
    }
    esperar('Confirmando o código')
    setErro(null)
    try {
      await verificarCodigo(passo.email, limpo)
      gravarPasso(null)
      setEsperando(null)
      aoEntrar()
    } catch (falha) {
      mostrarErro(mensagemDeErroAuth(falha), campoCodigo.current)
    }
  }

  async function reenviar() {
    if (!passo || ocupado || liberaEm === null) return
    if (passo.reenvios >= MAX_REENVIOS) {
      anunciar('Confira o spam ou tente mais tarde.')
      return
    }
    if (Date.now() < liberaEm) {
      anunciar(`Você pode pedir outro código a partir das ${HORA.format(liberaEm)}.`)
      return
    }
    esperar('Enviando outro código')
    try {
      await enviarCodigo(passo.email)
      const novo = { ...passo, enviadoEm: Date.now(), reenvios: passo.reenvios + 1 }
      gravarPasso(novo)
      setPasso(novo)
      setAviso('Enviamos outro código. Use sempre o mais recente.')
      anunciar('Enviamos outro código. Use sempre o mais recente.')
    } catch (falha) {
      const frase = mensagemDeErroAuth(falha)
      setAviso(frase)
      anunciar(frase)
    } finally {
      setEsperando(null)
    }
  }

  function trocarEmail() {
    gravarPasso(null)
    setPasso(null)
    setCodigo('')
    setErro(null)
    setAviso(null)
    setTimeout(() => campoEmail.current?.focus())
  }

  if (!passo) {
    return (
      <form className="fluxo-codigo" onSubmit={pedirCodigo} noValidate aria-label="Receber código por e-mail">
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <p id="email-dica" className="campo__dica">
            Seu e-mail serve só para contar um voto por pessoa. Suas rotas não ficam ligadas à sua conta.
          </p>
          <input
            ref={campoEmail}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'email-dica email-erro' : 'email-dica'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {erro && (
            <p id="email-erro" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
        </div>
        <Placa type="submit" variante="acao" pictograma="siga" aria-disabled={ocupado || undefined}>
          Receber código
        </Placa>
        {esperando && <p className="campo__retorno">{esperando}</p>}
      </form>
    )
  }

  const bloqueado = liberaEm !== null && Date.now() < liberaEm
  const esgotado = passo.reenvios >= MAX_REENVIOS
  const dicaReenvio = esgotado
    ? 'Confira o spam ou tente mais tarde.'
    : bloqueado && liberaEm !== null
      ? `Você pode pedir outro código a partir das ${HORA.format(liberaEm)}.`
      : 'Você já pode pedir outro código.'
  return (
    <div className="fluxo-codigo">
      <form onSubmit={confirmar} noValidate aria-label="Confirmar código">
        <div className="campo">
          <label htmlFor="codigo">Código de 6 dígitos</label>
          <p id="codigo-dica" className="campo__dica">
            Enviamos para {passo.email}. Confira também o spam. Use sempre o código mais recente.
          </p>
          <input
            ref={campoCodigo}
            id="codigo"
            name="codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'codigo-dica codigo-erro' : 'codigo-dica'}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          {erro && (
            <p id="codigo-erro" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
        </div>
        <Placa type="submit" variante="acao" pictograma="siga" aria-disabled={ocupado || undefined}>
          Confirmar código
        </Placa>
      </form>
      {esperando && <p className="campo__retorno">{esperando}</p>}
      <div className="fluxo-codigo__apoio">
        <Placa onClick={reenviar} aria-disabled={bloqueado || esgotado || ocupado || undefined} aria-describedby={aviso ? 'reenvio-dica reenvio-aviso' : 'reenvio-dica'}>
          Reenviar código
        </Placa>
        <Placa onClick={trocarEmail}>Trocar e-mail</Placa>
      </div>
      {/* a frase fica sempre: trocar o texto não empurra nada quando o reenvio libera */}
      <p id="reenvio-dica" className="campo__dica">
        {dicaReenvio}
      </p>
      {aviso && (
        <p id="reenvio-aviso" className="campo__retorno">
          {aviso}
        </p>
      )}
    </div>
  )
}
```

`frontend/src/componentes/PortaoLogin.tsx`:

```tsx
import { useEffect, useRef, type RefObject } from 'react'
import { MSG_LOGIN_DESLIGADO } from '../auth/config'
import { useSessao } from '../auth/useSessao'
import { FluxoCodigo } from './FluxoCodigo'
import { Placa } from './Placa'

type Props = {
  motivo: 'primeira' | 'expirou'
  aoEntrar: () => void
  aoCancelar: () => void
  /** Para onde o foco volta quando o portão fecha: o que o tinha some com ele (WCAG 2.4.3). */
  refRetorno: RefObject<HTMLElement | null>
}

/** Login na própria página, sem modal nem troca de rota: o formulário e a foto continuam montados. */
export function PortaoLogin({ motivo, aoEntrar, aoCancelar, refRetorno }: Props) {
  const { disponivel, aoEntrar: marcarLogado } = useSessao()
  const titulo = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titulo.current?.focus()
  }, [])

  return (
    <section className="portao" aria-labelledby="titulo-portao">
      <h2 id="titulo-portao" ref={titulo} tabIndex={-1} className="letreiro portao__titulo">
        {motivo === 'expirou' ? 'Sua sessão terminou' : 'Entre para continuar'}
      </h2>
      {!disponivel ? (
        <p>{MSG_LOGIN_DESLIGADO}</p>
      ) : (
        <>
          <p>
            {motivo === 'expirou'
              ? 'O que você escreveu continua aqui. Depois do código, a mesma ação é refeita.'
              : 'Pedimos um código no seu e-mail só desta vez. O que você escreveu continua aqui.'}
          </p>
          <FluxoCodigo
            aoEntrar={() => {
              marcarLogado()
              // antes da ação: se o que estava na tela ficou inválido, o erro leva o foco ao campo
              refRetorno.current?.focus()
              aoEntrar()
            }}
          />
        </>
      )}
      <Placa
        onClick={() => {
          refRetorno.current?.focus()
          aoCancelar()
        }}
      >
        Cancelar
      </Placa>
    </section>
  )
}
```

`frontend/src/pages/Entrar.tsx`:

```tsx
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { MSG_LOGIN_DESLIGADO, voltaSegura } from '../auth/config'
import { useSessao } from '../auth/useSessao'
import { FluxoCodigo } from '../componentes/FluxoCodigo'
import '../estilos/colaborar.css'

export function Entrar() {
  const h1 = usePaginaAcessivel('Entrar')
  const { disponivel, logado, aoEntrar } = useSessao()
  const [parametros] = useSearchParams()
  const navegar = useNavigate()
  const volta = voltaSegura(parametros.get('volta'))

  if (logado) return <Navigate to={volta} replace />

  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Entrar
      </h1>
      {disponivel ? (
        <>
          <p>Enviaremos um código de 6 dígitos para o seu e-mail. Sem senha. Planejar rotas não precisa de conta.</p>
          <FluxoCodigo
            aoEntrar={() => {
              aoEntrar()
              navegar(volta, { replace: true })
            }}
          />
        </>
      ) : (
        <p>{MSG_LOGIN_DESLIGADO}</p>
      )}
    </div>
  )
}
```

`frontend/src/pages/Conta.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ErroApi, MSG_INESPERADO } from '../api/base'
import { aquecerServidor } from '../api/servidor'
import { motivoDoLogin } from '../auth/comSessao'
import { useSessao } from '../auth/useSessao'
import { Placa } from '../componentes/Placa'
import { PortaoLogin } from '../componentes/PortaoLogin'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import '../estilos/colaborar.css'

export function Conta() {
  const h1 = usePaginaAcessivel('Sua conta')
  const { logado, conta, carregarConta, sair } = useSessao()
  const [erro, setErro] = useState<ErroApi | null>(null)
  const [carregando, setCarregando] = useState(logado)
  const espera = useEsperaServidor(carregando)
  const navegar = useNavigate()
  const anunciar = useAnuncio()

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      await carregarConta()
    } catch (e) {
      const erroApi = e instanceof ErroApi ? e : new ErroApi('inesperado', MSG_INESPERADO)
      setErro(erroApi)
      // o portão leva o foco ao próprio título e se lê sozinho
      if (erroApi.tipo !== 'sessao') anunciar(erroApi.message)
    } finally {
      setCarregando(false)
    }
  }, [carregarConta, anunciar])

  useEffect(() => {
    if (!logado) return
    aquecerServidor()
    void carregar()
  }, [logado, carregar])

  if (!logado) return <Navigate to="/entrar" replace />

  async function encerrar() {
    await sair()
    anunciar('Você saiu da conta.')
    navegar('/', { replace: true })
  }

  const faltaSessao = erro?.tipo === 'sessao'
  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Sua conta
      </h1>
      <p>E-mail: {conta?.email ?? (erro ? 'indisponível agora' : 'carregando…')}</p>
      {carregando && <p>{espera ?? 'Carregando os dados da conta…'}</p>}
      {erro && faltaSessao && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={() => void carregar()} aoCancelar={() => setErro(null)} />}
      {erro && !faltaSessao && (
        <>
          <p>{erro.message}</p>
          <Placa
            onClick={() => {
              // o botão some: o foco espera no título da página
              h1.current?.focus()
              void carregar()
            }}
          >
            Tentar de novo
          </Placa>
        </>
      )}
      <p>
        Sua conta serve para registrar barreiras e votar. Suas rotas não ficam ligadas a ela. Quem usa o site não vê quem
        registrou ou votou; a moderação vê um código da conta, nunca o e-mail, para auditoria.
      </p>
      <Placa onClick={encerrar}>Sair</Placa>
      {/* chega depois de GET /api/eu: fica por último para não empurrar nada (D19) */}
      {conta?.papel === 'admin' && (
        <p>
          <Link className="alvo" to="/admin">
            Painel de moderação
          </Link>
        </p>
      )}
    </div>
  )
}
```

`frontend/src/estilos/colaborar.css`:

```css
/* Login, barreiras e moderação. Tokens do DESIGN.md; nada de tamanho ou peso novo. */

.colaborar {
  max-width: var(--largura-max);
  margin: 0 auto;
  padding: var(--e-5) var(--calha) var(--e-6);
  display: grid;
  gap: var(--e-4);
}

.colaborar__titulo {
  margin: 0 0 var(--e-1);
  font-size: var(--t-2);
}

.colaborar__lista,
.colaborar__portao,
.portao {
  background: var(--placa);
  border: 1px solid var(--junta);
  padding: clamp(1.5rem, 3vw, 2.5rem);
  min-width: 0;
}

.colaborar__portao {
  grid-column: 1 / -1;
  padding: 0;
  border: 0;
}

.portao {
  display: grid;
  gap: var(--e-2);
  justify-items: start;
  margin-top: var(--e-3);
}

.portao p {
  margin: 0;
}

/* dentro de uma folha, nada de caixa dentro de caixa: abre com a junta, sobre a própria folha */
.folha .portao {
  background: none;
  border: 0;
  border-top: 1px solid var(--junta);
  padding: var(--e-3) 0 0;
}

.portao__titulo {
  margin: 0;
  font-size: var(--t-2);
}

/* texto corrido em página de leitura: mesmo campo do formulário */
.campo textarea {
  min-height: 48px;
  margin-top: 0.25rem;
  padding: 0.5rem 0.75rem;
  background: var(--vao);
  border: 1px solid var(--junta-forte);
  border-radius: 0;
  max-width: 100%;
  resize: vertical;
}

.campo textarea:hover {
  border-color: var(--tinta);
}

.campo input[type='file'] {
  padding: 0.5rem 0;
  background: transparent;
  border: 0;
  max-width: 100%;
}

.fluxo-codigo,
.fluxo-codigo form,
.foto__form,
.decisao {
  display: grid;
  gap: var(--e-3);
  justify-items: stretch;
  min-width: 0;
}

.fluxo-codigo .placa,
.foto__form .placa,
.decisao > .placa {
  justify-self: start;
}

.fluxo-codigo__apoio {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e-1);
}

.opcao--dupla {
  align-items: flex-start;
}

.opcao__dica {
  display: block;
  font-size: var(--t-1);
  color: var(--tinta-2);
}

.escolha-local {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: var(--e-2);
  justify-items: start;
  min-width: 0;
}

.escolha-local > * {
  max-width: 100%;
}

.escolha-local legend {
  padding: 0;
  font-weight: 600;
}

.escolha-local .campo-endereco,
.escolha-local .mapa-rota__corpo {
  width: 100%;
}

.escolha-local__escolhido {
  display: grid;
  gap: var(--e-1);
  justify-items: start;
}

.escolha-local__escolhido p {
  margin: 0;
}

.escolha-local__rotulo {
  font-weight: 600;
}

/* lista sem caixa: régua de 1 px, como a tabela gravada */
.lista-gravada {
  list-style: none;
  margin: 0 0 var(--e-3);
  padding: 0;
  border-top: 1px solid var(--junta-forte);
}

.lista-gravada li {
  padding: var(--e-3) 0;
  border-bottom: 1px solid var(--junta);
}

.lista-gravada h3 {
  margin: 0 0 var(--e-1);
  font-size: var(--t-2);
}

.lista-gravada p {
  margin: 0 0 var(--e-1);
}

.lista-gravada__link {
  justify-content: flex-start;
  padding-inline: 0;
}

.filtros {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--e-2);
}

.filtros a {
  font-weight: 600;
  font-size: var(--t-1);
  border-bottom: 2px solid transparent;
}

/* filtro atual: estado ativo */
.filtros a[aria-current='page'] {
  border-bottom-color: var(--oxido);
}

.votacao,
.foto {
  display: grid;
  gap: var(--e-2);
  margin-top: var(--e-4);
  padding-top: var(--e-3);
  border-top: 1px solid var(--junta);
}

.votacao__opcoes {
  display: grid;
  gap: var(--e-2);
}

.votacao__opcao {
  display: grid;
  gap: 0.25rem;
  justify-items: start;
}

.votacao__opcao p,
.votacao > p {
  margin: 0;
}

.foto__previa {
  display: block;
  max-height: 20rem;
  margin: var(--e-2) 0;
  border: 1px solid var(--junta);
}

.decisao {
  margin-top: var(--e-3);
}

.decisao__opcoes {
  display: grid;
  gap: var(--e-1);
  margin-top: var(--e-1);
}

.auditoria {
  margin: 0;
  padding: 0 0 0 var(--e-3);
}
```

Em `frontend/src/App.tsx`, acrescente:

```tsx
const Entrar = lazy(() => import('./pages/Entrar').then((m) => ({ default: m.Entrar })))
const Conta = lazy(() => import('./pages/Conta').then((m) => ({ default: m.Conta })))
```

```tsx
                <Route path="/entrar" element={<Entrar />} />
                <Route path="/conta" element={<Conta />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Entrar.test.tsx`
Expected: PASS, 21 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 26 arquivos, 227 testes passando.

---

### Task 18: Escolher o local: GPS, busca e mapa

**Files:**
- Create: `frontend/src/componentes/EscolhaLocal.tsx`, `frontend/src/componentes/mapa/PontoNoMapa.tsx`, `frontend/src/test/EscolhaLocal.test.tsx`

**Interfaces:**
- Consumes: `useBuscaEndereco(rotulo, inicial, aoEscolher)`, `CampoEndereco`, `obterPosicao`, `FORA_DA_AREA`, `localDeEndereco`, `ehFalhaDeConexao`, `NOTA_SEM_CONFIRMAR`, `opcoesMapa`, `vigiarTiles`, `focoPerdido`, `focarOuAnunciar`.
- Produces: `EscolhaLocal({ id, local, aoEscolher, erro?, aoEditar? })`, com o campo de busca em `id="<id>-busca"` e o botão "Trocar o local" em `id="<id>-trocar"`; `PontoNoMapa` (export default, `{ aoMarcar }`), carregado por `import()` à mão, com falha local.

`PontoNoMapa` só tem teste de navegador real, na Task 24: em jsdom o Leaflet não tem tamanho.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/EscolhaLocal.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { RegiaoViva } from '../componentes/RegiaoViva'
import { FORA_DA_AREA } from '../dados/localizacao'
import { AVISO_MEIO_DA_RUA, type LocalEscolhido } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { endereco } from './fixturasRota'

const chunk = vi.hoisted(() => ({ falhar: true }))

vi.mock('../componentes/mapa/PontoNoMapa', () => {
  if (chunk.falhar) {
    chunk.falhar = false
    throw new Error('chunk')
  }
  return { default: () => <p>Mapa de escolher ponto</p> }
})

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
let ultimo: LocalEscolhido | null = null

function Tela({ erro }: { erro?: string }) {
  const [local, setLocal] = useState<LocalEscolhido | null>(null)
  return (
    <RegiaoViva>
      <EscolhaLocal
        id="local"
        erro={erro}
        local={local}
        aoEscolher={(l) => {
          ultimo = l
          setLocal(l)
        }}
      />
    </RegiaoViva>
  )
}

function comGps(accuracy = 20) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: -23.5901234, longitude: -46.6359876, accuracy } } as GeolocationPosition),
    },
  })
}

beforeEach(() => {
  ultimo = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('EscolhaLocal', () => {
  it('mapa: avisa do IP antes; chunk que falha fica aqui, sem derrubar a página', async () => {
    // o primeiro import do arquivo falha: vi.hoisted acima
    apiFalsa({})
    render(<Tela />)
    const botao = screen.getByRole('button', { name: 'Escolher no mapa' })
    expect(botao).toHaveAccessibleDescription(expect.stringContaining('recebe o endereço IP'))
    await userEvent.click(botao)
    expect(await screen.findByText(/Não foi possível abrir o mapa/)).toBeInTheDocument()
    expect(botao).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(botao).toHaveFocus()
    expect(await screen.findByText('Mapa de escolher ponto')).toBeInTheDocument()
  })

  it('por teclado na busca: logradouro avisa que é o meio da rua', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([endereco(1, 'Rua A · Vila Mariana', { tipo: 'logradouro' })]) })
    render(<Tela />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await screen.findByRole('option')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(await screen.findByText(AVISO_MEIO_DA_RUA)).toBeInTheDocument()
    expect(ultimo).toMatchObject({ origem: 'busca', rotulo: 'Rua A · Vila Mariana' })
  })

  it('a barreira usa a coordenada do GPS, não a do endereço devolvido', async () => {
    const api = apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    await waitFor(() => expect(ultimo).not.toBeNull())
    expect(ultimo).toMatchObject({ lat: -23.5901234, lon: -46.6359876, rotulo: A.rotulo, origem: 'gps' })
    expect(new URL(api.de('GET /api/geocode/reverso')[0].url).searchParams.get('lat')).toBe('-23.5901')
    expect(screen.getByText(/perto de Rua A, 1/)).toBeInTheDocument()
  })

  it('GPS impreciso avisa, sem bloquear', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps(300)
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/A margem do GPS é de cerca de 300 m/)).toBeInTheDocument()
  })

  it('nada a 50 m ainda pode registrar; fora da área não', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, 'Nenhum endereço conhecido a até 50 metros deste ponto.') })
    comGps()
    const { unmount } = render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/pode registrar neste ponto/)).toBeInTheDocument()
    expect(ultimo).toMatchObject({ rotulo: null, origem: 'gps' })
    unmount()

    ultimo = null
    apiFalsa({ 'GET /api/geocode/reverso': erroApi(404, FORA_DA_AREA) })
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(FORA_DA_AREA)).toBeInTheDocument()
    expect(ultimo).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('permissão negada leva o foco à busca', async () => {
    apiFalsa({})
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, erro: PositionErrorCallback) => erro({ code: 1 } as GeolocationPositionError) },
    })
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText(/não autorizou a localização/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('escolher pela lista leva o foco ao local marcado, sem anunciar por cima', async () => {
    apiFalsa({ 'GET /api/geocode': Response.json([A]) })
    render(<Tela />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    campo.focus()
    fireEvent.change(campo, { target: { value: 'rua' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await screen.findByRole('option')
    fireEvent.keyDown(campo, { key: 'ArrowDown' })
    fireEvent.keyDown(campo, { key: 'Enter' })
    const marcado = await screen.findByText(/perto de Rua A, 1/)
    expect(marcado.closest('p')).toHaveFocus()
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status')).not.toHaveTextContent('Endereço: Rua A')
  })

  it('GPS: o botão some e o foco vai ao local marcado; "Trocar o local" leva à busca', async () => {
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    const marcado = await screen.findByText(/perto de Rua A, 1/)
    await waitFor(() => expect(marcado.closest('p')).toHaveFocus())
    await userEvent.click(screen.getByRole('button', { name: 'Trocar o local' }))
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveFocus()
  })

  it('se a pessoa saiu dali durante a espera, o foco fica e a região diz o local', async () => {
    let responder: PositionCallback = () => {}
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: PositionCallback) => (responder = ok) } })
    render(
      <>
        <button type="button">fora</button>
        <Tela />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    const fora = screen.getByRole('button', { name: 'fora' })
    fora.focus()
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await screen.findByText(/perto de Rua A, 1/)
    expect(fora).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Local marcado perto de Rua A, 1'))
  })

  it('sem sinal para o reverso, a coordenada fica no rascunho; fora da área continua recusado', async () => {
    apiFalsa({
      'GET /api/geocode/reverso': () => {
        throw new TypeError('rede')
      },
    })
    comGps()
    render(<Tela />)
    await userEvent.click(screen.getByRole('button', { name: 'Usar minha localização' }))
    expect(await screen.findByText('Ponto guardado. Não conseguimos confirmar o endereço agora.')).toBeInTheDocument()
    expect(ultimo).toMatchObject({ lat: -23.5901234, lon: -46.6359876, rotulo: null, origem: 'gps' })
  })

  it('acionar anuncia a busca; aria-disabled bloqueia de verdade; digitar descarta o GPS', async () => {
    let responder: PositionCallback = () => {}
    const getCurrentPosition = vi.fn((ok: PositionCallback) => (responder = ok))
    apiFalsa({ 'GET /api/geocode/reverso': Response.json(A) })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
    render(<Tela />)
    const botao = screen.getByRole('button', { name: 'Usar minha localização' })
    await userEvent.click(botao)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Buscando sua localização.'))
    await userEvent.click(botao)
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    await userEvent.type(screen.getByRole('combobox', { name: 'Endereço' }), 'r')
    await act(async () => responder({ coords: { latitude: -23.59, longitude: -46.63, accuracy: 20 } } as GeolocationPosition))
    await new Promise((r) => setTimeout(r, 20))
    expect(ultimo).toBeNull()
  })

  it('o erro recebido fica ligado ao campo de busca', () => {
    apiFalsa({})
    render(<Tela erro="Diga onde está a barreira." />)
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAccessibleDescription(expect.stringContaining('Diga onde está a barreira.'))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/EscolhaLocal.test.tsx`
Expected: FAIL (`Failed to resolve import "../componentes/EscolhaLocal"`).

- [ ] **Step 3: Implementar**

`frontend/src/componentes/EscolhaLocal.tsx`:

```tsx
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar, focoPerdido } from '../a11y/foco'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../api/base'
import { enderecoDoPonto } from '../api/client'
import { arredondar4, ErroLocalizacao, FORA_DA_AREA, obterPosicao, PRECISAO_ACEITAVEL_M, temGeolocalizacao } from '../dados/localizacao'
import { ehFalhaDeConexao, localDeEndereco, NOTA_SEM_CONFIRMAR, type LocalEscolhido } from '../dados/rascunho'
import { CampoEndereco } from './CampoEndereco'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { useAnuncio } from './useAnuncio'
import { useBuscaEndereco } from './useBuscaEndereco'
import { useEsperaServidor } from './useEsperaServidor'

type PropsPonto = { aoMarcar: (local: LocalEscolhido) => void }

type Props = {
  id: string
  local: LocalEscolhido | null
  aoEscolher: (local: LocalEscolhido | null) => void
  /** Erro de quem usa: ligado à busca sem local, e a "Trocar o local" com local. */
  erro?: string | null
  aoEditar?: () => void
}

const MSG_MAPA = 'Não foi possível abrir o mapa. Use a localização ou digite o endereço.'

function textoDoLocal(local: LocalEscolhido): string {
  return local.rotulo ? `Local marcado perto de ${local.rotulo}.` : 'Local marcado, sem endereço confirmado.'
}

/** Três caminhos equivalentes para dizer onde: GPS, busca e mapa. Nenhum depende de arrastar. */
export function EscolhaLocal({ id, local, aoEscolher, erro, aoEditar }: Props) {
  const busca = useBuscaEndereco('Endereço', null, (e) => {
    aoEscolher(localDeEndereco(e))
    setMensagem(null)
  })
  const [buscandoGps, setBuscandoGps] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [PontoNoMapa, setPontoNoMapa] = useState<ComponentType<PropsPonto> | null>(null)
  const [faseMapa, setFaseMapa] = useState<'fechado' | 'carregando' | 'pronto' | 'falhou'>('fechado')
  const espera = useEsperaServidor(buscandoGps)
  const anunciar = useAnuncio()
  const botaoGps = useRef<HTMLButtonElement>(null)
  const botaoMapa = useRef<HTMLButtonElement>(null)
  const marcado = useRef<HTMLParagraphElement>(null)
  const pedidoGps = useRef<{ controle: AbortController; texto: string } | null>(null)

  function cancelarGps() {
    pedidoGps.current?.controle.abort()
    pedidoGps.current = null
    setBuscandoGps(false)
  }

  useEffect(() => () => pedidoGps.current?.controle.abort(), [])

  // a espera diz que nada se perde: o que a pessoa fez nesse meio tempo vale mais que o GPS
  const textoCampo = busca.texto
  useEffect(() => {
    if (pedidoGps.current && pedidoGps.current.texto !== textoCampo) {
      pedidoGps.current.controle.abort()
      pedidoGps.current = null
      setBuscandoGps(false)
    }
  }, [textoCampo])

  // os blocos se trocam, e quem tinha o foco sai da tela. O foco vai ao que entrou e lê o
  // resultado; se a pessoa saiu dali durante a espera, fica onde está e a região anuncia.
  const temLocal = local !== null
  const textoLocal = local ? textoDoLocal(local) : null
  const tinhaLocal = useRef(temLocal)
  useEffect(() => {
    if (tinhaLocal.current === temLocal) return
    tinhaLocal.current = temLocal
    if (temLocal) {
      if (focoPerdido()) marcado.current?.focus()
      else if (textoLocal) anunciar(textoLocal)
    } else if (focoPerdido()) {
      document.getElementById(`${id}-busca`)?.focus()
    }
  }, [temLocal, textoLocal, id, anunciar])

  /** Sem local marcado: o foco vai à busca, que lê o erro. Quem saiu dali ouve pela região. */
  function avisar(texto: string) {
    flushSync(() => setMensagem(texto))
    const campo = document.getElementById(`${id}-busca`)
    if (focoPerdido() || document.activeElement === botaoGps.current || document.activeElement === campo) focarOuAnunciar(campo, texto, anunciar)
    else anunciar(texto)
  }

  async function usarGps() {
    if (buscandoGps) return
    const controle = new AbortController()
    pedidoGps.current = { controle, texto: busca.texto }
    setBuscandoGps(true)
    setMensagem(null)
    anunciar('Buscando sua localização.')
    try {
      const p = await obterPosicao()
      if (controle.signal.aborted) return
      const nota = p.precisaoM > PRECISAO_ACEITAVEL_M ? `A margem do GPS é de cerca de ${Math.round(p.precisaoM)} m. Confira.` : undefined
      try {
        // a barreira usa a coordenada do GPS: o endereço devolvido pode estar a até 50 m
        const e = await enderecoDoPonto(arredondar4(p.lat), arredondar4(p.lon), controle.signal)
        if (controle.signal.aborted) return
        aoEscolher({ lat: p.lat, lon: p.lon, rotulo: e.rotulo, origem: 'gps', nota })
      } catch (erroReverso) {
        if (controle.signal.aborted || ehCancelamento(erroReverso)) return
        if (erroReverso instanceof ErroApi && erroReverso.tipo === 'nao_encontrado' && erroReverso.message !== FORA_DA_AREA) {
          aoEscolher({ lat: p.lat, lon: p.lon, rotulo: null, origem: 'gps', nota: nota ?? 'Sem endereço conhecido a até 50 m; pode registrar neste ponto.' })
        } else if (ehFalhaDeConexao(erroReverso)) {
          // quem está na rua sem sinal não perde o ponto; o 422 do POST segura o que for de fora
          aoEscolher({ lat: p.lat, lon: p.lon, rotulo: null, origem: 'gps', nota: nota ? `${NOTA_SEM_CONFIRMAR} ${nota}` : NOTA_SEM_CONFIRMAR })
        } else {
          avisar(erroReverso instanceof ErroApi ? erroReverso.message : MSG_INESPERADO)
        }
      }
    } catch (erroGps) {
      if (controle.signal.aborted) return
      if (erroGps instanceof ErroLocalizacao) {
        avisar(erroGps.codigo === 1 ? 'O navegador não autorizou a localização. Digite o endereço.' : 'Não conseguimos sua localização agora. Digite o endereço.')
      }
    } finally {
      if (pedidoGps.current?.controle === controle) {
        pedidoGps.current = null
        setBuscandoGps(false)
      }
    }
  }

  // import() à mão: React.lazy guarda a rejeição e derrubaria a página inteira no limite de erro
  async function abrirMapa() {
    if (faseMapa === 'carregando') return
    setFaseMapa('carregando')
    anunciar('Abrindo o mapa.')
    try {
      const modulo = await import('./mapa/PontoNoMapa')
      setPontoNoMapa(() => modulo.default)
      setFaseMapa('pronto')
      anunciar('Mapa aberto. Use os botões abaixo dele.')
    } catch {
      setFaseMapa('falhou')
      anunciar(MSG_MAPA)
    }
  }

  const erroNoCampo = erro ?? mensagem
  return (
    <fieldset className="escolha-local">
      <legend>Onde?</legend>
      {local && (
        <div className="escolha-local__escolhido">
          <p ref={marcado} tabIndex={-1} aria-describedby={local.nota ? `${id}-nota` : undefined}>
            <strong className="escolha-local__rotulo">Local marcado:</strong>{' '}
            {local.rotulo ? `perto de ${local.rotulo}` : 'ponto sem endereço confirmado'}
          </p>
          {local.nota && (
            <p id={`${id}-nota`} className="campo__dica">
              {local.nota}
            </p>
          )}
          {erro && (
            <p id={`${id}-erro`} className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro}</span>
            </p>
          )}
          <Placa
            id={`${id}-trocar`}
            aria-describedby={erro ? `${id}-erro` : undefined}
            onClick={() => {
              aoEditar?.()
              aoEscolher(null)
              busca.limpar()
            }}
          >
            Trocar o local
          </Placa>
        </div>
      )}
      {!local && (
        <>
          {temGeolocalizacao() && (
            <div className="localizacao">
              <Placa ref={botaoGps} pictograma="localizacao" onClick={usarGps} aria-disabled={buscandoGps || undefined}>
                Usar minha localização
              </Placa>
              <p className="campo__dica">Usa o GPS do aparelho uma vez, só quando você aciona.</p>
              {buscandoGps && <p className="campo__retorno">{espera ?? 'Buscando sua localização…'}</p>}
            </div>
          )}
          <CampoEndereco
            id={`${id}-busca`}
            rotulo="Endereço"
            busca={busca}
            erro={erroNoCampo}
            aoEditar={() => {
              setMensagem(null)
              aoEditar?.()
            }}
          />
          <Placa
            ref={botaoMapa}
            pictograma="enquadrar"
            aria-pressed={faseMapa === 'pronto'}
            aria-disabled={faseMapa === 'carregando' || undefined}
            aria-describedby={`${id}-mapa-dica`}
            onClick={() => (faseMapa === 'pronto' ? setFaseMapa('fechado') : void abrirMapa())}
          >
            Escolher no mapa
          </Placa>
          <p id={`${id}-mapa-dica`} className="campo__dica">
            O mapa baixa imagens do OpenStreetMap, que recebe o endereço IP do seu aparelho e a região vista. A localização
            e o endereço levam ao mesmo resultado.
          </p>
          {faseMapa === 'carregando' && <p className="campo__retorno">Abrindo o mapa…</p>}
          {faseMapa === 'falhou' && (
            <div className="campo__retorno">
              <p>{MSG_MAPA}</p>
              <Placa
                onClick={() => {
                  botaoMapa.current?.focus()
                  void abrirMapa()
                }}
              >
                Tentar de novo
              </Placa>
            </div>
          )}
          {faseMapa === 'pronto' && PontoNoMapa && (
            <PontoNoMapa
              aoMarcar={(l) => {
                cancelarGps()
                aoEscolher(l)
              }}
            />
          )}
        </>
      )}
    </fieldset>
  )
}
```

`frontend/src/componentes/mapa/PontoNoMapa.tsx`:

```tsx
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { ehCancelamento, ErroApi, MSG_INESPERADO } from '../../api/base'
import { enderecoDoPonto } from '../../api/client'
import { arredondar4, FORA_DA_AREA } from '../../dados/localizacao'
import { ehFalhaDeConexao, NOTA_SEM_CONFIRMAR, type LocalEscolhido } from '../../dados/rascunho'
import { Pictograma } from '../Pictograma'
import { Placa } from '../Placa'
import { useAnuncio } from '../useAnuncio'
import './mapa.css'
import { MAX_ZOOM, opcoesMapa, ponteiroEhFino, URL_TILES, vigiarTiles } from './opcoesMapa'

/** Centro inicial: Vila Mariana, dentro da área piloto. */
const CENTRO: [number, number] = [-23.59, -46.635]
const PASSO_PX = 100
const MSG_TILES = 'O fundo do mapa não carregou. Use a localização ou digite o endereço.'

const MOVER = [
  { rotulo: 'Norte', dx: 0, dy: -PASSO_PX },
  { rotulo: 'Sul', dx: 0, dy: PASSO_PX },
  { rotulo: 'Leste', dx: PASSO_PX, dy: 0 },
  { rotulo: 'Oeste', dx: -PASSO_PX, dy: 0 },
]

/**
 * Marcar um ponto sem arrastar: a mira fica no centro e o mapa se move por botões reais de
 * 44 px; clicar no mapa centraliza nele. O mapa segue role="img" e sem nada focável dentro,
 * e a mesma tarefa existe nos botões (WCAG 2.5.7). O ponto marcado sempre vira texto.
 */
export default function PontoNoMapa({ aoMarcar }: { aoMarcar: (local: LocalEscolhido) => void }) {
  const contêiner = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<L.Map | null>(null)
  const tilesRef = useRef<L.TileLayer | null>(null)
  const botaoMarcar = useRef<HTMLButtonElement>(null)
  const pedido = useRef<AbortController | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [tilesFalharam, setTilesFalharam] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const anunciar = useAnuncio()

  useEffect(() => {
    const el = contêiner.current
    if (!el) return
    const mapa = L.map(el, opcoesMapa(ponteiroEhFino())).setView(CENTRO, 17, { animate: false })
    mapaRef.current = mapa
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'Mapa para escolher um ponto. Use os botões abaixo do mapa; a mira marca o centro.')
    const tiles = L.tileLayer(URL_TILES, { maxZoom: MAX_ZOOM })
    const pararVigia = vigiarTiles(tiles, () => {
      setTilesFalharam(true)
      anunciar(MSG_TILES)
    })
    tiles.addTo(mapa)
    tilesRef.current = tiles
    mapa.on('click', (e: L.LeafletMouseEvent) => mapa.setView(e.latlng, mapa.getZoom(), { animate: false }))
    return () => {
      pararVigia()
      pedido.current?.abort()
      mapa.remove()
      mapaRef.current = null
    }
  }, [anunciar])

  /** O mapa só mostra para quem enxerga; quem usa leitor de tela precisa saber que ele andou. */
  function mover(acao: (mapa: L.Map) => void, texto: string) {
    const mapa = mapaRef.current
    if (!mapa) return
    acao(mapa)
    anunciar(texto, { chave: 'mover-mapa', intervaloMs: 1500 })
  }

  async function marcar() {
    const mapa = mapaRef.current
    if (!mapa || ocupado) return
    const { lat, lng } = mapa.getCenter()
    const controle = new AbortController()
    pedido.current = controle
    setOcupado(true)
    setMensagem(null)
    try {
      const e = await enderecoDoPonto(arredondar4(lat), arredondar4(lng), controle.signal)
      if (controle.signal.aborted) return
      aoMarcar({ lat, lon: lng, rotulo: e.rotulo, origem: 'mapa' })
    } catch (erro) {
      if (controle.signal.aborted || ehCancelamento(erro)) return
      if (erro instanceof ErroApi && erro.tipo === 'nao_encontrado' && erro.message !== FORA_DA_AREA) {
        aoMarcar({ lat, lon: lng, rotulo: null, origem: 'mapa', nota: 'Sem endereço conhecido a até 50 m; pode registrar neste ponto.' })
      } else if (ehFalhaDeConexao(erro)) {
        aoMarcar({ lat, lon: lng, rotulo: null, origem: 'mapa', nota: NOTA_SEM_CONFIRMAR })
      } else {
        const texto = erro instanceof ErroApi ? erro.message : MSG_INESPERADO
        setMensagem(texto)
        anunciar(texto)
      }
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mapa-rota__corpo">
      <figure className="mapa">
        <div ref={contêiner} className="mapa__leaflet" />
        <Pictograma nome="localizacao" tamanho={36} className="mapa__mira" />
        <figcaption className="mapa__atribuicao">
          © colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
        </figcaption>
      </figure>
      {tilesFalharam && (
        <div className="aviso">
          <span>{MSG_TILES}</span>
          <Placa
            onClick={() => {
              botaoMarcar.current?.focus()
              setTilesFalharam(false)
              tilesRef.current?.redraw()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}
      <div role="group" aria-label="Mover o mapa" className="mapa-rota__controles">
        {MOVER.map((m) => (
          <Placa key={m.rotulo} onClick={() => mover((mapa) => mapa.panBy([m.dx, m.dy], { animate: false }), `Mapa movido para ${m.rotulo.toLowerCase()}.`)}>
            {m.rotulo}
          </Placa>
        ))}
        <Placa pictograma="mais" onClick={() => mover((mapa) => mapa.zoomIn(1, { animate: false }), 'Mapa aproximado.')}>
          Aproximar
        </Placa>
        <Placa pictograma="menos" onClick={() => mover((mapa) => mapa.zoomOut(1, { animate: false }), 'Mapa afastado.')}>
          Afastar
        </Placa>
      </div>
      <Placa ref={botaoMarcar} pictograma="localizacao" onClick={marcar} aria-disabled={ocupado || undefined}>
        Marcar o centro do mapa
      </Placa>
      {mensagem && <p className="campo__retorno campo__retorno--erro">{mensagem}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/EscolhaLocal.test.tsx`
Expected: PASS, 12 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 27 arquivos, 239 testes passando.

---

### Task 19: `/barreiras`

**Files:**
- Create: `frontend/src/pages/Barreiras.tsx`, `frontend/src/test/Barreiras.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `listarProximas`, `enderecoDoPonto`, `useConsulta`, `EscolhaLocal`, `textoStatus`, `textoEfeito`, `distanciaDirecao`, `rotuloCategoria`.
- Produces: `Barreiras`, que aceita `location.state = { ponto: [lat, lon], rotuloPonto }` e o repassa à ficha; item "Barreiras" no menu.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/Barreiras.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { apiFalsa } from './apiFalsa'
import { A, abrir, ficha, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/barreiras', () => {
  it('vindo de um passo usa o ponto do state e mostra a lista só com endereços prontos; nada na URL', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([ficha(), ficha({ id: 6, categoria: 'buraco', severidade: 'dificulta' })]), 'GET /api/geocode/reverso': Response.json(A) })
    const { container } = abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    const lista = (await screen.findByRole('heading', { level: 3, name: 'Escada' })).closest('ol')!
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lista).getAllByText(/perto de Rua A, 1/)).toHaveLength(2)
    expect(within(lista).getByRole('heading', { level: 3, name: 'Escada' })).toBeInTheDocument()
    expect(new URL(api.de('GET /api/barreiras')[0].url).searchParams.get('raio_m')).toBe('200')
    expect(screen.getByRole('link', { name: 'Registrar barreira neste ponto' })).toHaveAttribute('href', '/barreiras/nova')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 barreiras a até 200 metros.'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('lista vazia não diz que não há barreira; dá para ampliar o raio', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([]) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    expect(await screen.findByText('Nenhuma barreira registrada a até 200 m. Isso não quer dizer que não haja.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver até 500 m' }))
    await waitFor(() => expect(api.de('GET /api/barreiras')).toHaveLength(2))
    expect(new URL(api.de('GET /api/barreiras')[1].url).searchParams.get('raio_m')).toBe('500')
  })

  it('trocar o raio não anuncia a contagem antiga com o raio novo; o foco não cai', async () => {
    let responder: (r: Response) => void = () => {}
    let vez = 0
    apiFalsa({ 'GET /api/barreiras': () => (++vez === 1 ? Response.json([ficha()]) : new Promise<Response>((r) => (responder = r))), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 barreira a até 200 metros.'))
    await user.click(screen.getByRole('button', { name: 'Ver até 500 m' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Registradas aqui' })).toHaveFocus()
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.getByRole('status')).not.toHaveTextContent('a até 500 metros')
    expect(screen.queryByRole('heading', { level: 3, name: 'Escada' })).toBeNull()
    responder(Response.json([]))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nenhuma barreira registrada a até 500 metros.'))
  })

  it('trocar o local apaga a lista antiga e nada da consulta cancelada é anunciado', async () => {
    apiFalsa({ 'GET /api/barreiras': Response.json([]), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    await screen.findByText(/Isso não quer dizer que não haja/)
    await user.click(screen.getByRole('button', { name: 'Trocar o local' }))
    expect(screen.queryByText(/Isso não quer dizer que não haja/)).toBeNull()
    expect(screen.getByText('Escolha um ponto para ver as barreiras registradas perto dele.')).toBeInTheDocument()
    expect(screen.queryByText('Buscando barreiras…')).toBeNull()
  })

  it('"Tentar de novo" some, e o foco vai ao título da lista', async () => {
    let vez = 0
    apiFalsa({ 'GET /api/barreiras': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json([])) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635] })
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Registradas aqui' })).toHaveFocus()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Barreiras.test.tsx`
Expected: FAIL (`/barreiras` cai em "Página não encontrada").

- [ ] **Step 3: Implementar**

`frontend/src/pages/Barreiras.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { ehCancelamento } from '../api/base'
import { enderecoDoPonto } from '../api/client'
import { listarProximas, type Barreira } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useConsulta } from '../api/useConsulta'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { Placa } from '../componentes/Placa'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { distanciaDirecao, textoEfeito, textoStatus } from '../dados/barreira'
import { rotuloCategoria } from '../dados/categorias'
import { arredondar4 } from '../dados/localizacao'
import type { LocalEscolhido } from '../dados/rascunho'
import '../estilos/colaborar.css'

type Item = { barreira: Barreira; endereco: string | null }

/** Vindo de um passo, o ponto chega por location.state: nunca na URL. */
type EstadoNavegacao = { ponto?: [number, number]; rotuloPonto?: string } | null

/** Até 20 itens. A lista só aparece com os endereços prontos, para nada pular de lugar. */
async function carregar(lat: number, lon: number, raio: number, sinal: AbortSignal): Promise<Item[]> {
  const barreiras = await listarProximas(lat, lon, raio, sinal)
  return Promise.all(
    barreiras.slice(0, 20).map(async (barreira) => {
      try {
        const e = await enderecoDoPonto(arredondar4(barreira.lat), arredondar4(barreira.lon), sinal)
        return { barreira, endereco: e.rotulo }
      } catch (erro) {
        if (ehCancelamento(erro)) throw erro
        return { barreira, endereco: null } // reverso que falha cai só na distância
      }
    }),
  )
}

export function Barreiras() {
  const h1 = usePaginaAcessivel('Barreiras por perto')
  const estadoNav = useLocation().state as EstadoNavegacao
  const [local, setLocal] = useState<LocalEscolhido | null>(
    estadoNav?.ponto
      ? { lat: estadoNav.ponto[0], lon: estadoNav.ponto[1], rotulo: estadoNav.rotuloPonto ?? null, origem: 'passo' }
      : null,
  )
  const [raio, setRaio] = useState(200)
  const anunciar = useAnuncio()
  const tituloLista = useRef<HTMLHeadingElement>(null)

  useEffect(() => aquecerServidor(), [])

  const chave = local ? `${local.lat},${local.lon},${raio}` : null
  const { dados, erro, carregando, recarregar } = useConsulta(chave, (sinal) => carregar(local!.lat, local!.lon, raio, sinal))
  const espera = useEsperaServidor(carregando)

  useEffect(() => {
    if (erro) anunciar(erro.message)
    else if (dados) {
      const n = dados.length
      anunciar(n === 0 ? `Nenhuma barreira registrada a até ${raio} metros.` : `${n} ${n === 1 ? 'barreira' : 'barreiras'} a até ${raio} metros.`)
    }
  }, [dados, erro, raio, anunciar])

  return (
    <div className="colaborar">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Barreiras por perto
        </h1>
        <p className="subtitulo">Veja o que já foi registrado perto de um ponto e confirme, conteste ou diga que foi resolvido.</p>
      </div>

      <form className="formulario" aria-label="Escolher o ponto" onSubmit={(e) => e.preventDefault()}>
        <EscolhaLocal id="perto" local={local} aoEscolher={setLocal} />
      </form>

      <section className="colaborar__lista" aria-labelledby="titulo-lista">
        <h2 id="titulo-lista" ref={tituloLista} tabIndex={-1} className="letreiro colaborar__titulo">
          Registradas aqui
        </h2>
        {!local && <p>Escolha um ponto para ver as barreiras registradas perto dele.</p>}
        {carregando && <p>{espera ?? 'Buscando barreiras…'}</p>}
        {erro && (
          <>
            <p>{erro.message}</p>
            <Placa
              onClick={() => {
                tituloLista.current?.focus()
                recarregar()
              }}
            >
              Tentar de novo
            </Placa>
          </>
        )}
        {dados && dados.length === 0 && <p>Nenhuma barreira registrada a até {raio} m. Isso não quer dizer que não haja.</p>}
        {dados && dados.length > 0 && local && (
          <ol className="lista-gravada">
            {dados.map(({ barreira: b, endereco }) => (
              <li key={b.id}>
                <h3 className="letreiro">{rotuloCategoria(b.categoria)}</h3>
                <p>
                  {textoStatus(b)}. {textoEfeito(b)}
                </p>
                <p>
                  <span className="medida">{distanciaDirecao([local.lat, local.lon], b)}</span>
                  {endereco && `, perto de ${endereco}`}.
                </p>
                <Link
                  className="alvo"
                  to={`/barreiras/${b.id}`}
                  state={{ ponto: [local.lat, local.lon], rotuloPonto: local.rotulo ?? undefined }}
                  aria-label={`Ver e votar: ${rotuloCategoria(b.categoria)}, ${distanciaDirecao([local.lat, local.lon], b)}`}
                >
                  Ver e votar
                </Link>
              </li>
            ))}
          </ol>
        )}
        {local && raio === 200 && dados && dados.length < 5 && (
          <Placa
            onClick={() => {
              tituloLista.current?.focus()
              setRaio(500)
            }}
          >
            Ver até 500 m
          </Placa>
        )}
        {local && (
          <p>
            <Link className="alvo" to="/barreiras/nova" state={{ local }}>
              Registrar barreira neste ponto
            </Link>
          </p>
        )}
      </section>
    </div>
  )
}
```

Em `frontend/src/App.tsx`, acrescente:

```tsx
const Barreiras = lazy(() => import('./pages/Barreiras').then((m) => ({ default: m.Barreiras })))
```

```tsx
                <Route path="/barreiras" element={<Barreiras />} />
```

E, no menu, depois de "Planejar rota":

```tsx
                <li>
                  <NavLink className="alvo" to="/barreiras">
                    Barreiras
                  </NavLink>
                </li>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Barreiras.test.tsx`
Expected: PASS, 5 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 28 arquivos, 244 testes passando.

---

### Task 20: Ficha da barreira, votos e foto

**Files:**
- Create: `frontend/src/pages/Barreira.tsx`, `frontend/src/componentes/Votacao.tsx`, `frontend/src/componentes/FotoBarreira.tsx`, `frontend/src/test/FichaBarreira.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `obterBarreira`, `votar`, `anexarFoto`, `removerFoto`, `useAcaoComLogin`, `PortaoLogin`, `lembrarMinha`, `lerMinhas`, `erroDoArquivo`, `erroDaDescricao`.
- Produces: `Barreira`, que aceita `location.state = { recemCriada, jaExistia, ponto, rotuloPonto }`, consome `recemCriada` na chegada e devolve o ponto em "Ver outras barreiras"; `Votacao({ barreira, ehAutor, aoAtualizar, aoRecarregar, aoDescobrirAutor })`, `MSG_AUTOR`; `FotoBarreira({ barreira, aoAtualizar })`.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/FichaBarreira.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { lembrarMinha } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { A, CONTA, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/barreiras/:id', () => {
  const REVERSO = { 'GET /api/geocode/reverso': Response.json(A) }

  it('ficha pública diz status, efeito e fonte; o voto sem login abre o portão', async () => {
    const api = apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    const user = userEvent.setup()
    const { container } = abrir('/barreiras/5')
    expect(await screen.findByRole('heading', { level: 1, name: 'Escada' })).toBeInTheDocument()
    expect(screen.getByText('Aguardando confirmação.')).toBeInTheDocument()
    expect(screen.getByText(/Ainda não muda a rota. Falta 1 confirmação./)).toBeInTheDocument()
    expect(screen.getByText(/relato de colaboradores, não verificado pela Prefeitura/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmo' })).toHaveAccessibleDescription(expect.stringContaining('Com 2 confirmações, a rota passa a evitar'))
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })).toHaveFocus()
    expect(api.de('PUT /api/barreiras/5/voto')).toHaveLength(0)
  })

  it('votar mantém o foco no botão, anuncia e marca aria-pressed', async () => {
    const api = apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': Response.json(ficha()),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': Response.json(ficha({ status: 'validada', votos: { confirma: 2, contesta: 0, resolvida: 0 } })),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const confirmo = await screen.findByRole('button', { name: 'Confirmo' })
    await user.click(confirmo)
    await waitFor(() => expect(confirmo).toHaveAttribute('aria-pressed', 'true'))
    expect(confirmo).toHaveFocus()
    expect(JSON.parse(String(api.de('PUT /api/barreiras/5/voto')[0].init.body))).toEqual({ voto: 'confirma' })
    expect((api.de('PUT /api/barreiras/5/voto')[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tkn')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Voto registrado. Agora são 2 confirmações. A rota evita este ponto.'))
    expect(screen.getByText('Recalcule a rota para ver a mudança.')).toBeInTheDocument()
  })

  it('403 troca os botões, lembra a barreira e oferece a foto', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': erroApi(403, 'Quem cadastrou não vota.') })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByText('Você cadastrou esta barreira; quem vota são outras pessoas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    // os botões sumiram: o foco vai à frase, que se lê sozinha
    expect(screen.getByText('Você cadastrou esta barreira; quem vota são outras pessoas.')).toHaveFocus()
    expect(localStorage.getItem(`rf:minhas:${CONTA.id}`)).toBe('[5]')
    expect(screen.getByRole('heading', { level: 2, name: 'Foto (opcional)' })).toBeInTheDocument()
  })

  it('409 mostra a mensagem e relê a ficha', async () => {
    let leituras = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => Response.json(ficha(++leituras > 1 ? { status: 'contestada' } : {})),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': erroApi(409, 'A votação desta barreira já encerrou.'),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Confirmo' }))
    expect(await screen.findByText(/Pessoas disseram que não existe/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
  })

  it('status encerrado não mostra botões; 404 diz que não está disponível', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha({ status: 'expirada' })), ...REVERSO })
    const { unmount } = abrir('/barreiras/5')
    expect(await screen.findByText(/Ninguém confirmou no prazo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
    unmount()
    apiFalsa({ 'GET /api/barreiras/5': erroApi(404, 'Barreira não encontrada.') })
    abrir('/barreiras/5')
    expect(await screen.findByText('Esta barreira não está mais disponível.')).toBeInTheDocument()
  })

  it('foto: exige descrição, mostra a prévia com alt, manda multipart sem Content-Type e exibe com alt', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:previa')
    URL.revokeObjectURL = vi.fn()
    const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada de três degraus' })
    const api = apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'POST /api/barreiras/5/foto': Response.json(comFoto) })
    lembrarMinha(CONTA.id, 5)
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
    const arquivo = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Arquivo da foto'), arquivo)
    expect(screen.getByRole('img', { name: 'Prévia da foto, ainda sem descrição' })).toHaveAttribute('src', 'blob:previa')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    expect(screen.getByRole('textbox', { name: 'O que a foto mostra' })).toHaveFocus()
    expect(api.de('POST /api/barreiras/5/foto')).toHaveLength(0)
    await user.type(screen.getByRole('textbox', { name: 'O que a foto mostra' }), 'Escada de três degraus')
    await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
    await waitFor(() => expect(api.de('POST /api/barreiras/5/foto')).toHaveLength(1))
    const { init } = api.de('POST /api/barreiras/5/foto')[0]
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers).toEqual({ Authorization: 'Bearer tkn' })
    expect(await screen.findByRole('img', { name: 'Escada de três degraus' })).toHaveAttribute('src', comFoto.foto_url)
  })

  it('quando os dados chegam, a ficha é anunciada: o h1 focado mudou sem fala', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    abrir('/barreiras/5')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Escada. Aguardando confirmação. Ainda não muda a rota.'))
  })

  it('o voto que encerra a votação leva o foco ao efeito, sem anunciar por cima', async () => {
    apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': Response.json(ficha({ status: 'contestada' })) })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Escada.'))
    await user.click(await screen.findByRole('button', { name: 'Não existe' }))
    const efeito = await screen.findByText(/Pessoas disseram que não existe/)
    await waitFor(() => expect(efeito).toHaveFocus())
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status')).not.toHaveTextContent('Voto registrado')
  })

  it('cancelar e concluir o portão devolvem o foco ao botão do voto', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO, 'PUT /api/barreiras/5/voto': Response.json(ficha({ votos: { confirma: 1, contesta: 1, resolvida: 0 } })) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const botao = await screen.findByRole('button', { name: 'Não existe' })
    await user.click(botao)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(botao).toHaveFocus()

    await user.click(botao)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('PUT /api/barreiras/5/voto')).toHaveLength(1))
    expect(botao).toHaveFocus()
  })

  it('depois de um voto, um 409 ainda relê a ficha', async () => {
    let leituras = 0
    let votos = 0
    apiFalsa({
      ...logar(),
      'GET /api/barreiras/5': () => Response.json(ficha(++leituras > 1 ? { status: 'contestada' } : {})),
      ...REVERSO,
      'PUT /api/barreiras/5/voto': () => (++votos === 1 ? Response.json(ficha({ votos: { confirma: 2, contesta: 0, resolvida: 0 } })) : erroApi(409, 'Esta barreira não recebe mais votos.')),
    })
    const user = userEvent.setup()
    abrir('/barreiras/5')
    const confirmo = await screen.findByRole('button', { name: 'Confirmo' })
    await user.click(confirmo)
    await waitFor(() => expect(confirmo).toHaveAttribute('aria-pressed', 'true'))
    await user.click(screen.getByRole('button', { name: 'Não existe' }))
    expect(await screen.findByText(/Pessoas disseram que não existe/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmo' })).toBeNull()
  })

  it('endereço: "buscando" na carga, "indisponível" na falha, "50 m" só no 404', async () => {
    let soltar: (r: Response) => void = () => {}
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': () => new Promise<Response>((r) => (soltar = r)) })
    const { unmount } = abrir('/barreiras/5')
    expect(await screen.findByText('Buscando o endereço…')).toBeInTheDocument()
    expect(screen.queryByText(/a até 50 m/)).toBeNull()
    soltar(erroApi(404, 'Nenhum endereço conhecido a até 50 metros deste ponto.'))
    expect(await screen.findByText('Sem endereço conhecido a até 50 m.')).toBeInTheDocument()
    unmount()
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': new Response('x', { status: 503 }) })
    abrir('/barreiras/5')
    expect(await screen.findByText('Endereço indisponível agora.')).toBeInTheDocument()
  })

  it('barreira que bloqueia avisa da exceção da rota de reserva', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha({ status: 'validada' })), ...REVERSO })
    abrir('/barreiras/5')
    expect(await screen.findByText(/a rota de reserva, usada quando o serviço principal cai, ainda não considera este registro/i)).toBeInTheDocument()
  })

  it('"recém-criada" não sobrevive no histórico: outra conta não herda a autoria', async () => {
    apiFalsa({ 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
    let estado: unknown = 'inicial'
    function Espia() {
      estado = useLocation().state
      return null
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/barreiras/5', state: { recemCriada: true, jaExistia: false } }]}>
        <App />
        <Espia />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeInTheDocument()
    await waitFor(() => expect(estado).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeInTheDocument()
  })

  it('ida à ficha e volta por "Ver outras barreiras" mantêm o ponto, sem URL', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([ficha()]), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    const user = userEvent.setup()
    abrir('/barreiras', { ponto: [-23.59, -46.635], rotuloPonto: 'Meio do passo 3' })
    await user.click(await screen.findByRole('link', { name: /Ver e votar: Escada/ }))
    await user.click(await screen.findByRole('link', { name: 'Ver outras barreiras' }))
    await screen.findByRole('heading', { level: 1, name: 'Barreiras por perto' })
    await waitFor(() => expect(api.de('GET /api/barreiras')).toHaveLength(2))
    expect(screen.getByText(/Meio do passo 3/)).toBeInTheDocument()
    expect(screen.queryByText('Escolha um ponto para ver as barreiras registradas perto dele.')).toBeNull()
  })

  describe('foto: erros ligados ao campo', () => {
    function comoAutora() {
      URL.createObjectURL = vi.fn(() => 'blob:previa')
      URL.revokeObjectURL = vi.fn()
      lembrarMinha(CONTA.id, 5)
    }

    it('descrição curta marca o campo e liga a mensagem; Enviar sem arquivo também', async () => {
      comoAutora()
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
      const user = userEvent.setup()
      abrir('/barreiras/5')
      await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
      await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
      const arquivo = screen.getByLabelText('Arquivo da foto')
      expect(arquivo).toHaveFocus()
      expect(arquivo).toHaveAttribute('aria-invalid', 'true')
      expect(arquivo).toHaveAccessibleDescription(expect.stringContaining('Escolha uma foto.'))
      await user.upload(arquivo, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
      await user.click(screen.getByRole('button', { name: 'Enviar foto' }))
      const descricao = screen.getByRole('textbox', { name: 'O que a foto mostra' })
      expect(descricao).toHaveFocus()
      expect(descricao).toHaveAttribute('aria-invalid', 'true')
      expect(descricao).toHaveAccessibleDescription(expect.stringContaining('Descreva a foto em 5 a 300 caracteres'))
    })

    it('arquivo inválido: com o foco no campo, a região anuncia', async () => {
      comoAutora()
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(ficha()), ...REVERSO })
      abrir('/barreiras/5')
      await screen.findByRole('heading', { level: 2, name: 'Foto (opcional)' })
      const arquivo = screen.getByLabelText('Arquivo da foto')
      // no navegador o campo segue focado quando o seletor de arquivos fecha; o user.upload simula um blur
      arquivo.focus()
      fireEvent.change(arquivo, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } })
      expect(arquivo).toHaveFocus()
      expect(arquivo).toHaveAttribute('aria-invalid', 'true')
      expect(arquivo).toHaveAccessibleDescription(expect.stringContaining('Use uma foto em JPEG, PNG ou WebP.'))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Use uma foto em JPEG, PNG ou WebP.'))
    })

    it('"Remover foto" some: o foco vai ao retorno, que se lê sozinho', async () => {
      comoAutora()
      const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada de três degraus' })
      apiFalsa({ ...logar(), 'GET /api/barreiras/5': Response.json(comFoto), ...REVERSO, 'DELETE /api/barreiras/5/foto': Response.json(ficha()) })
      const user = userEvent.setup()
      abrir('/barreiras/5')
      await user.click(await screen.findByRole('button', { name: 'Remover foto' }))
      const retorno = await screen.findByText('Foto removida.')
      await waitFor(() => expect(retorno).toHaveFocus())
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/FichaBarreira.test.tsx`
Expected: FAIL (`/barreiras/5` cai em "Página não encontrada").

- [ ] **Step 3: Implementar**

`frontend/src/componentes/Votacao.tsx`:

```tsx
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { focoPerdido } from '../a11y/foco'
import { votar, type Barreira, type Voto } from '../api/colaboracao'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { useSessao } from '../auth/useSessao'
import { explicacaoVoto, ROTULO_VOTO, textoEfeito, votacaoEncerrada } from '../dados/barreira'
import { lembrarMinha } from '../dados/rascunho'
import { Placa } from './Placa'
import { PortaoLogin } from './PortaoLogin'
import { useAnuncio } from './useAnuncio'
import { useEsperaServidor } from './useEsperaServidor'

const VOTOS: Voto[] = ['confirma', 'contesta', 'resolvida']
export const MSG_AUTOR = 'Você cadastrou esta barreira; quem vota são outras pessoas.'

type Props = {
  barreira: Barreira
  ehAutor: boolean
  aoAtualizar: (b: Barreira) => void
  aoRecarregar: () => void
  aoDescobrirAutor: () => void
}

export function Votacao({ barreira, ehAutor, aoAtualizar, aoRecarregar, aoDescobrirAutor }: Props) {
  const [meuVoto, setMeuVoto] = useState<Voto | null>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const ultimo = useRef<Voto | null>(null)
  const botaoDoVoto = useRef<HTMLElement | null>(null)
  const fraseAutor = useRef<HTMLParagraphElement>(null)
  const descobriuAutor = useRef(false)
  const anunciar = useAnuncio()
  const { conta } = useSessao()

  const acao = useAcaoComLogin(
    (token: string, voto: Voto) => votar(token, barreira.id, voto),
    (atualizada) => {
      setMeuVoto(ultimo.current)
      setMensagem(null)
      aoAtualizar(atualizada)
      // o voto que encerra tira esta seção da tela: a ficha é quem diz o resultado
      if (votacaoEncerrada(atualizada)) return
      const n = atualizada.votos.confirma
      anunciar(`Voto registrado. Agora são ${n} ${n === 1 ? 'confirmação' : 'confirmações'}. ${textoEfeito(atualizada)}`)
    },
  )
  const enviando = acao.estado.fase === 'enviando'
  const espera = useEsperaServidor(enviando)

  const erro = acao.estado.fase === 'erro' ? acao.estado.erro : null
  useEffect(() => {
    if (!erro) return
    // o único 403 de PUT /voto é de autor (services/votacao.py): os botões saem da tela
    if (erro.tipo === 'permissao') {
      if (conta) lembrarMinha(conta.id, barreira.id)
      descobriuAutor.current = true
      aoDescobrirAutor()
      return
    }
    setMensagem(erro.message)
    anunciar(erro.message)
    if (erro.tipo === 'conflito' || erro.tipo === 'nao_encontrado') aoRecarregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erro])

  useEffect(() => {
    if (!ehAutor || !descobriuAutor.current) return
    descobriuAutor.current = false
    if (focoPerdido()) fraseAutor.current?.focus()
    else anunciar(MSG_AUTOR)
  }, [ehAutor, anunciar])

  if (ehAutor) {
    return (
      <p ref={fraseAutor} tabIndex={-1}>
        {MSG_AUTOR}
      </p>
    )
  }

  function votarCom(voto: Voto, e: MouseEvent<HTMLButtonElement>) {
    if (enviando) return
    ultimo.current = voto
    botaoDoVoto.current = e.currentTarget
    void acao.executar(voto)
  }

  return (
    <section className="votacao" aria-labelledby="titulo-votacao">
      <h2 id="titulo-votacao" className="letreiro colaborar__titulo">
        Você passou por aqui?
      </h2>
      <div className="votacao__opcoes">
        {VOTOS.map((voto) => (
          <div key={voto} className="votacao__opcao">
            <Placa aria-pressed={meuVoto === voto} aria-disabled={enviando || undefined} aria-describedby={`voto-${voto}`} onClick={(e) => votarCom(voto, e)}>
              {ROTULO_VOTO[voto]}
            </Placa>
            <p id={`voto-${voto}`} className="campo__dica">
              {explicacaoVoto(voto, barreira)}
            </p>
          </div>
        ))}
      </div>
      {enviando && <p className="campo__retorno">{espera ?? 'Registrando o voto…'}</p>}
      {mensagem && <p className="campo__retorno campo__retorno--erro">{mensagem}</p>}
      <p className="campo__dica">
        Seu voto conta uma vez. Votar de novo troca o voto. Quem usa o site não vê quem votou; a moderação vê um código da
        conta, nunca o e-mail, para auditoria.
      </p>
      {acao.estado.fase === 'login' && <PortaoLogin motivo={acao.estado.motivo} refRetorno={botaoDoVoto} aoEntrar={acao.concluirLogin} aoCancelar={acao.cancelarLogin} />}
    </section>
  )
}
```

`frontend/src/componentes/FotoBarreira.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { focarOuAnunciar, focoPerdido } from '../a11y/foco'
import { anexarFoto, removerFoto, type Barreira } from '../api/colaboracao'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { erroDaDescricao, erroDoArquivo } from '../dados/barreira'
import { Pictograma } from './Pictograma'
import { Placa } from './Placa'
import { PortaoLogin } from './PortaoLogin'
import { useAnuncio } from './useAnuncio'

const MSG_FOTO_FORA = 'Envio de foto indisponível. Sua barreira já está registrada.'

type ErroCampo = { campo: 'arquivo' | 'descricao'; texto: string }

/** Foto sempre opcional, sem zona de arrastar: o input nativo é a via única e basta (2.5.7). */
export function FotoBarreira({ barreira, aoAtualizar }: { barreira: Barreira; aoAtualizar: (b: Barreira) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [descricao, setDescricao] = useState('')
  const [erro, setErro] = useState<ErroCampo | null>(null)
  const [removida, setRemovida] = useState(false)
  const campoDescricao = useRef<HTMLTextAreaElement>(null)
  const campoArquivo = useRef<HTMLInputElement>(null)
  const botaoEnviar = useRef<HTMLButtonElement>(null)
  const botaoRemover = useRef<HTMLButtonElement>(null)
  const retornoRemocao = useRef<HTMLParagraphElement>(null)
  const anunciar = useAnuncio()

  useEffect(() => {
    if (!arquivo) {
      setPrevia(null)
      return
    }
    const url = URL.createObjectURL(arquivo)
    setPrevia(url)
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  function marcarErro(novo: ErroCampo, campo: HTMLElement | null) {
    flushSync(() => setErro(novo))
    focarOuAnunciar(campo, novo.texto, anunciar)
  }

  function montarEnvio(): [File, string] | null {
    if (!arquivo) {
      marcarErro({ campo: 'arquivo', texto: 'Escolha uma foto.' }, campoArquivo.current)
      return null
    }
    const invalida = erroDaDescricao(descricao)
    if (invalida) {
      marcarErro({ campo: 'descricao', texto: invalida }, campoDescricao.current)
      return null
    }
    setErro(null)
    return [arquivo, descricao.trim()]
  }

  const envio = useAcaoComLogin(
    (token: string, a: File, d: string) => anexarFoto(token, barreira.id, a, d),
    (atualizada) => {
      setArquivo(null)
      setDescricao('')
      setErro(null)
      setRemovida(false)
      aoAtualizar(atualizada)
      anunciar('Foto enviada.')
    },
    montarEnvio,
  )
  const remocao = useAcaoComLogin(
    (token: string) => removerFoto(token, barreira.id),
    (atualizada) => {
      setRemovida(true)
      aoAtualizar(atualizada)
    },
  )

  // "Remover foto" sai da tela com o sucesso: o foco vai à frase, que se lê sozinha
  useEffect(() => {
    if (!removida) return
    if (focoPerdido()) retornoRemocao.current?.focus()
    else anunciar('Foto removida.')
  }, [removida, anunciar])

  const falha = envio.estado.fase === 'erro' ? envio.estado.erro : remocao.estado.fase === 'erro' ? remocao.estado.erro : null
  const mensagemFalha = falha ? (falha.tipo === 'indisponivel' ? MSG_FOTO_FORA : falha.message) : null
  useEffect(() => {
    if (mensagemFalha) anunciar(mensagemFalha)
  }, [mensagemFalha, anunciar])

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (envio.estado.fase === 'enviando') return
    const args = montarEnvio()
    if (args) void envio.executar(...args)
  }

  return (
    <section className="foto" aria-labelledby="titulo-foto">
      <h2 id="titulo-foto" className="letreiro colaborar__titulo">
        Foto (opcional)
      </h2>
      {barreira.foto_url && (
        <Placa ref={botaoRemover} onClick={() => void remocao.executar()}>
          Remover foto
        </Placa>
      )}
      {removida && !barreira.foto_url && (
        <p ref={retornoRemocao} tabIndex={-1} className="campo__retorno">
          Foto removida.
        </p>
      )}
      <form onSubmit={enviar} noValidate className="foto__form" aria-label="Enviar foto">
        <div className="campo">
          <label htmlFor="foto-arquivo">Arquivo da foto</label>
          <p id="foto-aviso" className="campo__dica">
            Removemos a localização gravada na foto. Evite rostos e placas de carro; não há borramento automático.
          </p>
          <input
            ref={campoArquivo}
            id="foto-arquivo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-invalid={erro?.campo === 'arquivo' ? true : undefined}
            aria-describedby={erro?.campo === 'arquivo' ? 'foto-aviso foto-erro-arquivo' : 'foto-aviso'}
            onChange={(e) => {
              const escolhido = e.target.files?.[0] ?? null
              const invalido = escolhido && erroDoArquivo(escolhido)
              setArquivo(invalido ? null : escolhido)
              if (invalido) marcarErro({ campo: 'arquivo', texto: invalido }, e.target)
              else setErro(null)
            }}
          />
          {erro?.campo === 'arquivo' && (
            <p id="foto-erro-arquivo" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro.texto}</span>
            </p>
          )}
        </div>
        {previa && <img className="foto__previa" src={previa} alt={descricao.trim() || 'Prévia da foto, ainda sem descrição'} />}
        <div className="campo">
          <label htmlFor="foto-descricao">O que a foto mostra</label>
          <p id="foto-dica" className="campo__dica">
            Quem não enxerga a foto vai ouvir este texto. De 5 a 300 caracteres.
          </p>
          <textarea
            ref={campoDescricao}
            id="foto-descricao"
            rows={2}
            maxLength={300}
            aria-invalid={erro?.campo === 'descricao' ? true : undefined}
            aria-describedby={erro?.campo === 'descricao' ? 'foto-dica foto-erro-descricao' : 'foto-dica'}
            value={descricao}
            onChange={(e) => {
              setDescricao(e.target.value)
              if (erro?.campo === 'descricao') setErro(null)
            }}
          />
          {erro?.campo === 'descricao' && (
            <p id="foto-erro-descricao" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erro.texto}</span>
            </p>
          )}
        </div>
        {mensagemFalha && (
          <p className="campo__retorno campo__retorno--erro">
            <Pictograma nome="alerta" />
            <span>{mensagemFalha}</span>
          </p>
        )}
        <Placa ref={botaoEnviar} type="submit" pictograma="foto" aria-disabled={envio.estado.fase === 'enviando' || undefined}>
          Enviar foto
        </Placa>
      </form>
      {envio.estado.fase === 'login' && <PortaoLogin motivo={envio.estado.motivo} refRetorno={botaoEnviar} aoEntrar={envio.concluirLogin} aoCancelar={envio.cancelarLogin} />}
      {remocao.estado.fase === 'login' && <PortaoLogin motivo={remocao.estado.motivo} refRetorno={botaoRemover} aoEntrar={remocao.concluirLogin} aoCancelar={remocao.cancelarLogin} />}
    </section>
  )
}
```

`frontend/src/pages/Barreira.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { focoPerdido } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { enderecoDoPonto } from '../api/client'
import { obterBarreira } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useConsulta } from '../api/useConsulta'
import { useSessao } from '../auth/useSessao'
import { FotoBarreira } from '../componentes/FotoBarreira'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { Votacao } from '../componentes/Votacao'
import { AVISO_ROTA_RESERVA, formatarDia, textoEfeito, textoStatus, textoVotos, votacaoEncerrada } from '../dados/barreira'
import { rotuloCategoria } from '../dados/categorias'
import { arredondar4 } from '../dados/localizacao'
import { lembrarMinha, lerMinhas } from '../dados/rascunho'
import '../estilos/colaborar.css'
import '../estilos/rota.css'

type EstadoNavegacao = { recemCriada?: boolean; jaExistia?: boolean; ponto?: [number, number]; rotuloPonto?: string } | null

export function Barreira() {
  const { id } = useParams()
  const numero = Number(id)
  const local = useLocation()
  const navegar = useNavigate()
  const estadoNav = local.state as EstadoNavegacao
  // vale para esta visita: o histórico não guarda quem criou (efeito abaixo)
  const [chegada] = useState(() => ({
    recemCriada: estadoNav?.recemCriada === true,
    jaExistia: estadoNav?.jaExistia === true,
    ponto: estadoNav?.ponto,
    rotuloPonto: estadoNav?.rotuloPonto,
  }))
  const { recemCriada } = chegada
  const volta = chegada.ponto ? { ponto: chegada.ponto, rotuloPonto: chegada.rotuloPonto } : null
  const h1 = usePaginaAcessivel(recemCriada ? 'Barreira registrada' : 'Ficha da barreira')
  const { logado, conta, carregarConta } = useSessao()
  const anunciar = useAnuncio()
  const valido = Number.isInteger(numero) && numero > 0
  const consulta = useConsulta(valido ? `barreira-${numero}` : null, (sinal) => obterBarreira(numero, sinal))
  const espera = useEsperaServidor(consulta.carregando)
  const [autorNestaVisita, setAutorNestaVisita] = useState(false)
  const efeito = useRef<HTMLParagraphElement>(null)
  const barreira = consulta.dados

  useEffect(() => aquecerServidor(), [])

  useEffect(() => {
    // outra conta, voltando pelo histórico, não pode herdar "você cadastrou esta barreira"
    if (estadoNav?.recemCriada) navegar(local.pathname, { replace: true, state: volta })
    // só na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (logado) carregarConta().catch(() => {})
  }, [logado, carregarConta])

  useEffect(() => {
    if (recemCriada && conta) lembrarMinha(conta.id, numero)
  }, [recemCriada, conta, numero])

  const endereco = useConsulta(barreira ? `end-${barreira.id}` : null, (sinal) =>
    enderecoDoPonto(arredondar4(barreira!.lat), arredondar4(barreira!.lon), sinal),
  )

  const naoExiste = consulta.erro?.tipo === 'nao_encontrado' || !valido
  useEffect(() => {
    if (naoExiste) anunciar('Esta barreira não está mais disponível.')
    else if (consulta.erro) anunciar(consulta.erro.message)
  }, [naoExiste, consulta.erro, anunciar])

  // o h1 já tem o foco e muda de texto quando os dados chegam: sem isto, nada seria dito
  const resumo = barreira ? `${rotuloCategoria(barreira.categoria)}. ${textoStatus(barreira)}. ${textoEfeito(barreira)}` : null
  const anunciouFicha = useRef(false)
  useEffect(() => {
    if (!resumo || anunciouFicha.current) return
    anunciouFicha.current = true
    anunciar(resumo)
  }, [resumo, anunciar])

  // o voto que encerra, ou a releitura depois de um 409, tiram os botões da tela: o foco vai à
  // frase que diz o que aconteceu. Se a pessoa saiu dali, ele fica, e a região diz.
  const encerrada = barreira ? votacaoEncerrada(barreira) : null
  const votacaoAberta = useRef(false)
  useEffect(() => {
    const estavaAberta = votacaoAberta.current
    votacaoAberta.current = encerrada === false
    if (!estavaAberta || encerrada !== true) return
    if (focoPerdido()) efeito.current?.focus()
    else if (resumo) anunciar(resumo)
  }, [encerrada, resumo, anunciar])

  const ehMinha = recemCriada || autorNestaVisita || (conta ? lerMinhas(conta.id).includes(numero) : false)
  const ehAdmin = conta?.papel === 'admin'
  const textoEndereco = endereco.dados
    ? `Perto de ${endereco.dados.rotulo}.`
    : endereco.erro?.tipo === 'nao_encontrado'
      ? 'Sem endereço conhecido a até 50 m.'
      : endereco.erro
        ? 'Endereço indisponível agora.'
        : 'Buscando o endereço…'

  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        {recemCriada ? 'Barreira registrada' : barreira ? rotuloCategoria(barreira.categoria) : 'Ficha da barreira'}
      </h1>
      {consulta.carregando && !barreira && <p>{espera ?? 'Carregando a ficha…'}</p>}
      {naoExiste && <p>Esta barreira não está mais disponível.</p>}
      {consulta.erro && !naoExiste && <p>{consulta.erro.message}</p>}
      {barreira && (
        <>
          {recemCriada && chegada.jaExistia && <p>Esta barreira já estava registrada.</p>}
          {recemCriada && <p className="letreiro colaborar__titulo">{rotuloCategoria(barreira.categoria)}</p>}
          <p ref={efeito} tabIndex={-1}>
            <strong className="escolha-local__rotulo">{textoStatus(barreira)}.</strong> {textoEfeito(barreira)}
          </p>
          {barreira.status === 'validada' && barreira.severidade === 'intransponivel' && <p className="campo__dica">{AVISO_ROTA_RESERVA}</p>}
          <p>{textoEndereco}</p>
          {barreira.descricao && <p>{barreira.descricao}</p>}
          <p className="campo__dica">
            {textoVotos(barreira)}. Fonte: relato de colaboradores, não verificado pela Prefeitura, em{' '}
            <span className="medida">{formatarDia(barreira.criada_em)}</span>.
          </p>
          {barreira.foto_url && (
            <img className="foto__previa" src={barreira.foto_url} alt={barreira.foto_descricao ?? ''} loading="lazy" />
          )}
          {barreira.status === 'validada' && recemCriada === false && <p className="campo__dica">Recalcule a rota para ver a mudança.</p>}
          {!votacaoEncerrada(barreira) && (
            <Votacao
              barreira={barreira}
              ehAutor={ehMinha}
              aoAtualizar={consulta.atualizar}
              aoRecarregar={consulta.recarregar}
              aoDescobrirAutor={() => setAutorNestaVisita(true)}
            />
          )}
          {(ehMinha || ehAdmin) && <FotoBarreira barreira={barreira} aoAtualizar={consulta.atualizar} />}
          {ehAdmin && (
            <p>
              <Link className="alvo" to={`/admin/barreiras/${barreira.id}`}>
                Moderar esta barreira
              </Link>
            </p>
          )}
        </>
      )}
      <p>
        <Link className="alvo" to="/barreiras" state={volta}>
          Ver outras barreiras
        </Link>
      </p>
    </div>
  )
}
```

Em `frontend/src/App.tsx`, acrescente:

```tsx
const Barreira = lazy(() => import('./pages/Barreira').then((m) => ({ default: m.Barreira })))
```

```tsx
                <Route path="/barreiras/:id" element={<Barreira />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/FichaBarreira.test.tsx`
Expected: PASS, 17 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 29 arquivos, 261 testes passando.

---

### Task 21: Cadastro em 3 toques

**Files:**
- Create: `frontend/src/pages/NovaBarreira.tsx`, `frontend/src/test/NovaBarreira.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `criarBarreira`, `useAcaoComLogin`, `EscolhaLocal`, `PortaoLogin`, `CATEGORIAS`, `comChave`, `comEdicao`, `lerRascunho`, `gravarRascunho`, `apagarRascunho`.
- Produces: `NovaBarreira`, que aceita `location.state = { local }`, consome esse state na chegada (outro ponto gera chave nova) e navega para `/barreiras/:id` com `{ recemCriada: true, jaExistia }`.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/NovaBarreira.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { axe } from 'vitest-axe'
import App from '../App'
import { lerRascunho } from '../dados/rascunho'
import { apiFalsa, erroApi } from './apiFalsa'
import { A, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

const MSG_FALHA = 'Não conseguimos enviar agora. O rascunho fica só nesta aba: se você a fechar, ele se perde.'

describe('/barreiras/nova', () => {
  const LOCAL = { lat: -23.59, lon: -46.635, rotulo: 'Rua A, 1', origem: 'busca' }

  async function preencher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), 'Três degraus')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
  }

  it('tem as 10 categorias, não pergunta severidade e valida com foco', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    const { container } = abrir('/barreiras/nova')
    const grupo = await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(within(grupo).getAllByRole('radio')).toHaveLength(10)
    expect(screen.queryByText(/severidade/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    expect(within(grupo).getAllByRole('radio')[0]).toHaveFocus()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem login, o portão aparece na própria página e o rascunho fica; depois do código, a mesma ação e a mesma chave', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    const titulo = await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    expect(titulo).toHaveFocus()
    expect(api.de('POST /api/barreiras')).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Três degraus')
    const chave = lerRascunho().chave
    expect(chave).toBeTruthy()

    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org')
    await user.click(screen.getByRole('button', { name: 'Receber código' }))
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirmar código' }))

    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    const corpo = JSON.parse(String(api.de('POST /api/barreiras')[0].init.body))
    expect(corpo).toMatchObject({ categoria: 'escada', lat: LOCAL.lat, lon: LOCAL.lon, descricao: 'Três degraus', chave_idempotencia: chave })
    expect(await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })).toHaveFocus()
    expect(lerRascunho()).toEqual({ descricao: '' })
  })

  it('cancelar o portão devolve o foco ao botão de origem', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Registrar barreira' })).toHaveFocus()
  })

  it('401 renova o token e repete uma vez com a mesma chave', async () => {
    let tentativas = 0
    const api = apiFalsa({
      ...logar(),
      'POST /api/barreiras': () => (++tentativas === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json(ficha(), { status: 201 })),
      'GET /api/barreiras/5': Response.json(ficha()),
      'GET /api/geocode/reverso': Response.json(A),
    })
    mocks.renovarToken.mockResolvedValue('novo')
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 1, name: 'Barreira registrada' })
    const [a, b] = api.de('POST /api/barreiras')
    expect(JSON.parse(String(a.init.body)).chave_idempotencia).toBe(JSON.parse(String(b.init.body)).chave_idempotencia)
    expect((b.init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
  })

  it('sessão que não renova: "Sua sessão terminou", com o texto preservado', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(401, 'Faça login para continuar.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Descrição (opcional)' })).toHaveValue('Três degraus')
  })

  it('422 de fora da área mostra a mensagem do backend, ligada a "Trocar o local", que recebe o foco', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(422, 'Este ponto está fora da área atendida pelo Rota Falada SP.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    const trocar = await screen.findByRole('button', { name: 'Trocar o local' })
    await waitFor(() => expect(trocar).toHaveFocus())
    expect(trocar).toHaveAccessibleDescription(expect.stringContaining('fora da área atendida'))
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.getByRole('status').textContent).toBe('')
    await user.click(trocar)
    expect(screen.getByRole('combobox', { name: 'Endereço' })).toHaveAccessibleDescription(expect.not.stringContaining('fora da área atendida'))
  })

  it('sem local, o erro fica ligado ao campo de busca', async () => {
    apiFalsa({})
    const user = userEvent.setup()
    abrir('/barreiras/nova')
    await user.click(await screen.findByRole('radio', { name: /^Escada/ }))
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    const campo = screen.getByRole('combobox', { name: 'Endereço' })
    expect(campo).toHaveFocus()
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAccessibleDescription(expect.stringContaining('Diga onde está a barreira.'))
  })

  it('editar com o portão aberto vale: o POST sai com o texto novo e chave nova', async () => {
    const api = apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': Response.json(ficha(), { status: 201 }), 'GET /api/barreiras/5': Response.json(ficha()), 'GET /api/geocode/reverso': Response.json(A) })
    mocks.verificarCodigo.mockImplementation(async () => {
      mocks.temSessaoSalva.mockReturnValue(true)
      mocks.obterToken.mockResolvedValue('tkn')
    })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    const chaveAntiga = lerRascunho().chave
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), ' e sem corrimão')
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(1))
    const corpo = JSON.parse(String(api.de('POST /api/barreiras')[0].init.body))
    expect(corpo.descricao).toBe('Três degraus e sem corrimão')
    expect(corpo.chave_idempotencia).not.toBe(chaveAntiga)
  })

  it('chegar com outro ponto gera chave nova; o state não sobrevive à recarga', async () => {
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'x', categoria: 'escada', local: { ...LOCAL, lat: -23.6 }, chave: 'chave-velha' }))
    let estado: unknown = 'inicial'
    function Espia() {
      estado = useLocation().state
      return null
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/barreiras/nova', state: { local: LOCAL } }]}>
        <App />
        <Espia />
      </MemoryRouter>,
    )
    await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(lerRascunho().chave).toBeUndefined()
    expect(lerRascunho().local).toMatchObject({ lat: LOCAL.lat })
    await waitFor(() => expect(estado).toBeNull())
  })

  it('chegar com o mesmo ponto mantém a chave da tentativa anterior', async () => {
    sessionStorage.setItem('rf-rascunho', JSON.stringify({ descricao: 'x', categoria: 'escada', local: LOCAL, chave: 'chave-velha' }))
    abrir('/barreiras/nova', { local: LOCAL })
    await screen.findByRole('group', { name: 'Tipo de barreira' })
    expect(lerRascunho().chave).toBe('chave-velha')
  })

  it('os textos dizem o que acontece, sem prometer anonimato nem número errado de votos', async () => {
    apiFalsa({})
    abrir('/barreiras/nova')
    expect(await screen.findByText(/Com as confirmações necessárias, a rota passa a evitar ou avisar/)).toBeInTheDocument()
    expect(screen.queryByText(/Outra pessoa confirma/)).toBeNull()
    expect(screen.getByText(/a moderação vê só um código da conta/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/não identifica você/)
  })

  it('429 mantém o rascunho; 503 é honesto sobre onde o rascunho vive', async () => {
    apiFalsa({ ...logar(), 'POST /api/barreiras': erroApi(429, 'Limite de 20 barreiras por dia.') })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    expect(await screen.findByText('Limite de 20 barreiras por dia.')).toBeInTheDocument()
    expect(lerRascunho().descricao).toBe('Três degraus')
    apiFalsa({ 'GET /api/eu': Response.json({ papel: 'colaborador' }), 'POST /api/barreiras': new Response('x', { status: 503 }) })
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    expect(await screen.findByText(MSG_FALHA)).toBeInTheDocument()
  })

  it('editar depois de falha gera chave nova; repetir sem editar mantém', async () => {
    const api = apiFalsa({ ...logar(), 'POST /api/barreiras': new Response('x', { status: 503 }) })
    const user = userEvent.setup()
    abrir('/barreiras/nova', { local: LOCAL })
    await preencher(user)
    await screen.findByText(MSG_FALHA)
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(2))
    await user.type(screen.getByRole('textbox', { name: 'Descrição (opcional)' }), '!')
    await user.click(screen.getByRole('button', { name: 'Registrar barreira' }))
    await waitFor(() => expect(api.de('POST /api/barreiras')).toHaveLength(3))
    const chaves = api.de('POST /api/barreiras').map((c) => JSON.parse(String(c.init.body)).chave_idempotencia)
    expect(chaves[0]).toBe(chaves[1])
    expect(chaves[2]).not.toBe(chaves[1])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/NovaBarreira.test.tsx`
Expected: FAIL: a rota `/barreiras/nova` ainda cai em `/barreiras/:id`, e a ficha não tem o grupo "Tipo de barreira".

- [ ] **Step 3: Implementar**

`frontend/src/pages/NovaBarreira.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { focarOuAnunciar } from '../a11y/foco'
import { usePaginaAcessivel } from '../a11y/usePaginaAcessivel'
import { criarBarreira, type BarreiraIn } from '../api/colaboracao'
import { aquecerServidor } from '../api/servidor'
import { useAcaoComLogin } from '../auth/useAcaoComLogin'
import { EscolhaLocal } from '../componentes/EscolhaLocal'
import { Pictograma } from '../componentes/Pictograma'
import { Placa } from '../componentes/Placa'
import { PortaoLogin } from '../componentes/PortaoLogin'
import { Janela, Torre } from '../componentes/Torre'
import { useAnuncio } from '../componentes/useAnuncio'
import { useEsperaServidor } from '../componentes/useEsperaServidor'
import { CATEGORIAS, type Categoria } from '../dados/categorias'
import { apagarRascunho, comChave, comEdicao, gravarRascunho, lerRascunho, type LocalEscolhido, type Rascunho } from '../dados/rascunho'
import '../estilos/colaborar.css'
import '../estilos/rota.css'

const MSG_FALHA_ENVIO = 'Não conseguimos enviar agora. O rascunho fica só nesta aba: se você a fechar, ele se perde.'

type EstadoNavegacao = { local?: LocalEscolhido } | null

/**
 * Uma única página, sem assistente: trocar de etapa sozinho ao tocar numa opção violaria
 * WCAG 3.2.2 e confundiria o NVDA, que seleciona rádio ao andar com as setas. O login vem
 * no fim, ao confirmar: ninguém digita e-mail antes de saber se vale a pena.
 */
export function NovaBarreira() {
  const h1 = usePaginaAcessivel('Registrar barreira')
  const local = useLocation()
  const estadoNav = local.state as EstadoNavegacao
  const navegar = useNavigate()
  const anunciar = useAnuncio()
  const [rascunho, setRascunho] = useState<Rascunho>(() => {
    const salvo = lerRascunho()
    const vindo = estadoNav?.local
    if (!vindo) return salvo
    // outro ponto é outra barreira: a chave da tentativa anterior devolveria a barreira antiga (D18)
    return salvo.local?.lat === vindo.lat && salvo.local?.lon === vindo.lon ? salvo : comEdicao(salvo, { local: vindo })
  })
  const [erros, setErros] = useState<{ categoria?: string; local?: string }>({})
  const botao = useRef<HTMLButtonElement>(null)

  /**
   * Valida o que está na tela e monta o corpo. O login chama de novo ao concluir: o que vale é o
   * que a pessoa deixou escrito enquanto esperava o e-mail, com a chave certa para isso.
   */
  function montarEnvio(): [BarreiraIn] | null {
    const novos: typeof erros = {}
    if (!rascunho.categoria) novos.categoria = 'Escolha o tipo de barreira.'
    if (!rascunho.local) novos.local = 'Diga onde está a barreira.'
    flushSync(() => setErros(novos))
    if (novos.categoria) {
      focarOuAnunciar(document.querySelector<HTMLInputElement>('input[name="categoria"]'), novos.categoria, anunciar)
      return null
    }
    if (novos.local || !rascunho.local || !rascunho.categoria) {
      focarOuAnunciar(document.getElementById('local-busca'), novos.local ?? '', anunciar)
      return null
    }
    // a chave é salva antes do fetch: repetir, sessão expirada e recarga da aba reusam a mesma
    const comAChave = comChave(rascunho)
    setRascunho(comAChave)
    gravarRascunho(comAChave)
    return [
      {
        categoria: rascunho.categoria,
        lat: rascunho.local.lat,
        lon: rascunho.local.lon,
        descricao: rascunho.descricao.trim() || undefined,
        chave_idempotencia: comAChave.chave,
      },
    ]
  }

  const acao = useAcaoComLogin(
    criarBarreira,
    ({ barreira, nova }) => {
      apagarRascunho()
      navegar(`/barreiras/${barreira.id}`, { state: { recemCriada: true, jaExistia: !nova } })
    },
    montarEnvio,
  )
  const enviando = acao.estado.fase === 'enviando'
  const espera = useEsperaServidor(enviando)

  useEffect(() => aquecerServidor(), [])

  useEffect(() => {
    if (!estadoNav?.local) return
    // o state sobrevive à recarga e passaria por cima de "Trocar o local": consumido uma vez
    gravarRascunho(rascunho)
    navegar(local.pathname, { replace: true, state: null })
    // só na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function mudar(mudanca: Partial<Rascunho>) {
    const novo = comEdicao(rascunho, mudanca)
    setRascunho(novo)
    gravarRascunho(novo)
    acao.limparErro()
  }

  const erroAcao = acao.estado.fase === 'erro' ? acao.estado.erro : null
  // 422 com texto é o ponto fora da área: é do local, e fica ligado a "Trocar o local"
  const erroDoLocal = erroAcao?.tipo === 'validacao' && !erroAcao.campos ? erroAcao.message : null
  const mensagemErro = erroAcao && !erroDoLocal ? (erroAcao.tipo === 'validacao' || erroAcao.tipo === 'limite' ? erroAcao.message : MSG_FALHA_ENVIO) : null

  useEffect(() => {
    // o foco vai a "Trocar o local", que lê a mensagem; os outros erros ficam no botão e anunciam
    if (erroDoLocal) focarOuAnunciar(document.getElementById('local-trocar'), erroDoLocal, anunciar)
    else if (mensagemErro) anunciar(mensagemErro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [erroDoLocal, mensagemErro])

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    const args = montarEnvio()
    if (args) void acao.executar(...args)
  }

  return (
    <div className="rota">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Registrar barreira
        </h1>
        <p className="subtitulo">
          Três toques: o tipo, o lugar e confirmar. O que você registra fica público, sem seu nome nem e-mail; a moderação vê
          só um código da conta, para auditoria.
        </p>
      </div>

      <form className="formulario" aria-label="Registrar barreira" onSubmit={enviar} noValidate>
        <fieldset className="exigencia" aria-describedby={erros.categoria ? 'categoria-erro' : undefined}>
          <legend>Tipo de barreira</legend>
          {erros.categoria && (
            <p id="categoria-erro" className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{erros.categoria}</span>
            </p>
          )}
          <div className="exigencia__opcoes">
            {(Object.keys(CATEGORIAS) as Categoria[]).map((c) => (
              <label key={c} className="opcao opcao--dupla">
                <input type="radio" name="categoria" value={c} checked={rascunho.categoria === c} onChange={() => mudar({ categoria: c })} />
                <span>
                  {CATEGORIAS[c].rotulo}
                  <span className="opcao__dica">{CATEGORIAS[c].dica}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <EscolhaLocal
          id="local"
          local={rascunho.local ?? null}
          aoEscolher={(l) => mudar({ local: l ?? undefined })}
          erro={rascunho.local ? erroDoLocal : (erros.local ?? null)}
          aoEditar={() => setErros((e) => ({ ...e, local: undefined }))}
        />

        <div className="campo">
          <label htmlFor="descricao">Descrição (opcional)</label>
          <p id="descricao-dica" className="campo__dica">
            Até 500 caracteres. Não escreva nomes nem placas de carro.
          </p>
          <textarea
            id="descricao"
            name="descricao"
            maxLength={500}
            rows={3}
            aria-describedby="descricao-dica"
            value={rascunho.descricao}
            onChange={(e) => mudar({ descricao: e.target.value })}
          />
        </div>

        <div className="formulario__envio">
          <Placa ref={botao} type="submit" variante="acao" pictograma="siga" aria-disabled={enviando || undefined}>
            Registrar barreira
          </Placa>
          {enviando && <p className="campo__retorno">{espera ?? 'Enviando…'}</p>}
          {mensagemErro && (
            <p className="campo__retorno campo__retorno--erro">
              <Pictograma nome="alerta" />
              <span>{mensagemErro}</span>
            </p>
          )}
        </div>
      </form>

      <Torre variante="anexo">
        <Janela area="aviso">
          <h2 className="letreiro">O que acontece depois</h2>
          <p>
            A barreira aparece como aguardando confirmação. Com as confirmações necessárias, a rota passa a evitar ou avisar,
            conforme o tipo; tipos só informativos não mudam a rota. A moderação pode decidir antes.
          </p>
        </Janela>
      </Torre>

      {acao.estado.fase === 'login' && (
        <div className="colaborar__portao">
          <PortaoLogin
            motivo={acao.estado.motivo}
            refRetorno={botao}
            aoEntrar={acao.concluirLogin}
            aoCancelar={acao.cancelarLogin}
          />
        </div>
      )}
    </div>
  )
}
```

Em `frontend/src/App.tsx`, acrescente:

```tsx
const NovaBarreira = lazy(() => import('./pages/NovaBarreira').then((m) => ({ default: m.NovaBarreira })))
```

```tsx
                <Route path="/barreiras/nova" element={<NovaBarreira />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/NovaBarreira.test.tsx`
Expected: PASS, 13 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 30 arquivos, 274 testes passando.

---

### Task 22: Painel de admin

**Files:**
- Create: `frontend/src/pages/admin/Fila.tsx`, `frontend/src/pages/admin/Decisao.tsx`, `frontend/src/test/Admin.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `listarFila`, `obterBarreiraAdmin`, `mudarStatus`, `listarEventos`, `removerFoto`, `comSessao`, `motivoDoLogin`, `useConsulta`, `useAcaoComLogin`, `PortaoLogin`, `textoEvento`, `STATUS_TODOS`, `SIGNIFICADO_STATUS`, `erroDoMotivo`.
- Produces: `Fila` em `/admin?status=`; `Decisao` em `/admin/barreiras/:id`.

O status do admin nunca é repetido automaticamente, salvo um 401, que sai antes de qualquer gravação: repetir geraria dois eventos de auditoria.

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/Admin.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { apiFalsa, erroApi } from './apiFalsa'
import { CONTA, abrir, ficha, logar, mocks, prepararColaboracao } from './apoioColaboracao'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

describe('/admin', () => {
  it('conta comum recebe a resposta do backend como frase', async () => {
    apiFalsa({ ...logar(), 'GET /api/admin/barreiras': erroApi(403, 'Você não tem permissão para esta ação.') })
    abrir('/admin')
    expect(await screen.findByText('Esta área é só para a equipe de moderação.')).toBeInTheDocument()
  })

  it('sem sessão abre o portão', async () => {
    apiFalsa({})
    abrir('/admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeInTheDocument()
  })

  it('a fila filtra por link, anuncia a contagem e acha removida para restaurar', async () => {
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': Response.json([ficha({ status: 'removida' })]) })
    const { container } = abrir('/admin?status=removida')
    const link = await screen.findByRole('link', { name: 'Nº 5, Escada' })
    expect(link).toHaveAttribute('href', '/admin/barreiras/5')
    expect(new URL(api.de('GET /api/admin/barreiras')[0].url).searchParams.get('status')).toBe('removida')
    expect(within(screen.getByRole('navigation', { name: 'Filtrar por status' })).getByRole('link', { name: 'Removida pela moderação' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 barreira'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o padrão é pendente e "Carregar mais" pede antes_de e leva o foco ao primeiro novo', async () => {
    const pagina = Array.from({ length: 50 }, (_, i) => ficha({ id: 100 - i }))
    let vez = 0
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => Response.json(++vez === 1 ? pagina : [ficha({ id: 50 })]) })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 100, Escada' })
    expect(new URL(api.de('GET /api/admin/barreiras')[0].url).searchParams.get('status')).toBe('pendente')
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    const novo = await screen.findByRole('link', { name: 'Nº 50, Escada' })
    expect(new URL(api.de('GET /api/admin/barreiras')[1].url).searchParams.get('antes_de')).toBe('51')
    expect(novo).toHaveFocus()
  })

  it('a decisão exige motivo, mantém o foco, anuncia e atualiza a auditoria', async () => {
    const eventos = [{ id: 1, barreira_id: 5, usuario_id: CONTA.id, tipo: 'criada', de_status: null, para_status: 'pendente', detalhe: {}, criado_em: '2026-11-03T12:00:00+00:00' }]
    const api = apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras/5': Response.json(ficha()),
      'GET /api/admin/barreiras/5/eventos': () => Response.json(eventos),
      'POST /api/admin/barreiras/5/status': () => {
        eventos.push({ ...eventos[0], id: 2, tipo: 'admin', de_status: 'pendente', para_status: 'validada', detalhe: { motivo: 'Vi no local' } as never })
        return Response.json(ficha({ status: 'validada' }))
      },
    })
    const user = userEvent.setup()
    const { container } = abrir('/admin/barreiras/5')
    await screen.findByRole('heading', { level: 2, name: 'Nº 5, Escada' })
    expect(await screen.findByText(/criada por conta 3f2a91b0/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await user.click(screen.getByRole('radio', { name: /^Confirmada/ }))
    const registrar = screen.getByRole('button', { name: 'Registrar decisão' })
    await user.click(registrar)
    const motivo = screen.getByRole('textbox', { name: 'Motivo' })
    expect(motivo).toHaveFocus()
    expect(motivo).toHaveAttribute('aria-invalid', 'true')
    expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(0)

    await user.type(motivo, '  Vi no local  ')
    await user.click(registrar)
    await waitFor(() => expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(1))
    expect(JSON.parse(String(api.de('POST /api/admin/barreiras/5/status')[0].init.body))).toEqual({ status: 'validada', motivo: 'Vi no local' })
    expect(registrar).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Status alterado para confirmada. Auditoria atualizada.'))
    expect(await screen.findByText(/Motivo: Vi no local/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('pessoa@exemplo.org')
  })

  it('barreira removida abre e pode voltar', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': Response.json(ficha({ status: 'removida' })), 'GET /api/admin/barreiras/5/eventos': Response.json([]) })
    abrir('/admin/barreiras/5')
    expect(await screen.findByRole('radio', { name: /^Removida pela moderação/ })).toBeChecked()
  })

  it('401 na fila renova e repete, sem abrir o portão', async () => {
    let vez = 0
    const api = apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? erroApi(401, 'Faça login para continuar.') : Response.json([ficha()])) })
    mocks.renovarToken.mockResolvedValue('novo')
    abrir('/admin')
    expect(await screen.findByRole('link', { name: 'Nº 5, Escada' })).toBeInTheDocument()
    expect((api.de('GET /api/admin/barreiras')[1].init.headers as Record<string, string>).Authorization).toBe('Bearer novo')
    expect(screen.queryByRole('heading', { level: 2, name: /Entre para continuar|Sua sessão terminou/ })).toBeNull()
  })

  it('sessão que não renova na fila: "Sua sessão terminou", nunca "Entre para continuar"', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': erroApi(401, 'Faça login para continuar.') })
    abrir('/admin')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toBeInTheDocument()
  })

  it('"Carregar mais": cada lote foca o próprio primeiro item; 401 abre o portão; fim da fila não derruba o foco', async () => {
    const lote = (de: number) => Array.from({ length: 50 }, (_, i) => ficha({ id: de - i }))
    let vez = 0
    apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras': () => {
        vez += 1
        if (vez === 1) return Response.json(lote(200))
        if (vez === 2) return Response.json(lote(150))
        if (vez === 3) return erroApi(401, 'Faça login para continuar.')
        return Response.json([])
      },
    })
    const user = userEvent.setup()
    abrir('/admin')
    await screen.findByRole('link', { name: 'Nº 200, Escada' })
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByRole('link', { name: 'Nº 150, Escada' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('Não há mais barreiras.')).toHaveFocus()
  })

  it('"Tentar de novo" some, e o foco vai ao h1', async () => {
    let vez = 0
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras': () => (++vez === 1 ? new Response('x', { status: 503 }) : Response.json([])) })
    const user = userEvent.setup()
    abrir('/admin')
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Moderação' })).toHaveFocus()
  })

  it('401 na auditoria abre o portão em vez de uma frase sem saída', async () => {
    apiFalsa({ ...logar('admin'), 'GET /api/admin/barreiras/5': Response.json(ficha()), 'GET /api/admin/barreiras/5/eventos': erroApi(401, 'Faça login para continuar.') })
    abrir('/admin/barreiras/5')
    expect(await screen.findByRole('heading', { level: 2, name: 'Sua sessão terminou' })).toBeInTheDocument()
  })

  it('"Remover foto" some, e o foco vai ao retorno; o motivo editado com o portão aberto vale', async () => {
    const comFoto = ficha({ foto_url: 'https://x.supabase.co/f.webp', foto_descricao: 'Escada' })
    const api = apiFalsa({
      ...logar('admin'),
      'GET /api/admin/barreiras/5': Response.json(comFoto),
      'GET /api/admin/barreiras/5/eventos': Response.json([]),
      'DELETE /api/barreiras/5/foto': Response.json(ficha()),
      'POST /api/admin/barreiras/5/status': () => {
        return Response.json(ficha({ status: 'validada' }))
      },
    })
    const user = userEvent.setup()
    abrir('/admin/barreiras/5')
    await user.click(await screen.findByRole('button', { name: 'Remover foto' }))
    await waitFor(() => expect(screen.getByText('Foto removida.')).toHaveFocus())

    mocks.obterToken.mockResolvedValueOnce(null)
    await user.click(screen.getByRole('radio', { name: /^Confirmada/ }))
    await user.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Primeiro motivo')
    const registrar = screen.getByRole('button', { name: 'Registrar decisão' })
    await user.click(registrar)
    await screen.findByRole('heading', { level: 2, name: 'Entre para continuar' })
    await user.clear(screen.getByRole('textbox', { name: 'Motivo' }))
    await user.type(screen.getByRole('textbox', { name: 'Motivo' }), 'Motivo corrigido')
    await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'p@e.org{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Código de 6 dígitos' }), '123456{Enter}')
    await waitFor(() => expect(api.de('POST /api/admin/barreiras/5/status')).toHaveLength(1))
    expect(JSON.parse(String(api.de('POST /api/admin/barreiras/5/status')[0].init.body)).motivo).toBe('Motivo corrigido')
    expect(registrar).toHaveFocus()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Admin.test.tsx`
Expected: FAIL (`/admin` cai em "Página não encontrada").

- [ ] **Step 3: Implementar**

`frontend/src/pages/admin/Fila.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useSearchParams } from 'react-router'
import { usePaginaAcessivel } from '../../a11y/usePaginaAcessivel'
import { ErroApi, MSG_INESPERADO } from '../../api/base'
import { listarFila, type Barreira, type StatusBarreira } from '../../api/colaboracao'
import { useConsulta } from '../../api/useConsulta'
import { comSessao, motivoDoLogin, type MotivoLogin } from '../../auth/comSessao'
import { Placa } from '../../componentes/Placa'
import { PortaoLogin } from '../../componentes/PortaoLogin'
import { useAnuncio } from '../../componentes/useAnuncio'
import { useEsperaServidor } from '../../componentes/useEsperaServidor'
import { formatarDia, STATUS_TODOS, textoStatus, textoVotos } from '../../dados/barreira'
import { rotuloCategoria } from '../../dados/categorias'
import '../../estilos/colaborar.css'
import '../../estilos/rota.css'

const LIMITE = 50
const MSG_SEM_PERMISSAO = 'Esta área é só para a equipe de moderação.'

function statusDaUrl(valor: string | null): StatusBarreira {
  return STATUS_TODOS.includes(valor as StatusBarreira) ? (valor as StatusBarreira) : 'pendente'
}

export function Fila() {
  const h1 = usePaginaAcessivel('Moderação')
  const [parametros] = useSearchParams()
  const status = statusDaUrl(parametros.get('status'))
  const anunciar = useAnuncio()
  const { dados, erro, carregando, recarregar } = useConsulta(`fila-${status}`, (sinal) =>
    comSessao((token) => listarFila(token, { status, limite: LIMITE }, sinal)),
  )
  const espera = useEsperaServidor(carregando)
  const [extras, setExtras] = useState<{ status: StatusBarreira; itens: Barreira[]; fim: boolean }>({ status, itens: [], fim: false })
  const [erroMais, setErroMais] = useState<string | null>(null)
  const [portaoMais, setPortaoMais] = useState<MotivoLogin | null>(null)
  const [indiceNovo, setIndiceNovo] = useState(-1)
  const [semMais, setSemMais] = useState(false)
  const primeiroNovo = useRef<HTMLAnchorElement>(null)
  const textoFim = useRef<HTMLParagraphElement>(null)
  const botaoMais = useRef<HTMLButtonElement>(null)

  const adicionais = extras.status === status ? extras.itens : []
  const itens = [...(dados ?? []), ...adicionais]
  const fim = extras.status === status ? extras.fim : false

  useEffect(() => {
    if (dados) anunciar(`${dados.length} ${dados.length === 1 ? 'barreira' : 'barreiras'}: ${textoStatus({ status, severidade: 'dificulta' }).toLowerCase()}.`)
  }, [dados, status, anunciar])

  async function carregarMais() {
    const ultimo = itens[itens.length - 1]
    if (!ultimo) return
    setErroMais(null)
    try {
      const mais = await comSessao((token) => listarFila(token, { status, limite: LIMITE, antes_de: ultimo.id }))
      // o botão pode sair da tela com o lote: o foco vai ao primeiro novo, ou à frase do fim
      flushSync(() => {
        setIndiceNovo(mais.length > 0 ? itens.length : -1)
        setSemMais(mais.length === 0)
        setExtras({ status, itens: [...adicionais, ...mais], fim: mais.length < LIMITE })
      })
      if (mais.length > 0) primeiroNovo.current?.focus()
      else textoFim.current?.focus()
    } catch (e) {
      if (e instanceof ErroApi && e.tipo === 'sessao') {
        setPortaoMais(motivoDoLogin(e))
        return
      }
      const texto = e instanceof ErroApi ? e.message : MSG_INESPERADO
      setErroMais(texto)
      anunciar(texto)
    }
  }

  return (
    <div className="colaborar">
      <div className="rota__cabeca">
        <h1 ref={h1} tabIndex={-1} className="display">
          Moderação
        </h1>
      </div>

      {erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={recarregar} aoCancelar={() => history.back()} />}
      {erro?.tipo === 'permissao' && <p className="folha">{MSG_SEM_PERMISSAO}</p>}
      {erro && erro.tipo !== 'sessao' && erro.tipo !== 'permissao' && (
        <div className="folha">
          <p>{erro.message}</p>
          <Placa
            onClick={() => {
              h1.current?.focus()
              recarregar()
            }}
          >
            Tentar de novo
          </Placa>
        </div>
      )}

      {!erro && (
        <>
          <nav aria-label="Filtrar por status">
            <ul className="filtros">
              {STATUS_TODOS.map((s) => (
                <li key={s}>
                  <Link className="alvo" to={`/admin?status=${s}`} aria-current={s === status ? 'page' : undefined}>
                    {textoStatus({ status: s, severidade: 'dificulta' })}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <section className="colaborar__lista" aria-label="Fila de barreiras">
            {carregando && <p>{espera ?? 'Carregando a fila…'}</p>}
            {dados && itens.length === 0 && <p>Nenhuma barreira neste status.</p>}
            {itens.length > 0 && (
              <ol className="lista-gravada">
                {itens.map((b, i) => (
                  <li key={b.id}>
                    <h2 className="letreiro colaborar__titulo">
                      <Link ref={i === indiceNovo ? primeiroNovo : undefined} className="alvo lista-gravada__link" to={`/admin/barreiras/${b.id}`}>
                        Nº {b.id}, {rotuloCategoria(b.categoria)}
                      </Link>
                    </h2>
                    <p>
                      {textoStatus(b)}. {textoVotos(b)}. Registrada em <span className="medida">{formatarDia(b.criada_em)}</span>.
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {erroMais && <p>{erroMais}</p>}
            {semMais && fim && (
              <p ref={textoFim} tabIndex={-1}>
                Não há mais barreiras.
              </p>
            )}
            {dados && dados.length === LIMITE && !fim && (
              <Placa ref={botaoMais} onClick={carregarMais}>
                Carregar mais
              </Placa>
            )}
            {portaoMais && (
              <PortaoLogin
                motivo={portaoMais}
                refRetorno={botaoMais}
                aoEntrar={() => {
                  setPortaoMais(null)
                  void carregarMais()
                }}
                aoCancelar={() => setPortaoMais(null)}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}
```

`frontend/src/pages/admin/Decisao.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from 'react-router'
import { focarOuAnunciar, focoPerdido } from '../../a11y/foco'
import { usePaginaAcessivel } from '../../a11y/usePaginaAcessivel'
import { listarEventos, mudarStatus, obterBarreiraAdmin, removerFoto, type Barreira, type StatusBarreira } from '../../api/colaboracao'
import { useConsulta } from '../../api/useConsulta'
import { comSessao, motivoDoLogin } from '../../auth/comSessao'
import { useAcaoComLogin } from '../../auth/useAcaoComLogin'
import { Pictograma } from '../../componentes/Pictograma'
import { Placa } from '../../componentes/Placa'
import { PortaoLogin } from '../../componentes/PortaoLogin'
import { useAnuncio } from '../../componentes/useAnuncio'
import { useEsperaServidor } from '../../componentes/useEsperaServidor'
import { erroDoMotivo, SIGNIFICADO_STATUS, STATUS_TODOS, textoEfeito, textoEvento, textoStatus, textoVotos } from '../../dados/barreira'
import { rotuloCategoria } from '../../dados/categorias'
import '../../estilos/colaborar.css'
import '../../estilos/rota.css'

const MSG_SEM_PERMISSAO = 'Esta área é só para a equipe de moderação.'

export function Decisao() {
  const { id } = useParams()
  const numero = Number(id)
  const h1 = usePaginaAcessivel('Decisão da moderação')
  const anunciar = useAnuncio()
  const [atualizada, setAtualizada] = useState<Barreira | null>(null)
  const [escolha, setEscolha] = useState<StatusBarreira | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroMotivo, setErroMotivo] = useState<string | null>(null)
  const [fotoRemovida, setFotoRemovida] = useState(false)
  const campoMotivo = useRef<HTMLTextAreaElement>(null)
  const botaoRegistrar = useRef<HTMLButtonElement>(null)
  const botaoRemover = useRef<HTMLButtonElement>(null)
  const retornoFoto = useRef<HTMLParagraphElement>(null)

  const ficha = useConsulta(`admin-${numero}`, (sinal) => comSessao((t) => obterBarreiraAdmin(t, numero, sinal)))
  const eventos = useConsulta(ficha.dados ? `eventos-${numero}` : null, (sinal) => comSessao((t) => listarEventos(t, numero, sinal)))
  const espera = useEsperaServidor(ficha.carregando)
  const barreira = atualizada ?? ficha.dados
  const statusEscolhido = escolha ?? barreira?.status ?? null

  /** O login chama de novo ao concluir: o motivo editado com o portão aberto é o que vai à auditoria. */
  function montarDecisao(): [StatusBarreira, string] | null {
    if (!statusEscolhido) return null
    const invalido = erroDoMotivo(motivo)
    flushSync(() => setErroMotivo(invalido))
    if (invalido) {
      focarOuAnunciar(campoMotivo.current, invalido, anunciar)
      return null
    }
    return [statusEscolhido, motivo.trim()]
  }

  const decisao = useAcaoComLogin(
    (token: string, status: StatusBarreira, texto: string) => mudarStatus(token, numero, status, texto),
    (nova) => {
      setAtualizada(nova)
      setMotivo('')
      setEscolha(null)
      eventos.recarregar()
      anunciar(`Status alterado para ${textoStatus(nova).toLowerCase()}. Auditoria atualizada.`)
    },
    montarDecisao,
  )
  const remocao = useAcaoComLogin(
    (token: string) => removerFoto(token, numero),
    (nova) => {
      setAtualizada(nova)
      setFotoRemovida(true)
      eventos.recarregar()
    },
  )

  // "Remover foto" sai da tela com o sucesso: o foco vai à frase, que se lê sozinha
  useEffect(() => {
    if (!fotoRemovida) return
    if (focoPerdido()) retornoFoto.current?.focus()
    else anunciar('Foto removida.')
  }, [fotoRemovida, anunciar])

  const falha = decisao.estado.fase === 'erro' ? decisao.estado.erro : remocao.estado.fase === 'erro' ? remocao.estado.erro : null
  useEffect(() => {
    if (falha) anunciar(falha.message)
  }, [falha, anunciar])

  function registrar(e: FormEvent) {
    e.preventDefault()
    if (decisao.estado.fase === 'enviando') return
    const args = montarDecisao()
    if (args) void decisao.executar(...args)
  }

  const erro = ficha.erro
  return (
    <div className="folha">
      <h1 ref={h1} tabIndex={-1}>
        Decisão da moderação
      </h1>
      {ficha.carregando && !barreira && <p>{espera ?? 'Carregando a ficha…'}</p>}
      {erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(erro)} refRetorno={h1} aoEntrar={ficha.recarregar} aoCancelar={() => history.back()} />}
      {erro?.tipo === 'permissao' && <p>{MSG_SEM_PERMISSAO}</p>}
      {erro && erro.tipo !== 'sessao' && erro.tipo !== 'permissao' && <p>{erro.message}</p>}

      {barreira && (
        <>
          <h2>
            Nº {barreira.id}, {rotuloCategoria(barreira.categoria)}
          </h2>
          <p>
            {textoStatus(barreira)}. {textoEfeito(barreira)}
          </p>
          <p>{textoVotos(barreira)}.</p>
          {barreira.descricao && <p>{barreira.descricao}</p>}
          {barreira.foto_url && <img className="foto__previa" src={barreira.foto_url} alt={barreira.foto_descricao ?? ''} loading="lazy" />}
          {barreira.foto_url && barreira.status !== 'removida' && (
            <>
              <p className="campo__dica">Foto denunciada: remova antes de marcar como removida. Depois disso a foto não pode mais ser apagada por aqui.</p>
              <Placa ref={botaoRemover} onClick={() => void remocao.executar()}>
                Remover foto
              </Placa>
            </>
          )}
          {fotoRemovida && !barreira.foto_url && (
            <p ref={retornoFoto} tabIndex={-1} className="campo__retorno">
              Foto removida.
            </p>
          )}

          <form onSubmit={registrar} noValidate aria-label="Registrar decisão" className="decisao">
            <fieldset className="exigencia">
              <legend>Novo status</legend>
              <div className="decisao__opcoes">
                {STATUS_TODOS.map((s) => (
                  <label key={s} className="opcao opcao--dupla">
                    <input type="radio" name="status" value={s} checked={statusEscolhido === s} onChange={() => setEscolha(s)} />
                    <span>
                      {textoStatus({ status: s, severidade: barreira.severidade })}
                      <span className="opcao__dica">{SIGNIFICADO_STATUS[s]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="campo__dica">Enquanto a votação estiver aberta, um voto novo pode recalcular o status.</p>
            <div className="campo">
              <label htmlFor="motivo">Motivo</label>
              <p id="motivo-dica" className="campo__dica">
                De 3 a 300 caracteres. Fica na auditoria.
              </p>
              <textarea
                ref={campoMotivo}
                id="motivo"
                rows={3}
                maxLength={300}
                aria-invalid={erroMotivo ? true : undefined}
                aria-describedby={erroMotivo ? 'motivo-dica motivo-erro' : 'motivo-dica'}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {erroMotivo && (
                <p id="motivo-erro" className="campo__retorno campo__retorno--erro">
                  <Pictograma nome="alerta" />
                  <span>{erroMotivo}</span>
                </p>
              )}
            </div>
            <Placa ref={botaoRegistrar} type="submit" variante="acao" pictograma="siga" aria-disabled={decisao.estado.fase === 'enviando' || undefined}>
              Registrar decisão
            </Placa>
            {falha && <p className="campo__retorno campo__retorno--erro">{falha.message}</p>}
          </form>
          {decisao.estado.fase === 'login' && <PortaoLogin motivo={decisao.estado.motivo} refRetorno={botaoRegistrar} aoEntrar={decisao.concluirLogin} aoCancelar={decisao.cancelarLogin} />}
          {remocao.estado.fase === 'login' && <PortaoLogin motivo={remocao.estado.motivo} refRetorno={botaoRemover} aoEntrar={remocao.concluirLogin} aoCancelar={remocao.cancelarLogin} />}

          <h2>Auditoria</h2>
          {eventos.carregando && <p>Carregando a auditoria…</p>}
          {eventos.erro?.tipo === 'sessao' && <PortaoLogin motivo={motivoDoLogin(eventos.erro)} refRetorno={h1} aoEntrar={eventos.recarregar} aoCancelar={() => history.back()} />}
          {eventos.erro && eventos.erro.tipo !== 'sessao' && <p>{eventos.erro.message}</p>}
          {eventos.dados && (
            <ol className="auditoria">
              {eventos.dados.map((ev) => (
                <li key={ev.id}>{textoEvento(ev)}</li>
              ))}
            </ol>
          )}
        </>
      )}
      <p>
        <Link className="alvo" to="/admin">
          Voltar à fila
        </Link>
      </p>
    </div>
  )
}
```

Em `frontend/src/App.tsx`, acrescente:

```tsx
const Fila = lazy(() => import('./pages/admin/Fila').then((m) => ({ default: m.Fila })))
const Decisao = lazy(() => import('./pages/admin/Decisao').then((m) => ({ default: m.Decisao })))
```

```tsx
                <Route path="/admin" element={<Fila />} />
                <Route path="/admin/barreiras/:id" element={<Decisao />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Admin.test.tsx`
Expected: PASS, 12 testes.

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 31 arquivos, 286 testes passando. `src/App.tsx` agora é igual ao estado final:

`frontend/src/App.tsx`:

```tsx
import { lazy, Suspense } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { SessaoProvider } from './auth/SessaoProvider'
import { LinkConta } from './auth/LinkConta'
import { ErroDePagina } from './componentes/ErroDePagina'
import { Pictograma } from './componentes/Pictograma'
import { RegiaoViva } from './componentes/RegiaoViva'
import { Inicio } from './pages/Inicio'

// a landing fica na entrada (é a primeira dobra); o resto vem sob demanda
const Rota = lazy(() => import('./pages/Rota').then((m) => ({ default: m.Rota })))
const Fontes = lazy(() => import('./pages/Fontes').then((m) => ({ default: m.Fontes })))
const Acessibilidade = lazy(() => import('./pages/Acessibilidade').then((m) => ({ default: m.Acessibilidade })))
const NaoEncontrada = lazy(() => import('./pages/NaoEncontrada').then((m) => ({ default: m.NaoEncontrada })))
const Entrar = lazy(() => import('./pages/Entrar').then((m) => ({ default: m.Entrar })))
const Conta = lazy(() => import('./pages/Conta').then((m) => ({ default: m.Conta })))
const Barreiras = lazy(() => import('./pages/Barreiras').then((m) => ({ default: m.Barreiras })))
const NovaBarreira = lazy(() => import('./pages/NovaBarreira').then((m) => ({ default: m.NovaBarreira })))
const Barreira = lazy(() => import('./pages/Barreira').then((m) => ({ default: m.Barreira })))
const Fila = lazy(() => import('./pages/admin/Fila').then((m) => ({ default: m.Fila })))
const Decisao = lazy(() => import('./pages/admin/Decisao').then((m) => ({ default: m.Decisao })))

export default function App() {
  const { pathname } = useLocation()
  return (
    <RegiaoViva>
      <SessaoProvider>
        <SkipLink />
        <header className="faixa faixa--topo">
          <div className="faixa__miolo">
            <Link className="alvo marca" to="/">
              <Pictograma nome="marca" tamanho={28} />
              <span className="letreiro">Rota Falada SP</span>
            </Link>
            <nav aria-label="Principal">
              <ul className="menu">
                <li>
                  <NavLink className="alvo" to="/" end>
                    Início
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/rota">
                    Planejar rota
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/barreiras">
                    Barreiras
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/fontes">
                    Fontes
                  </NavLink>
                </li>
                <li>
                  <NavLink className="alvo" to="/acessibilidade">
                    Acessibilidade
                  </NavLink>
                </li>
                <LinkConta />
              </ul>
            </nav>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1}>
          <ErroDePagina key={pathname}>
            <Suspense fallback={<p className="carregando-pagina">Carregando…</p>}>
              <Routes>
                <Route path="/" element={<Inicio />} />
                <Route path="/rota" element={<Rota />} />
                <Route
                  path="/fontes"
                  element={
                    <div className="folha">
                      <Fontes />
                    </div>
                  }
                />
                <Route
                  path="/acessibilidade"
                  element={
                    <div className="folha">
                      <Acessibilidade />
                    </div>
                  }
                />
                <Route path="/entrar" element={<Entrar />} />
                <Route path="/conta" element={<Conta />} />
                <Route path="/barreiras" element={<Barreiras />} />
                <Route path="/barreiras/nova" element={<NovaBarreira />} />
                <Route path="/barreiras/:id" element={<Barreira />} />
                <Route path="/admin" element={<Fila />} />
                <Route path="/admin/barreiras/:id" element={<Decisao />} />
                <Route
                  path="*"
                  element={
                    <div className="folha">
                      <NaoEncontrada />
                    </div>
                  }
                />
              </Routes>
            </Suspense>
          </ErroDePagina>
        </main>
        <footer className="faixa faixa--base">
          <div className="faixa__miolo">
            <p>
              Dados do mapa © colaboradores do OpenStreetMap. Veja{' '}
              <Link to="/fontes">todas as fontes e licenças</Link>.
            </p>
          </div>
        </footer>
      </SessaoProvider>
    </RegiaoViva>
  )
}
```

---

### Task 23: Ligar a rota à colaboração

**Files:**
- Create: `frontend/src/test/Ligacao.test.tsx`
- Replace: `frontend/src/componentes/BarreirasDoPasso.tsx`, `frontend/src/componentes/TabelaPassos.tsx`
- Modify: `frontend/src/componentes/ResultadoRota.tsx`

**Interfaces:**
- Consumes: `linhaDoGeoJson`, `meioDaLinha`, `Barreiras` com `location.state`.
- Produces: prop `comBarreiras` em `TabelaPassos`; link "Barreiras perto do passo N"; link "Ver e votar", de 44 px e nome contextual, só em barreira colaborativa.

Um link por passo, não dois: dois dariam 22 paradas de Tab numa rota de 11 passos (spec, R11).

- [ ] **Step 1: Escrever o teste**

`frontend/src/test/Ligacao.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gravarSessaoRota, PERFIL_FORM_PADRAO } from '../dados/sessaoRota'
import { montarPedido } from '../pages/rotaEstado'
import { apiFalsa } from './apiFalsa'
import { abrir, logar, prepararColaboracao } from './apoioColaboracao'
import { endereco, ROTA } from './fixturasRota'

vi.mock('../auth/cliente', () => import('./clienteFalso'))

prepararColaboracao()

const A = endereco(1, 'Rua A, 1 · Vila Mariana')
const B = endereco(2, 'Rua B, 2 · Vila Mariana')

function barreira(id: number, origem: 'oficial' | 'colaborativa') {
  return { id, origem, categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: origem === 'colaborativa' ? 1 : null, data_referencia: '2026-11-03' }
}

function comRotaSalva(rota = ROTA) {
  gravarSessaoRota({
    versao: 1,
    origem: A,
    destino: B,
    perfil: PERFIL_FORM_PADRAO,
    rota,
    rotaDe: { pedido: montarPedido(A, B, PERFIL_FORM_PADRAO), origem: A.rotulo, destino: B.rotulo },
    calculadaEm: new Date().toISOString(),
  })
}

describe('rota e colaboração', () => {
  it('colaborativa leva à ficha, oficial não: os ids colidem entre as duas tabelas', async () => {
    apiFalsa({})
    comRotaSalva({ ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira(9, 'colaborativa'), barreira(9, 'oficial')] }] })
    abrir('/rota')
    const lista = await screen.findByRole('list', { name: 'Os 1 passos da rota' })
    const links = within(lista).getAllByRole('link', { name: 'Ver e votar: Buraco, a 12 m' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/barreiras/9')
    expect(links[0]).toHaveClass('alvo')
  })

  it('cada passo leva às barreiras perto dele, com o ponto no state e nada na URL; a volta restaura a rota', async () => {
    const api = apiFalsa({ 'GET /api/barreiras': Response.json([]) })
    comRotaSalva()
    const user = userEvent.setup()
    abrir('/rota')
    const link = await screen.findByRole('link', { name: 'Barreiras perto do passo 2' })
    expect(link).toHaveAttribute('href', '/barreiras')
    await user.click(link)
    await screen.findByText(/Isso não quer dizer que não haja/)
    const url = new URL(api.de('GET /api/barreiras')[0].url)
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(-23.59)
    await user.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Planejar rota' }))
    expect(await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })).toBeInTheDocument()
    expect(api.de('POST /api/rotas')).toHaveLength(0)
  })

  it('LGPD: com login, geocode e rota continuam sem Authorization', async () => {
    const api = apiFalsa({ ...logar(), 'GET /api/geocode': Response.json([A, B]), 'POST /api/rotas': Response.json(ROTA) })
    const user = userEvent.setup()
    abrir('/rota')
    for (const [nome, setas] of [
      ['Origem', '{ArrowDown}'],
      ['Destino', '{ArrowDown}{ArrowDown}'],
    ] as const) {
      await user.click(await screen.findByRole('combobox', { name: nome }))
      await user.keyboard('rua{Enter}')
      await screen.findAllByRole('option')
      await user.keyboard(`${setas}{Enter}`)
    }
    await user.click(screen.getByRole('button', { name: 'Calcular rota' }))
    await screen.findByRole('heading', { level: 2, name: /Rota encontrada/ })
    expect(api.de('POST /api/rotas')[0].init.headers).toEqual({ 'Content-Type': 'application/json' })
    for (const c of api.de('GET /api/geocode')) expect(c.init.headers).toEqual({})
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest --run src/test/Ligacao.test.tsx`
Expected: FAIL (`Unable to find an accessible element with the role "link" and name "Ver e votar: Buraco, a 12 m"`).

- [ ] **Step 3: Implementar**

`frontend/src/componentes/BarreirasDoPasso.tsx`:

```tsx
import { Link } from 'react-router'
import { rotuloCategoria } from '../dados/categorias'
import { textoBarreira, type BarreiraResumo } from '../dados/passo'

/**
 * Só `dificulta` chega ao passo: intransponível vira desvio e pendente não entra na rota.
 * Por isso a lista vazia não vira "sem barreiras". O id oficial não é de
 * barreira_colaborativa: só a colaborativa leva à ficha.
 */
export function BarreirasDoPasso({ barreiras }: { barreiras: BarreiraResumo[] }) {
  if (barreiras.length === 0) return null
  return (
    <ul className="barreiras-passo">
      {barreiras.map((b) => (
        <li key={`${b.origem}-${b.id}`}>
          {textoBarreira(b)}
          {b.origem === 'colaborativa' && (
            <Link
              className="alvo barreiras-passo__link"
              to={`/barreiras/${b.id}`}
              aria-label={`Ver e votar: ${rotuloCategoria(b.categoria)}, a ${Math.round(b.distancia_m)} m`}
            >
              Ver e votar
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}
```

`frontend/src/componentes/TabelaPassos.tsx`:

```tsx
import { Link } from 'react-router'
import {
  formatarDistancia,
  textoDataPasso,
  textoDeclividade,
  textoFontePasso,
  textoGuia,
  textoInstrucao,
  textoLargura,
  type Passo,
} from '../dados/passo'
import { linhaDoGeoJson, meioDaLinha } from '../dados/rotaGeo'
import { BarreirasDoPasso } from './BarreirasDoPasso'
import { Placa } from './Placa'

const CAMPOS = ['Distância', 'Largura', 'Declividade', 'Guia', 'Degrau', 'Fonte', 'Data']

type Props = {
  passos: Passo[]
  passoAtivo: number | null
  rotulo: string
  /** Com o mapa aberto, cada passo ganha "Ver o passo N no mapa". O texto dirige o mapa. */
  aoVerNoMapa?: (ordem: number) => void
  passoNoMapa?: number | null
  /** Em /rota cada passo leva às barreiras perto dele. */
  comBarreiras?: boolean
}

/** A lista canônica de passos (`id="lista-passos"`). Tudo o que o mapa mostra está aqui. */
export function TabelaPassos({ passos, passoAtivo, rotulo, aoVerNoMapa, passoNoMapa, comBarreiras = false }: Props) {
  return (
    <div className="tabela-passos">
      {/* cabeçalho só visual, alinhado pelo subgrid; cada linha mantém seus <dt> para o leitor de tela */}
      <div className="tabela-passos__cabecalho" aria-hidden="true">
        <span />
        {CAMPOS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <ol id="lista-passos" className="placas" aria-label={rotulo} tabIndex={-1}>
        {passos.map((p) => {
          const ativo = p.ordem === passoAtivo
          const linha = comBarreiras ? linhaDoGeoJson(p.geometria) : null
          return (
            <li
              key={p.ordem}
              id={`passo-${p.ordem}`}
              className={ativo ? 'placa-passo placa-passo--ativa' : 'placa-passo'}
              aria-current={ativo ? 'step' : undefined}
            >
              <span className="placa-passo__ordem letreiro">{p.ordem}</span>
              <p className="placa-passo__instrucao">{textoInstrucao(p)}</p>
              <dl className="placa-passo__dados">
                <div>
                  <dt className="rotulo-campo">Distância</dt>
                  <dd className="medida">{formatarDistancia(p.distancia_m)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Largura</dt>
                  <dd className="medida">{textoLargura(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Declividade</dt>
                  <dd className="medida">{textoDeclividade(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Guia</dt>
                  <dd className={p.guia === 'nao_transponivel' ? 'alerta' : undefined}>{textoGuia(p.guia)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Degrau</dt>
                  <dd className={p.is_degrau ? 'alerta' : undefined}>{p.is_degrau ? 'sim' : 'não'}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Fonte</dt>
                  <dd>{textoFontePasso(p)}</dd>
                </div>
                <div>
                  <dt className="rotulo-campo">Data</dt>
                  <dd className="medida">{textoDataPasso(p)}</dd>
                </div>
              </dl>
              <BarreirasDoPasso barreiras={p.barreiras_proximas} />
              {(aoVerNoMapa || linha) && (
                <div className="placa-passo__acoes">
                  {aoVerNoMapa && (
                    <Placa aria-current={p.ordem === passoNoMapa ? 'true' : undefined} onClick={() => aoVerNoMapa(p.ordem)}>
                      Ver o passo {p.ordem} no mapa
                    </Placa>
                  )}
                  {linha && (
                    <Link
                      className="alvo"
                      to="/barreiras"
                      state={{ ponto: meioDaLinha(linha), rotuloPonto: `Meio do passo ${p.ordem}: ${textoInstrucao(p)}` }}
                    >
                      Barreiras perto do passo {p.ordem}
                    </Link>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
```

Em `frontend/src/componentes/ResultadoRota.tsx`, acrescente a prop em `<TabelaPassos>`:

```tsx
        comBarreiras
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest --run src/test/Ligacao.test.tsx src/test/Rota.test.tsx src/test/Inicio.test.tsx`
Expected: PASS, 32 testes (3, 23 e 6).

- [ ] **Step 5: Verificação**

Run: `npx tsc -b ; npm run lint ; npx vitest --run`
Expected: sem erros; 32 arquivos, 289 testes passando.

---

### Task 24: E2E da colaboração e gate do Plano 6

**Files:**
- Create: `frontend/e2e/colaboracao.spec.ts`
- Modify: `DESIGN.md`, `PRODUCT.md`, `README.md`, `docs/superpowers/specs/2026-11-02-colaborativo-design.md`

- [ ] **Step 1: Escrever os cenários**

`frontend/e2e/colaboracao.spec.ts`:

```ts
import { expect, test, type Page, type Route } from '@playwright/test'
import { alvosDe44, BARREIRA, escolherPorTeclado, focoNaoCaiu, json, ROTA, semRolagemHorizontal, semViolacoes, simular, umaRegiaoViva } from './apoio'

const SUPABASE = 'https://teste.supabase.co'
const CONTA = '3f2a91b0-1111-2222-3333-444455556666'

function jwt(): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  return `${parte({ alg: 'ES256', typ: 'JWT' })}.${parte({ sub: CONTA, email: 'pessoa@exemplo.org', aud: 'authenticated', exp: agora + 3600, iat: agora })}.assinatura`
}

function sessao() {
  return {
    access_token: jwt(),
    refresh_token: 'r1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: CONTA, aud: 'authenticated', email: 'pessoa@exemplo.org', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' },
  }
}

/** Supabase Auth simulado; o build de E2E usa estas variáveis (package.json, build:e2e). */
async function simularAuth(page: Page) {
  await page.route(`${SUPABASE}/auth/v1/**`, (route: Route) => {
    const url = new URL(route.request().url())
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors })
    if (url.pathname.endsWith('/otp')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' })
    if (url.pathname.endsWith('/verify')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(sessao()) })
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' })
  })
}

async function verificarTela(page: Page, contexto: string) {
  await semViolacoes(page, contexto)
  await umaRegiaoViva(page)
  await semRolagemHorizontal(page, contexto)
  await alvosDe44(page, contexto)
}

test('cadastro em 3 toques só por teclado, com login no fim e a mesma chave', async ({ page }) => {
  const corpos: { chave_idempotencia: string; categoria: string }[] = []
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'colaborador' }),
    'POST /api/barreiras': (r) => {
      corpos.push(r.request().postDataJSON())
      return json(r, BARREIRA, 201)
    },
  })
  await simularAuth(page)
  await page.goto('/barreiras/nova')
  await verificarTela(page, 'cadastro vazio')

  await page.getByRole('radio', { name: /^Escada/ }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('combobox', { name: 'Endereço' }).focus()
  await page.keyboard.type('rua')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  // o combobox sai da tela: o foco vai ao local marcado, e dali se chega ao envio só com Tab
  await expect(page.locator('.escolha-local__escolhido p').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Trocar o local' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Descrição (opcional)' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Registrar barreira' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeFocused()
  await verificarTela(page, 'portão de login')
  expect(corpos).toHaveLength(0)

  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.keyboard.press('Enter')
  const codigo = page.getByRole('textbox', { name: 'Código de 6 dígitos' })
  await expect(codigo).toBeFocused()
  await verificarTela(page, 'código')
  await page.keyboard.type('123 456')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { level: 1, name: 'Barreira registrada' })).toBeFocused()
  expect(corpos).toHaveLength(1)
  expect(corpos[0].categoria).toBe('escada')
  await verificarTela(page, 'barreira registrada')
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Conta' })).toBeVisible()
})

test('ver barreiras e votar', async ({ page }) => {
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'colaborador' }),
    'PUT /api/barreiras/5/voto': (r) => json(r, { ...BARREIRA, status: 'validada', votos: { confirma: 2, contesta: 0, resolvida: 0 } }),
  })
  await simularAuth(page)
  await page.goto('/entrar')
  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.getByRole('button', { name: 'Receber código' }).click()
  await page.getByRole('textbox', { name: 'Código de 6 dígitos' }).fill('123456')
  await page.getByRole('button', { name: 'Confirmar código' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sua conta' })).toBeVisible()
  await verificarTela(page, 'conta')

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Barreiras' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Barreiras por perto' })).toBeFocused()
  await page.getByRole('combobox', { name: 'Endereço' }).fill('rua')
  await page.keyboard.press('Enter')
  await page.getByRole('option').first().click()
  await focoNaoCaiu(page, 'local escolhido')
  await page.getByRole('link', { name: /Ver e votar: Escada/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Escada' })).toBeFocused()
  await verificarTela(page, 'ficha')
  const confirmo = page.getByRole('button', { name: 'Confirmo' })
  await confirmo.click()
  await expect(confirmo).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status')).toContainText('Voto registrado. Agora são 2 confirmações.')
})

test('painel de admin: fila, decisão com motivo e auditoria', async ({ page }) => {
  const eventos: Record<string, unknown>[] = [{ id: 1, barreira_id: 5, usuario_id: CONTA, tipo: 'criada', de_status: null, para_status: 'pendente', detalhe: {}, criado_em: '2026-11-03T12:00:00+00:00' }]
  await simular(page, {
    'GET /api/eu': (r) => json(r, { papel: 'admin' }),
    'GET /api/admin/barreiras': (r) => json(r, [{ ...BARREIRA, status: 'removida' }]),
    'GET /api/admin/barreiras/5': (r) => json(r, { ...BARREIRA, status: 'removida' }),
    'GET /api/admin/barreiras/5/eventos': (r) => json(r, eventos),
    'POST /api/admin/barreiras/5/status': (r) => {
      eventos.push({ ...eventos[0], id: 2, tipo: 'admin', de_status: 'removida', para_status: 'pendente', detalhe: { motivo: 'Denúncia improcedente' } })
      return json(r, BARREIRA)
    },
  })
  await simularAuth(page)
  await page.goto('/entrar?volta=/admin?status=removida')
  await page.getByRole('textbox', { name: 'E-mail' }).fill('pessoa@exemplo.org')
  await page.getByRole('button', { name: 'Receber código' }).click()
  await page.getByRole('textbox', { name: 'Código de 6 dígitos' }).fill('123456')
  await page.getByRole('button', { name: 'Confirmar código' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Moderação' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nº 5, Escada' })).toBeVisible()
  await verificarTela(page, 'fila')
  await page.getByRole('link', { name: 'Nº 5, Escada' }).click()
  await expect(page.getByText(/criada por conta 3f2a91b0/)).toBeVisible()
  await verificarTela(page, 'decisão')
  await page.getByRole('radio', { name: /^Aguardando confirmação/ }).check()
  await page.getByRole('textbox', { name: 'Motivo' }).fill('Denúncia improcedente')
  await page.getByRole('button', { name: 'Registrar decisão' }).click()
  await expect(page.getByText(/Motivo: Denúncia improcedente/)).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Auditoria atualizada.')
})

test('reflow do cadastro a 320 px com o mapa de escolher ponto', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await simular(page)
  await page.goto('/barreiras/nova')
  await page.getByRole('button', { name: 'Escolher no mapa' }).click()
  const mapa = page.getByRole('img', { name: /Mapa para escolher um ponto/ })
  await expect(mapa).toBeVisible()
  await expect(mapa.locator('a, button, [tabindex]:not([tabindex="-1"])')).toHaveCount(0)
  await verificarTela(page, 'mapa de escolher')
  await expect(page.getByRole('button', { name: 'Escolher no mapa' })).toHaveAttribute('aria-describedby', /.+/)
  await page.getByRole('button', { name: 'Norte' }).click()
  await expect(page.getByRole('status')).toContainText('Mapa movido para norte.')
  await page.getByRole('button', { name: 'Marcar o centro do mapa' }).click()
  await expect(page.locator('.escolha-local__escolhido p').first()).toBeFocused()
  await page.getByRole('button', { name: 'Trocar o local' }).click()
  await expect(page.getByRole('combobox', { name: 'Endereço' })).toBeFocused()
})

test('mapa de escolher ponto: fundo que não carrega avisa e aponta os outros caminhos', async ({ page }) => {
  await simular(page)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/barreiras/nova')
  await page.getByRole('button', { name: 'Escolher no mapa' }).click()
  await expect(page.getByText('O fundo do mapa não carregou. Use a localização ou digite o endereço.')).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByRole('button', { name: 'Marcar o centro do mapa' })).toBeFocused()
})

test('o portão dentro da ficha abre por junta, sem caixa dentro de caixa; cancelar devolve o foco', async ({ page }) => {
  await simular(page)
  await page.goto('/barreiras/5')
  const confirmo = page.getByRole('button', { name: 'Confirmo' })
  await confirmo.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Entre para continuar' })).toBeFocused()
  const estilo = await page.locator('.portao').evaluate((el) => {
    const c = getComputedStyle(el)
    return { fundo: c.backgroundColor, esquerda: c.borderLeftWidth, topo: c.borderTopWidth }
  })
  expect(estilo).toEqual({ fundo: 'rgba(0, 0, 0, 0)', esquerda: '0px', topo: '1px' })
  await verificarTela(page, 'portão na ficha')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirmo).toBeFocused()
})

test('"Ver e votar" do passo é um alvo de 44 px', async ({ page }) => {
  const barreira = { id: 5, origem: 'colaborativa', categoria: 'buraco', severidade: 'dificulta', distancia_m: 12, confirmacoes: 1, data_referencia: '2026-11-03' }
  await simular(page, { 'POST /api/rotas': (r) => json(r, { ...ROTA, passos: [{ ...ROTA.passos[0], barreiras_proximas: [barreira] }] }) })
  await page.goto('/rota')
  await escolherPorTeclado(page)
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByRole('link', { name: 'Ver e votar: Buraco, a 12 m' })).toBeVisible()
  await alvosDe44(page, 'barreira no passo')
})
```

- [ ] **Step 2: Rodar**

Run: `npx tsc -p tsconfig.e2e.json ; npx playwright test`
Expected: sem erros de tipo; 21 cenários passando.

Em outro terminal, `npm run preview -- --port 4173 --strictPort`. Depois:

Run: `node scripts/gate-lighthouse.mjs`
Expected: nota de pelo menos 95 em `/`, `/rota`, `/fontes`, `/acessibilidade`, `/barreiras`, `/barreiras/nova` e `/entrar` (100 no protótipo).

- [ ] **Step 3: Gate manual do Plano 6, com NVDA e zoom de 400%**

Exige Docker com PostGIS, ETL local e um projeto Supabase com login configurado. Sem ordem do dono para mexer em produção, use um projeto de teste.

1. Entrar com código real, por teclado. Colar o código funciona.
2. Cadastrar uma escada só por teclado, sem mouse, com NVDA. Ao escolher o endereço, o foco vai a "Local marcado" e o NVDA lê o local; confirme que "Trocar o local" leva de volta à busca. Corrija a descrição com o portão aberto: o texto corrigido é o que vai.
3. Com outra conta, confirmar; com uma terceira, confirmar. Status vira "Confirmada".
4. Recalcular a rota e ver os passos mudarem. Hoje a saída não diz qual intransponível foi evitada, então a demonstração mostra os passos mudando. Precisa do OpenRouteService no ar: a rota de reserva (pgRouting) não lê barreira registrada (spec, decisão do dono 12), e a ficha da rota diz isso.
5. Repetir validando pelo painel de admin, com motivo, e ver a auditoria.
6. Remover uma barreira e restaurá-la pela fila.
7. Foto de câmera real, com GPS no EXIF, e conferir que a imagem servida não o tem.

Registre o resultado em `DESIGN.md`, "Registro da entrega". **Não marque o gate como cumprido sem essa rodada.**

- [ ] **Step 4: Documentação**

Em `PRODUCT.md`, na seção "Ainda não existe", remova a linha do cadastro colaborativo e deixe só o Plano 7. Em "Existe hoje", acrescente:

```markdown
- Login por código de 6 dígitos, cadastro de barreira em 3 toques, votos, foto opcional e painel de moderação.
```

A linha 54 de `PRODUCT.md` ("Nenhuma chave de API no frontend") **só muda com a decisão 1 do dono** (spec, seção 18).

Em `README.md`, na seção "Produção", acrescente às variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` como variáveis de build no Cloudflare e corrija "das 7h às 3h" para "das 7h às 23h59 de Brasília", conforme `keep-alive.yml`. Em "Armadilhas conhecidas", acrescente:

```markdown
- Chunk antigo depois de um deploy: o Workers devolve `index.html` com 200, e `ErroDePagina` oferece recarregar, sem afirmar a causa, porque falta de sinal chega igual.
- O código do login exige `{{ .Token }}` nos modelos Magic Link **e** de confirmação de cadastro no Supabase; sem isso chega um link, não o código.
- `frontend/public/_headers` lista os hosts da API e do Supabase: mudou o host, muda a CSP.
```

Em `docs/superpowers/specs/2026-11-02-colaborativo-design.md`, seção 10, acrescente uma referência à seção 16 do spec de 05/11/2026.

- [ ] **Step 5: Verificação final**

Run: `npx tsc -b ; npx tsc -p tsconfig.e2e.json ; npm run lint ; npx vitest --run ; npm run build ; npm run orcamento ; npx playwright test`
Expected: tudo verde; 32 arquivos, 289 testes e 21 cenários.

Em `backend/`: `.venv/Scripts/python.exe -m pytest -q ; .venv/Scripts/python.exe -m ruff check . ; .venv/Scripts/python.exe -m ruff format --check .`
Expected: suíte verde.

Run: `git status --short`
Expected: as alterações do plano, nada commitado. Entregue ao dono a lista da seção 16 do spec e as decisões da seção 18.
