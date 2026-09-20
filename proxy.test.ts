import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { config, proxy } from "./proxy"
import { SESSION_COOKIE, signSessionToken } from "@/lib/server/auth/session"

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${path}`, init)

beforeEach(() => vi.stubEnv("AUTH_SECRET", "p".repeat(40)))
afterEach(() => vi.unstubAllEnvs())

describe("proxy: /api (só recusa mutação de outra origem, não olha a sessão)", () => {
  it("mutação vinda de outro site: 403 sem chegar na rota, sem cache", async () => {
    const response = await proxy(req("/api/valores", { method: "PUT", headers: { "sec-fetch-site": "cross-site" } }))
    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "Requisição de outra origem recusada." })
  })

  it("mutação de um subdomínio do mesmo site (same-site) também", async () => {
    expect((await proxy(req("/api/auth/logout", { method: "POST", headers: { "sec-fetch-site": "same-site" } }))).status).toBe(403)
  })

  it("mutação do próprio app passa (o proxy não redireciona API para /login: quem responde 401 é a rota)", async () => {
    const response = await proxy(req("/api/valores", { method: "PUT", headers: { "sec-fetch-site": "same-origin" } }))
    expect(response.status).toBe(200) // NextResponse.next()
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("leitura (GET) de outro site passa por aqui — a rota exige a sessão de qualquer jeito", async () => {
    expect((await proxy(req("/api/empresa", { headers: { "sec-fetch-site": "cross-site" } }))).headers.get("x-middleware-next")).toBe("1")
  })

  it("curl/teste de fumaça (sem cabeçalhos de navegador) passa", async () => {
    expect((await proxy(req("/api/auth/login", { method: "POST" }))).headers.get("x-middleware-next")).toBe("1")
  })
})

describe("proxy: páginas", () => {
  it("sem sessão vai para /login; a página de login é livre", async () => {
    const semSessao = await proxy(req("/"))
    expect(semSessao.status).toBe(307)
    expect(new URL(semSessao.headers.get("location")!).pathname).toBe("/login")
    expect((await proxy(req("/login"))).headers.get("x-middleware-next")).toBe("1")
  })

  it("com sessão válida, /login manda para a raiz", async () => {
    const token = await signSessionToken(1)
    const response = await proxy(req("/login", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))
    expect(new URL(response.headers.get("location")!).pathname).toBe("/")
  })

  it("sem AUTH_SECRET: falha fechada com 503", async () => {
    vi.stubEnv("AUTH_SECRET", "")
    const response = await proxy(req("/", { headers: { cookie: `${SESSION_COOKIE}=qualquer` } }))
    expect(response.status).toBe(503)
  })
})

describe("matcher", () => {
  it("cobre /api e as páginas, e deixa de fora arquivos estáticos", () => {
    expect(config.matcher).toContain("/api/:path*")
    const paginas = new RegExp(`^${config.matcher[1]}$`)
    expect(paginas.test("/")).toBe(true)
    expect(paginas.test("/esqueci-senha")).toBe(true)
    expect(paginas.test("/_next/static/chunk.js")).toBe(false)
    expect(paginas.test("/favicon.ico")).toBe(false)
  })
})
