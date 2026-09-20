import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/current-user"
import { POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", "e".repeat(40))
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/auth/sessoes/encerrar-outras", () => {
  it("invalida as sessões abertas (sessoesValidasDesde = agora) e reemite o cookie DESTA sessão", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })

    const response = await POST()

    expect(response.status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { sessoesValidasDesde: expect.any(Date) },
    })
    expect(response.headers.getSetCookie().join(";")).toMatch(/cb_session=[^;]+/) // quem clicou continua logado
  })

  it("audita com o e-mail de quem encerrou", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
    await POST()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Outras sessões encerradas", usuario: "ana@teste.com" }),
    })
  })

  it("sem login: 401 e nada é alterado", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await POST()
    expect(response.status).toBe(401)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })
})
