import { describe, expect, it } from "vitest"
import { isCrossOriginMutation } from "./csrf"

const h = (headers: Record<string, string>) => new Headers(headers)

describe("isCrossOriginMutation", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("%s nunca é barrado (não muda dados)", (metodo) => {
    expect(isCrossOriginMutation(metodo, h({ "sec-fetch-site": "cross-site" }))).toBe(false)
  })

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s vindo de outro SITE é barrado", (metodo) => {
    expect(isCrossOriginMutation(metodo, h({ "sec-fetch-site": "cross-site" }))).toBe(true)
  })

  it("vindo de um subdomínio/outro app do mesmo site (same-site) também é barrado — o cookie Lax iria junto", () => {
    expect(isCrossOriginMutation("POST", h({ "sec-fetch-site": "same-site" }))).toBe(true)
  })

  it("do próprio app (same-origin) e ação direta do usuário (none) passam", () => {
    expect(isCrossOriginMutation("POST", h({ "sec-fetch-site": "same-origin" }))).toBe(false)
    expect(isCrossOriginMutation("DELETE", h({ "sec-fetch-site": "none" }))).toBe(false)
  })

  it("o Sec-Fetch-Site vale mais que o Origin (o navegador não deixa a página forjá-lo)", () => {
    expect(isCrossOriginMutation("POST", h({ "sec-fetch-site": "cross-site", origin: "https://app.exemplo.com", host: "app.exemplo.com" }))).toBe(true)
  })

  describe("navegador sem Fetch Metadata: confere o Origin com o host", () => {
    it("Origin igual ao host passa", () => {
      expect(isCrossOriginMutation("POST", h({ origin: "https://app.exemplo.com", host: "app.exemplo.com" }))).toBe(false)
    })
    it("Origin de outro host é barrado", () => {
      expect(isCrossOriginMutation("POST", h({ origin: "https://evil.example", host: "app.exemplo.com" }))).toBe(true)
    })
    it("atrás de proxy usa o x-forwarded-host", () => {
      expect(isCrossOriginMutation("POST", h({ origin: "https://app.exemplo.com", host: "interno:3000", "x-forwarded-host": "app.exemplo.com" }))).toBe(false)
    })
    it("Origin ilegível ('null') ou sem host para comparar é barrado", () => {
      expect(isCrossOriginMutation("POST", h({ origin: "null", host: "app.exemplo.com" }))).toBe(true)
      expect(isCrossOriginMutation("POST", h({ origin: "https://app.exemplo.com" }))).toBe(true)
    })
  })

  it("sem nenhum dos dois cabeçalhos (curl, teste de fumaça, scripts) passa: não é um navegador sendo enganado", () => {
    expect(isCrossOriginMutation("POST", h({}))).toBe(false)
  })
})
