import { lazy, Suspense } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { SessaoProvider } from './auth/SessaoProvider'
import { LinkConta } from './auth/LinkConta'
import { CarregandoPagina } from './componentes/CarregandoPagina'
import { ErroDePagina } from './componentes/ErroDePagina'
import { Pictograma } from './componentes/Pictograma'
import { RegiaoViva } from './componentes/RegiaoViva'
import { Inicio } from './pages/Inicio'

// a landing fica na entrada (é a primeira dobra); o resto vem sob demanda
const Rota = lazy(() => import('./pages/Rota').then((m) => ({ default: m.Rota })))
// chunk próprio, sem Leaflet: a navegação guiada não tem mapa (spec 9)
const Navegar = lazy(() => import('./pages/Navegar').then((m) => ({ default: m.Navegar })))
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
            <Suspense fallback={<CarregandoPagina />}>
              <Routes>
                <Route path="/" element={<Inicio />} />
                <Route path="/rota" element={<Rota />} />
                <Route path="/rota/navegar" element={<Navegar />} />
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
