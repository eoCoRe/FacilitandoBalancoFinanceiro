// Log estruturado (uma linha JSON por evento) para o que interessa à operação e à segurança:
// login recusado, limite de tentativas, código de 2 etapas bloqueado, erros inesperados. Regras:
//  - NUNCA registra senha, token, código, segredo, cookie ou hash (qualquer campo com esses nomes
//    vira "[oculto]", mesmo que alguém o passe por engano);
//  - e-mail é mascarado ("a**@dominio.com"): dá para correlacionar sem expor a pessoa;
//  - mensagens de erro do banco NÃO entram (o Prisma pode incluir valores da consulta), só o nome e o código.
// A trilha de auditoria (AuditLog) continua sendo o registro de negócio; isto é observabilidade.

export type LogLevel = "info" | "warn" | "error"

// `code` só é segredo quando é EXATAMENTE o nome do campo (código de verificação); `errorCode`, `statusCode` etc. são
// inofensivos e úteis. O mesmo vale para `otp`.
const SENSITIVE_KEY = /senha|password|token|codigo|secret|segredo|authorization|cookie|hash|^code$|^otp$/i
const EMAIL_KEY = /^(e-?mail|usuario|user)$/i

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "***"
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`
}

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) out[key] = "[oculto]"
    else if (EMAIL_KEY.test(key) && typeof value === "string" && value.includes("@")) out[key] = maskEmail(value)
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value
    else out[key] = "[objeto omitido]" // nada de despejar objetos inteiros (podem carregar dados pessoais)
  }
  return out
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...redactFields(fields) })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.info(line)
}

// Resumo seguro de um erro qualquer: só nome e código (ex.: "PrismaClientKnownRequestError", "P2002"), sem
// mensagem nem stack, que podem conter valores de consulta.
export function describeError(error: unknown): { errorName: string; errorCode?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return { errorName: error.name, ...(typeof code === "string" ? { errorCode: code } : {}) }
  }
  return { errorName: typeof error }
}
