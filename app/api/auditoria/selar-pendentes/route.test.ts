import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, seal } = vi.hoisted(() => ({
  prisma: { empresa: { findFirst: vi.fn() }, auditLog: { create: vi.fn() } },
  seal: { sealPendingDetailed: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/audit/audit-seal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audit/audit-seal")>()),
  sealPendingDetailed: seal.sealPendingDetailed,
}))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { SEAL_MAX_PER_CALL } from "@/lib/server/audit/audit-seal"
import { POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, email: "admin@teste.com", nome: "Admin", papel: "ADMINISTRADOR" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  seal.sealPendingDetailed.mockResolvedValue({ count: 3, primeiroId: 40, ultimoId: 44 })
})

describe("POST /api/auditoria/selar-pendentes", () => {
  it("sela TODOS os pendentes e REGISTRA na trilha quem decidiu, quantos e a faixa de ids REALMENTE selados", async () => {
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ selados: 3 })
    expect(seal.sealPendingDetailed).toHaveBeenCalledWith({ all: true })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: "Registros pendentes selados manualmente",
        usuario: "admin@teste.com",
        detalhe: expect.stringContaining("3 registro(s) sem selo (#40 a #44)"),
      }),
    })
  })

  it("histórico MAIOR que o limite de uma chamada: continua selando até acabar; total e faixa REAIS na trilha", async () => {
    seal.sealPendingDetailed.mockReset()
    seal.sealPendingDetailed
      .mockResolvedValueOnce({ count: SEAL_MAX_PER_CALL, primeiroId: 1, ultimoId: 2500 })
      .mockResolvedValueOnce({ count: SEAL_MAX_PER_CALL, primeiroId: 2501, ultimoId: 5000 })
      .mockResolvedValueOnce({ count: 120, primeiroId: 5001, ultimoId: 5120 })
    const corpo = await (await POST()).json()
    expect(corpo).toEqual({ selados: SEAL_MAX_PER_CALL * 2 + 120 })
    expect(seal.sealPendingDetailed).toHaveBeenCalledTimes(3)
    expect(prisma.auditLog.create.mock.calls[0][0].data.detalhe).toContain(`${SEAL_MAX_PER_CALL * 2 + 120} registro(s) sem selo (#1 a #5120)`)
  })

  it("sem nada pendente: não grava registro nenhum na trilha", async () => {
    seal.sealPendingDetailed.mockResolvedValue({ count: 0, primeiroId: null, ultimoId: null })
    expect(await (await POST()).json()).toEqual({ selados: 0 })
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it.each(["ANALISTA", "COORDENADOR"] as const)("%s não pode (só administrador): 403 e nada é selado", async (papel) => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 2, email: "x@teste.com", nome: "X", papel })
    expect((await POST()).status).toBe(403)
    expect(seal.sealPendingDetailed).not.toHaveBeenCalled()
  })

  it("sem login: 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
  })
})
