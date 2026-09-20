import { describe, expect, it } from "vitest"
import { formatCnpj, isValidCnpj, onlyDigits } from "./cnpj"

describe("CNPJ", () => {
  it("aceita CNPJs válidos, com ou sem máscara", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true)
    expect(isValidCnpj("11222333000181")).toBe(true)
    expect(isValidCnpj("00.000.000/0001-91")).toBe(true) // Banco do Brasil
  })

  it("recusa dígito verificador errado, tamanho errado, repetidos e lixo", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false)
    expect(isValidCnpj("1122233300018")).toBe(false)
    expect(isValidCnpj("11111111111111")).toBe(false)
    expect(isValidCnpj("")).toBe(false)
    expect(isValidCnpj("abc")).toBe(false)
  })

  it("formata e extrai dígitos", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81")
    expect(formatCnpj("123")).toBe("123")
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181")
  })
})
