# Parte 09 — Operação e webhooks

## Objetivo

Preparar o serviço para operação contínua e integrações orientadas a eventos.

## Passos

1. Adicionar logs estruturados e sanitizados.
2. Criar health checks de aplicação, banco e Redis.
3. Manter o estado da Equatorial separado da saúde geral do serviço.
4. Medir duração, tentativas, resultados e redução do PDF.
5. Documentar backup, retenção e rotação da chave de criptografia.
6. Preparar implantação e CI sem teste real da Equatorial.
7. Adicionar webhooks somente quando houver consumidor confirmado.
8. Assinar webhooks e implementar retries/idempotência de entrega.

## Critério de aceite

O serviço pode ser diagnosticado sem revelar credenciais, tokens, documentos ou
conteúdo de faturas.
