import { useEffect, useRef, type ReactNode } from 'react'
import '../estilos/rota.css'
import { textoRetorno } from './campoEstado'
import { Pictograma } from './Pictograma'
import type { BuscaEndereco } from './useBuscaEndereco'
import { useEsperaServidor } from './useEsperaServidor'

type Props = {
  id: string
  rotulo: string
  busca: BuscaEndereco
  /** Erro do formulário ("Escolha um endereço da lista."); tem precedência sobre o retorno. */
  erro?: string | null
  /** Digitar invalida o erro: quem guarda o erro limpa aqui, para o retorno voltar a aparecer. */
  aoEditar?: () => void
  dica?: string
  /** Fica depois da lista: o botão de localização, na origem. */
  children?: ReactNode
}

const DICA_PADRAO = 'Digite ao menos 3 letras da rua ou do lugar e escolha na lista.'

/**
 * Combobox editável ARIA 1.2 com lista e seleção manual. A lista fica em fluxo, nunca
 * flutuante: resolve 320 px, zoom de 400% e foco coberto (WCAG 2.4.11) de uma vez.
 */
export function CampoEndereco({ id, rotulo, busca, erro, aoEditar, dica = DICA_PADRAO, children }: Props) {
  const { estado } = busca
  const aberta = estado.fase === 'lista' && estado.aberta
  const ativo = estado.fase === 'lista' ? estado.ativo : -1
  const espera = useEsperaServidor(estado.fase === 'buscando')
  const lista = useRef<HTMLDivElement>(null)
  const retorno = erro ?? espera ?? textoRetorno(estado)

  useEffect(() => {
    if (ativo >= 0) lista.current?.children[ativo]?.scrollIntoView?.({ block: 'nearest' })
  }, [ativo])

  return (
    <div className="campo campo-endereco">
      <label htmlFor={id}>{rotulo}</label>
      <p id={`${id}-dica`} className="campo__dica">
        {dica}
      </p>
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        maxLength={100}
        aria-autocomplete="list"
        aria-expanded={aberta}
        aria-controls={`${id}-lista`}
        aria-activedescendant={ativo >= 0 ? `${id}-op-${ativo}` : undefined}
        aria-invalid={erro ? true : undefined}
        aria-describedby={`${id}-dica ${id}-retorno`}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint={estado.fase === 'escolhido' ? 'go' : 'search'}
        value={busca.texto}
        onChange={(e) => {
          aoEditar?.()
          busca.aoDigitar(e.target.value)
        }}
        onKeyDown={busca.aoTecla}
        onBlur={(e) => {
          // trocar de janela também tira o foco, mas o campo continua sendo o elemento ativo
          if (document.activeElement !== e.currentTarget) busca.aoSair()
        }}
        onCompositionStart={busca.aoComporInicio}
        onCompositionEnd={(e) => busca.aoComporFim(e.currentTarget.value)}
      />
      <p id={`${id}-retorno`} className={erro ? 'campo__retorno campo__retorno--erro' : 'campo__retorno'}>
        {erro && <Pictograma nome="alerta" />}
        <span>{retorno}</span>
      </p>
      <div ref={lista} id={`${id}-lista`} role="listbox" aria-label={`Sugestões para ${rotulo.toLowerCase()}`} hidden={!aberta} className="sugestoes">
        {estado.fase === 'lista' &&
          estado.opcoes.map((op, i) => (
            // o teclado fica no campo (aria-activedescendant); o clique mantém o foco nele
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
            <div
              key={op.id}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === ativo}
              className="sugestao"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => busca.escolher(op)}
            >
              <span>{op.rotulo}</span>
              {op.aproximado && <span className="sugestao__nota">número aproximado: o mais próximo do que você digitou</span>}
              {i === ativo && <Pictograma nome="siga" tamanho={20} className="sugestao__marca" />}
            </div>
          ))}
      </div>
      {children}
    </div>
  )
}
