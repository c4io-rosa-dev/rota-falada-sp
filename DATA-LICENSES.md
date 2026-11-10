# Licenças dos dados

| Fonte | Licença | Obrigações | Tabelas |
|---|---|---|---|
| OpenStreetMap (via Geofabrik) | ODbL 1.0 | Atribuição "© OpenStreetMap contributors"; share-alike em bases derivadas | `via_pedestre`, `no_pedestre` |
| GeoSampa / PMSP | CC-BY-SA 4.0 | Atribuição; manter licença semelhante em obras derivadas | `calcada_sp` (fisicamente isolada) |
| SP156 / SMIT | CC0 1.0 | Nenhuma (atribuímos por boa prática) | `barreira_oficial` |
| SPTrans (Olho Vivo e GTFS) | Não declarada publicamente | Atribuímos "Dados: SPTrans / API Olho Vivo" | `parada`, `linha` |
| openrouteservice | Dados ODbL; serviço CC-BY 4.0 | "© openrouteservice.org by HeiGIT" | respostas em `rota_cache` |
| Contribuições dos usuários | ODbL 1.0 (decisão de 10/09/2026) | Permite devolução futura ao OSM | `barreira_colaborativa`, `confirmacao`, `barreira_evento` |
| Fotos enviadas pelos usuários | CC BY-SA 4.0 (decisão de 05/11/2026) | Atribuição; manter licença semelhante em obras derivadas | bucket `fotos-barreiras` |
| OpenStreetMap via build do Protomaps (mapa da navegação) | ODbL 1.0 | Atribuição visível junto do mapa; o arquivo recortado é distribuído sob a ODbL | nenhuma: arquivo `rota-falada-sp-AAAAMMDD.pmtiles` no bucket R2 `rota-falada-mapas` |

A tabela `usuario` guarda só o id do Supabase e o papel (`colaborador`/`admin`); nenhum e-mail é copiado para o banco da aplicação. As respostas públicas não expõem autor nem votantes; as fotos são reprocessadas sem metadados (o GPS da câmera é descartado). Na exclusão de conta, as barreiras continuam públicas, sem autor.

## Por que as tabelas são separadas

ODbL e CC-BY-SA 4.0 são dois copyleft mutuamente incompatíveis para gerar uma base derivada única. A solução é de modelagem, não jurídica: os dados do OSM e do GeoSampa ficam em tabelas fisicamente separadas, ligadas pela tabela `conflacao_via_calcada`, que guarda **apenas chaves estrangeiras, distância, confiança e método**. Nenhuma geometria é fundida e nenhum atributo é copiado entre elas. O conjunto se caracteriza como *Collective Database* e o share-alike de uma fonte não contamina a outra nem os dados próprios do grupo.

Regras práticas:

1. Jamais fazer upload de dados do GeoSampa para o OpenStreetMap.
2. Jamais copiar `largura` ou `declividade` do GeoSampa para uma coluna da tabela do OSM. A junção é feita na consulta.
3. A tabela `fonte_dados` é a fonte da verdade das atribuições exibidas na interface; toda linha espacial aponta para ela.

## Mapa da navegação

O mapa opcional da navegação guiada é desenhado no aparelho com tiles vetoriais servidos pelo próprio site (`/mapa/*`, Worker da Cloudflare lendo o bucket R2 `rota-falada-mapas`). Nenhum terceiro recebe pedido de mapa.

| Peça | Versão | Licença | Papel |
|---|---|---|---|
| `maplibre-gl` | 6.16.0 (exata) | BSD-3-Clause | desenha o mapa (só no chunk carregado ao abrir o mapa) |
| `pmtiles` | 4.5.0 (exata) | BSD-3-Clause | lê o arquivo `.pmtiles` por requisição HTTP Range |
| `@protomaps/basemaps` | 5.7.2 (exata) | BSD-3-Clause (é o que o `package.json` do pacote declara) | camadas da base, recoloridas com o "flavor" concreto em `frontend/src/componentes/mapa/estiloMapaNavegacao.ts` |
| Dependências transitivas novas (25 pacotes, conferidas no `package-lock.json` em 09/11/2026) | — | MIT, ISC, BSD-2-Clause, BSD-3-Clause, MIT OR Apache-2.0 | nenhuma GPL, AGPL ou LGPL |

Dados e demais peças:

- **OpenStreetMap (ODbL 1.0).** O arquivo `rota-falada-sp-AAAAMMDD.pmtiles` é um recorte, sem alteração dos dados, do build diário do Protomaps (`https://build.protomaps.com/AAAAMMDD.pmtiles`, dados do OSM) só da área coberta; a data no nome é a do build usado (ver `scripts/mapa/LEIAME.md`). Como o Worker entrega o arquivo inteiro a quem pedir sem `Range`, os dados do OSM podem ser extraídos dele: tratamos o arquivo como *Derivative Database* e o **distribuímos sob a ODbL 1.0**, no próprio endereço `/mapa/rota-falada-sp-AAAAMMDD.pmtiles`. Obrigações: crédito visível junto do mapa, "Mapa: Protomaps © colaboradores do OpenStreetMap", fora do desenho (texto em HTML, lido por leitor de tela), com link para https://www.openstreetmap.org/copyright; e a página Fontes diz que o recorte é distribuído sob a ODbL.
- **Por que o arquivo não entra em `fonte_dados`.** A regra 3 vale para linhas espaciais do banco (cada uma aponta para a sua fonte). O `.pmtiles` não é linha do banco: fica no R2 e leva a atribuição no próprio mapa, sempre visível. Registrá-lo em `fonte_dados` pediria uma migração no banco de produção, decisão do dono; até lá, a página Fontes cita o mapa num parágrafo fixo.
- **Esquema de tiles e estilo Protomaps.** O pacote `@protomaps/basemaps` declara só BSD-3-Clause; nenhuma outra licença do estilo foi conferida neste repositório, então não afirmamos nenhuma. Usamos as camadas como base e trocamos todas as cores pelos tokens do DESIGN.md; sem ícones, sem POIs e sem fontes remotas (sem `glyphs` nem `sprite`).
- **Fonte Archivo (SIL Open Font License 1.1).** Já distribuída no site via `@fontsource-variable/archivo`; o mapa reaproveita os mesmos `woff2` locais pela propriedade `font-faces` do estilo.
- **go-pmtiles (BSD-3-Clause).** Ferramenta externa usada só para gerar o `.pmtiles` (ver `scripts/mapa/LEIAME.md`). Não é distribuída com o site nem baixada sem autorização do dono.

## Avisos de licença do código de terceiros

BSD, MIT, ISC e a OFL pedem que o aviso de copyright acompanhe a redistribuição, e o build minificado não leva os comentários de licença. Por isso o build gera `dist/licencas-terceiros.txt` (plugin `frontend/scripts/pluginAvisosTerceiros.ts`): a lista de todo pacote npm que entra em algum chunk, mais as dependências que ele declara (o `maplibre-gl` traz `pbf`, `@mapbox/vector-tile`, `@mapbox/tiny-sdf`, `@mapbox/unitbezier` e outras embutidas no próprio dist), com o texto da licença de cada um, lido do próprio pacote. O arquivo é publicado na raiz do site e linkado da página Fontes ("Avisos de licença do código de terceiros"); o `npm run orcamento` reprova o build se ele faltar.
