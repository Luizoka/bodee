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
