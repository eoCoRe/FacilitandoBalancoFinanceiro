import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, verification } = vi.hoisted(() => ({
  prisma: {
    usuario: { update: vi.fn(), findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  verification: { consumeResetToken: vi.fn(), releaseResetToken: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/auth/verification", () => ({
  consumeResetToken: verification.consumeResetToken,
  releaseResetToken: verification.releaseResetToken,
}))

import { resetRateLimits } from "@/lib/server/auth/rate-limit"
import { verifyPassword } from "@/lib/server/auth/password"
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
  prisma.usuario.findUnique.mockResolvedValue({ email: "ana@teste.com" })
  verification.releaseResetToken.mockResolvedValue(undefined)
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

  it("senha parecida com o e-mail do dono do link é recusada, e o link é DEVOLVIDO (não queima o uso)", async () => {
    verification.consumeResetToken.mockResolvedValue(5)
    prisma.usuario.findUnique.mockResolvedValue({ email: "joaquim.silva@empresa.com" })

    const response = await post({ token: "id.segredo", novaSenha: "Joaquim.Silva-2026!" })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/comum ou previsível/)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
    expect(verification.releaseResetToken).toHaveBeenCalledWith("id.segredo")
  })

  it("chute de links: 10 falhas por IP e passa a responder 429", async () => {
    verification.consumeResetToken.mockResolvedValue(null)
    for (let i = 0; i < 10; i++) expect((await post({ token: `x${i}.y`, novaSenha: "nova-senha-segura-1" })).status).toBe(400)
    verification.consumeResetToken.mockClear()
    expect((await post({ token: "ID.SEGREDO", novaSenha: "nova-senha-segura-1" })).status).toBe(429)
    expect(verification.consumeResetToken).not.toHaveBeenCalled()
  })

  it("se a gravação da senha falhar DEPOIS de gastar o link, o link é devolvido (a pessoa não fica sem)", async () => {
    verification.consumeResetToken.mockResolvedValue(5)
    prisma.usuario.update.mockRejectedValue(new Error("banco fora"))

    await expect(post({ token: "ID.SEGREDO", novaSenha: "nova-senha-segura-1" })).rejects.toThrow("banco fora")

    expect(verification.releaseResetToken).toHaveBeenCalledWith("ID.SEGREDO")
  })

  it("o hash da senha é calculado ANTES de gastar o link", async () => {
    const ordem: string[] = []
    verification.consumeResetToken.mockImplementation(async () => {
      ordem.push("consome")
      return 5
    })
    prisma.usuario.update.mockImplementation(async ({ data }: { data: { senhaHash: string } }) => {
      ordem.push(data.senhaHash.startsWith("scrypt$") ? "grava-com-hash-pronto" : "grava-sem-hash")
      return { id: 5, email: "ana@teste.com" }
    })
    await post({ token: "ID.SEGREDO", novaSenha: "nova-senha-segura-1" })
    expect(ordem).toEqual(["consome", "grava-com-hash-pronto"])
  })
})
