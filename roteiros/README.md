# Roteiros do FaturaSync

O roteiro original foi separado em partes executáveis. Cada parte possui escopo,
dependências e critério de aceite. Uma fase posterior não deve ser iniciada antes
da aprovação da anterior.

| Parte                              | Tema                                 | Estado inicial    |
| ---------------------------------- | ------------------------------------ | ----------------- |
| [00](./00-visao-geral.md)          | Visão geral e regras do projeto      | Referência        |
| [01](./01-poc-equatorial.md)       | POC Equatorial por CLI               | Em andamento      |
| [02](./02-provider-equatorial.md)  | Abstração de provider                | Bloqueada pela 01 |
| [03](./03-persistencia-storage.md) | PostgreSQL e storage                 | Bloqueada pela 02 |
| [04](./04-sync-manual.md)          | API e sincronização manual           | Bloqueada pela 03 |
| [05](./05-filas-retries.md)        | Redis, BullMQ e retries              | Bloqueada pela 04 |
| [06](./06-processamento-pdf.md)    | Processamento e integridade do PDF   | Bloqueada pela 05 |
| [07](./07-automacao-mensal.md)     | Scheduler e execução mensal          | Bloqueada pela 06 |
| [08](./08-api-consumidores.md)     | Segurança e API para consumidores    | Bloqueada pela 07 |
| [09](./09-operacao-e-webhooks.md)  | Operação, observabilidade e webhooks | Bloqueada pela 08 |

O arquivo `roteiro.txt` permanece como documento original e fonte histórica.
