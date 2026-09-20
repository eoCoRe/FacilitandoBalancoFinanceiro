import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, google } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn(), update: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  google: { exchangeCodeForIdToken: vi.fn(), verifyGoogleIdToken: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma }))
// Só a parte que fala com o Google é trocada; state/PKCE/cookie assinado rodam de verdade.
vi.mock("@/lib/server/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/google")>()),
  exchangeCodeForIdToken: google.exchangeCodeForIdToken,
  verifyGoogleIdToken: google.verifyGoogleIdToken,
}))

import { newOAuthFlow, signOAuthFlow } from "@/lib/server/google"
import { GET } from "./route"

const flow = newOAuthFlow()

async function callback(query: Record<string, string>, opts: { cookie?: boolean; state?: string } = {}) {
  const url = new URL("http://localhost:3000/api/auth/google/callback")
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (opts.cookie !== false) headers.cookie = `cb_oauth=${await signOAuthFlow(flow)}`
  return GET(new NextRequest(url, { headers }))
}

const location = (response: Response) => response.headers.get("location")!
const perfil = (over = {}) => ({ sub: "g-123", email: "ana@teste.com", emailVerified: true, name: "Ana", ...over })
const usuario = (over = {}) => ({ id: 5, email: "ana@teste.com", ativo: true, googleSub: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", "c".repeat(40))
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid")
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "csecret")
  vi.stubEnv("APP_URL", "http://localhost:3000")
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  google.exchangeCodeForIdToken.mockResolvedValue("ID_TOKEN")
  google.verifyGoogleIdToken.mockResolvedValue(perfil())
  prisma.usuario.findUnique.mockResolvedValue(usuario())
})
afterEach(() => vi.unstubAllEnvs())

describe("GET /api/auth/google/callback", () => {
  it("usuário cadastrado: cria a sessão, vincula o googleSub e volta para o app", async () => {
    const response = await callback({ code: "abc", state: flow.state })

    expect(location(response)).toBe("http://localhost:3000/")
    expect(response.headers.getSetCookie().join(";")).toMatch(/cb_session=[^;]+/)
    expect(prisma.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ googleSub: "g-123" }) }),
    )
    expect(google.exchangeCodeForIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", verifier: flow.verifier }),
    )
    expect(google.verifyGoogleIdToken).toHaveBeenCalledWith("ID_TOKEN", "cid", flow.nonce)
  })

  it("state diferente do que o navegador iniciou: recusa, sem falar com o Google", async () => {
    const response = await callback({ code: "abc", state: "outro-state" })
    expect(location(response)).toContain("/login?erro=google_falhou")
    expect(google.exchangeCodeForIdToken).not.toHaveBeenCalled()
  })

  it("sem o cookie do fluxo (login iniciado em outro lugar): recusa", async () => {
    const response = await callback({ code: "abc", state: flow.state }, { cookie: false })
    expect(location(response)).toContain("erro=google_falhou")
    expect(google.exchangeCodeForIdToken).not.toHaveBeenCalled()
  })

  it("usuário negou o acesso no Google", async () => {
    const response = await callback({ error: "access_denied" })
    expect(location(response)).toContain("erro=google_negado")
  })

  it("e-mail Google não cadastrado: sem auto-cadastro, não entra", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toContain("erro=google_sem_cadastro")
    expect(response.headers.getSetCookie().join(";")).not.toMatch(/cb_session=[^;]/)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("e-mail não verificado pelo Google: não entra", async () => {
    google.verifyGoogleIdToken.mockResolvedValue(perfil({ emailVerified: false }))
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toContain("erro=google_email_nao_verificado")
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("conta desativada: não entra", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ ativo: false }))
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toContain("erro=conta_inativa")
  })

  it("mesmo e-mail, mas já vinculado a OUTRA conta Google: não sobrescreve o vínculo nem entra", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ googleSub: "g-de-outra-pessoa" }))
    // a busca por googleSub não acha ninguém; a por e-mail acha o usuário já vinculado a outro sub
    prisma.usuario.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(usuario({ googleSub: "g-de-outra-pessoa" }))
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toContain("erro=google_falhou")
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("token do Google inválido (assinatura/nonce): falha sem vazar o motivo na URL", async () => {
    google.verifyGoogleIdToken.mockRejectedValue(new Error("nonce do id_token não confere."))
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toBe("http://localhost:3000/login?erro=google_falhou")
  })

  it("sem credenciais do Google configuradas: indisponível", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "")
    const response = await callback({ code: "abc", state: flow.state })
    expect(location(response)).toContain("erro=google_indisponivel")
  })
})
