import { jwtVerify, SignJWT } from "jose"
import { ServiceUnavailableError } from "@/lib/server/validation"
import type { NextResponse } from "next/server"

// Sessão sem estado no servidor: um JWT assinado (HS256) num cookie httpOnly. O token só
// diz QUEM é (id do usuário); perfil e situação (ativo, sessão ainda válida) são lidos do
// banco a cada requisição em current-user.ts — assim desativar alguém ou mudar o perfil
// vale na hora, não só quando o token expirar.

export const SESSION_COOKIE = "cb_session"
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

// Renovação deslizante: quem está USANDO o sistema não é deslogado no meio do expediente. Depois de metade da vida
// do token (4 h), o próximo acesso reemite o cookie por mais 8 h. Mas a sessão tem um TETO absoluto contado desde o
// login de verdade (`at` no token, que a renovação preserva): passou de 24 h, só entrando de novo.
export const SESSION_RENEW_AFTER_SECONDS = SESSION_MAX_AGE_SECONDS / 2
export const SESSION_ABSOLUTE_MAX_SECONDS = 24 * 60 * 60

// Fail-closed: sem segredo forte configurado, nenhuma sessão é emitida nem aceita. Lido sob
// demanda (não na importação) para o `next build` não exigir o segredo.
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    // ServiceUnavailableError: as rotas respondem 503 com a causa (como o proxy faz nas páginas), em vez de um 500 opaco.
    throw new ServiceUnavailableError("AUTH_SECRET ausente ou curta (mínimo 32 caracteres) — veja .env.example")
  }
  return new TextEncoder().encode(secret)
}

// `authTime` = quando a pessoa REALMENTE fez login (segundos). Login novo: agora. Renovação: o valor original.
export async function signSessionToken(userId: number, authTime: number = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ at: authTime })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret())
}

export interface VerifiedSession {
  userId: number
  issuedAt: number // segundos desde a época (da EMISSÃO deste token, que a renovação atualiza)
  authTime: number // segundos desde a época do login original (não muda na renovação)
}

// Devolve null para qualquer token inválido (assinatura, expiração, formato) — quem chama
// não precisa distinguir o motivo. Erro de CONFIGURAÇÃO (segredo ausente) não é engolido.
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  const secret = getAuthSecret()
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] })
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0 || typeof payload.iat !== "number") return null
    // Token antigo, sem `at`: vale o momento da emissão.
    const authTime = typeof payload.at === "number" ? payload.at : payload.iat
    return { userId, issuedAt: payload.iat, authTime }
  } catch {
    return null
  }
}

// Atributos do cookie de sessão — um lugar só, usado no login e na renovação.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Lax: o cookie não acompanha POST vindo de outro site (proteção contra CSRF) mas
    // sobrevive ao redirecionamento de volta do Google.
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
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
