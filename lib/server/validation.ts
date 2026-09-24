// Validação de entrada nas rotas de API (OWASP: nunca confiar em payload de cliente).
// Cada `require*` lança ValidationError com uma mensagem já pronta para virar HTTP 400.

export class ValidationError extends Error {}

// Não há empresa cadastrada (instalação nova, ou depois da eliminação LGPD). A tela reconhece o código e oferece o cadastro.
export class NoCompanyError extends Error {}

// Token LGPD ausente/incorreto (ver lib/server/data/lgpd.ts) — 401, não 400: o problema não é
// a forma do payload, é a credencial de acesso ao endpoint.
export class UnauthorizedError extends Error {}

// Login válido, mas o perfil não pode fazer isso — 403 (ver lib/server/auth/authz.ts).
export class ForbiddenError extends Error {}

// Serviço de que a operação depende (ex.: envio de e-mail) indisponível — 503.
export class ServiceUnavailableError extends Error {}

// Muitas tentativas de login seguidas — 429 (ver lib/server/auth/rate-limit.ts).
export class TooManyRequestsError extends Error {}

export function requireNonEmptyString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} é obrigatório.`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} deve ter no máximo ${maxLength} caracteres.`)
  }
  return trimmed
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} deve ser um número válido.`)
  }
  return value
}

export function requirePositiveInt(value: unknown, field: string): number {
  const num = requireFiniteNumber(value, field)
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError(`${field} deve ser um número inteiro positivo.`)
  }
  return num
}

export function requireRange(value: number, field: string, min: number, max: number): number {
  if (value < min || value > max) {
    throw new ValidationError(`${field} deve estar entre ${min} e ${max}.`)
  }
  return value
}

// Payloads absurdamente grandes (ex.: milhões numéricos ou milhares de itens numa
// extração) não têm por que existir num documento real — limite defensivo, não regra
// de negócio.
export function requireBoundedNumber(value: unknown, field: string, bound = 1_000_000_000_000): number {
  const num = requireFiniteNumber(value, field)
  return requireRange(num, field, -bound, bound)
}

// Normaliza (minúsculas, sem espaços nas pontas) e valida o formato de forma simples — a
// prova de que o e-mail existe é o próprio login, não uma regex.
export function requireEmail(value: unknown, field = "E-mail"): string {
  const email = requireNonEmptyString(value, field, 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError(`${field} inválido.`)
  }
  return email
}
