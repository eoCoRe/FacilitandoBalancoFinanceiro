import { describe, expect, it } from "vitest"
import { basesVerticaisBalanco, formatPercentual, percentual, variacao } from "./analise-hv"
import type { Account } from "./financial-data"

const CONTAS: Account[] = [
  {
    code: "1",
    name: "Ativo",
    children: [
      { code: "1.1", name: "Disponibilidades", values: { "2024": 200, "2025": 300 } },
      { code: "1.2", name: "Estoques", values: { "2024": 800, "2025": 700 } },
    ],
  },
  {
    code: "2",
    name: "Passivo",
    children: [
      { code: "2.1", name: "Fornecedores", values: { "2024": 400, "2025": 250 } },
      { code: "2.3", name: "Patrimônio Líquido", values: { "2024": 600, "2025": 750 } },
    ],
  },
]

describe("análise vertical", () => {
  it("cada conta sobre o total do seu lado do balanço, no mesmo exercício", () => {
    const bases = basesVerticaisBalanco(CONTAS, "2025")
    expect(bases.get("1")).toBe(1000)
    expect(bases.get("1.2")).toBe(1000)
    expect(bases.get("2.1")).toBe(1000)
    expect(percentual(700, bases.get("1.2"))).toBe(70)
    expect(percentual(250, bases.get("2.1"))).toBe(25)
  })

  it("base zero ou faltando: sem valor (nunca 0%)", () => {
    expect(percentual(10, 0)).toBeUndefined()
    expect(percentual(10, undefined)).toBeUndefined()
    expect(percentual(undefined, 100)).toBeUndefined()
    expect(basesVerticaisBalanco(CONTAS, "2023").get("1.1")).toBeUndefined()
  })
})

describe("análise horizontal", () => {
  it("variação sobre o exercício anterior", () => {
    expect(variacao(300, 200)).toBe(50)
    expect(variacao(700, 800)).toBe(-12.5)
  })

  it("linha negativa (custo): o sinal diz se cresceu em valor absoluto do anterior", () => {
    // custo de -1000 para -1200: variação -20% (piorou 20% em relação ao valor absoluto)
    expect(variacao(-1200, -1000)).toBe(-20)
    // prejuízo de -100 virou lucro de 50: +150%
    expect(variacao(50, -100)).toBe(150)
  })

  it("sem anterior ou anterior zero: sem valor", () => {
    expect(variacao(10, undefined)).toBeUndefined()
    expect(variacao(10, 0)).toBeUndefined()
  })
})

describe("formatPercentual", () => {
  it("uma casa, vírgula decimal, sinal opcional e traço quando não há valor", () => {
    expect(formatPercentual(12.345)).toBe("12,3%")
    expect(formatPercentual(12.345, true)).toBe("+12,3%")
    expect(formatPercentual(-4, true)).toBe("-4,0%")
    expect(formatPercentual(undefined)).toBe("—")
  })
})
