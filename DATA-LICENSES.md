# Licenças dos dados

| Fonte | Licença | Obrigações | Tabelas |
|---|---|---|---|
| OpenStreetMap (via Geofabrik) | ODbL 1.0 | Atribuição "© OpenStreetMap contributors"; share-alike em bases derivadas | `via_pedestre`, `no_pedestre` |
| GeoSampa / PMSP | CC-BY-SA 4.0 | Atribuição; manter licença semelhante em obras derivadas | `calcada_sp` (fisicamente isolada) |
| SP156 / SMIT | CC0 1.0 | Nenhuma (atribuímos por boa prática) | `barreira_oficial` |
| SPTrans (Olho Vivo e GTFS) | Não declarada publicamente | Atribuímos "Dados: SPTrans / API Olho Vivo" | `parada`, `linha` |
| openrouteservice | Dados ODbL; serviço CC-BY 4.0 | "© openrouteservice.org by HeiGIT" | respostas em `rota_cache` |
| Contribuições dos usuários | ODbL 1.0 (decisão de 10/09/2026) | Permite devolução futura ao OSM | `barreira_colaborativa`, `confirmacao` |

## Por que as tabelas são separadas

ODbL e CC-BY-SA 4.0 são dois copyleft mutuamente incompatíveis para gerar uma base derivada única. A solução é de modelagem, não jurídica: os dados do OSM e do GeoSampa ficam em tabelas fisicamente separadas, ligadas pela tabela `conflacao_via_calcada`, que guarda **apenas chaves estrangeiras, distância, confiança e método**. Nenhuma geometria é fundida e nenhum atributo é copiado entre elas. O conjunto se caracteriza como *Collective Database* e o share-alike de uma fonte não contamina a outra nem os dados próprios do grupo.

Regras práticas:

1. Jamais fazer upload de dados do GeoSampa para o OpenStreetMap.
2. Jamais copiar `largura` ou `declividade` do GeoSampa para uma coluna da tabela do OSM. A junção é feita na consulta.
3. A tabela `fonte_dados` é a fonte da verdade das atribuições exibidas na interface; toda linha espacial aponta para ela.
