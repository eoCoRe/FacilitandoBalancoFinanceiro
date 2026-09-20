import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto"
import { safeEqual } from "./safe-equal"
import { getAuthSecret } from "@/lib/server/auth/session"

// Segundo fator por app autenticador (Google Authenticator, Authy, 1Password…): TOTP, RFC 6238
// (HMAC-SHA1, passos de 30 s, 6 dígitos), implementado com node:crypto — sem dependência nova.
// Este arquivo só tem as funções puras (sem banco); a regra de uso fica em second-factor.ts.

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
// Tolerância a relógio desalinhado: aceita o passo atual e um para cada lado (±30 s).
export const TOTP_WINDOW = 1
export const TOTP_ISSUER = "Central de Balanços"

// ---- Base32 (RFC 4648, sem preenchimento): é o formato que os apps pedem ao digitar a chave ----

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error("Chave em base32 inválida.")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ---- Código ----

// 20 bytes (160 bits), o tamanho do HMAC-SHA1 e o recomendado pela RFC 4226.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS)
}

export function totpCodeAtStep(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hash = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest()
  const offset = hash[hash.length - 1] & 0x0f
  const binary =
    ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3]
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0")
}

// Passo em que o código confere (dentro da janela), ou null. `afterStep` é o último passo já aceito:
// um código de passo igual ou anterior é recusado — o mesmo código não vale duas vezes.
export function matchTotp(
  secretBase32: string,
  rawCode: unknown,
  { nowMs = Date.now(), afterStep = null }: { nowMs?: number; afterStep?: number | null } = {},
): number | null {
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : ""
  if (!/^\d{6}$/.test(code)) return null
  const current = totpStep(nowMs)
  let found: number | null = null
  // Sem "return" antecipado: o tempo não deve revelar em qual passo (ou se) o código conferiu.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (safeEqual(totpCodeAtStep(secretBase32, step), code) && (afterStep === null || step > afterStep)) found = step
  }
  return found
}

// Endereço que os apps entendem (também vira QR Code). A chave vai em base32, sem preenchimento.
export function otpauthUri(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---- A chave no banco: cifrada (AES-256-GCM) ----
// Diferente de um código de uso único, a chave TOTP precisa ser recuperável (o servidor a usa a cada
// login), então não dá para guardar só um hash. Cifrando com uma chave derivada de AUTH_SECRET, um
// vazamento só do banco não entrega as chaves. Formato: v1.<iv>.<tag>.<texto cifrado>, em base64url.

function encryptionKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", getAuthSecret(), Buffer.alloc(0), "central-balancos:totp:v1", 32))
}

export function encryptTotpSecret(secretBase32: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function decryptTotpSecret(stored: string): string {
  const [version, iv, tag, data, extra] = stored.split(".")
  if (version !== "v1" || !iv || !tag || !data || extra !== undefined) throw new Error("Chave TOTP em formato desconhecido.")
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

// ---- Códigos de recuperação ----

// Sem 0/O/1/I/L: dá para ler e digitar de um papel sem confundir. 10 caracteres de um alfabeto de 32
// = 50 bits, o bastante para um código de uso único protegido por limite de tentativas.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const RECOVERY_CODE_COUNT = 8

export function generateRecoveryCode(): string {
  let raw = ""
  for (let i = 0; i < 10; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

// Aceita maiúsculas/minúsculas, com ou sem hífen e espaços; devolve a forma canônica ou null.
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const clean = raw.replace(/[\s-]/g, "").toUpperCase()
  if (clean.length !== 10 || [...clean].some((c) => !RECOVERY_ALPHABET.includes(c))) return null
  return `${clean.slice(0, 5)}-${clean.slice(5)}`
}

// HMAC com AUTH_SECRET, amarrado ao usuário: o mesmo código em duas contas gera hashes diferentes.
export function hashRecoveryCode(userId: number, canonicalCode: string): string {
  return createHmac("sha256", Buffer.from(getAuthSecret())).update(`recuperacao:${userId}:${canonicalCode}`).digest("hex")
}
