# BODEE — extensão Equatorial

Esta é a fonte da extensão Manifest V3. O usuário faz login normalmente no portal
da Equatorial; somente depois disso o BODEE consulta unidades, faturas e baixa PDFs
usando a sessão vigente no Chrome/Edge. Para instruções de build e distribuição,
consulte [`docs/chrome-extension.md`](../docs/chrome-extension.md).

## Instalar no Chrome/Edge

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione `dist-extension/`, após executar `pnpm build:extension`.
4. Abra o portal antigo da Equatorial de PA, PI, AL, AP ou MA e faça login normalmente.
5. Abra o popup BODEE, atualize as unidades, marque uma ou mais unidades e as competências desejadas. O BODEE baixa cada combinação disponível de unidade e competência selecionadas.

## Modo de teste local

Para abrir o próprio popup com unidades, competências e fila simuladas — sem sessão,
portal, chamadas à Equatorial ou downloads reais — gere a extensão de desenvolvimento:

```bash
npm run build:extension:mock
```

Carregue `dist-extension/` normalmente em `chrome://extensions`. O build normal
(`npm run build:extension`) não inclui os arquivos de mock e é o único apropriado
para distribuição.

## Segurança e escopo

- As permissões de host são limitadas aos portais e APIs da Equatorial em PA, PI, AL, AP e MA.
- A extensão não coleta senha, não automatiza login e não tenta contornar CAPTCHA, Imperva ou Transmit Security.
- O token é lido somente durante uma solicitação. Não é gravado em storage, exibido, registrado ou enviado a serviços externos.
- Para cada chamada à API, uma aba técnica em segundo plano é aberta na origem da API e fechada ao terminar. Ela preserva o contexto real do navegador para a validação da POC.
- O download cria PDFs individuais em `Downloads/BODEE/<titular>/UC <unidade consumidora> - CC <conta contrato>/<ano-mês> - <unidade consumidora>.pdf`; ZIP será avaliado depois da validação no Windows 11. Se o portal não informar a UC ou o titular, o caminho usa a conta-contrato ou a pasta `Titular não informado` como alternativa.
- Ao iniciar um lote, a fila é executada pelo processo em segundo plano da extensão. Você pode fechar o popup ou trocar de aba; mantenha apenas a aba do portal aberta e a sessão conectada até o fim dos downloads.
- Se a consulta de unidades falhar, o popup informa um diagnóstico seguro com o status HTTP, tipo e formato da resposta. O último diagnóstico fica guardado localmente na extensão; ele nunca contém token, cookies, CPF, nome ou o corpo da resposta.

## Validação no computador aceito pela Equatorial

Após o login, compare no DevTools > Network uma chamada de unidades, uma de faturas e uma de segunda via com o resultado da extensão. O aceite desta POC exige sessão conectada, unidades retornadas, competência encontrada e PDF válido. Nunca copie cookies ou tokens para issues, logs ou mensagens.
