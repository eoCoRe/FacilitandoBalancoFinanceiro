import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    exercicio: { count: vi.fn() },
    valor: { count: vi.fn() },
    extracao: { count: vi.fn() },
    auditLog: { count: vi.fn() },
    lgpdErasureLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { DELETE } from "./route"

function buildRequest(headers: Record<string, string> = {}, body?: unknown) {
  return new Request("http://localhost/api/lgpd/eliminacao", {
    method: "DELETE",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("LGPD_ADMIN_TOKEN", "segredo-123")
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  prisma.exercicio.count.mockResolvedValue(0)
  prisma.valor.count.mockResolvedValue(0)
  prisma.extracao.count.mockResolvedValue(0)
  prisma.auditLog.count.mockResolvedValue(0)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("DELETE /api/lgpd/eliminacao", () => {
  it("rejeita sem o token (401), sem apagar nada", async () => {
    const response = await DELETE(buildRequest())
    expect(response.status).toBe(401)
    expect(prisma.empresa.delete).not.toHaveBeenCalled()
  })

  it("com token correto e sem corpo, apaga a empresa e devolve o resumo do que foi apagado", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })

    const response = await DELETE(buildRequest({ "x-lgpd-token": "segredo-123" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.empresaId).toBe(1)
    expect(prisma.empresa.delete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("aceita solicitadoPor opcional no corpo", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Empresa X" })

    await DELETE(buildRequest({ "x-lgpd-token": "segredo-123" }, { solicitadoPor: "Titular via e-mail" }))

    expect(prisma.lgpdErasureLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ solicitadoPor: "Titular via e-mail" }) }),
    )
  })

  it("rejeita corpo com JSON malformado, sem apagar nada", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/lgpd/eliminacao", {
        method: "DELETE",
        headers: { "x-lgpd-token": "segredo-123" },
        body: "{ não é json",
      }),
    )
    expect(response.status).toBe(400)
    expect(prisma.empresa.delete).not.toHaveBeenCalled()
  })
})
