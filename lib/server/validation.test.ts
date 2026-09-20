import { describe, expect, it } from "vitest"
import {
  requireBoundedNumber,
  requireFiniteNumber,
  requireNonEmptyString,
  requirePositiveInt,
  requireRange,
  ValidationError,
} from "@/lib/server/validation"

describe("requireNonEmptyString", () => {
  it("retorna a string sem espaços nas pontas", () => {
    expect(requireNonEmptyString("  Ativo  ", "nome")).toBe("Ativo")
  })

  it("rejeita string vazia, só espaço, ou tipo errado", () => {
    expect(() => requireNonEmptyString("", "nome")).toThrow(ValidationError)
    expect(() => requireNonEmptyString("   ", "nome")).toThrow(ValidationError)
    expect(() => requireNonEmptyString(123, "nome")).toThrow(ValidationError)
  })

  it("rejeita string acima do limite de tamanho", () => {
    expect(() => requireNonEmptyString("a".repeat(201), "nome", 200)).toThrow(/máximo 200/)
  })
})

describe("requireFiniteNumber / requireBoundedNumber", () => {
  it("aceita número finito", () => {
    expect(requireFiniteNumber(42, "valor")).toBe(42)
  })

  it("rejeita NaN, Infinity e tipos não numéricos", () => {
    expect(() => requireFiniteNumber(Number.NaN, "valor")).toThrow(ValidationError)
    expect(() => requireFiniteNumber(Number.POSITIVE_INFINITY, "valor")).toThrow(ValidationError)
    expect(() => requireFiniteNumber("100", "valor")).toThrow(ValidationError)
  })

  it("rejeita valores fora do limite defensivo", () => {
    expect(() => requireBoundedNumber(1e13, "valor")).toThrow(ValidationError)
  })
})

describe("requirePositiveInt", () => {
  it("aceita inteiro positivo", () => {
    expect(requirePositiveInt(5, "paginaOrigem")).toBe(5)
  })

  it("rejeita zero, negativo e não inteiro", () => {
    expect(() => requirePositiveInt(0, "paginaOrigem")).toThrow(ValidationError)
    expect(() => requirePositiveInt(-1, "paginaOrigem")).toThrow(ValidationError)
    expect(() => requirePositiveInt(1.5, "paginaOrigem")).toThrow(ValidationError)
  })
})

describe("requireRange", () => {
  it("aceita valor dentro do intervalo, inclusive nas bordas", () => {
    expect(requireRange(0, "confianca", 0, 100)).toBe(0)
    expect(requireRange(100, "confianca", 0, 100)).toBe(100)
  })

  it("rejeita valor fora do intervalo", () => {
    expect(() => requireRange(101, "confianca", 0, 100)).toThrow(ValidationError)
    expect(() => requireRange(-1, "confianca", 0, 100)).toThrow(ValidationError)
  })
})
