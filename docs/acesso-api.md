# Acesso à API por papel

Esta API possui três contextos de uso. Uma mesma chave nunca deve ser usada em
mais de um contexto.

## 1. Administração da plataforma

Uso: onboarding de clientes, operação diária e recuperação de falhas.

Autenticação: `Authorization: Bearer <ADMIN_API_KEY>`.

Essa chave pertence somente à equipe que opera o FaturaSync. Ela não deve ser
enviada a clientes finais, integradores ou aplicações de terceiros.

| Método e rota | Uso |
| --- | --- |
| `POST /api/v1/clients` | Cria um cliente da plataforma. |
| `POST /api/v1/clients/:id/accounts` | Associa uma conta contrato ao cliente. |
| `DELETE /api/v1/clients/:id` | Remove o cliente e seus dados associados. |
| `PUT /api/v1/clients/:id/providers/equatorial/credentials` | Salva credenciais Equatorial criptografadas. |
| `GET /api/v1/clients/:id/providers/equatorial/credentials/status` | Verifica somente se as credenciais existem. |
| `DELETE /api/v1/clients/:id/providers/equatorial/credentials` | Remove as credenciais Equatorial. |
| `POST /api/v1/clients/:id/api-keys` | Emite uma API key para o cliente; o valor aparece apenas nessa resposta. |
| `DELETE /api/v1/clients/:clientId/api-keys/:keyId` | Revoga uma API key de cliente. |
| `GET /api/v1/admin/sync-runs` | Consulta a fila e seus status; aceita `status` e `limit`. |
| `POST /api/v1/admin/sync-runs/:id/requeue` | Reprocessa uma execução que esteja em `FAILED`. |
| `GET /api/v1/admin/audit-logs` | Consulta eventos de auditoria; aceita `limit`. |

Exemplo de operação: cadastrar a empresa, associar suas contas, configurar
credenciais, emitir sua API key e acompanhar eventuais falhas da fila.

## 2. Cliente final ou integrador

Uso: solicitar, consultar e baixar somente as próprias faturas.

Autenticação: `Authorization: Bearer <API key do cliente>`.

A chave é emitida pela administração. Ela é vinculada a um único cliente e a
API ignora qualquer tentativa de consultar IDs, faturas ou contas de outro
cliente.

| Método e rota | Uso |
| --- | --- |
| `POST /api/v1/sync` | Cria uma solicitação de sincronização para contas já associadas ao cliente. |
| `GET /api/v1/sync/:id` | Consulta o status e itens de uma solicitação própria. |
| `GET /api/v1/invoices` | Lista somente as próprias faturas. |
| `GET /api/v1/invoices/:id/download` | Baixa o PDF de uma fatura própria. |

Fluxo esperado: o integrador envia `POST /sync`, recebe `syncId`, consulta
`GET /sync/:id` até `COMPLETED` e então usa `GET /invoices` e o download.

## 3. Processos internos do sistema

Esses processos não são rotas HTTP públicas e não usam API keys de cliente.

| Comando | Uso |
| --- | --- |
| `pnpm scheduler:monthly` | Cria trabalhos mensais para contas ativas elegíveis. |
| `pnpm worker:sync` | Busca itens da fila e processa os PDFs. |
| `pnpm test:worker:recovery` | Testa falhas, reinício do worker e reprocessamento; uso exclusivo de desenvolvimento. |

O agendador apenas cria itens `QUEUED`; o worker é quem os processa. Em Windows,
a tarefa `FaturaSync - Agendamento Mensal` executa o agendador mensalmente.

## Rota pública de infraestrutura

| Método e rota | Uso |
| --- | --- |
| `GET /api/v1/health` | Verifica se API e banco estão disponíveis. Não requer autenticação. |

## Referência interativa

Com a API em execução, use Swagger em `http://localhost:3000/api/docs` para
ver parâmetros, exemplos e testar as rotas com as chaves apropriadas.
