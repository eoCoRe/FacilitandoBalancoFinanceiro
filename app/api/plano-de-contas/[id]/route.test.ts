import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    conta: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { DELETE, PATCH } from "./route"

function buildRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/plano-de-contas/5", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

describe("PATCH /api/plano-de-contas/[id]", () => {
  it("rejeita id inválido", async () => {
    const response = await PATCH(buildRequest("PATCH", { nome: "Novo nome" }), ctx("abc"))
    expect(response.status).toBe(400)
    expect(prisma.conta.update).not.toHaveBeenCalled()
  })

  it("rejeita conta inexistente", async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    const response = await PATCH(buildRequest("PATCH", { nome: "Novo nome" }), ctx("5"))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/não encontrada/i)
  })

  it("rejeita nome vazio", async () => {
    prisma.conta.findUnique.mockResolvedValue({ id: 5, codigo: "1.1" })
    const response = await PATCH(buildRequest("PATCH", { nome: "  " }), ctx("5"))
    expect(response.status).toBe(400)
    expect(prisma.conta.update).not.toHaveBeenCalled()
  })

  it("renomeia e registra auditoria", async () => {
    prisma.conta.findUnique.mockResolvedValue({ id: 5, codigo: "1.1" })
    prisma.conta.update.mockResolvedValue({ id: 5, codigo: "1.1", descricao: "Novo nome" })

    const response = await PATCH(buildRequest("PATCH", { nome: "Novo nome" }), ctx("5"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.descricao).toBe("Novo nome")
    expect(prisma.conta.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { descricao: "Novo nome" } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: "Conta renomeada" }) }),
    )
  })

  it("rejeita corpo com JSON malformado sem tocar no banco", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/plano-de-contas/5", { method: "PATCH", body: "{ não é json" }),
      ctx("5"),
    )
    expect(response.status).toBe(400)
    expect(prisma.conta.update).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/plano-de-contas/[id]", () => {
  it("rejeita conta inexistente", async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    const response = await DELETE(buildRequest("DELETE"), ctx("5"))
    expect(response.status).toBe(400)
    expect(prisma.conta.delete).not.toHaveBeenCalled()
  })

  it("remove e registra auditoria", async () => {
    prisma.conta.findUnique.mockResolvedValue({ id: 5, codigo: "1.1" })

    const response = await DELETE(buildRequest("DELETE"), ctx("5"))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(prisma.conta.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: "Conta removida" }) }),
    )
  })
})
