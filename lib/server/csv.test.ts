import { describe, expect, it } from "vitest"
import { csvCell, toCsv } from "./csv"

describe("csvCell", () => {
  it("envolve em aspas e duplica as aspas internas", () => {
    expect(csvCell('Disse "oi"')).toBe('"Disse ""oi"""')
  })

  it("preserva vírgulas, quebras de linha e acentos dentro da célula", () => {
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"')
    expect(csvCell("Ação")).toBe('"Ação"')
  })

  it("trata null e undefined como vazio", () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", '=HYPERLINK("http://evil","x")'])(
    "neutraliza injeção de fórmula: %j vira texto",
    (perigoso) => {
      const cell = csvCell(perigoso)
      expect(cell.startsWith(`"'`)).toBe(true) // o apóstrofo na frente impede a planilha de executar
    },
  )

  it("não mexe em texto normal que só CONTÉM esses símbolos no meio", () => {
    expect(csvCell("1.1.1 · 1T2026 = 945")).toBe('"1.1.1 · 1T2026 = 945"')
    expect(csvCell("ana@teste.com")).toBe('"ana@teste.com"')
  })
})

describe("toCsv", () => {
  it("começa com BOM UTF-8, usa CRLF e termina com quebra de linha", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]])
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv).toBe('﻿"A","B"\r\n"1","2"\r\n')
  })

  it("aplica a proteção também nas linhas de dados", () => {
    expect(toCsv(["Detalhe"], [["=cmd|' /C calc'!A0"]])).toContain(`"'=cmd`)
  })
})
