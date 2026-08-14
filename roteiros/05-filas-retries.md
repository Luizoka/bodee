# Parte 05 — Filas e retries

## Objetivo

Tornar o processamento realmente assíncrono e resistente a indisponibilidades.

## Passos

1. Adicionar Redis e BullMQ.
2. Separar, quando necessário, filas de autenticação e sincronização.
3. Limitar autenticações Playwright inicialmente a duas simultâneas.
4. Classificar erros permanentes e transitórios.
5. Aplicar backoff em timeout, erro 5xx e indisponibilidade.
6. Renovar token imediatamente após `401`.
7. Não repetir credenciais inválidas indefinidamente.
8. Registrar tentativas, duração e último erro.

## Critério de aceite

Reinício do worker não perde jobs e falhas transitórias respeitam backoff.
