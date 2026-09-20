// Limitador de tentativas em memória, contra adivinhação de senha. Limitação assumida: cada
// instância do servidor tem o seu próprio contador (em vários servidores, ou após reinício,
// zera). Para produção multi-instância, trocar por um armazenamento compartilhado (ex.: Redis).

interface Bucket {
  failures: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

// Teto de chaves rastreadas ao mesmo tempo. Sem ele, quem manda milhões de e-mails/IPs inventados (o cabeçalho de IP
// pode ser forjado) encheria a memória do processo: um balde só some quando a MESMA chave é consultada de novo depois da
// janela. Ao chegar no teto: primeiro se descartam os vencidos; se tudo ainda é da janela atual, os 10% mais antigos
// que NÃO estão protegidos. Um bloqueio ativo nunca é apagado para abrir espaço — senão inundar de chaves falsas zeraria o
// limite de quem está sendo atacado. Os limites em uso vão de 3 a 20 falhas, então "protegido" é qualquer balde com 3 ou
// mais falhas (todo bloqueio é um deles). Se não sobrar o que descartar, o rastreio de uma chave NOVA falha — e quem
// reserva uma tentativa (`reserveAttempt`) recebe "recusado": um limitador de segurança falha FECHADO.
export const MAX_BUCKETS = 50_000
const PROTECTED_FAILURES = 3

function makeRoom(now: number): boolean {
  if (buckets.size < MAX_BUCKETS) return true
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= LOGIN_WINDOW_MS) buckets.delete(key)
  }
  if (buckets.size < MAX_BUCKETS) return true
  let drop = Math.ceil(MAX_BUCKETS / 10)
  for (const [key, bucket] of buckets) { // o Map guarda a ordem de inserção: os primeiros são os mais antigos
    if (drop <= 0) break
    if (bucket.failures >= PROTECTED_FAILURES) continue // pode ser um bloqueio ativo: fica
    buckets.delete(key)
    drop--
  }
  return buckets.size < MAX_BUCKETS
}

// Só para testes.
export function bucketCount(): number {
  return buckets.size
}

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

// Devolve false quando não deu para rastrear a chave (tabela cheia de baldes protegidos).
export function recordFailure(key: string, windowMs = LOGIN_WINDOW_MS, now = Date.now()): boolean {
  const bucket = current(key, now, windowMs)
  if (bucket) {
    bucket.failures++
    return true
  }
  if (!makeRoom(now)) return false
  buckets.set(key, { failures: 1, windowStart: now })
  return true
}

// Reserva UMA tentativa ANTES de a conferência começar. Conferir senha/código é assíncrono (banco, scrypt): se o
// limite só fosse checado antes e a falha só registrada depois, uma rajada de requisições paralelas passaria
// TODAS pela checagem antes de a primeira falha ser contada. Como o JavaScript roda esta função sem interrupção,
// no máximo `max` tentativas (em andamento ou já erradas) passam. Acertou: `clearFailures` zera, ou
// `releaseAttempt` devolve só esta reserva (quando o contador é compartilhado com outras pessoas, como o do IP).
export function reserveAttempt(key: string, max = LOGIN_MAX_FAILURES, windowMs = LOGIN_WINDOW_MS, now = Date.now()): boolean {
  if (isRateLimited(key, max, windowMs, now)) return false
  return recordFailure(key, windowMs, now) // não rastreável (tabela cheia): recusa, em vez de deixar passar sem limite
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
