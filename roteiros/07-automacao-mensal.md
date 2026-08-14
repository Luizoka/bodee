# Parte 07 — Automação mensal

## Objetivo

Executar diariamente as automações elegíveis e repetir somente contas pendentes.

## Passos

1. Modelar `Automation`, `MonthlySync` e `MonthlySyncItem`.
2. Criar um scheduler diário no fuso `America/Belem`.
3. Criar uma execução única por automação e competência.
4. Inicializar um item por conta ativa.
5. Ignorar itens `COMPLETED` nos dias seguintes.
6. Reagendar `WAITING_INVOICE` para o próximo dia.
7. Diferenciar ausência de fatura de indisponibilidade do provider.
8. Encerrar em `COMPLETED`, `FAILED` ou `REQUIRES_ATTENTION`.

## Decisões antes da implementação

- Política para dia 29, 30 ou 31 em meses menores.
- Se o limite representa dias, tentativas ou ambos.
- Horário exato da execução diária.

## Critério de aceite

Em um cenário X/Y concluídas e Z pendente, o próximo ciclo processa somente Z.
