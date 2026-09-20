import { describe, expect, it } from "vitest"
import { safeEqual } from "./safe-equal"

describe("safeEqual", () => {
  it("iguais: true; diferentes (mesmo tamanho ou não): false", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true)
    expect(safeEqual("abc123", "abc124")).toBe(false)
    expect(safeEqual("abc", "abc123")).toBe(false)
    expect(safeEqual("", "")).toBe(true)
  })

  it("null e undefined nunca são iguais a nada", () => {
    expect(safeEqual(null, "")).toBe(false)
    expect(safeEqual(undefined, "x")).toBe(false)
  })

  it("compara bytes, não caracteres: 'é' (2 bytes) não é igual a 'e'", () => {
    expect(safeEqual("é", "e")).toBe(false)
    expect(safeEqual("é", "é")).toBe(true)
  })
})
