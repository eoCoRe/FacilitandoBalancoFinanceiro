// IP do cliente para os limites de tentativas (login, recuperação de senha). Sem um proxy reverso
// confiável na frente, o cabeçalho x-forwarded-for pode ser forjado: por isso o limite por E-MAIL é
// o que de fato protege uma conta, e o por IP é só uma segunda camada contra varredura.
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido"
}
