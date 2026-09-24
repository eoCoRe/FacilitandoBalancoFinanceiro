import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    conta: { findMany: vi.fn() },
    empresa: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

describe("GET /api/dre", () => {
  it("calcula os totalizadores a partir das linhas de entrada, sem duplicar o motor do frontend", async () => {
    prisma.conta.findMany.mockResolvedValue([
      {
        id: 1,
        codigo: "receita-bruta",
        descricao: "Receita Bruta",
        valores: [{ valor: 1000, exercicio: { periodo: "1T2026" } }],
      },
      {
        id: 2,
        codigo: "deducoes",
        descricao: "(-) Deduções da Receita",
        valores: [{ valor: -100, exercicio: { periodo: "1T2026" } }],
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.valoresPorExercicio["1T2026"]["receita-liquida"]).toBe(900)
    // linha computada não vem de uma Conta persistida
    const receitaLiquidaLinha = body.linhas.find((l: { id: string }) => l.id === "receita-liquida")
    expect(receitaLiquidaLinha.contaId).toBeNull()
    const receitaBrutaLinha = body.linhas.find((l: { id: string }) => l.id === "receita-bruta")
    expect(receitaBrutaLinha.contaId).toBe(1)
  })

  it("propaga 'dados insuficientes' quando falta algum insumo do período", async () => {
    prisma.conta.findMany.mockResolvedValue([
      {
        id: 1,
        codigo: "receita-bruta",
        descricao: "Receita Bruta",
        valores: [{ valor: 1000, exercicio: { periodo: "1T2026" } }],
      },
      // sem "deducoes" lançado em 1T2026
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.valoresPorExercicio["1T2026"]["receita-liquida"]).toBeUndefined()
  })

  it("calcula cada exercício de forma independente, sem misturar insumos entre períodos", async () => {
    prisma.conta.findMany.mockResolvedValue([
      {
        id: 1,
        codigo: "receita-bruta",
        descricao: "Receita Bruta",
        valores: [
          { valor: 1000, exercicio: { periodo: "4T2024" } },
          { valor: 2000, exercicio: { periodo: "1T2025" } },
        ],
      },
      {
        id: 2,
        codigo: "deducoes",
        descricao: "(-) Deduções da Receita",
        valores: [
          { valor: -100, exercicio: { periodo: "4T2024" } },
          { valor: -200, exercicio: { periodo: "1T2025" } },
        ],
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.valoresPorExercicio["4T2024"]["receita-liquida"]).toBe(900)
    expect(body.valoresPorExercicio["1T2025"]["receita-liquida"]).toBe(1800)
  })

  it("devolve linhas com valoresPorExercicio vazio quando não há contas de DRE lançadas", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    const response = await GET()
    const body = await response.json()

    expect(body.valoresPorExercicio).toEqual({})
    expect(body.linhas.length).toBeGreaterThan(0) // linhas do catálogo continuam presentes
    expect(body.linhas.every((l: { contaId: number | null }) => l.contaId === null)).toBe(true)
  })
})

describe("GET /api/dre — várias empresas", () => {
  it("lê só os valores da empresa em análise (a conta é global; o valor é do exercício de uma empresa)", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    await GET()
    expect(prisma.conta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { valores: { where: { exercicio: { empresaId: 1 } }, include: { exercicio: true } } } }),
    )
  })
})
