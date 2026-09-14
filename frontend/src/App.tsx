import { Link, NavLink, Route, Routes } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { Inicio } from './pages/Inicio'

export default function App() {
  return (
    <>
      <SkipLink />
      <header>
        <nav aria-label="Principal">
          <ul className="menu">
            <li>
              <NavLink className="alvo" to="/">
                Início
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
      </header>
      <main id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/fontes" element={<Inicio />} />
          <Route path="/acessibilidade" element={<Inicio />} />
        </Routes>
      </main>
      <footer>
        <p>
          Dados do mapa © colaboradores do OpenStreetMap. Veja{' '}
          <Link to="/fontes">todas as fontes e licenças</Link>.
        </p>
      </footer>
    </>
  )
}
