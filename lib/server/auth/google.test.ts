import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  appOrigin,
  buildGoogleAuthUrl,
  exchangeCodeForIdToken,
  googleConfig,
  googleRedirectUri,
  newOAuthFlow,
  pkceChallenge,
  signOAuthFlow,
  verifyOAuthFlow,
} from "@/lib/server/auth/google"

beforeEach(() => vi.stubEnv("AUTH_SECRET", "g".repeat(40)))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("PKCE", () => {
  it("calcula o code_challenge S256 (vetor de teste da RFC 7636, Apêndice B)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    )
  })

  it("cada fluxo tem state, verifier e nonce próprios e imprevisíveis", () => {
    const a = newOAuthFlow()
    const b = newOAuthFlow()
    expect(a.state).not.toBe(b.state)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
    expect(new Set([a.state, a.verifier, a.nonce]).size).toBe(3)
  })
})

describe("cookie do fluxo", () => {
  it("ida e volta", async () => {
    const flow = newOAuthFlow()
    expect(await verifyOAuthFlow(await signOAuthFlow(flow))).toEqual(flow)
  })

  it("recusa cookie adulterado", async () => {
    const token = await signOAuthFlow(newOAuthFlow())
    expect(await verifyOAuthFlow(token.slice(0, -2) + "xx")).toBeNull()
    expect(await verifyOAuthFlow("lixo")).toBeNull()
  })
})

describe("URL de autorização", () => {
  it("leva state, nonce e o desafio PKCE S256, nunca o verifier", () => {
    const flow = newOAuthFlow()
    const url = new URL(
      buildGoogleAuthUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/auth/google/callback", flow }),
    )
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("state")).toBe(flow.state)
    expect(url.searchParams.get("nonce")).toBe(flow.nonce)
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(flow.verifier))
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toBe("openid email profile")
    expect(url.toString()).not.toContain(flow.verifier)
  })
})

describe("configuração", () => {
  it("só habilita com as duas credenciais", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id")
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "")
    expect(googleConfig()).toBeNull()
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "segredo")
    expect(googleConfig()).toEqual({ clientId: "id", clientSecret: "segredo" })
  })

  it("o redirect_uri vem de APP_URL, não do Host da requisição", () => {
    vi.stubEnv("APP_URL", "https://app.exemplo.com/")
    const req = new Request("http://evil.example/api/auth/google")
    expect(appOrigin(req)).toBe("https://app.exemplo.com")
    expect(googleRedirectUri(req)).toBe("https://app.exemplo.com/api/auth/google/callback")
  })
})

describe("exchangeCodeForIdToken", () => {
  const params = { code: "c", verifier: "v", clientId: "cid", clientSecret: "sec", redirectUri: "http://x/cb" }

  it("envia o code_verifier e devolve o id_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "TOKEN" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await exchangeCodeForIdToken(params)).toBe("TOKEN")
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get("code_verifier")).toBe("v")
    expect(body.get("grant_type")).toBe("authorization_code")
  })

  it("lança se o Google recusar ou não devolver id_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })))
    await expect(exchangeCodeForIdToken(params)).rejects.toThrow(/recusou/)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))
    await expect(exchangeCodeForIdToken(params)).rejects.toThrow(/id_token/)
  })
})
