# BODEE — Buscador Online de Documentos de Energia da Equatorial

O BODEE é a implementação principal para consultar e baixar faturas do usuário
autenticado no portal da Equatorial Energia. Ele é uma extensão Chrome Manifest
V3, independente e sem afiliação oficial com a Equatorial.

## Extensão Chrome

```bash
pnpm install
pnpm build:extension
```

No Chrome, abra `chrome://extensions`, ative o **Modo do desenvolvedor** e
selecione **Carregar sem compactação** → `dist-extension/`.

Para validar o pacote de produção e gerar o ZIP da Chrome Web Store:

```bash
pnpm check:extension
pnpm package:extension
```

O pacote resultante é criado em `release/bodee-extension-<versão>.zip`, com
`manifest.json` na raiz. Consulte [a documentação da extensão](docs/chrome-extension.md), a
[política de privacidade](docs/privacy-policy.md) e o [guia de revisão da Store](docs/chrome-web-store-review.md).

## Fluxos legados do FaturaSync

O restante deste repositório contém POCs Node/Playwright e uma API experimental.
Eles não fazem parte do bundle da extensão, nem são necessários para executar o
BODEE no Chrome.

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

Por padrão, o POC processa uma conta e uma competência. Para consultar duas ou
mais contas na mesma sessão, informe-as separadas por vírgula:

```env
EQUATORIAL_ACCOUNT=
EQUATORIAL_ACCOUNTS=003003643114,000000000000
```

Há três formas mutuamente exclusivas de escolher as competências. Use somente
uma delas:

```env
# Uma competência
EQUATORIAL_COMPETENCE=2026/08

# Ou uma lista específica
EQUATORIAL_COMPETENCES=2026/08,2026/06,2025/12

# Ou um intervalo inclusivo; também aceita ordem decrescente
EQUATORIAL_COMPETENCE_START=2026/08
EQUATORIAL_COMPETENCE_END=2025/11
```

Ao usar lista ou intervalo, deixe `EQUATORIAL_COMPETENCE` vazio ou remova essa
linha do `.env`. Cada conta e competência é processada isoladamente. Fatura
ainda não emitida fica como `unavailable`; erro de consulta, download, PDF,
gravação local ou banco fica como `failed`. Nos dois casos, o POC continua nos
itens seguintes. Ao final, `equatorial.batch.completed` informa os totais; a
execução retorna código de erro somente se houver pelo menos um item `failed`.

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

## API sem banco (Swagger e Render)

A API pode iniciar sem PostgreSQL para baixar faturas diretamente da
Equatorial. Nesse modo, as credenciais chegam no corpo da requisição, são usadas
somente durante o login e não são persistidas.

Configure apenas uma chave administrativa com pelo menos 32 caracteres. Para
desenvolvimento local, copie os valores de `.env.render.example` para o seu
`.env`. No Render, cadastre-os em **Environment**; não envie um `.env` real ao
repositório.

```env
ADMIN_API_KEY=gere-uma-chave-aleatoria-com-pelo-menos-32-caracteres
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_BROWSER_CHANNEL=chromium
PLAYWRIGHT_TIMEOUT_MS=60000
EQUATORIAL_LOGIN_MAX_ATTEMPTS=3
EQUATORIAL_API_TIMEOUT_MS=30000
```

Não configure `DATABASE_URL` nem `CREDENTIALS_ENCRYPTION_KEY`. Inicie com:

```bash
pnpm api
```

Abra `http://localhost:3000/api/docs`, clique em **Authorize**, informe
`ADMIN_API_KEY` e execute:

```text
POST /api/v1/equatorial/invoices/download
```

Exemplo do corpo:

```json
{
  "document": "00000000000",
  "birthDate": "01/01/1990",
  "accounts": ["003003643114"],
  "competences": ["2026/08", "2026/07"]
}
```

A resposta é `faturas-equatorial.zip`, contendo os PDFs encontrados e um
`resultado.json` com o estado de cada conta e competência. A requisição aceita
até 20 contas, 24 competências e 120 combinações. Os arquivos existem apenas na
resposta HTTP; nada é salvo no disco do serviço.

O `render.yaml` da raiz já cria um Web Service Docker sem banco. Depois do
deploy, o Swagger fica em `https://SEU-SERVICO.onrender.com/api/docs`.

## API local com PostgreSQL

Inicie o PostgreSQL localmente uma única vez:

```bash
docker compose up -d
```

Com o `.env` local configurado, inicie a API:

```bash
pnpm api
```

As rotas locais estão sob o prefixo `/api/v1`:

- `GET /api/v1/health` verifica a conexão com o banco e não exige API key;
- `POST /clients`, `POST /clients/:id/accounts`, `POST /clients/:id/api-keys`
  e `DELETE /clients/:id/api-keys/:keyId` exigem a chave administrativa;
- `POST /sync`, `GET /sync/:id` e `GET /invoices` exigem uma API key ativa do
  próprio cliente.

A documentação interativa Swagger está disponível em:

```text
http://localhost:3000/api/docs
```

Use o botão `Authorize`: `adminApiKey` serve para cadastro e operação;
`clientApiKey` serve para sincronizações, faturas e downloads do cliente.

Para saber quais rotas pertencem à administração, ao cliente final e aos
processos internos, consulte [Acesso à API por papel](./docs/acesso-api.md).

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

Após uma falha temporária, o worker espera progressivamente antes de tentar
novamente: por padrão, 10 s, 20 s e 40 s (até uma hora). Ajuste a primeira espera
com `WORKER_RETRY_BASE_DELAY_MS`; a próxima data fica em `next_attempt_at` nas
consultas da sincronização e da fila administrativa.

Quando o provider Equatorial for habilitado, todos os itens de um mesmo `syncId`
serão processados em lote: uma sessão por cliente, vários downloads e descarte
de token, cookies e contexto do navegador ao terminar. Esses dados de sessão não
serão gravados no banco nem nos logs.

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

No Windows, o projeto inclui um script para criar a tarefa. No PowerShell, na
raiz do projeto, execute uma única vez (o padrão é dia 5 às 08:00):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-monthly-scheduler.ps1
```

Para escolher outro dia e horário, por exemplo dia 10 às 09:30:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-monthly-scheduler.ps1 -Day 10 -At 09:30
```

A tarefa grava sua saída em `output/scheduler.log`. Para dispará-la uma vez e
validar, use `schtasks /Run /TN "FaturaSync - Agendamento Mensal"`; para
removê-la, execute `scripts\unregister-monthly-scheduler.ps1`.

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

Para testar recuperação de falhas do worker, primeiro pare qualquer
`pnpm worker:sync` em execução. Em seguida, rode:

```bash
pnpm test:worker:recovery
```

O teste simula uma falha temporária, reinicia o worker com sucesso, força uma
falha terminal e confirma o reprocessamento manual. Todos os dados de teste são
removidos ao final.

`pnpm test:equatorial` é intencionalmente um teste real opcional e não deve ser
executado automaticamente no CI.

## Deploy no Render

O arquivo `render.yaml` descreve três processos independentes usando a mesma
imagem Docker e o mesmo PostgreSQL. Configure os segredos somente no painel do
Render; eles não pertencem ao repositório, ao Dockerfile nem ao Swagger.

```text
Web Service       pnpm api
Background Worker pnpm worker:sync
Cron Job          pnpm scheduler:monthly
```

O Web Service usa automaticamente `PORT` fornecida pelo Render; para o
desenvolvimento local, `API_PORT=3000` continua suportado. Configure o health
check do Web Service como `/api/v1/health`.

No primeiro deploy, use `SYNC_PROVIDER=offline`. Isso valida API, PostgreSQL,
fila, worker e PDF de teste sem iniciar uma sessão no portal. Só altere para
`SYNC_PROVIDER=equatorial` depois de validar o Chromium e a autenticação no
Render. Um eventual bloqueio antifraude do portal é distinto de uma falha da
infraestrutura Docker.

Para produção, não use o filesystem efêmero do Render para PDFs. Depois de
validar a fase offline, configure:

```env
INVOICE_STORAGE_PROVIDER=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_INVOICE_BUCKET=faturas
```

O worker envia cada PDF para um caminho como
`clients/12/equatorial/123456789/2026/08/invoice.pdf`; o banco guarda somente a
referência do storage e metadados, nunca o PDF em Base64. A chave `SERVICE_ROLE`
é utilizada exclusivamente nos processos de servidor e não é retornada, exibida
no Swagger ou registrada em logs.

A imagem usa a versão oficial do Playwright correspondente à dependência do
projeto, com Chromium e bibliotecas Linux. O primeiro teste recomendado é
`PLAYWRIGHT_HEADLESS=true`. Se, no futuro, for necessário abrir Chromium normal
sem monitor físico, a imagem também possui Xvfb e o worker pode ser iniciado com:

```bash
xvfb-run -a pnpm worker:sync
```

Isso apenas fornece um display virtual; não contorna mecanismos antifraude.

O login reproduz o fluxo normal da página: o formulário inicial executa
`otp-check`; quando o portal escolhe o fluxo legado, o próprio JavaScript carrega
reCAPTCHA e Transmit Security, formata CPF/data e envia `autenticacao`. O sistema
não extrai, fabrica nem reutiliza tokens de segurança. Se a conta for direcionada
para confirmação manual por OTP, a requisição é encerrada com erro específico.

Cada tentativa usa um contexto novo, sem compartilhar cookies entre clientes ou
entre falhas. Respostas transitórias como `DENY` podem ser repetidas no máximo
três vezes, com espera de 2 e 5 segundos. Ajuste o limite entre 1 e 3 com
`EQUATORIAL_LOGIN_MAX_ATTEMPTS`; não há retry para bloqueio HTTP 403.

Após o login, o sistema confirma a sessão, carrega
`ajax-uc-contas-contrato` e só então consulta as faturas. Os logs contêm apenas
método, caminho, status, tipo de conteúdo e nomes dos campos; CPF, data, cookies,
JWT e tokens nunca são registrados.

Quando não encontrar o formulário de autenticação, a POC salva uma captura em
`output/equatorial/debug/auth-form-unavailable.png` para diagnóstico local.

## Estado conhecido do portal

Em 14/08/2026, o HTML público do portal antigo ainda continha o formulário de
CPF/CNPJ e data de nascimento, mas ele estava marcado como oculto e o formulário
de OTP estava visível. Além disso, o acesso automatizado em modo headless recebeu
HTTP 403 do mecanismo de proteção do portal. Por isso, a configuração inicial usa
`PLAYWRIGHT_HEADLESS=false`.

A POC não altera a página para contornar esses estados: se a proteção bloquear a
navegação, encerra com `PAGE_BLOCKED`; se os scripts de segurança não carregarem,
encerra com `SCRIPT_LOAD_FAILED`; e se nenhum formulário legítimo estiver
disponível, encerra com `AUTH_FORM_UNAVAILABLE`.

Essa verificação é deliberada. Antes de adaptar a automação, deve-se confirmar no
navegador qual fluxo de login a conta autorizada recebe atualmente.
