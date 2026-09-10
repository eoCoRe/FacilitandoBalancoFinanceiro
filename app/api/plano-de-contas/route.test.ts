import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    conta: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET, POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/plano-de-contas", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("GET /api/plano-de-contas", () => {
  it("monta a árvore hierárquica com os valores por exercício", async () => {
    prisma.conta.findMany.mockResolvedValue([
      { id: 1, codigo: "1", descricao: "Ativo", contaPaiId: null, valores: [] },
      {
        id: 2,
        codigo: "1.1",
        descricao: "Ativo Circulante",
        contaPaiId: 1,
        valores: [{ valor: 100, exercicio: { periodo: "1T2026" } }],
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.contas).toHaveLength(1)
    expect(body.contas[0]).toMatchObject({ id: 1, codigo: "1", descricao: "Ativo" })
    expect(body.contas[0].subcontas).toHaveLength(1)
    expect(body.contas[0].subcontas[0]).toMatchObject({
      id: 2,
      codigo: "1.1",
      valores: { "1T2026": 100 },
    })
  })

  it("retorna lista vazia quando não há contas", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    const response = await GET()
    const body = await response.json()
    expect(body.contas).toEqual([])
  })

  it("ignora conta cujo contaPaiId não corresponde a nenhuma conta retornada (órfã), sem crashar", async () => {
    prisma.conta.findMany.mockResolvedValue([
      { id: 2, codigo: "1.1", descricao: "Ativo Circulante", contaPaiId: 999, valores: [] },
    ])
    const response = await GET()
    const body = await response.json()
    expect(body.contas).toEqual([]) // não aparece como raiz nem como filha de ninguém
  })
})

describe("POST /api/plano-de-contas", () => {
  it("rejeita nome vazio sem tocar no banco", async () => {
    const response = await POST(buildRequest({ parentId: null, nome: "  " }))
    expect(response.status).toBe(400)
    expect(prisma.conta.create).not.toHaveBeenCalled()
  })

  it("rejeita quando o pai informado não existe", async () => {
    prisma.conta.findUnique.mockResolvedValueOnce(null)
    const response = await POST(buildRequest({ parentId: 999, nome: "Subconta" }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/não encontrada/i)
    expect(prisma.conta.create).not.toHaveBeenCalled()
  })

  it("cria um grupo raiz com o próximo código livre e registra auditoria", async () => {
    prisma.conta.findMany.mockResolvedValueOnce([{ codigo: "1" }, { codigo: "2" }])
    prisma.conta.create.mockResolvedValueOnce({ id: 10, codigo: "3", descricao: "Contas de Compensação" })

    const response = await POST(buildRequest({ parentId: null, nome: "Contas de Compensação" }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.codigo).toBe("3")
    expect(prisma.conta.create).toHaveBeenCalledWith({
      data: { codigo: "3", descricao: "Contas de Compensação", tipo: "BP", contaPaiId: null },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: 1, acao: "Conta criada" }) }),
    )
  })

  it("cria uma subconta usando <código do pai>.<próximo n>", async () => {
    prisma.conta.findUnique.mockResolvedValueOnce({ id: 1, codigo: "1" })
    prisma.conta.findMany.mockResolvedValueOnce([{ codigo: "1.1" }])
    prisma.conta.create.mockResolvedValueOnce({ id: 11, codigo: "1.2", descricao: "Nova subconta" })

    const response = await POST(buildRequest({ parentId: 1, nome: "Nova subconta" }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.codigo).toBe("1.2")
  })

  it("rejeita corpo com JSON malformado", async () => {
    const response = await POST(
      new Request("http://localhost/api/plano-de-contas", { method: "POST", body: "{ isso não é json" }),
    )
    expect(response.status).toBe(400)
    expect(prisma.conta.create).not.toHaveBeenCalled()
  })

  it("rejeita parentId negativo ou zero sem consultar o banco", async () => {
    const response = await POST(buildRequest({ parentId: 0, nome: "Subconta" }))
    expect(response.status).toBe(400)
    expect(prisma.conta.findUnique).not.toHaveBeenCalled()
  })
})
