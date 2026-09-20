import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, seal } = vi.hoisted(() => ({
  prisma: { empresa: { findFirst: vi.fn() }, auditLog: { create: vi.fn() } },
  seal: { verifyAuditIntegrity: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/audit/audit-seal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audit/audit-seal")>()),
  verifyAuditIntegrity: seal.verifyAuditIntegrity,
}))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { GET } from "./route"

const OK = { integra: true, verificados: 12, naoSelados: 0, primeiroId: 1, ultimoId: 12, quebra: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 2, email: "coord@teste.com", nome: "Coord", papel: "COORDENADOR" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  seal.verifyAuditIntegrity.mockResolvedValue(OK)
})

describe("GET /api/auditoria/integridade", () => {
  it("devolve o relatório e registra a verificação na trilha", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(OK)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: "Integridade da auditoria verificada",
        usuario: "coord@teste.com",
        detalhe: expect.stringContaining("12 registro(s)"),
      }),
    })
  })

  it("quando encontra problema, o registro do problema vai para a trilha", async () => {
    seal.verifyAuditIntegrity.mockResolvedValue({
      ...OK,
      integra: false,
      quebra: { id: 7, motivo: "O conteúdo deste registro não confere com o selo: foi alterado depois de gravado." },
    })
    const corpo = await (await GET()).json()
    expect(corpo.integra).toBe(false)
    expect(corpo.quebra.id).toBe(7)
    expect(prisma.auditLog.create.mock.calls[0][0].data.detalhe).toMatch(/PROBLEMA no registro #7/)
  })

  it("analista não pode (só coordenador ou acima): 403, nada é lido", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 3, email: "a@teste.com", nome: "A", papel: "ANALISTA" })
    expect((await GET()).status).toBe(403)
    expect(seal.verifyAuditIntegrity).not.toHaveBeenCalled()
  })

  it("sem login: 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(seal.verifyAuditIntegrity).not.toHaveBeenCalled()
  })
})
