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

export function requireValidPassword(value: unknown, field = "Senha"): string {
  if (typeof value !== "string") throw new ValidationError(`${field} é obrigatória.`)
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`${field} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(`${field} deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
  }
  return value
}
