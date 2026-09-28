export function assertEquatorialSuccess(status, fallback) {
  if (status >= 200 && status < 300) return;
  if (status === 401) throw new Error('A sessão expirou. Faça login novamente na Equatorial.');
  if (status === 403) throw new Error('A Equatorial recusou esta sessão. Verifique o portal e tente novamente.');
  if (status === 429) throw new Error('A Equatorial limitou temporariamente as consultas. Aguarde alguns minutos e tente novamente.');
  if (status >= 500) throw new Error('A Equatorial está indisponível no momento. Tente novamente mais tarde.');
  throw new Error(fallback);
}
