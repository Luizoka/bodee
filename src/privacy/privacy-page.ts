export const privacyPageHtml = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Política de Privacidade da extensão BODEE." />
    <title>Política de Privacidade — BODEE</title>
    <style>
      :root { color-scheme: light; --ink: #1c211d; --muted: #616861; --line: #d9ddd7; --paper: #f8f8f5; --accent: #2e6245; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--paper); color: var(--ink); font-family: Arial, Helvetica, sans-serif; font-size: 17px; line-height: 1.65; }
      main { width: min(100% - 40px, 760px); margin: 0 auto; padding: 72px 0 96px; }
      header { border-top: 4px solid var(--accent); padding-top: 20px; margin-bottom: 58px; }
      .eyebrow { color: var(--accent); font-family: "Courier New", monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; margin: 0 0 20px; text-transform: uppercase; }
      h1, h2 { letter-spacing: -0.035em; line-height: 1.1; }
      h1 { font-size: clamp(40px, 8vw, 64px); margin: 0; max-width: 680px; }
      .updated { color: var(--muted); font-family: "Courier New", monospace; font-size: 13px; margin: 20px 0 0; }
      section { margin-top: 48px; }
      h2 { font-size: 27px; margin: 0 0 18px; }
      p { margin: 0 0 20px; }
      ul { margin: 0 0 20px; padding-left: 22px; }
      li { margin: 7px 0; }
      code, a { color: var(--accent); overflow-wrap: anywhere; }
      code { background: #edf1eb; border-radius: 2px; font-family: "Courier New", monospace; font-size: 0.88em; padding: 0.12em 0.28em; }
      footer { border-top: 1px solid var(--line); color: var(--muted); font-family: "Courier New", monospace; font-size: 12px; margin-top: 58px; padding-top: 18px; }
      @media (max-width: 520px) { main { width: min(100% - 32px, 760px); padding-top: 40px; } h2 { font-size: 24px; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">BODEE · Extensão para Chrome</p>
        <h1>Política de Privacidade</h1>
        <p class="updated">Última atualização: 28 de setembro de 2026.</p>
      </header>

      <p>O BODEE — Buscador Online de Documentos de Energia da Equatorial — é uma extensão independente para Chrome. Sua finalidade única é facilitar a consulta e o download de faturas do usuário autenticado no portal da Equatorial Energia. O BODEE não tem vínculo, parceria ou afiliação oficial com a Equatorial Energia.</p>

      <section>
        <h2>Dados acessados e finalidade</h2>
        <p>Quando o usuário abre o BODEE em uma página elegível do portal, a extensão pode acessar temporariamente a sessão já autenticada no navegador, a lista de unidades consumidoras, o nome do titular informado pelo portal, números de conta-contrato e unidade consumidora, competências, números de fatura e o conteúdo PDF da segunda via. Esses dados são usados exclusivamente para mostrar as opções no popup e solicitar os PDFs selecionados pelo próprio usuário.</p>
        <p>A extensão não solicita, coleta ou armazena CPF/CNPJ, data de nascimento ou senha. Ela não realiza login, não contorna CAPTCHA nem outros mecanismos de segurança.</p>
      </section>

      <section>
        <h2>Armazenamento e transmissão</h2>
        <p>O BODEE não usa <code>chrome.storage</code>, banco de dados, analytics, cookies próprios nem servidores do desenvolvedor. JWT e cookies da sessão existente podem ser usados somente em memória durante a chamada necessária ao portal; não são gravados, exibidos ou registrados em logs. Os PDFs ficam em memória somente durante a criação do download e são salvos pelo Chrome no computador do usuário, no diretório escolhido pelo navegador.</p>
        <p>Os dados necessários para consultar e baixar faturas são transmitidos somente aos domínios da Equatorial já usados pelo portal autenticado:</p>
        <ul>
          <li><a href="https://pa.equatorialenergia.com.br">https://pa.equatorialenergia.com.br</a></li>
          <li><a href="https://api-pa-cliente.equatorialenergia.com.br">https://api-pa-cliente.equatorialenergia.com.br</a></li>
        </ul>
        <p>O BODEE não transmite dados a servidores próprios nem compartilha dados com terceiros para publicidade, análise, perfilamento ou venda.</p>
      </section>

      <section>
        <h2>Controle do usuário</h2>
        <p>O usuário escolhe as unidades e competências antes de cada lote. Pode remover a extensão a qualquer momento em <code>chrome://extensions</code>; como o BODEE não persiste dados próprios, não há cadastro ou base remota a ser apagada.</p>
      </section>

      <section>
        <h2>Contato e publicação</h2>
        <p>Antes da publicação, esta política será hospedada em uma URL HTTPS pública e o publicador informará aqui um e-mail de suporte válido. Até essa definição, não publique a extensão na Chrome Web Store.</p>
      </section>

      <footer>BODEE — Buscador Online de Documentos de Energia da Equatorial</footer>
    </main>
  </body>
</html>`;
