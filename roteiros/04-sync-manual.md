# Parte 04 — Sincronização manual

## Objetivo

Permitir que uma solicitação crie um trabalho rastreável de sincronização.

## Passos

1. Criar os módulos de clientes, contas, faturas e jobs.
2. Implementar `POST /api/v1/clients/:id/sync`.
3. Validar competência e lista opcional de contas.
4. Registrar job e resultados por conta.
5. Executar provider, validação, storage e persistência.
6. Implementar `GET /api/v1/jobs/:id`.
7. Garantir idempotência por conta e competência.

## Critério de aceite

Uma requisição resulta em job auditável, PDF válido no storage e fatura no banco.
