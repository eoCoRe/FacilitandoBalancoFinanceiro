import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

function buildRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/lgpd/exportacao", { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("LGPD_ADMIN_TOKEN", "segredo-123")
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/lgpd/exportacao", () => {
  it("rejeita sem o token (401), sem consultar a empresa", async () => {
    const response = await GET(buildRequest())
    expect(response.status).toBe(401)
    expect(prisma.empresa.findFirst).not.toHaveBeenCalled()
  })

  it("rejeita com token errado (401)", async () => {
    const response = await GET(buildRequest({ "x-lgpd-token": "errado" }))
    expect(response.status).toBe(401)
  })

  it("com token correto, devolve os dados da empresa e registra auditoria", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", exercicios: [], auditLogs: [] })

    const response = await GET(buildRequest({ "x-lgpd-token": "segredo-123" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cnpj).toBe("12.345.678/0001-90")
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: "Exportação de dados solicitada (LGPD)" }) }),
    )
  })
})
