import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { codeCheckMessage } from "@/lib/server/code-messages"
import { handleRouteError } from "@/lib/server/http"
import { logEvent } from "@/lib/server/log"
import { issueSession } from "@/lib/server/login-session"
import { clearFailures } from "@/lib/server/rate-limit"
import { clearTwoFactorCookie, TWO_FACTOR_CHALLENGE_KEY, TWO_FACTOR_COOKIE, verifyTwoFactorToken } from "@/lib/server/two-factor"
import { UnauthorizedError } from "@/lib/server/validation"
import { checkCode } from "@/lib/server/verification"

// Segundo passo do login: confere o código enviado por e-mail. Só aqui nasce a sessão de quem
// usa 2 etapas. O usuário vem do cookie assinado do passo 1 (não do corpo), então não dá para
// tentar o código de outra pessoa.
export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(TWO_FACTOR_COOKIE)?.value
    const pending = cookie ? await verifyTwoFactorToken(cookie) : null
    if (!pending) throw new UnauthorizedError("A verificação expirou. Entre novamente com a sua senha.")

    const body = (await request.json()) as { codigo?: unknown }
    const resultado = await checkCode(pending.challengeId, pending.userId, "LOGIN_2FA", body.codigo)

    if (resultado !== "ok") {
      const usuario = await prisma.usuario.findUnique({ where: { id: pending.userId } })
      if (resultado === "bloqueado" && usuario) {
        await logAuditSafe("Verificação em 2 etapas bloqueada", "Tentativas de código esgotadas.", usuario.email)
        logEvent("warn", "auth.2fa.blocked", { email: usuario.email })
      }
      // Bloqueado: o desafio não serve mais, então o cookie também é descartado.
      const response = NextResponse.json({ error: codeCheckMessage(resultado, "login") }, { status: 401 })
      if (resultado === "bloqueado") clearTwoFactorCookie(response)
      return response
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: pending.userId } })
    // A conta pode ter sido desativada entre a senha e o código.
    if (!usuario || !usuario.ativo) throw new UnauthorizedError("A verificação expirou. Entre novamente com a sua senha.")

    // Login concluído: o teto de desafios é contra quem pede códigos e NUNCA os usa, não contra quem entra.
    clearFailures(TWO_FACTOR_CHALLENGE_KEY(usuario.id))
    const response = await issueSession(usuario, "Entrada com e-mail, senha e código de verificação.")
    clearTwoFactorCookie(response)
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
