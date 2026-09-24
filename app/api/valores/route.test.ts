import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    valor: { upsert: vi.fn(), deleteMany: vi.fn() },
    conta: { findUnique: vi.fn() },
    exercicio: { findUnique: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { PUT } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.conta.findUnique.mockResolvedValue({ id: 5 })
  prisma.exercicio.findUnique.mockResolvedValue({ id: 2, empresaId: 1 })
})

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/valores", { method: "PUT", body: JSON.stringify(body) })
}

describe("PUT /api/valores", () => {
  it("exercício de OUTRA empresa (a empresa em análise foi trocada em outra aba): 400, nada é gravado nem apagado", async () => {
    prisma.exercicio.findUnique.mockResolvedValue({ id: 2, empresaId: 7, periodo: "2025" })
    const gravar = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: 100 }))
    expect(gravar.status).toBe(400)
    expect((await gravar.json()).error).toMatch(/outra empresa/)
    const apagar = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: null }))
    expect(apagar.status).toBe(400)
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
    expect(prisma.valor.deleteMany).not.toHaveBeenCalled()
  })

  it("rejeita quando contaId ou exercicioId estão ausentes ou inválidos", async () => {
    const response = await PUT(buildRequest({ valor: 100 }))
    expect(response.status).toBe(400)
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })

  it("rejeita valor fora do limite defensivo ou de tipo errado", async () => {
    // Infinity/NaN não sobrevivem a JSON.stringify (viram null), então o caso real de
    // payload malicioso é: número absurdamente grande, ou um tipo que não é number.
    const tooLarge = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: 1e13 }))
    expect(tooLarge.status).toBe(400)

    const wrongType = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: "1234" }))
    expect(wrongType.status).toBe(400)

    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })

  it("faz upsert quando um valor válido é informado, e registra auditoria", async () => {
    prisma.valor.upsert.mockResolvedValue({ id: 1, contaId: 5, exercicioId: 2, valor: 1234 })

    const response = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: 1234 }))
    const body = await response.json()

    expect(prisma.valor.upsert).toHaveBeenCalledWith({
      where: { exercicioId_contaId: { exercicioId: 2, contaId: 5 } },
      update: { valor: 1234 },
      create: { exercicioId: 2, contaId: 5, valor: 1234 },
    })
    expect(body.valor).toBe(1234)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: 1, acao: "Valor lançado" }) }),
    )
  })

  it("apaga o lançamento quando valor é null, sem chamar upsert", async () => {
    const response = await PUT(buildRequest({ contaId: 5, exercicioId: 2, valor: null }))
    const body = await response.json()

    expect(prisma.valor.deleteMany).toHaveBeenCalledWith({ where: { contaId: 5, exercicioId: 2 } })
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
    expect(body).toEqual({ ok: true })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: "Valor removido" }) }),
    )
  })

  it("permite apagar mesmo que contaId/exercicioId não existam mais (deleteMany é inofensivo)", async () => {
    prisma.conta.findUnique.mockResolvedValue(null)
    prisma.exercicio.findUnique.mockResolvedValue(null)

    const response = await PUT(buildRequest({ contaId: 999, exercicioId: 999, valor: null }))

    expect(response.status).toBe(200)
    expect(prisma.valor.deleteMany).toHaveBeenCalledWith({ where: { contaId: 999, exercicioId: 999 } })
  })

  it("rejeita com 400 (não 500 de violação de FK) quando contaId não existe", async () => {
    prisma.conta.findUnique.mockResolvedValue(null)

    const response = await PUT(buildRequest({ contaId: 999, exercicioId: 2, valor: 100 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/Conta não encontrada/)
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })

  it("rejeita com 400 quando exercicioId não existe", async () => {
    prisma.exercicio.findUnique.mockResolvedValue(null)

    const response = await PUT(buildRequest({ contaId: 5, exercicioId: 999, valor: 100 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatch(/Exercício não encontrado/)
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })

  it("rejeita corpo com JSON malformado", async () => {
    const response = await PUT(new Request("http://localhost/api/valores", { method: "PUT", body: "{ isso não é json" }))
    expect(response.status).toBe(400)
    expect(prisma.valor.upsert).not.toHaveBeenCalled()
  })

  it("a auditoria mostra código da conta e período (não ids internos)", async () => {
    prisma.conta.findUnique.mockResolvedValue({ id: 3, codigo: "1.1.1" })
    prisma.exercicio.findUnique.mockResolvedValue({ id: 9, empresaId: 1, periodo: "1T2026" })
    prisma.valor.upsert.mockResolvedValue({ id: 1 })

    await PUT(buildRequest({ contaId: 3, exercicioId: 9, valor: 1500 }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detalhe: "1.1.1 · 1T2026 = 1500" }),
    })

    prisma.auditLog.create.mockClear()
    await PUT(buildRequest({ contaId: 3, exercicioId: 9, valor: null }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detalhe: "1.1.1 · 1T2026 limpo." }),
    })
  })
})
