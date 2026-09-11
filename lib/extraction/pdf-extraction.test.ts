import { describe, expect, it } from "vitest"
import type { Account } from "../financial-data"
import { extractRowsFromLines } from "./pdf-extraction"

function buildAccounts(): Account[] {
  return [
    {
      code: "1",
      name: "Ativo",
      children: [
        { code: "1.1.1", name: "Disponibilidades", values: {} },
        { code: "1.1.3", name: "Contas a Receber de Clientes", values: {} },
      ],
    },
    {
      code: "2",
      name: "Passivo",
      children: [{ code: "2.1.1", name: "Fornecedores", values: {} }],
    },
  ]
}

describe("extractRowsFromLines", () => {
  it("extrai contas reconhecidas com código atribuído", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidades 850,00", page: 1 },
        { text: "1.1.3 Contas a Receber de Clientes 3.200,00", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ code: "1.1.1", value: 850, page: 1 })
    expect(rows[1]).toMatchObject({ code: "1.1.3", value: 3200, page: 1 })
  })

  it("deixa código nulo quando não reconhece a conta, pra revisão manual", () => {
    const rows = extractRowsFromLines([{ text: "Adiantamento a Fornecedores 640,00", page: 2 }], buildAccounts())
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBeNull()
    expect(rows[0].suggestedName).toBe("Adiantamento a Fornecedores")
  })

  it("ignora linhas sem valor numérico (títulos, cabeçalhos)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "BALANÇO PATRIMONIAL", page: 1 },
        { text: "ATIVO CIRCULANTE", page: 1 },
        { text: "1.1.1 Disponibilidades 850,00", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows).toHaveLength(1)
  })

  it("dedupe: mantém só a ocorrência de maior confiança quando a mesma conta aparece 2x", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidade 850,00", page: 1 }, // singular, casamento mais fraco
        { text: "1.1.1 Disponibilidades 900,00", page: 2 }, // casamento exato
      ],
      buildAccounts(),
    )
    const disponibilidades = rows.filter((r) => r.code === "1.1.1")
    expect(disponibilidades).toHaveLength(1)
    expect(disponibilidades[0].value).toBe(900)
  })

  it("retorna lista vazia quando nenhuma linha tem conteúdo extraível", () => {
    expect(extractRowsFromLines([{ text: "BALANÇO PATRIMONIAL", page: 1 }], buildAccounts())).toEqual([])
  })
})
