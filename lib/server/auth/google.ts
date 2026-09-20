import { createHash, randomBytes } from "node:crypto"
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose"
import { appOrigin } from "@/lib/server/auth/app-url"
import { getAuthSecret } from "@/lib/server/auth/session"

// Login com Google (OpenID Connect, fluxo authorization code + PKCE). Não há auto-cadastro:
// o e-mail do Google só entra se um administrador já cadastrou esse e-mail (ver o callback).

export const OAUTH_COOKIE = "cb_oauth"
export const OAUTH_MAX_AGE_SECONDS = 10 * 60
export const OAUTH_COOKIE_PATH = "/api/auth/google"

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

// Só habilita o botão "Entrar com Google" se as duas credenciais existirem.
export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export { appOrigin }

export function googleRedirectUri(request: Request): string {
  return `${appOrigin(request)}/api/auth/google/callback`
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url")
}

export interface OAuthFlow {
  state: string // amarra a resposta ao navegador que iniciou o login (anti-CSRF)
  verifier: string // PKCE: segredo que só quem iniciou conhece
  nonce: string // amarra o id_token a este login (anti-replay)
}

export function newOAuthFlow(): OAuthFlow {
  return {
    state: base64url(randomBytes(32)),
    verifier: base64url(randomBytes(48)),
    nonce: base64url(randomBytes(32)),
  }
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest())
}

// O estado do fluxo vai num cookie assinado (não há sessão ainda para guardá-lo).
export async function signOAuthFlow(flow: OAuthFlow): Promise<string> {
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret())
}

export async function verifyOAuthFlow(token: string): Promise<OAuthFlow | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), { algorithms: ["HS256"] })
    const { state, verifier, nonce } = payload as Partial<OAuthFlow>
    if (typeof state !== "string" || typeof verifier !== "string" || typeof nonce !== "string") return null
    return { state, verifier, nonce }
  } catch {
    return null
  }
}

export function buildGoogleAuthUrl(params: { clientId: string; redirectUri: string; flow: OAuthFlow }): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", params.flow.state)
  url.searchParams.set("nonce", params.flow.nonce)
  url.searchParams.set("code_challenge", pkceChallenge(params.flow.verifier))
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("prompt", "select_account")
  return url.toString()
}

export async function exchangeCodeForIdToken(params: {
  code: string
  verifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.verifier,
    }),
  })
  if (!response.ok) throw new Error(`Google recusou a troca do código (HTTP ${response.status}).`)
  const body = (await response.json()) as { id_token?: unknown }
  if (typeof body.id_token !== "string") throw new Error("Resposta do Google sem id_token.")
  return body.id_token
}

export interface GoogleProfile {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
}

const jwks = createRemoteJWKSet(new URL(JWKS_URL))

// Valida assinatura (chaves públicas do Google), emissor, público (nosso client id), validade
// e o nonce — só então o conteúdo do token é confiável.
export async function verifyGoogleIdToken(idToken: string, clientId: string, nonce: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUERS, audience: clientId })
  if (payload.nonce !== nonce) throw new Error("nonce do id_token não confere.")
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new Error("id_token sem sub/email.")
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : null,
  }
}
