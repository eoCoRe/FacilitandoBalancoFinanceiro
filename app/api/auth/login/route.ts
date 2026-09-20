import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { clientIp } from "@/lib/server/auth/client-ip"
import { handleRouteError } from "@/lib/server/http"
import { logEvent } from "@/lib/server/log"
import { issueSession } from "@/lib/server/auth/login-session"
import { PASSWORD_MAX_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/server/auth/password"
import { clearFailures, isRateLimited, recordFailure, releaseAttempt, reserveAttempt } from "@/lib/server/auth/rate-limit"
import { TOTP_CHALLENGE } from "@/lib/server/auth/second-factor"
import {
  isTwoFactorRequired,
  sendLoginCode,
  setTwoFactorCookie,
  signTwoFactorToken,
  TWO_FACTOR_CHALLENGE_KEY,
  TWO_FACTOR_CHALLENGE_MAX,
} from "@/lib/server/auth/two-factor"
import { requireEmail, TooManyRequestsError, UnauthorizedError, ValidationError } from "@/lib/server/validation"

const IP_MAX_FAILURES = 20

// Login com e-mail e senha. Todas as falhas (e-mail inexistente, senha errada, conta
// desativada, conta só-Google) devolvem a MESMA mensagem e gastam o mesmo tempo, para a
// resposta não revelar quais e-mails estão cadastrados.
//
// Com verificação em 2 etapas (escolha do usuário ou exigência do perfil), acertar a senha NÃO
// cria a sessão: responde `{ segundoFator: true, metodo }` e guarda só um cookie temporário; a
// sessão nasce em /api/auth/2fa/verificar. Com o app autenticador ligado (`metodo: "app"`) o código
// vem do celular; senão (`metodo: "email"`) é enviado por e-mail.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; senha?: unknown }
    const email = requireEmail(body.email)
    const senha = body.senha
    if (typeof senha !== "string" || !senha || senha.length > PASSWORD_MAX_LENGTH) {
      throw new ValidationError("Informe e-mail e senha.")
    }

    const emailKey = `login:email:${email}`
    const ipKey = `login:ip:${clientIp(request)}`
    // A tentativa é RESERVADA antes de conferir a senha (assíncrono): uma rajada paralela não passa toda pela
    // checagem antes de a primeira falha ser contada.
    const emailReserved = reserveAttempt(emailKey)
    const ipReserved = emailReserved && reserveAttempt(ipKey, IP_MAX_FAILURES)
    if (!emailReserved || !ipReserved) {
      if (emailReserved) releaseAttempt(emailKey)
      logEvent("warn", "auth.login.rate_limited", { email, ip: clientIp(request) })
      throw new TooManyRequestsError("Muitas tentativas de login. Aguarde 15 minutos e tente novamente.")
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } })
    const senhaConfere = usuario?.senhaHash
      ? await verifyPassword(senha, usuario.senhaHash)
      : await verifyAgainstDummy(senha)

    if (!usuario || !usuario.ativo || !senhaConfere) {
      logEvent("warn", "auth.login.failed", { email, ip: clientIp(request) })
      // Só registra na auditoria tentativa contra e-mail existente: o limite por e-mail já
      // limita isso, e e-mails inventados não devem poder encher a trilha.
      if (usuario) await logAuditSafe("Login recusado", "Senha incorreta ou conta desativada.", usuario.email)
      throw new UnauthorizedError("E-mail ou senha inválidos.")
    }

    // Acertou: zera as falhas deste e-mail e devolve a reserva do IP (o contador do IP é compartilhado por quem
    // usa a mesma rede — entradas corretas não devem esgotá-lo).
    clearFailures(emailKey)
    releaseAttempt(ipKey)

    if (await isTwoFactorRequired(usuario)) {
      if (usuario.totpAtivo) {
        const response = NextResponse.json({ segundoFator: true, metodo: "app" })
        setTwoFactorCookie(response, await signTwoFactorToken(usuario.id, TOTP_CHALLENGE))
        return response
      }
      const challengeKey = TWO_FACTOR_CHALLENGE_KEY(usuario.id)
      if (isRateLimited(challengeKey, TWO_FACTOR_CHALLENGE_MAX)) {
        throw new TooManyRequestsError("Muitos códigos solicitados. Aguarde 15 minutos e tente novamente.")
      }
      if (!recordFailure(challengeKey)) {
        throw new TooManyRequestsError("Muitos códigos solicitados. Aguarde 15 minutos e tente novamente.")
      }
      const challengeId = await sendLoginCode(usuario)
      const response = NextResponse.json({ segundoFator: true, metodo: "email" })
      setTwoFactorCookie(response, await signTwoFactorToken(usuario.id, challengeId))
      return response
    }

    return await issueSession(usuario, "Entrada com e-mail e senha.")
  } catch (error) {
    return handleRouteError(error)
  }
}
