# Parte 01 — POC Equatorial

## Objetivo

Comprovar por CLI o fluxo completo usando o portal:

```text
https://pa.equatorialenergia.com.br/siteantigo
```

## Passos

1. Inicializar Node.js, TypeScript, lint, formatação e testes.
2. Configurar credenciais somente no `.env` local.
3. Abrir o portal com Playwright.
4. Preencher CPF/CNPJ e data de nascimento.
5. Submeter o formulário e deixar o frontend executar os mecanismos de segurança.
   Quando o portal oferecer OTP, solicitar o código e aguardar sua conclusão
   manual no navegador aberto.
   Aguardar a transição do portal antes de selecionar o formulário; o formulário
   de data de nascimento tem prioridade sobre OTP quando ambos estiverem visíveis.
6. Capturar `access_token` da resposta ou o JWT salvo pelo próprio frontend.
7. Consultar `GET /api/v1/debitos/{conta}?listarEmAberto=false`.
8. Encontrar a fatura pela competência exata.
9. Consultar `GET /api/v1/faturas/segunda-via/{numeroFatura}`.
10. Decodificar e validar o PDF.
11. Salvar o arquivo em diretório local ignorado pelo Git.
12. Testar a lógica sem depender do portal real.
13. Documentar execução e limitações.

## Fora do escopo

- banco de dados;
- Redis e BullMQ;
- scheduler;
- API REST pública;
- remoção da segunda página;
- armazenamento S3.

## Critério de aceite

- O comando `pnpm poc:equatorial` completa o fluxo com dados autorizados.
- O token e as credenciais nunca aparecem na saída.
- O PDF salvo abre e possui ao menos uma página.
- Competência inexistente retorna `INVOICE_NOT_AVAILABLE`.
- O fluxo funciona em pelo menos três sessões novas do navegador.

## Estado em 14/08/2026

- Estrutura, CLI, cliente HTTP, validação de PDF e testes locais: concluídos.
- Chromium do Playwright: instalado.
- Portal em modo headless: bloqueado com HTTP 403.
- HTML público: formulário de data de nascimento presente, porém oculto; OTP
  visível.
- Fluxo autenticado real: pendente de execução local em navegador visível com
  uma conta autorizada.
