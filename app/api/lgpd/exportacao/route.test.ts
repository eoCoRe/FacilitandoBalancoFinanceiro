import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCurrentUser } from "@/lib/server/current-user"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

describe("GET /api/lgpd/exportacao", () => {
  it("rejeita sem login (401), sem consultar a empresa", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled()
  })

  it("rejeita perfil que não é administrador (403)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 2, email: "c@teste.com", nome: "C", papel: "COORDENADOR" })
    const response = await GET()
    expect(response.status).toBe(403)
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled()
  })

  it("como administrador, devolve os dados da empresa e registra auditoria com o e-mail dele", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", exercicios: [], auditLogs: [] })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cnpj).toBe("12.345.678/0001-90")
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acao: "Exportação de dados solicitada (LGPD)", usuario: "admin@teste.com" }),
      }),
    )
  })
})
