import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCurrentUser } from "@/lib/server/auth/current-user"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    exercicio: { count: vi.fn() },
    valor: { count: vi.fn() },
    extracao: { count: vi.fn() },
    auditLog: { count: vi.fn() },
    parecer: { count: vi.fn() },
    lgpdErasureLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { DELETE } from "./route"

function buildRequest(body?: unknown) {
  return new Request("http://localhost/api/lgpd/eliminacao", {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  prisma.exercicio.count.mockResolvedValue(0)
  prisma.valor.count.mockResolvedValue(0)
  prisma.extracao.count.mockResolvedValue(0)
  prisma.auditLog.count.mockResolvedValue(0)
  prisma.parecer.count.mockResolvedValue(0)
})

describe("DELETE /api/lgpd/eliminacao", () => {
  it("rejeita sem login (401), sem apagar nada", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await DELETE(buildRequest())
    expect(response.status).toBe(401)
    expect(prisma.empresa.delete).not.toHaveBeenCalled()
  })

  it("rejeita perfil que não é administrador (403), sem apagar nada", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 3, email: "a@teste.com", nome: "A", papel: "ANALISTA" })
    const response = await DELETE(buildRequest())
    expect(response.status).toBe(403)
    expect(prisma.empresa.delete).not.toHaveBeenCalled()
  })

  it("como administrador e sem corpo, apaga a empresa e devolve o resumo do que foi apagado", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })

    const response = await DELETE(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.empresaId).toBe(1)
    expect(prisma.empresa.delete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("registra o administrador que executou como solicitante quando não há corpo", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })
    await DELETE(buildRequest())
    expect(prisma.lgpdErasureLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ solicitadoPor: "admin@teste.com" }) }),
    )
  })

  it("aceita solicitadoPor opcional no corpo e registra também quem executou", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })

    await DELETE(buildRequest({ solicitadoPor: "Titular via e-mail" }))

    expect(prisma.lgpdErasureLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ solicitadoPor: "Titular via e-mail (executado por admin@teste.com)" }) }),
    )
  })

  it("rejeita corpo com JSON malformado, sem apagar nada", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/lgpd/eliminacao", {
        method: "DELETE",
        body: "{ não é json",
      }),
    )
    expect(response.status).toBe(400)
    expect(prisma.empresa.delete).not.toHaveBeenCalled()
  })
})
