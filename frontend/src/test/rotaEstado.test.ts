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
    expect(resumoDaRota(ROTA, 6)).toBe('200 m em 2 passos, cerca de 4 minutos a pé, sem avisos')
    expect(resumoDaRota({ ...ROTA, passos: [passo(1)] }, 6)).toContain('em 1 passo,')
    // conta os avisos que a ficha mostra, não os do backend
    expect(resumoDaRota({ ...ROTA, passos: [passo(1, { is_degrau: true })], motor: 'pgrouting' }, 6)).toContain('2 avisos')
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
