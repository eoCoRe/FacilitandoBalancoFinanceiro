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

export function clearFailures(key: string): void {
  buckets.delete(key)
}

// Só para testes.
export function resetRateLimits(): void {
  buckets.clear()
}
