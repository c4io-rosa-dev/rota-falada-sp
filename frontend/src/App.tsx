import { Link, NavLink, Route, Routes } from 'react-router'
import { SkipLink } from './a11y/SkipLink'
import { Pictograma } from './componentes/Pictograma'
import { RegiaoViva } from './componentes/RegiaoViva'
import { Inicio } from './pages/Inicio'
import { Rota } from './pages/Rota'
import { Fontes } from './pages/Fontes'
import { Acessibilidade } from './pages/Acessibilidade'

export default function App() {
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
        </Routes>
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
