import { describe, expect, it } from "vitest"
import { formatBrNumberForInput, parseBrNumber, parseExpressao } from "./number-input"

describe("parseBrNumber", () => {
  it("lê o formato brasileiro, com ou sem separador de milhar", () => {
    expect(parseBrNumber("12.663.067,45")).toBe(12663067.45)
    expect(parseBrNumber("12663,07")).toBe(12663.07)
    expect(parseBrNumber(" -1.200 ")).toBe(-1200)
    expect(parseBrNumber("850")).toBe(850)
  })

  it("vazio ou texto que não é número: null", () => {
    expect(parseBrNumber("")).toBeNull()
    expect(parseBrNumber("abc")).toBeNull()
    expect(parseBrNumber("12a")).toBeNull()
    expect(parseBrNumber(",")).toBeNull()
  })
})

describe("formatBrNumberForInput", () => {
  it("volta ao MESMO número quando lido de novo (o bug antigo: '12663.07' virava 1266307)", () => {
    for (const value of [12663.07, -81550.44, 850, 0.5]) {
      expect(parseBrNumber(formatBrNumberForInput(value))).toBe(value)
    }
  })

  it("sem valor: campo vazio", () => {
    expect(formatBrNumberForInput(undefined)).toBe("")
  })
})

describe("parseExpressao (campo que aceita conta)", () => {
  it("um campo menos outro, como vem em muito balanço", () => {
    expect(parseExpressao("4.133.297,81 - 3.152.704,65")).toBe(980593.16)
    expect(parseExpressao("1.000 + 250,5")).toBe(1250.5)
    expect(parseExpressao("100 - 30 - 20")).toBe(50)
  })

  it("número sozinho, negativo com sinal ou entre parênteses", () => {
    expect(parseExpressao("12.663.067,45")).toBe(12663067.45)
    expect(parseExpressao("-500")).toBe(-500)
    expect(parseExpressao("(1.200,00)")).toBe(-1200)
    expect(parseExpressao("5.000 - (200)")).toBe(5200)
  })

  it("vazio ou texto inválido: null", () => {
    expect(parseExpressao("")).toBeNull()
    expect(parseExpressao("abc")).toBeNull()
    expect(parseExpressao("10 * 2")).toBeNull()
    expect(parseExpressao("10 -")).toBeNull()
    expect(parseExpressao("1,2,3")).toBeNull()
  })
})
