import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  verification: { consumeResetToken: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/verification", () => ({ consumeResetToken: verification.consumeResetToken }))

import { resetRateLimits } from "@/lib/server/rate-limit"
import { verifyPassword } from "@/lib/server/password"
import { POST } from "./route"

const post = (body: unknown, ip = "1.1.1.1") =>
  POST(
    new Request("http://localhost/api/auth/redefinir-senha", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.usuario.update.mockResolvedValue({ id: 5, email: "ana@teste.com" })
})

describe("POST /api/auth/redefinir-senha", () => {
  it("com link válido: grava a senha em hash, derruba as sessões abertas e audita", async () => {
    verification.consumeResetToken.mockResolvedValue(5)

    const response = await post({ token: "ID.SEGREDO", novaSenha: "nova-senha-segura-1" })

    expect(response.status).toBe(200)
    const { where, data } = prisma.usuario.update.mock.calls[0][0]
    expect(where).toEqual({ id: 5 })
    expect(data.senhaHash).not.toContain("nova-senha-segura-1")
    expect(await verifyPassword("nova-senha-segura-1", data.senhaHash)).toBe(true)
    expect(data.sessoesValidasDesde).toBeInstanceOf(Date)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Senha redefinida por e-mail", usuario: "ana@teste.com" }),
    })
  })

  it("link inválido/expirado/já usado: 400 com mensagem única, nada alterado", async () => {
    verification.consumeResetToken.mockResolvedValue(null)
    const response = await post({ token: "ruim", novaSenha: "nova-senha-segura-1" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/inválido ou expirado/)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("senha fraca é recusada ANTES de gastar o link (não queima o único uso)", async () => {
    const response = await post({ token: "ID.SEGREDO", novaSenha: "curta" })
    expect(response.status).toBe(400)
    expect(verification.consumeResetToken).not.toHaveBeenCalled()
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("chute de links: 10 falhas por IP e passa a responder 429", async () => {
    verification.consumeResetToken.mockResolvedValue(null)
    for (let i = 0; i < 10; i++) expect((await post({ token: `x${i}.y`, novaSenha: "nova-senha-segura-1" })).status).toBe(400)
    verification.consumeResetToken.mockClear()
    expect((await post({ token: "ID.SEGREDO", novaSenha: "nova-senha-segura-1" })).status).toBe(429)
    expect(verification.consumeResetToken).not.toHaveBeenCalled()
  })
})
