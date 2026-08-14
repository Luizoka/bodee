# Parte 06 — Processamento do PDF

## Objetivo

Manter somente a primeira página sem aplicar otimizações destrutivas.

## Passos

1. Abrir o PDF validado.
2. Copiar somente a página de índice zero para um novo documento.
3. Validar novamente o arquivo resultante.
4. Calcular SHA-256.
5. Guardar tamanhos original e processado.
6. Salvar o arquivo processado de forma atômica.

## Critério de aceite

O PDF final abre, possui exatamente uma página e mantém os dados legíveis.
