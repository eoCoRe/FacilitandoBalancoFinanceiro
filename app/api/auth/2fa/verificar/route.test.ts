import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  verification: { checkCode: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/verification")>()),
  checkCode: verification.checkCode,
}))

import { isRateLimited, recordFailure, resetRateLimits } from "@/lib/server/rate-limit"
import { signTwoFactorToken, TWO_FACTOR_CHALLENGE_KEY, TWO_FACTOR_CHALLENGE_MAX } from "@/lib/server/two-factor"
import { POST } from "./route"

const usuario = (over = {}) => ({ id: 5, nome: "Ana", email: "ana@teste.com", papel: "ANALISTA", ativo: true, ...over })

async function verificar(codigo: unknown, opts: { cookie?: string | null } = {}) {
  const headers: Record<string, string> = {}
  const token = opts.cookie === undefined ? await signTwoFactorToken(5, "desafio-1") : opts.cookie
  if (token) headers.cookie = `cb_2fa=${token}`
  return POST(
    new NextRequest("http://localhost/api/auth/2fa/verificar", {
      method: "POST",
      headers,
      body: JSON.stringify({ codigo }),
    }),
  )
}
const cookies = (r: Response) => r.headers.getSetCookie().join(";")

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv("AUTH_SECRET", "t".repeat(40))
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.usuario.findUnique.mockResolvedValue(usuario())
  verification.checkCode.mockResolvedValue("ok")
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/2fa/verificar", () => {
  it("código certo: cria a sessão, descarta o cookie temporário e audita o login", async () => {
    const response = await verificar("123456")

    expect(response.status).toBe(200)
    expect((await response.json()).user).toMatchObject({ id: 5, email: "ana@teste.com" })
    expect(cookies(response)).toMatch(/cb_session=[^;]+/)
    expect(cookies(response)).toMatch(/cb_2fa=;/) // limpo
    expect(verification.checkCode).toHaveBeenCalledWith("desafio-1", 5, "LOGIN_2FA", "123456")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Login realizado", usuario: "ana@teste.com" }),
    })
  })

  it("o usuário vem do cookie assinado, nunca do corpo (não dá para tentar o código de outra pessoa)", async () => {
    await verificar("123456")
    expect(verification.checkCode.mock.calls[0][1]).toBe(5)
  })

  it("sem o cookie do passo 1 (ou adulterado): 401 e nem consulta o código", async () => {
    expect((await verificar("123456", { cookie: null })).status).toBe(401)
    expect((await verificar("123456", { cookie: "lixo" })).status).toBe(401)
    const outro = await signTwoFactorToken(5, "desafio-1")
    expect((await verificar("123456", { cookie: outro.slice(0, -3) + "abc" })).status).toBe(401)
    expect(verification.checkCode).not.toHaveBeenCalled()
  })

  it("código errado: 401, sem sessão", async () => {
    verification.checkCode.mockResolvedValue("invalido")
    const response = await verificar("000000")
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("Código incorreto.")
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
  })

  it("código expirado: mensagem própria, sem sessão", async () => {
    verification.checkCode.mockResolvedValue("expirado")
    const response = await verificar("123456")
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/expirou/)
  })

  it("tentativas esgotadas: 401, cookie descartado e ocorrência na auditoria", async () => {
    verification.checkCode.mockResolvedValue("bloqueado")
    const response = await verificar("123456")
    expect(response.status).toBe(401)
    expect(cookies(response)).toMatch(/cb_2fa=;/)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Verificação em 2 etapas bloqueada" }),
    })
  })

  it("conta desativada entre a senha e o código: não entra", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ ativo: false }))
    const response = await verificar("123456")
    expect(response.status).toBe(401)
    expect(cookies(response)).not.toMatch(/cb_session=[^;]/)
  })

  it("login concluído zera o teto de desafios (quem entra e sai várias vezes não é bloqueado)", async () => {
    for (let i = 0; i < TWO_FACTOR_CHALLENGE_MAX; i++) recordFailure(TWO_FACTOR_CHALLENGE_KEY(5))
    expect(isRateLimited(TWO_FACTOR_CHALLENGE_KEY(5), TWO_FACTOR_CHALLENGE_MAX)).toBe(true)

    expect((await verificar("123456")).status).toBe(200)

    expect(isRateLimited(TWO_FACTOR_CHALLENGE_KEY(5), TWO_FACTOR_CHALLENGE_MAX)).toBe(false)
  })

  it("código errado NÃO zera o teto (só o sucesso zera)", async () => {
    for (let i = 0; i < TWO_FACTOR_CHALLENGE_MAX; i++) recordFailure(TWO_FACTOR_CHALLENGE_KEY(5))
    verification.checkCode.mockResolvedValue("invalido")
    await verificar("000000")
    expect(isRateLimited(TWO_FACTOR_CHALLENGE_KEY(5), TWO_FACTOR_CHALLENGE_MAX)).toBe(true)
  })
})
