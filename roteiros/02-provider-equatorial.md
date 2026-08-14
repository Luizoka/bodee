# Parte 02 — Provider Equatorial

## Objetivo

Retirar a orquestração da CLI e expor a Equatorial por uma implementação da
interface de provider.

## Passos

1. Definir contratos de autenticação, listagem e download.
2. Criar `EquatorialProvider` sem dependência da CLI.
3. Encapsular sessão e renovação de token.
4. Ao receber `401`, renovar a autenticação uma única vez e repetir a chamada.
5. Reutilizar uma autenticação para todas as contas do mesmo cliente.
6. Criar mocks completos do provider.

## Critério de aceite

Testes usam o provider por contrato e não conhecem Playwright, URLs ou Base64.
