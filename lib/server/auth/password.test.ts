import { describe, expect, it } from "vitest"
import { hashPassword, requireValidPassword, verifyPassword } from "@/lib/server/auth/password"
import { ValidationError } from "@/lib/server/validation"

// Custo baixo só para os testes não demorarem; o formato carrega os parâmetros, então o
// verifyPassword de produção lê o custo de dentro do hash.
const FAST = { N: 1024, r: 8, p: 1 }

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta e recusa a errada", async () => {
    const hash = await hashPassword("uma-senha-longa-123", FAST)
    expect(await verifyPassword("uma-senha-longa-123", hash)).toBe(true)
    expect(await verifyPassword("uma-senha-longa-124", hash)).toBe(false)
  })

  it("nunca guarda a senha em texto e gera sal diferente a cada vez", async () => {
    const a = await hashPassword("mesma-senha-123", FAST)
    const b = await hashPassword("mesma-senha-123", FAST)
    expect(a).not.toContain("mesma-senha-123")
    expect(a).not.toBe(b)
    expect(await verifyPassword("mesma-senha-123", b)).toBe(true)
  })

  it("grava o esquema e os parâmetros dentro do hash", async () => {
    const [scheme, n, r, p] = (await hashPassword("x-senha-longa", FAST)).split("$")
    expect([scheme, n, r, p]).toEqual(["scrypt", "1024", "8", "1"])
  })

  it("recusa hash malformado ou de outro esquema, sem lançar", async () => {
    expect(await verifyPassword("x", "")).toBe(false)
    expect(await verifyPassword("x", "bcrypt$10$abc")).toBe(false)
    expect(await verifyPassword("x", "scrypt$abc$8$1$c2Fs$aGFzaA==")).toBe(false)
  })
})

describe("requireValidPassword", () => {
  it("exige o mínimo de caracteres", () => {
    expect(() => requireValidPassword("curta")).toThrow(ValidationError)
    expect(requireValidPassword("dez-chars-ok")).toBe("dez-chars-ok")
  })

  it("impõe um teto (evita negação de serviço por senha gigante)", () => {
    expect(() => requireValidPassword("a".repeat(129))).toThrow(ValidationError)
  })

  it("recusa o que não é texto", () => {
    expect(() => requireValidPassword(undefined)).toThrow(ValidationError)
    expect(() => requireValidPassword(12345678901)).toThrow(ValidationError)
  })
})
