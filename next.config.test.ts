import { afterEach, describe, expect, it, vi } from "vitest"
import nextConfig from "./next.config.mjs"

type Rule = { source: string; headers: { key: string; value: string }[] }
const headersFor = async (source: string): Promise<Record<string, string>> => {
  const rules = (await nextConfig.headers!()) as Rule[]
  const rule = rules.find((r) => r.source === source)!
  return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))
}

afterEach(() => vi.unstubAllEnvs())

describe("cabeçalhos de segurança", () => {
  it("bloqueiam clickjacking, sniffing de tipo e vazamento de referrer", async () => {
    const h = await headersFor("/:path*")
    expect(h["X-Frame-Options"]).toBe("DENY")
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/)
  })

  it("a CSP proíbe iframes, objetos e conexões para fora do próprio domínio", async () => {
    const csp = (await headersFor("/:path*"))["Content-Security-Policy"]
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("worker-src 'self' blob:") // worker do pdfjs
  })

  it("em PRODUÇÃO a CSP não libera eval de JavaScript e liga o HSTS", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const h = await headersFor("/:path*")
    expect(h["Content-Security-Policy"]).not.toContain("'unsafe-eval'")
    expect(h["Content-Security-Policy"]).toContain("'wasm-unsafe-eval'")
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/)
  })

  it("em desenvolvimento libera eval (webpack) e NÃO liga o HSTS (forçaria https em localhost)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const h = await headersFor("/:path*")
    expect(h["Content-Security-Policy"]).toContain("'unsafe-eval'")
    expect(h["Strict-Transport-Security"]).toBeUndefined()
  })
})

describe("cache da API", () => {
  it("nenhuma resposta de /api/* pode ser guardada em cache", async () => {
    const h = await headersFor("/api/:path*")
    expect(h["Cache-Control"]).toMatch(/no-store/)
  })
})
