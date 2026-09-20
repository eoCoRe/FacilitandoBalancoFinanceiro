import { afterEach, describe, expect, it, vi } from "vitest"
import { appOrigin, publicOrigin } from "./app-url"
import { ServiceUnavailableError } from "./validation"

const req = new Request("http://host-forjado.example/api/x")

afterEach(() => vi.unstubAllEnvs())

describe("publicOrigin (links enviados por e-mail)", () => {
  it("usa APP_URL, sem barra final, ignorando o Host da requisição", () => {
    vi.stubEnv("APP_URL", "https://app.exemplo.com/")
    expect(publicOrigin(req)).toBe("https://app.exemplo.com")
  })

  it("em produção sem APP_URL: falha fechado (nunca usa o Host)", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_URL", "")
    expect(() => publicOrigin(req)).toThrow(ServiceUnavailableError)
  })

  it("em desenvolvimento sem APP_URL: cai para a origem da requisição", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_URL", "")
    expect(publicOrigin(req)).toBe("http://host-forjado.example")
  })
})

describe("appOrigin (redirecionamentos no mesmo site)", () => {
  it("sem APP_URL usa a origem da requisição, mesmo em produção (não vaza nada para terceiros)", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_URL", "")
    expect(appOrigin(req)).toBe("http://host-forjado.example")
  })

  it("com APP_URL usa APP_URL", () => {
    vi.stubEnv("APP_URL", "https://app.exemplo.com")
    expect(appOrigin(req)).toBe("https://app.exemplo.com")
  })
})
