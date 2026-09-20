import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"
import { ValidationError } from "@/lib/server/validation"

// scrypt do próprio Node (sem dependência nativa, que costuma dar dor de cabeça no Windows).
// Parâmetros seguem uma das combinações mínimas da OWASP (N=2^16, r=8, p=2). Ficam gravados
// dentro do próprio hash, então dá para aumentar o custo no futuro sem invalidar senhas antigas.
const DEFAULT_COST = { N: 2 ** 16, r: 8, p: 2 }
const KEY_LENGTH = 64
const MAX_MEMORY = 256 * 1024 * 1024

export const PASSWORD_MIN_LENGTH = 10
// Teto por causa do custo de hashing: sem ele, uma "senha" de megabytes viraria negação de serviço.
export const PASSWORD_MAX_LENGTH = 128

export type ScryptCost = { N: number; r: number; p: number }

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  const options: ScryptOptions = { N: cost.N, r: cost.r, p: cost.p, maxmem: MAX_MEMORY }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

// Formato: scrypt$N$r$p$<salt base64>$<hash base64>
export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, cost)
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64"), key.toString("base64")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$")
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false
  const cost = { N: Number(n), r: Number(r), p: Number(p) }
  if (![cost.N, cost.r, cost.p].every((v) => Number.isInteger(v) && v > 0)) return false

  const expected = Buffer.from(hashB64, "base64")
  let actual: Buffer
  try {
    actual = await derive(password, Buffer.from(saltB64, "base64"), cost)
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Hash descartável para gastar o mesmo tempo quando o e-mail não existe — sem isso, a
// resposta mais rápida entregaria quais e-mails estão cadastrados.
let dummyHash: Promise<string> | undefined
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("senha-descartavel-so-para-gastar-tempo")
  await verifyPassword(password, await dummyHash)
  return false
}

// Senhas que aparecem em todas as listas de vazamentos e de tentativas automáticas (só as de 10+ caracteres,
// porque as menores já caem no mínimo). Comparação sem maiúsculas/minúsculas e sem separadores.
const COMMON_PASSWORDS = new Set([
  "1234567890", "12345678901", "123456789012", "0123456789", "1234567891", "9876543210", "0987654321",
  "1q2w3e4r5t", "1q2w3e4r5t6y", "qwertyuiop", "qwerty1234", "qwerty12345", "qwertyuiop123", "asdfghjkl1", "asdfghjklç",
  "zxcvbnm123", "abcdefghij", "abcd123456", "abc1234567", "password12", "password123", "password1234", "passw0rd123",
  "p@ssw0rd123", "iloveyou12", "iloveyou123", "welcome123", "welcome1234", "letmein1234", "administrador", "administrador1",
  "administrator", "admin12345", "admin123456", "adminadmin", "mudar12345", "mudar123456", "trocar12345", "senha12345",
  "senha123456", "senha1234567", "minhasenha", "minhasenha1", "minhasenha123", "senhasegura", "senhaforte1", "brasil1234",
  "brasil12345", "brasil2024", "brasil2025", "brasil2026", "corinthians", "flamengo123", "palmeiras1", "saopaulo123",
  "gremio12345", "internacional", "1111111111", "0000000000", "aaaaaaaaaa", "123123123123", "123456123456", "112233445566",
  "147258369147", "1234512345", "12345abcde", "123456789a", "123456789q", "a123456789", "q123456789", "central123",
  "centraldebalancos", "balancos123", "empresa1234", "empresa12345", "contabilidade",
])

function normalizeForCheck(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]/g, "")
}

// Previsível demais mesmo passando no tamanho: uma só repetição ("aaaaaaaaaa"), um bloco repetido ("abcabcabcabc")
// ou uma sequência corrida de números/letras ("12345678901", "abcdefghijk").
function isPredictable(normalized: string): boolean {
  if (new Set(normalized).size <= 2) return true
  if (/^(.{1,4})\1{2,}$/.test(normalized)) return true
  // Sequência corrida: dígitos contam em círculo (…8, 9, 0, 1…), letras não.
  const onlyDigits = /^\d+$/.test(normalized)
  const codes = [...normalized].map((c) => c.charCodeAt(0))
  const diffs = codes.slice(1).map((c, i) => (onlyDigits ? (c - codes[i] + 10) % 10 : c - codes[i]))
  const down = onlyDigits ? 9 : -1
  return diffs.every((d) => d === 1) || diffs.every((d) => d === down)
}

export interface PasswordContext {
  // Quem vai usar a senha: ela não pode ser o próprio e-mail nem conter a parte antes do @.
  email?: string
}

export function requireValidPassword(value: unknown, field = "Senha", context: PasswordContext = {}): string {
  if (typeof value !== "string") throw new ValidationError(`${field} é obrigatória.`)
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`${field} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(`${field} deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
  }
  const normalized = normalizeForCheck(value)
  const local = context.email ? normalizeForCheck(context.email.split("@")[0]) : ""
  if (COMMON_PASSWORDS.has(normalized) || isPredictable(normalized) || (local.length >= 4 && normalized.includes(local))) {
    throw new ValidationError(`${field} é muito comum ou previsível (ou parecida com o e-mail). Escolha outra.`)
  }
  return value
}
