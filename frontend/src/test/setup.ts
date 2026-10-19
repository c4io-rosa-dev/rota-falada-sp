import '@testing-library/jest-dom/vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import { beforeEach, expect } from 'vitest'
import { reiniciarEstadoDeNavegacao } from '../a11y/usePaginaAcessivel'

expect.extend(axeMatchers)

// cada teste começa como uma carga nova da aplicação (sem foco no h1 no primeiro render)
beforeEach(() => reiniciarEstadoDeNavegacao())
