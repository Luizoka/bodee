# Informações para revisão da Chrome Web Store

## Propósito único

> O BODEE facilita a consulta e o download de faturas de energia para usuários autenticados no portal da Equatorial Energia.

## Funcionamento

1. O usuário acessa o portal da Equatorial.
2. O usuário realiza sua própria autenticação.
3. O BODEE detecta a sessão autenticada existente.
4. O usuário seleciona unidades e competências.
5. O BODEE consulta as faturas disponíveis.
6. O BODEE solicita as segundas vias selecionadas.
7. Os documentos são entregues ao usuário pelo gerenciador de downloads do Chrome.

O BODEE não executa login, não solicita credenciais, não contorna CAPTCHAs e não
possui vínculo oficial com a Equatorial Energia.

## Permissões

| Permissão | Motivo |
| --- | --- |
| `scripting` | Executar chamadas pontuais no contexto das origens autorizadas, com a sessão que o usuário já estabeleceu. |
| `downloads` | Salvar as segundas vias PDF que o usuário selecionou. |

## Hosts

| Host | Motivo |
| --- | --- |
| `https://pa.equatorialenergia.com.br/*` | Portal autenticado e consulta das unidades consumidoras. |
| `https://api-pa-cliente.equatorialenergia.com.br/*` | Consulta de faturas e segunda via. |

## Dados

| Dado | Acessado? | Armazenado pela extensão? | Transmitido? | Finalidade |
| --- | --- | --- | --- |
| Sessão, JWT e cookies existentes | Sim, temporariamente em memória | Não | Somente à Equatorial na chamada autenticada | Autenticar a consulta solicitada. |
| Nome do titular e identificadores de unidade/conta | Sim | Não | À Equatorial quando necessário para a consulta | Mostrar opções e nomear o download local. |
| Competência e número da fatura | Sim | Não | À Equatorial para solicitar a segunda via | Localizar e baixar o PDF escolhido. |
| Conteúdo do PDF | Sim, temporariamente | Não | Recebido da Equatorial e entregue ao Chrome | Download local do documento. |
| CPF/CNPJ, senha e data de nascimento | Não | Não | Não | Não aplicável. |

Não há transmissão a servidores próprios, analytics, publicidade ou compartilhamento
com terceiros. Preencha as declarações do painel de privacidade de modo idêntico a
esta tabela e à política de privacidade publicada.

## Instruções de teste para revisão

O revisor precisa de uma conta Equatorial autorizada e sessão ativa no portal do
Pará. Abra `https://pa.equatorialenergia.com.br/siteantigo/`, autentique-se de
forma normal, abra o BODEE, marque uma unidade e uma competência e inicie o
download. Sem sessão, o popup exibe um botão para abrir o portal.
