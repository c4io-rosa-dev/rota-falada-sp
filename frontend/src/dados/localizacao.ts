export type Posicao = { lat: number; lon: number; precisaoM: number }

/** Duas vezes o raio do reverso (50 m). Escolha de projeto; ajustar depois do teste em campo. */
export const PRECISAO_ACEITAVEL_M = 100

export const FORA_DA_AREA = 'Este ponto está fora da área atendida pelo Rota Falada SP.'

export class ErroLocalizacao extends Error {
  readonly codigo: number

  constructor(codigo: number) {
    super(codigo === 1 ? 'O navegador não autorizou a localização.' : 'Não conseguimos sua localização agora.')
    this.name = 'ErroLocalizacao'
    this.codigo = codigo
  }
}

export function temGeolocalizacao(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && !!navigator.geolocation
}

/** Só chamar a partir de um clique: é aqui que o navegador pede permissão. */
export function obterPosicao(): Promise<Posicao> {
  return new Promise((resolver, rejeitar) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lon: p.coords.longitude, precisaoM: p.coords.accuracy }),
      (e) => rejeitar(new ErroLocalizacao(e.code)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  })
}

/** 4 casas (cerca de 11 m): as coordenadas viram URL e cache, e o raio de busca é 50 m. */
export function arredondar4(valor: number): number {
  return Math.round(valor * 10_000) / 10_000
}
