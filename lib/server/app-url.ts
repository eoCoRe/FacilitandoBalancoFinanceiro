// URL pública do app, usada nos links enviados por e-mail e no redirect_uri do Google. Vem de
// APP_URL (configuração), não do cabeçalho Host da requisição, que o cliente controla — sem
// isso, um atacante poderia pedir uma recuperação de senha com Host forjado e fazer o link do
// e-mail da vítima apontar para o site dele.
export function appOrigin(request: Request): string {
  return (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "")
}
