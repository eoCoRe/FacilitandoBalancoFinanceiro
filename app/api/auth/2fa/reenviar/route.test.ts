import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, mail, verification } = vi.hoisted(() => ({
  prisma: { usuario: { findUnique: vi.fn() } },
  mail: { sendMail: vi.fn(), mailAvailable: vi.fn() },
  verification: { createCodeChallenge: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/mail", () => ({ sendMail: mail.sendMail, mailAvailable: mail.mailAvailable }))
vi.mock("@/lib/server/verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/verification")>()),
  createCodeChallenge: verification.createCodeChallenge,
}))

import { resetRateLimits } from "@/lib/server/rate-limit"
import { signTwoFactorToken } from "@/lib/server/two-factor"
import { POST } from "./route"

async function reenviar(cookie: string | null | undefined = undefined) {
  const headers: Record<string, string> = {}
  const token = cookie === undefined ? await signTwoFactorToken(5, "desafio-1") : cookie
  if (token) headers.cookie = `cb_2fa=${token}`
  return POST(new NextRequest("http://localhost/api/auth/2fa/reenviar", { method: "POST", headers }))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv("AUTH_SECRET", "r".repeat(40))
  prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true })
  mail.mailAvailable.mockReturnValue(true)
  mail.sendMail.mockResolvedValue(undefined)
  verification.createCodeChallenge.mockResolvedValue({ id: "desafio-2", code: "654321" })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/2fa/reenviar", () => {
  it("envia um novo código e troca o cookie pelo do novo desafio", async () => {
    const response = await reenviar()
    expect(response.status).toBe(200)
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("654321") }))
    expect(response.headers.getSetCookie().join(";")).toMatch(/cb_2fa=[^;]+/)
  })

  it("sem o cookie do passo 1: 401, nada enviado", async () => {
    expect((await reenviar(null)).status).toBe(401)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("conta desativada: 401, nada enviado", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: false })
    expect((await reenviar()).status).toBe(401)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("o reenvio divide o teto de 5 desafios por usuário (não vira brecha para pedir códigos sem fim)", async () => {
    for (let i = 0; i < 5; i++) expect((await reenviar()).status).toBe(200)
    mail.sendMail.mockClear()
    expect((await reenviar()).status).toBe(429)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })

  it("quem usa o app autenticador NÃO pode trocar para o código por e-mail: 400, nada enviado, cookie intacto", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true, totpAtivo: true })
    const response = await reenviar(await signTwoFactorToken(5, "totp"))
    expect(response.status).toBe(400)
    expect(mail.sendMail).not.toHaveBeenCalled()
    expect(verification.createCodeChallenge).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie().join(";")).not.toMatch(/cb_2fa=[^;]/)
  })

  it("mesmo com um cookie de e-mail antigo, se a conta já usa o app, o reenvio é recusado", async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 5, email: "ana@teste.com", ativo: true, totpAtivo: true })
    expect((await reenviar()).status).toBe(400)
    expect(mail.sendMail).not.toHaveBeenCalled()
  })
})
