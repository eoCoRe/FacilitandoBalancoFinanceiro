import type { Usuario } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { codeCheckMessage } from "@/lib/server/auth/code-messages"
import { handleRouteError } from "@/lib/server/http"
import { logEvent } from "@/lib/server/log"
import { issueSession } from "@/lib/server/auth/login-session"
import { clearFailures, isRateLimited, recordFailure } from "@/lib/server/auth/rate-limit"
import { checkLoginCode, TOTP_CHALLENGE, TOTP_LOGIN_KEY } from "@/lib/server/auth/second-factor"
import { clearTwoFactorCookie, TWO_FACTOR_CHALLENGE_KEY, TWO_FACTOR_COOKIE, verifyTwoFactorToken } from "@/lib/server/auth/two-factor"
import { TooManyRequestsError, UnauthorizedError } from "@/lib/server/validation"
import { checkCode } from "@/lib/server/auth/verification"

const EXPIRED = "A verificação expirou. Entre novamente com a sua senha."

// Segundo passo do login: confere o código (do e-mail, ou do app autenticador / de recuperação).
// Só aqui nasce a sessão de quem usa 2 etapas. O usuário vem do cookie assinado do passo 1 (não do
// corpo), então não dá para tentar o código de outra pessoa.
export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(TWO_FACTOR_COOKIE)?.value
    const pending = cookie ? await verifyTwoFactorToken(cookie) : null
    if (!pending) throw new UnauthorizedError(EXPIRED)

    const body = (await request.json()) as { codigo?: unknown }

    // A conta pode ter sido desativada — ou ter passado a exigir o app — entre a senha e o código.
    const usuario = await prisma.usuario.findUnique({ where: { id: pending.userId } })
    if (!usuario || !usuario.ativo) throw new UnauthorizedError(EXPIRED)

    if (pending.challengeId === TOTP_CHALLENGE) {
      if (!usuario.totpAtivo) throw new UnauthorizedError(EXPIRED)
      return await verifyAppCode(usuario, body.codigo)
    }
    // Cookie de um login por e-mail, mas a conta ligou o app depois: o e-mail não basta mais.
    if (usuario.totpAtivo) throw new UnauthorizedError(EXPIRED)

    const resultado = await checkCode(pending.challengeId, pending.userId, "LOGIN_2FA", body.codigo)

    if (resultado !== "ok") {
      if (resultado === "bloqueado") {
        await logAuditSafe("Verificação em 2 etapas bloqueada", "Tentativas de código esgotadas.", usuario.email)
        logEvent("warn", "auth.2fa.blocked", { email: usuario.email })
      }
      // Bloqueado: o desafio não serve mais, então o cookie também é descartado.
      const response = NextResponse.json({ error: codeCheckMessage(resultado, "login") }, { status: 401 })
      if (resultado === "bloqueado") clearTwoFactorCookie(response)
      return response
    }

    // Login concluído: o teto de desafios é contra quem pede códigos e NUNCA os usa, não contra quem entra.
    clearFailures(TWO_FACTOR_CHALLENGE_KEY(usuario.id))
    const response = await issueSession(usuario, "Entrada com e-mail, senha e código de verificação.")
    clearTwoFactorCookie(response)
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}

// App autenticador (6 dígitos) ou código de recuperação. Não há desafio no banco para limitar as
// tentativas, então o limite é por usuário (5 erros a cada 15 min) — reentrar com a senha não zera.
async function verifyAppCode(usuario: Usuario, codigo: unknown): Promise<NextResponse> {
  const key = TOTP_LOGIN_KEY(usuario.id)
  if (isRateLimited(key)) {
    throw new TooManyRequestsError("Muitas tentativas incorretas. Aguarde 15 minutos e entre novamente com a sua senha.")
  }

  const resultado = await checkLoginCode(usuario, codigo)
  if (!resultado.ok) {
    recordFailure(key)
    if (isRateLimited(key)) {
      await logAuditSafe("Verificação em 2 etapas bloqueada", "Tentativas de código do aplicativo esgotadas.", usuario.email)
      logEvent("warn", "auth.2fa.blocked", { email: usuario.email })
      const response = NextResponse.json(
        { error: "Muitas tentativas incorretas. Aguarde 15 minutos e entre novamente com a sua senha." },
        { status: 401 },
      )
      clearTwoFactorCookie(response)
      return response
    }
    return NextResponse.json({ error: "Código incorreto." }, { status: 401 })
  }
  clearFailures(key)

  if (resultado.via === "recuperacao") {
    await logAuditSafe("Código de recuperação usado", `Restam ${resultado.restantes} código(s) de recuperação.`, usuario.email)
  }
  const response = await issueSession(
    usuario,
    resultado.via === "app"
      ? "Entrada com e-mail, senha e aplicativo autenticador."
      : "Entrada com e-mail, senha e código de recuperação.",
  )
  clearTwoFactorCookie(response)
  return response
}
