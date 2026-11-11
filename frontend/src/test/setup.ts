import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import * as axeMatchers from 'vitest-axe/matchers'
import { beforeEach, expect } from 'vitest'
import { reiniciarEstadoDeNavegacao } from '../a11y/usePaginaAcessivel'
import { reiniciarServidor } from '../api/servidor'
import { reiniciarAnuncioDeEspera } from '../componentes/useEsperaServidor'

expect.extend(axeMatchers)

// com a suíte inteira rodando em paralelo, telas pesadas passam de 1 s para aparecer: o prazo de findBy/waitFor sobe para 5 s
configure({ asyncUtilTimeout: 5000 })

// cada teste começa como uma carga nova da aplicação (sem foco no h1 no primeiro render)
beforeEach(() => {
  reiniciarEstadoDeNavegacao()
  reiniciarServidor()
  reiniciarAnuncioDeEspera()
  sessionStorage.clear()
  localStorage.clear()
})
