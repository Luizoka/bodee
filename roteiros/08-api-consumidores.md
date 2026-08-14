# Parte 08 — API para consumidores

## Objetivo

Oferecer acesso versionado sem expor credenciais da Equatorial.

## Passos

1. Implementar API Keys com armazenamento somente do hash.
2. Associar chaves a consumidores e permissões.
3. Criar CRUD mínimo de clientes, contas e automações.
4. Criar consultas de faturas e filtro por competência.
5. Criar download autorizado do arquivo.
6. Adicionar paginação e limites de requisição.
7. Garantir que não exista lógica específica para Mapa GD ou outro consumidor.

## Critério de aceite

Cada consumidor acessa apenas os recursos permitidos e nunca recebe segredos do
provider.
