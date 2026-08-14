# Parte 00 — Visão geral

## Objetivo

Construir uma API independente que esconda dos consumidores a autenticação no
portal, o JWT da Equatorial, os endpoints internos, o Base64 e o processamento
dos PDFs.

## Princípios obrigatórios

- Playwright será usado somente para autenticação.
- As consultas e downloads posteriores usarão HTTP.
- Credenciais, tokens, documentos e PDFs não podem aparecer em logs.
- Faturas são selecionadas pela competência `YYYY/MM`, nunca por posição.
- Ausência de fatura é um estado esperado, diferente de falha do provider.
- Uma conta concluída não deve ser processada novamente no mesmo ciclo.
- PDFs ficam em object storage; o banco guarda metadados.
- A integração deve permitir outros providers no futuro.

## Arquitetura-alvo

```text
API -> Jobs -> Provider -> Equatorial
             |        -> Processamento PDF -> Storage
             -> Banco

Scheduler -> Queue -> Jobs
```

## Regra de avanço

A parte mais arriscada é a autenticação automatizada. Banco, fila, scheduler e
API pública só começam depois da aprovação da Parte 01.
