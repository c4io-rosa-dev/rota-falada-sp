import { ROTA_EXEMPLO } from '../dados/rotaExemplo'
import {
  formatarData,
  formatarDistancia,
  letreiroDoPasso,
  nomeFonte,
  separarInstrucao,
  textoDeclividade,
  textoDegrau,
  textoGuia,
  textoLargura,
} from '../dados/passo'

const [p1, p2, , p4] = ROTA_EXEMPLO.passos

describe('formatação de um passo', () => {
  it('separa a ação do nome da rua quando a instrução traz "em direção a"', () => {
    expect(separarInstrucao(p2.instrucao)).toEqual({ acao: 'Vire à direita', rua: 'Rua Helen Keller' })
    expect(separarInstrucao(p1.instrucao)).toEqual({ acao: 'Siga para oeste', rua: null })
  })

  it('usa o nome da rua como letreiro, ou a própria instrução quando não há rua', () => {
    expect(letreiroDoPasso(p2)).toBe('Rua Helen Keller')
    expect(letreiroDoPasso(p4)).toBe('Vire à direita')
  })

  it('formata medidas em pt-BR com uma casa decimal', () => {
    expect(formatarDistancia(48)).toBe('48 m')
    expect(formatarDistancia(750.7)).toBe('751 m')
    expect(formatarDistancia(1993.9)).toBe('2,0 km')
    expect(textoLargura(p4)).toBe('1,67 m')
    expect(textoDeclividade(p4)).toBe('cerca de 3% (estimativa)')
    expect(textoDeclividade({ ...p4, declividade_pct: 9.15, declividade_medida: true })).toBe('9,15% (GeoSampa)')
    expect(textoDeclividade({ ...p4, declividade_pct: null, declividade_medida: false })).toBe('sem dado')
  })

  it('diz "sem dado" quando o dado não existe, em vez de inventar', () => {
    expect(textoLargura(p2)).toBe('sem dado')
    expect(textoGuia('desconhecida')).toBe('sem dado')
    expect(formatarData(null)).toBe('sem dado')
  })

  it('traduz guia, degrau, fonte e data', () => {
    expect(textoGuia('transponivel')).toBe('rebaixada')
    expect(textoGuia('nao_transponivel')).toBe('não rebaixada')
    expect(textoDegrau(false)).toBe('sem degrau')
    expect(textoDegrau(true)).toBe('com degrau')
    expect(nomeFonte('osm')).toBe('OpenStreetMap')
    expect(nomeFonte('geosampa')).toBe('GeoSampa')
    expect(formatarData('2026-10-12')).toBe('12/10/2026')
  })

})
