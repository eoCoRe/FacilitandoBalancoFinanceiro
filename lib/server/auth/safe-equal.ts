import { timingSafeEqual } from "node:crypto"

// Comparação de textos secretos (hashes, HMAC, códigos) em tempo constante: `===` sai no primeiro caractere diferente
// e o tempo de resposta vazaria quanto do segredo já foi acertado. Tamanhos diferentes já são "diferentes" (o tamanho
// de um hash/HMAC não é segredo). `null`/`undefined` nunca é igual.
export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (typeof a !== "string") return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
