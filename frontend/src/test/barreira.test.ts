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
