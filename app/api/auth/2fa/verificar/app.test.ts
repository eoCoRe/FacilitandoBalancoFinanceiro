import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// 2º passo do login quando o segundo fator é o APP AUTENTICADOR (ou um código de recuperação).
const { prisma, sf, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  sf: { checkLoginCode: vi.fn() },
  verification: { checkCode: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/auth/second-factor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/second-factor")>()),
  checkLoginCode: sf.checkLoginCode,
}))
vi.mock("@/lib/server/auth/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/auth/verification")>()),
  checkCode: verification.checkCode,
}))

import { resetRateLimits } from "@/lib/server/auth/rate-limit"
import { TOTP_CHALLENGE } from "@/lib/server/auth/second-factor"
import { signTwoFactorToken } from "@/lib/server/auth/two-factor"
import { POST } from "./route"

const usuario = (over = {}) => ({
  id: 5,
  nome: "Ana",
  email: "ana@teste.com",
  papel: "ANALISTA",
  ativo: true,
  totpAtivo: true,
  totpSegredo: "v1.x.y.z",
  totpUltimoPasso: null,
  ...over,
})

async function verificar(codigo: unknown, challenge = TOTP_CHALLENGE) {
  return POST(
    new NextRequest("http://localhost/api/auth/2fa/verificar", {
      method: "POST",
      headers: { cookie: `cb_2fa=${await signTwoFactorToken(5, challenge)}` },
      body: JSON.stringify({ codigo }),
    }),
  )
}
const cookies = (r: Response) => r.headers.getSetCookie().join(";")

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv("AUTH_SECRET", "a".repeat(40))
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.usuario.findUnique.mockResolvedValue(usuario())
  sf.checkLoginCode.mockResolvedValue({ ok: true, via: "app" })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/2fa/verificar com o app autenticador", () => {
  it("código do app certo: cria a sessão, limpa o cookie temporário e audita o login", async () => {
    const response = await verificar("123456")
    expect(response.status).toBe(200)
    expect(cookies(response)).toMatch(/cb_session=[^;]+/)
    expect(cookies(response)).toMatch(/cb_2fa=;/)
    expect(sf.checkLoginCode).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), "123456")
    expect(verification.checkCode).not.toHaveBeenCalled() // não usa desafio de e-mail
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Login realizado", detalhe: expect.stringContaining("aplicativo autenticador") }),
    })
  })

  it("código errado: 401 'Código incorreto.', sem sessão, e o cookie continua (dá para tentar de novo)", async () => {
    sf.checkLoginCode.mockResolvedValue({ ok: false })
    const response = await verificar("000000")
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("Código incorreto.")
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
    expect(cookies(response)).not.toMatch(/cb_2fa=;/)
  })

  it("5 erros bloqueiam: audita, descarta o cookie e as tentativas seguintes levam 429 — mesmo com o código certo", async () => {
    sf.checkLoginCode.mockResolvedValue({ ok: false })
    for (let i = 0; i < 4; i++) expect((await verificar("000000")).status).toBe(401)
    const quinta = await verificar("000000")
    expect(quinta.status).toBe(401)
    expect(cookies(quinta)).toMatch(/cb_2fa=;/)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Verificação em 2 etapas bloqueada" }),
    })

    sf.checkLoginCode.mockResolvedValue({ ok: true, via: "app" })
    sf.checkLoginCode.mockClear()
    const depois = await verificar("123456")
    expect(depois.status).toBe(429)
    expect(sf.checkLoginCode).not.toHaveBeenCalled()
    expect(cookies(depois)).not.toMatch(/cb_session=[^;]/)
  })

  it("o limite é do USUÁRIO: refazer o login com a senha não devolve as tentativas", async () => {
    sf.checkLoginCode.mockResolvedValue({ ok: false })
    for (let i = 0; i < 5; i++) await verificar("000000")
    // "novo login" = um cookie novo do passo 1
    expect((await verificar("123456")).status).toBe(429)
  })

  it("acertar zera os erros anteriores", async () => {
    sf.checkLoginCode.mockResolvedValue({ ok: false })
    for (let i = 0; i < 4; i++) await verificar("000000")
    sf.checkLoginCode.mockResolvedValue({ ok: true, via: "app" })
    expect((await verificar("123456")).status).toBe(200)
    sf.checkLoginCode.mockResolvedValue({ ok: false })
    for (let i = 0; i < 4; i++) expect((await verificar("000000")).status).toBe(401) // teria bloqueado sem o zeramento
  })

  it("código de recuperação: entra, audita o uso e quantos restam", async () => {
    sf.checkLoginCode.mockResolvedValue({ ok: true, via: "recuperacao", restantes: 3 })
    const response = await verificar("ABCDE-FGHJK")
    expect(response.status).toBe(200)
    expect(cookies(response)).toMatch(/cb_session=[^;]+/)
    const acoes = prisma.auditLog.create.mock.calls.map((c) => c[0].data)
    expect(acoes).toContainEqual(expect.objectContaining({ acao: "Código de recuperação usado", detalhe: expect.stringContaining("3") }))
    expect(acoes).toContainEqual(expect.objectContaining({ acao: "Login realizado", detalhe: expect.stringContaining("recuperação") }))
  })

  it("app desligado (pelo administrador) entre a senha e o código: 401, não entra", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ totpAtivo: false }))
    const response = await verificar("123456")
    expect(response.status).toBe(401)
    expect(sf.checkLoginCode).not.toHaveBeenCalled()
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
  })

  it("conta desativada entre a senha e o código: 401", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ ativo: false }))
    expect((await verificar("123456")).status).toBe(401)
    expect(sf.checkLoginCode).not.toHaveBeenCalled()
  })

  it("cookie de um login POR E-MAIL, mas a conta ligou o app depois: o código do e-mail não vale mais", async () => {
    verification.checkCode.mockResolvedValue("ok")
    const response = await verificar("123456", "desafio-de-email")
    expect(response.status).toBe(401)
    expect(verification.checkCode).not.toHaveBeenCalled()
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
  })
})

describe("rajada paralela de chutes no código do app", () => {
  it("só 5 chegam a conferir o código; as demais levam 429 antes de tocar no banco", async () => {
    sf.checkLoginCode.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5)) // a conferência é assíncrona, como no banco de verdade
      return { ok: false }
    })
    const respostas = await Promise.all(Array.from({ length: 40 }, () => verificar("000000")))
    expect(sf.checkLoginCode).toHaveBeenCalledTimes(5)
    const status = respostas.map((r) => r.status)
    expect(status.filter((s) => s === 429)).toHaveLength(35)
    expect(status.filter((s) => s === 401)).toHaveLength(5)
  })
})
