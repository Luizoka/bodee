# Política de Privacidade — BODE

Última atualização: 28 de setembro de 2026.

O BODE — Buscador Online de Documentos de Energia da Equatorial — é uma extensão
independente para Chrome. Sua finalidade única é facilitar a consulta e o download
de faturas do usuário autenticado no portal da Equatorial Energia. O BODE não tem
vínculo, parceria ou afiliação oficial com a Equatorial Energia.

## Dados acessados e finalidade

Quando o usuário abre o BODE em uma página elegível do portal, a extensão pode
acessar temporariamente a sessão já autenticada no navegador, a lista de unidades
consumidoras, o nome do titular informado pelo portal, números de conta-contrato e
unidade consumidora, competências, números de fatura e o conteúdo PDF da segunda
via. Esses dados são usados exclusivamente para mostrar as opções no popup e
solicitar os PDFs selecionados pelo próprio usuário.

A extensão não solicita, coleta ou armazena CPF/CNPJ, data de nascimento ou senha.
Ela não realiza login, não contorna CAPTCHA nem outros mecanismos de segurança.

## Armazenamento e transmissão

O BODE não usa `chrome.storage`, banco de dados, analytics, cookies próprios nem
servidores do desenvolvedor. JWT e cookies da sessão existente podem ser usados
somente em memória durante a chamada necessária ao portal; não são gravados,
exibidos ou registrados em logs. Os PDFs ficam em memória somente durante a
criação do download e são salvos pelo Chrome no computador do usuário, no diretório
escolhido pelo navegador.

Os dados necessários para consultar e baixar faturas são transmitidos somente aos
domínios da Equatorial já usados pelo portal autenticado:

- `https://pa.equatorialenergia.com.br`
- `https://api-pa-cliente.equatorialenergia.com.br`

O BODE não transmite dados a servidores próprios nem compartilha dados com
terceiros para publicidade, análise, perfilamento ou venda.

## Controle do usuário

O usuário escolhe as unidades e competências antes de cada lote. Pode remover a
extensão a qualquer momento em `chrome://extensions`; como o BODE não persiste
dados próprios, não há cadastro ou base remota a ser apagada.

## Contato e publicação

Antes da publicação, esta política será hospedada em uma URL HTTPS pública e o
publicador informará aqui um e-mail de suporte válido. Até essa definição, não
publique a extensão na Chrome Web Store.
