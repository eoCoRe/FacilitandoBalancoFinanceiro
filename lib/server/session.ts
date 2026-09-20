import { jwtVerify, SignJWT } from "jose"
import type { NextResponse } from "next/server"

// Sessão sem estado no servidor: um JWT assinado (HS256) num cookie httpOnly. O token só
// diz QUEM é (id do usuário); perfil e situação (ativo, sessão ainda válida) são lidos do
// banco a cada requisição em current-user.ts — assim desativar alguém ou mudar o perfil
// vale na hora, não só quando o token expirar.

export const SESSION_COOKIE = "cb_session"
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

// Fail-closed: sem segredo forte configurado, nenhuma sessão é emitida nem aceita. Lido sob
// demanda (não na importação) para o `next build` não exigir o segredo.
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curta (mínimo 32 caracteres) — veja .env.example")
  }
  return new TextEncoder().encode(secret)
}

export async function signSessionToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret())
}

export interface VerifiedSession {
  userId: number
  issuedAt: number // segundos desde a época
}

// Devolve null para qualquer token inválido (assinatura, expiração, formato) — quem chama
// não precisa distinguir o motivo. Erro de CONFIGURAÇÃO (segredo ausente) não é engolido.
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  const secret = getAuthSecret()
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] })
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0 || typeof payload.iat !== "number") return null
    return { userId, issuedAt: payload.iat }
  } catch {
    return null
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax: o cookie não acompanha POST vindo de outro site (proteção contra CSRF) mas
    // sobrevive ao redirecionamento de volta do Google.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}
