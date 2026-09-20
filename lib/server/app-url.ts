import { ServiceUnavailableError } from "./validation"

// URL pública do app, usada nos links enviados por e-mail e no redirect_uri do Google. Vem de
// APP_URL (configuração), não do cabeçalho Host da requisição, que o cliente controla — sem
// isso, um atacante poderia pedir uma recuperação de senha com Host forjado e fazer o link do
// e-mail da vítima apontar para o site dele.

// Para REDIRECIONAMENTOS no mesmo site (ex.: voltar ao /login): se APP_URL não existir, usa a origem
// da própria requisição — não vaza nada, o usuário já está nesse site.
export function appOrigin(request: Request): string {
  return (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "")
}

// Para LINKS que vão por e-mail: em produção APP_URL é obrigatória (falha fechado). O fallback para
// o Host da requisição só existe em desenvolvimento, onde não há atacante nem e-mail real.
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL
  if (configured) return configured.replace(/\/+$/, "")
  if (process.env.NODE_ENV === "production") {
    throw new ServiceUnavailableError("A recuperação de senha não está disponível (APP_URL não configurada).")
  }
  return new URL(request.url).origin
}
