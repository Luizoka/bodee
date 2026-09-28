# BODEE — extensão Chrome

## Arquitetura

O código-fonte da extensão está em `extension/`. O build copia somente os arquivos
de runtime para `dist-extension/`:

```text
extension/src/background/service-worker.js  → dist-extension/background/
extension/src/equatorial/client.js          → dist-extension/services/
extension/src/shared/                       → dist-extension/shared/
extension/src/popup/                        → dist-extension/popup/
extension/assets/ e extension/icons/        → dist-extension/assets/ e icons/
extension/manifest.json                     → dist-extension/manifest.json
```

O service worker coordena as mensagens e os downloads. O popup exibe unidades e
competências. Funções pontuais são injetadas no contexto do portal pelo
`chrome.scripting`, usando a sessão legítima do usuário. Não há content script,
Playwright, Node.js, servidor local ou executável externo dentro de
`dist-extension/`.

## Build, teste e release

```bash
pnpm install
pnpm build:extension
pnpm check:extension
pnpm package:extension
```

Carregue `dist-extension/` em `chrome://extensions` para testar exatamente o
bundle de produção. `package:extension` reconstrói e valida o bundle e cria
`release/bodee-extension-<versão>.zip`, com o manifest na raiz.

## Permissões

| Permissão | Motivo técnico |
| --- | --- |
| `scripting` | Executar funções pontuais no contexto principal do portal e da API, usando a sessão existente do usuário. |
| `downloads` | Entregar os PDFs selecionados no computador do usuário. |

Não são usadas permissões `tabs`, `cookies`, `webRequest`, `history`,
`storage` ou acesso amplo a sites.

## Hosts utilizados

| Host | Motivo |
| --- | --- |
| `https://pa.equatorialenergia.com.br/*` | Portal onde o usuário se autentica e de onde são listadas as unidades. |
| `https://api-pa-cliente.equatorialenergia.com.br/*` | API da Equatorial usada para consultar faturas e segundas vias. |

## Dados, armazenamento e logs

O BODEE acessa temporariamente a sessão autenticada, unidades, nome do titular,
identificadores de unidade/conta, competências, número de fatura e PDF. Esses
dados não são persistidos pela extensão. JWT, cookies e PDFs vivem apenas em
memória durante a operação; o PDF é então entregue ao gerenciador de downloads do
Chrome. A extensão não envia dados a infraestrutura própria e não possui analytics.

Não há logs de produção de tokens, cookies, CPF/CNPJ, conta completa, Base64 ou
respostas pessoais. Erros apresentados ao usuário são mensagens curtas e
compreensíveis.

## Checklist Chrome Web Store

- [ ] Executar `pnpm package:extension` e subir somente o ZIP em `release/`.
- [ ] Testar `dist-extension/` sem a extensão de desenvolvimento carregada.
- [ ] Hospedar `docs/privacy-policy.md` em URL HTTPS e atualizar o contato.
- [ ] Gerar screenshots reais e não sensíveis conforme `store-assets/README.md`.
- [ ] Conferir versão, descrição, permissões e divulgações de privacidade no painel.
- [ ] Declarar que a extensão não é afiliada à Equatorial.
