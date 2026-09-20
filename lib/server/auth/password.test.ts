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

  it.each([
    "1234567890", "Password123", "qwertyuiop", "SENHA-12345", "1q2w3e4r5t", "Brasil 12345", "administrador",
    "aaaaaaaaaaaa", "abababababab", "abcabcabcabc", "1111111111", "abcdefghijkl", "98765432109876", "123456789012345",
  ])("recusa senha comum ou previsível: %j", (fraca) => {
    expect(() => requireValidPassword(fraca)).toThrow(/comum ou previsível/)
  })

  it("aceita frases e senhas que só PARECEM fracas (não bloqueia por engano)", () => {
    for (const boa of ["cavalo-bateria-grampo", "Minha senha é longa mesmo!", "ana.2026.Balanco#Q3", "tomate7 mesa 91 rio", "uma-senha-forte-123"]) {
      expect(requireValidPassword(boa)).toBe(boa)
    }
  })

  it("com o e-mail de contexto: não pode ser o e-mail nem conter a parte antes do @", () => {
    const ctx = { email: "joaquim.silva@empresa.com" }
    expect(() => requireValidPassword("joaquim.silva@empresa.com", "Senha", ctx)).toThrow(/comum ou previsível/)
    expect(() => requireValidPassword("Joaquim.Silva-2026!", "Senha", ctx)).toThrow(/comum ou previsível/)
    expect(requireValidPassword("cavalo-bateria-grampo", "Senha", ctx)).toBe("cavalo-bateria-grampo")
  })

  it("parte local curta (menos de 4 caracteres) não bloqueia: 'ana' apareceria em muita frase legítima", () => {
    expect(requireValidPassword("banana-mesa-caneta-42", "Senha", { email: "ana@empresa.com" })).toBe("banana-mesa-caneta-42")
  })

  it("a mensagem indica o campo", () => {
    expect(() => requireValidPassword("1234567890", "Nova senha")).toThrow(/^Nova senha é muito comum/)
  })
})
