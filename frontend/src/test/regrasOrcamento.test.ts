import { referenciasEstaticasAoMotor } from '../../scripts/regrasOrcamento.mjs'

describe('orçamento: o motor do mapa só por import()', () => {
  it.each([
    ['import nomeado', 'import{c as d}from"./MotorMapaNavegacao-B1x2.js";'],
    ['import com espaço', "import { c } from './MotorMapaNavegacao-B1x2.js'"],
    ['import só pelo efeito', 'import"./MotorMapaNavegacao-B1x2.js";'],
    ['reexportação', 'export{c}from"./MotorMapaNavegacao-B1x2.js";'],
  ])('reprova %s', (_nome, texto) => {
    expect(referenciasEstaticasAoMotor(texto)).toEqual(['import estático do MotorMapaNavegacao'])
  })

  it('reprova qualquer menção ao worker do MapLibre', () => {
    expect(referenciasEstaticasAoMotor('const u="/assets/maplibre-gl-worker-Ab12.mjs"')).toEqual([
      'referência ao maplibre-gl-worker',
    ])
  })

  it.each([
    ['import() dinâmico', 'const m=()=>import("./MotorMapaNavegacao-B1x2.js")'],
    ['import () com espaço', 'import ( "./MotorMapaNavegacao-B1x2.js" )'],
    ['lista do preload do Vite', '__vite__mapDeps(["assets/MotorMapaNavegacao-B1x2.js","assets/index-x.css"])'],
    ['página sem o mapa', 'import{a}from"./index-Q9.js";'],
  ])('aceita %s', (_nome, texto) => {
    expect(referenciasEstaticasAoMotor(texto)).toEqual([])
  })
})
