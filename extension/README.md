# BODE — extensão Equatorial (POC)

Esta extensão Manifest V3 é uma prova de conceito isolada. Ela não altera nem remove o fluxo Playwright. O usuário faz login normalmente no portal da Equatorial; somente depois disso a extensão consulta unidades, faturas e baixa PDFs usando a sessão vigente no Chrome/Edge.

## Instalar no Chrome/Edge

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta `extension/`.
4. Abra `https://pa.equatorialenergia.com.br/siteantigo/` e faça login normalmente.
5. Abra o popup BODE, atualize as unidades, marque uma ou mais unidades e as competências desejadas. O BODE baixa cada combinação disponível de unidade e competência selecionadas.

## Segurança e escopo

- As permissões de host são limitadas ao portal e à API da Equatorial no Pará.
- A extensão não coleta senha, não automatiza login e não tenta contornar CAPTCHA, Imperva ou Transmit Security.
- O token é lido somente durante uma solicitação. Não é gravado em storage, exibido, registrado ou enviado a serviços externos.
- Para cada chamada à API, uma aba técnica em segundo plano é aberta na origem da API e fechada ao terminar. Ela preserva o contexto real do navegador para a validação da POC.
- O download atual cria PDFs individuais em `Downloads/BODE/`; ZIP será avaliado depois da validação no Windows 11.

## Validação no computador aceito pela Equatorial

Após o login, compare no DevTools > Network uma chamada de unidades, uma de faturas e uma de segunda via com o resultado da extensão. O aceite desta POC exige sessão conectada, unidades retornadas, competência encontrada e PDF válido. Nunca copie cookies ou tokens para issues, logs ou mensagens.
