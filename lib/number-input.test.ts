import { describe, expect, it } from "vitest"
import { formatBrNumberForInput, parseBrNumber } from "./number-input"

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
