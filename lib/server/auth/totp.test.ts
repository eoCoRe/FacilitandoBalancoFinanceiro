import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotp,
  normalizeRecoveryCode,
  otpauthUri,
  totpCodeAtStep,
  totpStep,
} from "@/lib/server/auth/totp"

// Chave dos vetores de teste da RFC 6238 (ASCII "12345678901234567890").
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "x".repeat(40))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("base32", () => {
  it("bate com os vetores da RFC 4648 (sem preenchimento)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI")
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB")
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar")
  })

  it("ida e volta com bytes aleatórios; aceita minúsculas, espaços e hífens ao digitar", () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Encode(base32Decode(secret))).toBe(secret)
    const digitada = secret.toLowerCase().replace(/(.{4})/g, "$1 ")
    expect(base32Encode(base32Decode(digitada))).toBe(secret)
  })

  it("recusa caractere fora do alfabeto", () => {
    expect(() => base32Decode("ABC1")).toThrow(/base32/)
  })
})

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("vetor oficial: em %i s o código é %s", (segundos, esperado) => {
    expect(totpCodeAtStep(RFC_SECRET, totpStep(segundos * 1000))).toBe(esperado)
  })

  const agora = 1_700_000_000_000
  const passo = totpStep(agora)

  it("aceita o passo atual e devolve qual foi", () => {
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo), { nowMs: agora })).toBe(passo)
  })

  it("tolera 1 passo (30 s) de relógio para cada lado, e só isso", () => {
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo - 1), { nowMs: agora })).toBe(passo - 1)
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo + 1), { nowMs: agora })).toBe(passo + 1)
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo - 2), { nowMs: agora })).toBeNull()
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo + 2), { nowMs: agora })).toBeNull()
  })

  it("não aceita o mesmo código duas vezes: passo igual ou anterior ao último aceito é recusado", () => {
    const codigo = totpCodeAtStep(RFC_SECRET, passo)
    expect(matchTotp(RFC_SECRET, codigo, { nowMs: agora, afterStep: passo - 1 })).toBe(passo)
    expect(matchTotp(RFC_SECRET, codigo, { nowMs: agora, afterStep: passo })).toBeNull()
    // um código mais antigo dentro da janela também não volta
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(RFC_SECRET, passo - 1), { nowMs: agora, afterStep: passo })).toBeNull()
  })

  it("aceita o código digitado com espaço no meio; recusa o que não tem 6 dígitos", () => {
    const codigo = totpCodeAtStep(RFC_SECRET, passo)
    expect(matchTotp(RFC_SECRET, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, { nowMs: agora })).toBe(passo)
    for (const ruim of ["", "12345", "1234567", "abcdef", null, undefined, 123456]) {
      expect(matchTotp(RFC_SECRET, ruim, { nowMs: agora })).toBeNull()
    }
  })

  it("código de outra chave não confere", () => {
    const outra = generateTotpSecret()
    expect(matchTotp(RFC_SECRET, totpCodeAtStep(outra, passo), { nowMs: agora })).toBeNull()
  })
})

describe("otpauth://", () => {
  it("monta o endereço que os apps leem, com a chave e os parâmetros", () => {
    const uri = new URL(otpauthUri("ana+teste@empresa.com", RFC_SECRET))
    expect(uri.protocol).toBe("otpauth:")
    expect(uri.host).toBe("totp")
    expect(decodeURIComponent(uri.pathname)).toBe("/Central de Balanços:ana+teste@empresa.com")
    expect(uri.searchParams.get("secret")).toBe(RFC_SECRET)
    expect(uri.searchParams.get("issuer")).toBe("Central de Balanços")
    expect(uri.searchParams.get("digits")).toBe("6")
    expect(uri.searchParams.get("period")).toBe("30")
  })
})

describe("chave cifrada no banco", () => {
  it("ida e volta, sem deixar a chave à vista", () => {
    const secret = generateTotpSecret()
    const guardado = encryptTotpSecret(secret)
    expect(guardado).toMatch(/^v1\./)
    expect(guardado).not.toContain(secret)
    expect(decryptTotpSecret(guardado)).toBe(secret)
  })

  it("cada cifragem é diferente (IV aleatório)", () => {
    expect(encryptTotpSecret(RFC_SECRET)).not.toBe(encryptTotpSecret(RFC_SECRET))
  })

  it("com outro AUTH_SECRET não decifra; texto adulterado ou em formato estranho também falha", () => {
    const guardado = encryptTotpSecret(RFC_SECRET)
    vi.stubEnv("AUTH_SECRET", "y".repeat(40))
    expect(() => decryptTotpSecret(guardado)).toThrow()
    vi.stubEnv("AUTH_SECRET", "x".repeat(40))
    const [v, iv, tag, dados] = guardado.split(".")
    const adulterado = [v, iv, tag, Buffer.from("outra coisa aqui").toString("base64url")].join(".")
    expect(() => decryptTotpSecret(adulterado)).toThrow()
    expect(dados).toBeTruthy()
    expect(() => decryptTotpSecret("texto puro")).toThrow(/formato/)
    expect(() => decryptTotpSecret(`v2.${iv}.${tag}.${dados}`)).toThrow(/formato/)
  })
})

describe("códigos de recuperação", () => {
  it("têm o formato XXXXX-XXXXX, sem caracteres ambíguos, e não se repetem", () => {
    const codigos = new Set(Array.from({ length: 200 }, generateRecoveryCode))
    expect(codigos.size).toBe(200)
    for (const c of codigos) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/)
  })

  it("normaliza o que a pessoa digita: minúsculas, sem hífen, com espaços", () => {
    expect(normalizeRecoveryCode("abcde-fghjk")).toBe("ABCDE-FGHJK")
    expect(normalizeRecoveryCode(" abcde fghjk ")).toBe("ABCDE-FGHJK")
    expect(normalizeRecoveryCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK")
  })

  it("recusa o que não é um código (tamanho errado, caractere ambíguo, não-texto)", () => {
    for (const ruim of ["", "ABCDE", "ABCDE-FGHJKL", "ABCDE-FGHJ0", "ABCDE-FGHJO", "123456", null, undefined, 42]) {
      expect(normalizeRecoveryCode(ruim)).toBeNull()
    }
  })

  it("o hash depende do usuário e do código, e não expõe o código", () => {
    const h = hashRecoveryCode(1, "ABCDE-FGHJK")
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashRecoveryCode(1, "ABCDE-FGHJK"))
    expect(h).not.toBe(hashRecoveryCode(2, "ABCDE-FGHJK"))
    expect(h).not.toBe(hashRecoveryCode(1, "ABCDE-FGHJM"))
  })
})
