# FaturaSync

POC para autenticar no portal da Equatorial com Playwright e usar a API HTTP para
localizar e baixar uma fatura por competência.

O desenvolvimento foi dividido em [roteiros menores](./roteiros/README.md). A
implementação atual está limitada à Parte 01: não há banco, Redis, scheduler ou
API pública.

## Requisitos

- Node.js 20 ou superior;
- pnpm 9;
- credenciais e conta autorizadas para teste.

## Instalação

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

Preencha o `.env` local. Ele é ignorado pelo Git. Não coloque credenciais reais
no `.env.example`.

## Execução

Durante o primeiro diagnóstico, é útil acompanhar o navegador:

```env
PLAYWRIGHT_HEADLESS=false
```

Depois execute:

```bash
pnpm poc:equatorial
```

Para validar o fluxo localmente sem abrir o portal nem depender dos servidores
da Equatorial, execute:

```bash
pnpm poc:offline
```

Esse comando simula a autenticação, a lista de faturas e o download de uma
segunda via. O PDF de teste é salvo em `output/equatorial-offline/`. Ele aceita
`EQUATORIAL_ACCOUNT`, `EQUATORIAL_COMPETENCE` e `POC_OFFLINE_OUTPUT_DIR` do
`.env`, mas não usa credenciais reais.

Fluxo realizado:

```text
portal informado
-> login por CPF/CNPJ e data de nascimento
   ou OTP, quando o portal exigir
-> captura do JWT
-> consulta de débitos da conta
-> seleção pela competência AAAA/MM
-> download da segunda via em Base64
-> validação do PDF
-> output/equatorial/CONTA/AAAA-MM/CONTA_MMYYYY.pdf
```

Os logs são estruturados e não exibem documento, data de nascimento, conta,
Base64 ou JWT. O arquivo é nomeado pela conta contrato e competência.

## Verificações locais

```bash
pnpm build
pnpm lint
pnpm test
pnpm format:check
```

## API local

Inicie o PostgreSQL localmente uma única vez:

```bash
docker compose up -d
```

Com o `.env` local configurado, inicie a API:

```bash
pnpm api
```

As rotas locais estão sob o prefixo `/api/v1`:

- `GET /health` verifica a conexão com o banco;
- `POST /clients`, `POST /clients/:id/accounts`, `POST /clients/:id/api-keys`
  e `DELETE /clients/:id/api-keys/:keyId` exigem a chave administrativa;
- `POST /sync`, `GET /sync/:id` e `GET /invoices` exigem uma API key ativa do
  próprio cliente.

Envie as chaves sempre no header:

```text
Authorization: Bearer <chave>
```

As API keys dos clientes são geradas em `POST /clients/:id/api-keys` e aparecem
somente nessa resposta; o banco guarda exclusivamente o hash. A API sempre
restringe sincronizações e faturas ao cliente autenticado, mesmo que outro UUID
seja informado na URL.

As credenciais da Equatorial são administradas apenas com a chave administrativa:

- `PUT /clients/:id/providers/equatorial/credentials` cadastra ou atualiza;
- `GET /clients/:id/providers/equatorial/credentials/status` informa somente se
  estão configuradas;
- `DELETE /clients/:id/providers/equatorial/credentials` remove.

CPF/CNPJ e data de nascimento nunca são devolvidos pela API: o banco armazena
somente versões criptografadas, que serão usadas pelo provider real no worker.

O processamento offline é um worker local, não uma rota HTTP:

```bash
pnpm worker:offline
```

Ele busca continuamente sincronizações `QUEUED`, processa uma por vez e atualiza
o estado para `COMPLETED`, `QUEUED` (nova tentativa) ou `FAILED`. Para processar
somente uma sincronização específica, use `pnpm worker:offline -- <syncId>`; para
buscar no máximo uma pendência e encerrar, use `pnpm worker:offline -- --once`.

Ele existe apenas para desenvolvimento: não acessa a Equatorial nem usa
credenciais reais.

O worker usa `SYNC_PROVIDER=offline` por padrão. A arquitetura também aceita
`SYNC_PROVIDER=equatorial`, que já valida as credenciais criptografadas, mas só
deve ser ativado quando a integração real da Equatorial estiver habilitada. O
comando genérico do worker é `pnpm worker:sync`; `pnpm worker:offline` continua
como atalho compatível para o modo local.

## Agendamento mensal

O agendador procura todas as contas ativas e cria trabalhos `QUEUED` somente
para as que ainda não possuem fatura da competência. Ele não baixa arquivos;
deixe `pnpm worker:sync` em execução para processar a fila. A operação é
idempotente: repeti-la não duplica itens pendentes nem faturas já baixadas.

Para agendar a competência do mês atual (fuso `America/Sao_Paulo`):

```bash
pnpm scheduler:monthly
```

Para executar uma competência específica durante testes:

```bash
pnpm scheduler:monthly -- --competence=2026/08
```

Em produção, configure esse comando no Agendador de Tarefas do Windows ou no
cron para rodar uma vez por mês. `SCHEDULER_TIME_ZONE` permite mudar o fuso.

## Operação administrativa

Com a chave administrativa, acompanhe a fila e reenvie somente execuções que
terminaram em falha:

```text
GET  /api/v1/admin/sync-runs?status=FAILED
POST /api/v1/admin/sync-runs/:id/requeue
```

O reprocessamento zera as tentativas e devolve os itens da execução para
`QUEUED`; o worker ativo volta a processá-los normalmente.

As ações administrativas e solicitações de sincronização ficam registradas sem
segredos ou dados pessoais. Consulte os últimos eventos com:

```text
GET /api/v1/admin/audit-logs?limit=50
```

## Limite de requisições

Exceto por `GET /health`, a API limita requisições por IP em janelas de um
minuto: 60 nas rotas administrativas e 120 nas rotas de cliente. Ao exceder,
responde `HTTP 429` e informa o header `Retry-After`. Ajuste
`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_ADMIN_MAX` e `RATE_LIMIT_CLIENT_MAX` no
`.env`. Em ambiente com proxy reverso confiável, defina
`RATE_LIMIT_TRUST_PROXY=true` para usar `X-Forwarded-For`.

No modo offline, cada processamento gera um PDF de teste em
`INVOICE_STORAGE_DIR` (padrão `output/invoices`). O cliente autenticado pode
baixar somente a própria fatura com `GET /api/v1/invoices/:id/download`.

Para executar o fluxo completo de segurança e API contra a instância local em
execução, use:

```bash
pnpm test:api:flow
```

O teste cria dois clientes temporários, confirma que um não acessa os dados do
outro, executa o worker offline, revoga uma API key e remove os dados criados ao
finalizar.

Para validar a reserva automática da fila, em vez de processar um `syncId`
específico, no Windows execute:

```cmd
set API_FLOW_WORKER_MODE=queue && pnpm test:api:flow
```

Com `pnpm worker:offline` já aberto em outro terminal, o fluxo pode usar esse
mesmo worker contínuo:

```cmd
pnpm test:api:flow -- --use-running-worker
```

`pnpm test:equatorial` é intencionalmente um teste real opcional e não deve ser
executado automaticamente no CI.

Quando o portal exibir somente OTP, a POC preenche o CPF/CNPJ e solicita o código.
Conclua a confirmação no navegador que foi aberto. Se precisar de mais tempo,
aumente `PLAYWRIGHT_TIMEOUT_MS` no `.env`, por exemplo para `180000`.

Antes de escolher OTP, a POC espera até 10 segundos pelo formulário preferencial
de CPF/CNPJ e data de nascimento. Após o login, as chamadas HTTP reutilizam o
JWT, os cookies da sessão e o user-agent do navegador, sem registrar nenhum desses
dados nos logs.

Por padrão, a POC abre um contexto novo do Chromium em modo visível, porque esse
foi o modo que comprovou o login neste projeto. Para investigar problemas de
antifraude, é possível configurar o Chrome instalado e um perfil dedicado em
`output/browser-profile` com `PLAYWRIGHT_BROWSER_CHANNEL=chrome` e
`PLAYWRIGHT_PERSISTENT_CONTEXT=true`. Esse perfil não é o seu perfil pessoal.

Quando não encontrar o formulário de autenticação, a POC salva uma captura em
`output/equatorial/debug/auth-form-unavailable.png` para diagnóstico local.

## Estado conhecido do portal

Em 14/08/2026, o HTML público do portal antigo ainda continha o formulário de
CPF/CNPJ e data de nascimento, mas ele estava marcado como oculto e o formulário
de OTP estava visível. Além disso, o acesso automatizado em modo headless recebeu
HTTP 403 do mecanismo de proteção do portal. Por isso, a configuração inicial usa
`PLAYWRIGHT_HEADLESS=false`.

A POC não altera a página para contornar esses estados: se a proteção bloquear a
navegação, encerra com `PORTAL_BLOCKED`; se nenhum formulário legítimo estiver
disponível, encerra com `AUTH_FORM_UNAVAILABLE`. O OTP é concluído manualmente.

Essa verificação é deliberada. Antes de adaptar a automação, deve-se confirmar no
navegador qual fluxo de login a conta autorizada recebe atualmente.
