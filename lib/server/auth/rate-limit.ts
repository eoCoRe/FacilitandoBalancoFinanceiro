// Limitador de tentativas em memória, contra adivinhação de senha. Limitação assumida: cada
// instância do servidor tem o seu próprio contador (em vários servidores, ou após reinício,
// zera). Para produção multi-instância, trocar por um armazenamento compartilhado (ex.: Redis).

interface Bucket {
  failures: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

// Conferir a SENHA ATUAL de quem já está logado (trocar senha, desligar o 2FA): sem limite, uma
// sessão emprestada/roubada serviria para adivinhar a senha sem passar pelo bloqueio do login.
export const PASSWORD_CHECK_KEY = (userId: number) => `pwcheck:${userId}`

function current(key: string, now: number, windowMs: number): Bucket | undefined {
  const bucket = buckets.get(key)
  if (bucket && now - bucket.windowStart >= windowMs) {
    buckets.delete(key)
    return undefined
  }
  return bucket
}

export function isRateLimited(key: string, max = LOGIN_MAX_FAILURES, windowMs = LOGIN_WINDOW_MS, now = Date.now()): boolean {
  return (current(key, now, windowMs)?.failures ?? 0) >= max
}

export function recordFailure(key: string, windowMs = LOGIN_WINDOW_MS, now = Date.now()): void {
  const bucket = current(key, now, windowMs)
  if (bucket) bucket.failures++
  else buckets.set(key, { failures: 1, windowStart: now })
}

// Reserva UMA tentativa ANTES de a conferência começar. Conferir senha/código é assíncrono (banco, scrypt): se o
// limite só fosse checado antes e a falha só registrada depois, uma rajada de requisições paralelas passaria
// TODAS pela checagem antes de a primeira falha ser contada. Como o JavaScript roda esta função sem interrupção,
// no máximo `max` tentativas (em andamento ou já erradas) passam. Acertou: `clearFailures` zera, ou
// `releaseAttempt` devolve só esta reserva (quando o contador é compartilhado com outras pessoas, como o do IP).
export function reserveAttempt(key: string, max = LOGIN_MAX_FAILURES, windowMs = LOGIN_WINDOW_MS, now = Date.now()): boolean {
  if (isRateLimited(key, max, windowMs, now)) return false
  recordFailure(key, windowMs, now)
  return true
}

export function releaseAttempt(key: string, windowMs = LOGIN_WINDOW_MS, now = Date.now()): void {
  const bucket = current(key, now, windowMs)
  if (!bucket) return
  bucket.failures--
  if (bucket.failures <= 0) buckets.delete(key)
}

export function clearFailures(key: string): void {
  buckets.delete(key)
}

// Só para testes.
export function resetRateLimits(): void {
  buckets.clear()
}
