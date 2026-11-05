import { Component, createRef, type ReactNode } from 'react'
import { Placa } from './Placa'

type Props = { children: ReactNode }
type Estado = { falhou: boolean }

const TITULO = 'Não conseguimos abrir esta página'

/**
 * Página que não carregou: sem sinal, ou um chunk antigo depois de um deploy (o Workers
 * devolve index.html com 200 e o import() rejeita). Não dá para saber qual; o texto não
 * afirma a causa. A App remonta este limite a cada troca de rota (key = pathname).
 */
export class ErroDePagina extends Component<Props, Estado> {
  state: Estado = { falhou: false }
  private readonly titulo = createRef<HTMLHeadingElement>()

  static getDerivedStateFromError(): Estado {
    return { falhou: true }
  }

  private anunciarFalha() {
    document.title = `${TITULO} · Rota Falada SP`
    this.titulo.current?.focus()
  }

  componentDidMount() {
    if (this.state.falhou) this.anunciarFalha()
  }

  componentDidUpdate(_props: Props, anterior: Estado) {
    if (this.state.falhou && !anterior.falhou) this.anunciarFalha()
  }

  render() {
    if (!this.state.falhou) return this.props.children
    return (
      <div className="folha">
        <h1 ref={this.titulo} tabIndex={-1}>
          {TITULO}
        </h1>
        <p>Pode ser falta de sinal ou uma versão nova do site. Confira o sinal e recarregue.</p>
        <Placa onClick={() => window.location.reload()}>Recarregar a página</Placa>
      </div>
    )
  }
}
