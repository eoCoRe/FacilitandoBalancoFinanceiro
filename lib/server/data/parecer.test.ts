import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, contas } = vi.hoisted(() => ({
  prisma: { exercicio: { findMany: vi.fn() }, conta: { findMany: vi.fn() } },
  contas: { buildBpAccountTree: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/data/contas", () => contas)

import { calcularParecer } from "./parecer"

const valor = (periodo: string, v: number) => ({ valor: v, exercicio: { periodo } })

beforeEach(() => {
  vi.clearAllMocks()
  prisma.exercicio.findMany.mockResolvedValue([
    { id: 10, periodo: "2024" },
    { id: 11, periodo: "2025" },
  ])
  contas.buildBpAccountTree.mockResolvedValue([
    { code: "1", name: "Ativo", values: { "2025": 3000 } },
    { code: "1.1", name: "Ativo Circulante", values: { "2025": 1000 } },
    { code: "2.1", name: "Passivo Circulante", values: { "2025": 500 } },
    { code: "2.2", name: "Exigível a Longo Prazo", values: { "2025": 300 } },
    { code: "2.3", name: "Patrimônio Líquido", values: { "2025": 2000 } },
  ])
  prisma.conta.findMany.mockImplementation(async ({ where }: { where: { tipo: string } }) =>
    where.tipo === "DRE"
      ? [
          { codigo: "receita-bruta", valores: [valor("2024", 1000), valor("2025", 1200)] },
          { codigo: "deducoes", valores: [valor("2024", -200), valor("2025", -200)] },
          { codigo: "cmv", valores: [valor("2024", -350), valor("2025", -400)] },
          { codigo: "despesas-operacionais", valores: [valor("2024", -100), valor("2025", -100)] },
          { codigo: "resultado-financeiro", valores: [valor("2024", -30), valor("2025", -50)] },
          { codigo: "ir-csll", valores: [valor("2024", -20), valor("2025", -50)] },
        ]
      : [{ descricao: "Fluxo de Caixa Operacional", valores: [valor("2025", 300)] }],
  )
})

describe("calcularParecer", () => {
  it("usa os dados DA EMPRESA no banco, com o exercício anterior como período de comparação", async () => {
    const { periodo, opiniao } = await calcularParecer(1, 11, 200_000)
    expect(periodo).toBe("2025")
    expect(contas.buildBpAccountTree).toHaveBeenCalledWith(1)
    for (const [chamada] of prisma.conta.findMany.mock.calls) {
      expect(chamada.include.valores.where).toEqual({ exercicio: { empresaId: 1 } })
    }
    // receita líquida 1000 (anual) -> 250k; PL 2000*1,2 -> 2,4 mi; caixa 300*3 -> 900k: limite 250k
    expect(opiniao.suggestedLimit).toBe(250_000)
    expect(opiniao.criteria.find((c) => c.label === "Tendência do Lucro")?.detail).toContain("2024")
    expect(opiniao.rating).toBe("favoravel")
  })

  it("exercício que não é da empresa: erro de validação", async () => {
    await expect(calcularParecer(1, 99, 1000)).rejects.toThrow(/Exercício não encontrado/)
  })
})
