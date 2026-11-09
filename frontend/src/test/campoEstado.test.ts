import { semRepetidas } from '../componentes/campoEstado'

describe('sugestões repetidas', () => {
  const op = (rotulo: string, lat: number, lon: number) => ({ rotulo, lat, lon })

  it('tira a mesma sugestão no mesmo lugar e mantém a primeira', () => {
    const lista = [op('Terminal Metrô Vila Mariana · Vila Mariana', -23.5891, -46.6347), op('Terminal metrô Vila Mariana · Vila Mariana', -23.5893, -46.6349), op('Rua Domingos de Morais, 10', -23.58, -46.63)]
    expect(semRepetidas(lista)).toEqual([lista[0], lista[2]])
  })

  it('mesmo nome em lugares distantes continua: são lugares diferentes', () => {
    const lista = [op('Paulista · Centro', -23.561, -46.656), op('Paulista · Centro', -23.57, -46.64)]
    expect(semRepetidas(lista)).toHaveLength(2)
  })
})
