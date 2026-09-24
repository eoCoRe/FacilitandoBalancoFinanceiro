import { describe, expect, it } from "vitest"
import { extractLabelAndValue, newestColumnFromRight } from "./number-parsing"

describe("extractLabelAndValue", () => {
  it("lê rótulo e valor de uma linha simples", () => {
    expect(extractLabelAndValue("Disponibilidades 850,00")).toEqual({
      label: "Disponibilidades",
      value: 850,
    })
  })

  it("lê valor com separador de milhar", () => {
    expect(extractLabelAndValue("Contas a Receber de Clientes 3.200,00")).toEqual({
      label: "Contas a Receber de Clientes",
      value: 3200,
    })
  })

  it("remove o código de conta do início do rótulo", () => {
    expect(extractLabelAndValue("1.1.1 Disponibilidades 850,00")).toEqual({
      label: "Disponibilidades",
      value: 850,
    })
  })

  it("usa o último número da linha (coluna mais à direita) quando há vários exercícios", () => {
    expect(extractLabelAndValue("Disponibilidades 850,00 920,00 1.050,00")).toEqual({
      label: "Disponibilidades",
      value: 1050,
    })
  })

  it("trata valor entre parênteses como negativo", () => {
    expect(extractLabelAndValue("(-) Depreciação Acumulada (1.200,00)")).toEqual({
      label: "(-) Depreciação Acumulada",
      value: -1200,
    })
  })

  it("remove pontilhado que liga o nome ao valor", () => {
    expect(extractLabelAndValue("Fornecedores .......... 3.100,00")).toEqual({
      label: "Fornecedores",
      value: 3100,
    })
  })

  it("ignora percentuais como valor da linha", () => {
    expect(extractLabelAndValue("Margem Líquida 12,5%")).toBeNull()
  })

  it("retorna null quando não há número na linha", () => {
    expect(extractLabelAndValue("BALANÇO PATRIMONIAL")).toBeNull()
  })

  it("retorna null quando o rótulo restante é vazio ou curto demais", () => {
    expect(extractLabelAndValue("12 850,00")).toBeNull()
  })

  it("'-' no FIM do número é sinal de crédito e fica no próprio número (não passa para o seguinte)", () => {
    const line = "LUCROS OU PREJUIZOS ACUMULADOS 3.267.377,89- 0,00"
    expect(extractLabelAndValue(line, 1)).toEqual({ label: "LUCROS OU PREJUIZOS ACUMULADOS", value: -3267377.89 })
    expect(extractLabelAndValue(line)?.value).toBe(0)
  })

  it("não lê pedaço de CNPJ, de ano ou de número mal formatado como valor", () => {
    expect(extractLabelAndValue("C.N.P.J. 00.417.504/0001-01")).toBeNull()
    expect(extractLabelAndValue("BALANÇO PATRIMONIAL EXERCICIO 2025")).toBeNull()
    expect(extractLabelAndValue("Disponibilidades 1.2345")).toBeNull()
  })

  it("coluna pedida além das que a linha tem: fica a última", () => {
    expect(extractLabelAndValue("Disponibilidades 850,00", 3)?.value).toBe(850)
  })
})

describe("newestColumnFromRight", () => {
  it("acha a coluna do ano mais recente, contando da direita", () => {
    expect(newestColumnFromRight("Descricao da conta---Sld.de Setembro 2024--Sld.de Dezembro 2023")).toBe(1)
    expect(newestColumnFromRight("Conta 2023 2024")).toBe(0)
    expect(newestColumnFromRight("Conta 2022 2024 2023")).toBe(1)
  })

  it("não é cabeçalho: um ano só, ou a linha já tem valores", () => {
    expect(newestColumnFromRight("Exercício encerrado em 30 de setembro de 2024.")).toBeNull()
    expect(newestColumnFromRight("Resultado 2024 1.000,00 2023 900,00")).toBeNull()
  })
})
