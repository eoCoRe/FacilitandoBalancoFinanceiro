import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, seal } = vi.hoisted(() => ({
  prisma: { empresa: { findFirst: vi.fn() }, auditLog: { create: vi.fn(), findMany: vi.fn() } },
  seal: { sealPending: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/audit/audit-seal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audit/audit-seal")>()),
  sealPending: seal.sealPending,
}))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, email: "admin@teste.com", nome: "Admin", papel: "ADMINISTRADOR" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.auditLog.findMany.mockResolvedValue([{ id: 40 }, { id: 41 }, { id: 44 }])
  seal.sealPending.mockResolvedValue(3)
})

describe("POST /api/auditoria/selar-pendentes", () => {
  it("sela ignorando o prazo e REGISTRA na trilha quem decidiu, quantos e quais ids", async () => {
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ selados: 3 })
    expect(seal.sealPending).toHaveBeenCalledWith({ ignoreGrace: true })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: "Registros pendentes selados manualmente",
        usuario: "admin@teste.com",
        detalhe: expect.stringContaining("#40 a #44"),
      }),
    })
  })

  it("sem nada pendente: não grava registro nenhum na trilha", async () => {
    prisma.auditLog.findMany.mockResolvedValue([])
    seal.sealPending.mockResolvedValue(0)
    expect(await (await POST()).json()).toEqual({ selados: 0 })
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it.each(["ANALISTA", "COORDENADOR"] as const)("%s não pode (só administrador): 403 e nada é selado", async (papel) => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 2, email: "x@teste.com", nome: "X", papel })
    expect((await POST()).status).toBe(403)
    expect(seal.sealPending).not.toHaveBeenCalled()
  })

  it("sem login: 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
  })
})
