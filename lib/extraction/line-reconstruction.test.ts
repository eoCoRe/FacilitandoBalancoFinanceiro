import { describe, expect, it } from "vitest"
import { reconstructLines } from "./line-reconstruction"

describe("reconstructLines", () => {
  it("junta itens na mesma altura (y) numa única linha, ordenados por x", () => {
    const lines = reconstructLines([
      { text: "850,00", x: 200, y: 100 },
      { text: "Disponibilidades", x: 20, y: 100 },
    ])
    expect(lines).toEqual(["Disponibilidades 850,00"])
  })

  it("mantém itens de alturas diferentes em linhas separadas", () => {
    const lines = reconstructLines([
      { text: "Disponibilidades", x: 20, y: 100 },
      { text: "Fornecedores", x: 20, y: 80 },
    ])
    expect(lines).toEqual(["Disponibilidades", "Fornecedores"])
  })

  it("agrupa itens com y ligeiramente diferente dentro da tolerância", () => {
    const lines = reconstructLines(
      [
        { text: "Disponibilidades", x: 20, y: 100 },
        { text: "850,00", x: 200, y: 101.5 },
      ],
      2,
    )
    expect(lines).toEqual(["Disponibilidades 850,00"])
  })

  it("retorna lista vazia para nenhum item", () => {
    expect(reconstructLines([])).toEqual([])
  })
})
