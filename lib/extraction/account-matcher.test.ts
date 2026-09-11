import { describe, expect, it } from "vitest"
import type { Account } from "../financial-data"
import { matchAccountName } from "./account-matcher"

function buildLeaves(): Account[] {
  return [
    { code: "1.1.1", name: "Disponibilidades", values: {} },
    { code: "1.1.3", name: "Contas a Receber de Clientes", values: {} },
    { code: "1.1.4", name: "Estoques", values: {} },
    { code: "2.1.1", name: "Fornecedores", values: {} },
  ]
}

describe("matchAccountName", () => {
  it("casa nome idêntico com score máximo", () => {
    const { account, score } = matchAccountName("Disponibilidades", buildLeaves())
    expect(account?.code).toBe("1.1.1")
    expect(score).toBeGreaterThanOrEqual(96)
  })

  it("ignora maiúsculas/acentos ao comparar", () => {
    const { account } = matchAccountName("DISPONIBILIDADES", buildLeaves())
    expect(account?.code).toBe("1.1.1")
  })

  it("casa por sinônimo conhecido de outro sistema contábil", () => {
    const { account, score } = matchAccountName("Caixa e Equivalentes de Caixa", buildLeaves())
    expect(account?.code).toBe("1.1.1")
    expect(score).toBeGreaterThanOrEqual(90)
  })

  it("casa 'Clientes' com Contas a Receber de Clientes via sinônimo", () => {
    const { account } = matchAccountName("Clientes", buildLeaves())
    expect(account?.code).toBe("1.1.3")
  })

  it("não força um casamento para um rótulo sem relação com nenhuma conta", () => {
    const { account, score } = matchAccountName("Adiantamento a Fornecedores de Terceiros no Exterior", buildLeaves())
    if (account) {
      // se casar com algo, tem que ser com confiança baixa o suficiente pra ficar "não reconhecida"
      expect(score).toBeLessThan(70)
    }
  })

  it("retorna score 0 e conta nula para rótulo vazio", () => {
    expect(matchAccountName("", buildLeaves())).toEqual({ account: null, score: 0 })
  })
})
