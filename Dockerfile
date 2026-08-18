FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# A imagem oficial já contém Chromium e suas bibliotecas. Xvfb deixa disponível
# a alternativa headed: `xvfb-run -a pnpm worker:sync`.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

ENV NODE_ENV=production
CMD ["sh", "scripts/start-render-api.sh"]
