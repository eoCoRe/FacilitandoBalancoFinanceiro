import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    extracao: { create: vi.fn(), findMany: vi.fn() },
    valorExtraido: { createMany: vi.fn() },
    valor: { upsert: vi.fn(), deleteMany: vi.fn() },
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
  return new Request("http://localhost/api/extracoes", { method: "POST", body: JSON.stringify(body) })
}

describe("POST /api/extracoes", () => {
  it("rejeita quando faltam campos obrigatórios", async () => {
    const response = await POST(buildRequest({ exercicioId: 1 }))
    expect(response.status).toBe(400)
    expect(prisma.extracao.create).not.toHaveBeenCalled()
  })

  it("rejeita itens vazio ou além do limite de 200", async () => {
    const empty = await POST(buildRequest({ exercicioId: 1, arquivoOrigem: "a.pdf", itens: [] }))
    expect(empty.status).toBe(400)

    const tooMany = await POST(
      buildRequest({
        exercicioId: 1,
        arquivoOrigem: "a.pdf",
        itens: Array.from({ length: 201 }, () => ({ contaId: 1, valor: 10, confianca: 90 })),
      }),
    )
    expect(tooMany.status).toBe(400)
    expect(prisma.extracao.create).not.toHaveBeenCalled()
  })

  it("rejeita item que não é objeto (ex.: string ou null na lista de itens)", async () => {
    const response = await POST(buildRequest({ exercicioId: 1, arquivoOrigem: "a.pdf", itens: ["não é um objeto"] }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/itens\[0\] inválido/)
    expect(prisma.extracao.create).not.toHaveBeenCalled()
  })

  it("rejeita confiança fora de 0–100", async () => {
    const response = await POST(
      buildRequest({
        exercicioId: 1,
        arquivoOrigem: "a.pdf",
        itens: [{ contaId: 1, valor: 10, confianca: 150 }],
      }),
    )
    expect(response.status).toBe(400)
    expect(prisma.extracao.create).not.toHaveBeenCalled()
  })

  it("grava a extração, os itens extraídos e só lança Valor para os itens mapeados", async () => {
    prisma.extracao.create.mockResolvedValue({ id: 99 })

    const response = await POST(
      buildRequest({
        exercicioId: 2,
        arquivoOrigem: "balanco-teste.png",
        itens: [
          { contaId: 10, valor: 945, confianca: 97, paginaOrigem: 1 },
          { contaId: null, valor: 640, confianca: 68, paginaOrigem: 2 }, // não reconhecida
        ],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual({ extracaoId: 99, gravados: 1 })

    expect(prisma.valorExtraido.createMany).toHaveBeenCalledWith({
      data: [
        { extracaoId: 99, contaId: 10, valor: 945, paginaOrigem: 1, confianca: 97 },
        { extracaoId: 99, contaId: null, valor: 640, paginaOrigem: 2, confianca: 68 },
      ],
    })

    // só a linha com contaId mapeado vira Valor
    expect(prisma.valor.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.valor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { exercicioId: 2, contaId: 10, valor: 945 } }),
    )

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ empresaId: 1, acao: "Extração confirmada" }),
      }),
    )
  })

  it("usa 'mock-demo-v1' como modeloLlm padrão quando não informado", async () => {
    prisma.extracao.create.mockResolvedValue({ id: 1 })
    await POST(buildRequest({ exercicioId: 1, arquivoOrigem: "a.pdf", itens: [{ contaId: null, valor: 1, confianca: 50 }] }))
    expect(prisma.extracao.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modeloLlm: "mock-demo-v1" }) }),
    )
  })

  it("respeita o modeloLlm informado explicitamente", async () => {
    prisma.extracao.create.mockResolvedValue({ id: 1 })
    await POST(
      buildRequest({
        exercicioId: 1,
        arquivoOrigem: "a.pdf",
        modeloLlm: "gpt-vision-teste",
        itens: [{ contaId: null, valor: 1, confianca: 50 }],
      }),
    )
    expect(prisma.extracao.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ modeloLlm: "gpt-vision-teste" }) }),
    )
  })

  it("rejeita corpo com JSON malformado", async () => {
    const response = await POST(new Request("http://localhost/api/extracoes", { method: "POST", body: "{ não é json" }))
    expect(response.status).toBe(400)
    expect(prisma.extracao.create).not.toHaveBeenCalled()
  })
})

describe("GET /api/extracoes", () => {
  it("lista as extrações mais recentes primeiro", async () => {
    prisma.extracao.findMany.mockResolvedValue([
      {
        id: 2,
        arquivoOrigem: "b.pdf",
        modeloLlm: "mock-demo-v1",
        status: "CONCLUIDA",
        criadoEm: new Date("2026-01-02"),
        exercicio: { periodo: "1T2026" },
        _count: { valoresExtraidos: 3 },
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.extracoes).toHaveLength(1)
    expect(body.extracoes[0]).toMatchObject({ id: 2, totalItens: 3, exercicio: "1T2026" })
  })

  it("retorna lista vazia quando não há extrações", async () => {
    prisma.extracao.findMany.mockResolvedValue([])
    const response = await GET()
    const body = await response.json()
    expect(body.extracoes).toEqual([])
  })
})
