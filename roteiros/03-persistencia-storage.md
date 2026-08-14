# Parte 03 — Persistência e storage

## Objetivo

Persistir clientes, contas, faturas e arquivos sem guardar Base64 no PostgreSQL.

## Passos

1. Adicionar PostgreSQL e Prisma.
2. Modelar `Client`, `ClientAccount` e `Invoice`.
3. Criptografar credenciais em repouso com envelope versionado.
4. Normalizar datas inválidas do provider, como `0000-00-00`, para `null`.
5. Criar unicidade por provider, conta e identificador externo da fatura.
6. Definir interface de storage.
7. Implementar storage local de desenvolvimento.
8. Calcular e persistir SHA-256 e tamanhos.

## Critério de aceite

A mesma fatura não é duplicada e o banco contém apenas metadados do arquivo.
