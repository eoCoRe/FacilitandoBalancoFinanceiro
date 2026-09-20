import { jwtVerify, SignJWT } from "jose"
import type { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Papel } from "@/lib/permissions"
import { mailAvailable, sendMail } from "./mail"
import { loginCodeMail } from "./mail-templates"
import { getAuthSecret } from "./session"
import { ServiceUnavailableError } from "./validation"
import { CODE_TTL_MS, createCodeChallenge } from "./verification"

// Segundo fator no login: depois de acertar a senha, um código de 6 dígitos vai para o e-mail
// e só a confirmação dele cria a sessão. Entre os dois passos o navegador carrega apenas um
// cookie assinado (cb_2fa) dizendo "este usuário acertou a senha, aguardando o código".

export const TWO_FACTOR_COOKIE = "cb_2fa"
// O cookie só precisa ir para as rotas de autenticação, não para o resto do app.
export const TWO_FACTOR_COOKIE_PATH = "/api/auth"

// 5 desafios por usuário a cada 15 min: quem já sabe a senha não pode pedir códigos sem fim
// (cada um teria 5 tentativas) nem encher a caixa de e-mail da vítima.
export const TWO_FACTOR_CHALLENGE_MAX = 5
export const TWO_FACTOR_CHALLENGE_KEY = (userId: number) => `2fa:login:${userId}`

export async function isTwoFactorRequired(usuario: {
  doisFatoresAtivo: boolean
  totpAtivo: boolean
  papel: Papel
}): Promise<boolean> {
  if (usuario.doisFatoresAtivo || usuario.totpAtivo) return true
  const politica = await prisma.politicaSeguranca.findUnique({ where: { papel: usuario.papel } })
  return politica?.doisFatoresObrigatorio === true
}

// Cria o desafio e envia o código. Falha FECHADO: se o e-mail não puder ser enviado, o login não
// conclui — nunca se pula o segundo fator por defeito do envio.
export async function sendLoginCode(usuario: { id: number; email: string }): Promise<string> {
  if (!mailAvailable()) {
    throw new ServiceUnavailableError(
      "O envio de e-mail não está configurado, então não é possível concluir o login com verificação em 2 etapas. Fale com um administrador.",
    )
  }
  const { id, code } = await createCodeChallenge(usuario.id, "LOGIN_2FA")
  try {
    await sendMail(loginCodeMail(usuario.email, code, CODE_TTL_MS / 60_000))
  } catch (error) {
    console.error("Falha ao enviar código de 2 etapas:", error instanceof Error ? error.message : error)
    throw new ServiceUnavailableError("Não foi possível enviar o código de verificação. Tente novamente em instantes.")
  }
  return id
}

export async function signTwoFactorToken(userId: number, challengeId: string): Promise<string> {
  return new SignJWT({ cid: challengeId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${CODE_TTL_MS / 1000}s`)
    .sign(getAuthSecret())
}

export async function verifyTwoFactorToken(token: string): Promise<{ userId: number; challengeId: string } | null> {
  const secret = getAuthSecret()
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] })
    const userId = Number(payload.sub)
    if (!Number.isInteger(userId) || userId <= 0 || typeof payload.cid !== "string") return null
    return { userId, challengeId: payload.cid }
  } catch {
    return null
  }
}

export function setTwoFactorCookie(response: NextResponse, token: string): void {
  response.cookies.set(TWO_FACTOR_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: TWO_FACTOR_COOKIE_PATH,
    maxAge: CODE_TTL_MS / 1000,
  })
}

export function clearTwoFactorCookie(response: NextResponse): void {
  response.cookies.set(TWO_FACTOR_COOKIE, "", { path: TWO_FACTOR_COOKIE_PATH, maxAge: 0 })
}
