import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { handleRouteError } from "@/lib/server/http"
import { issueSession } from "@/lib/server/login-session"
import { PASSWORD_MAX_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/server/password"
import { clearFailures, isRateLimited, recordFailure } from "@/lib/server/rate-limit"
import {
  isTwoFactorRequired,
  sendLoginCode,
  setTwoFactorCookie,
  signTwoFactorToken,
  TWO_FACTOR_CHALLENGE_MAX,
} from "@/lib/server/two-factor"
import { requireEmail, TooManyRequestsError, UnauthorizedError, ValidationError } from "@/lib/server/validation"

const IP_MAX_FAILURES = 20

// Sem proxy reverso confiável o cabeçalho pode ser forjado; por isso o limite por e-mail é o
// que de fato protege uma conta, e o por IP é só uma segunda camada contra varredura de e-mails.
function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido"
}

// Login com e-mail e senha. Todas as falhas (e-mail inexistente, senha errada, conta
// desativada, conta só-Google) devolvem a MESMA mensagem e gastam o mesmo tempo, para a
// resposta não revelar quais e-mails estão cadastrados.
//
// Com verificação em 2 etapas (escolha do usuário ou exigência do perfil), acertar a senha NÃO
// cria a sessão: responde `{ segundoFator: true }`, envia o código por e-mail e guarda só um
// cookie temporário; a sessão nasce em /api/auth/2fa/verificar.
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
    if (isRateLimited(emailKey) || isRateLimited(ipKey, IP_MAX_FAILURES)) {
      throw new TooManyRequestsError("Muitas tentativas de login. Aguarde 15 minutos e tente novamente.")
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } })
    const senhaConfere = usuario?.senhaHash
      ? await verifyPassword(senha, usuario.senhaHash)
      : await verifyAgainstDummy(senha)

    if (!usuario || !usuario.ativo || !senhaConfere) {
      recordFailure(emailKey)
      recordFailure(ipKey)
      // Só registra na auditoria tentativa contra e-mail existente: o limite por e-mail já
      // limita isso, e e-mails inventados não devem poder encher a trilha.
      if (usuario) await logAuditSafe("Login recusado", "Senha incorreta ou conta desativada.", usuario.email)
      throw new UnauthorizedError("E-mail ou senha inválidos.")
    }

    clearFailures(emailKey)

    if (await isTwoFactorRequired(usuario)) {
      const challengeKey = `2fa:login:${usuario.id}`
      if (isRateLimited(challengeKey, TWO_FACTOR_CHALLENGE_MAX)) {
        throw new TooManyRequestsError("Muitos códigos solicitados. Aguarde 15 minutos e tente novamente.")
      }
      recordFailure(challengeKey)
      const challengeId = await sendLoginCode(usuario)
      const response = NextResponse.json({ segundoFator: true })
      setTwoFactorCookie(response, await signTwoFactorToken(usuario.id, challengeId))
      return response
    }

    return await issueSession(usuario, "Entrada com e-mail e senha.")
  } catch (error) {
    return handleRouteError(error)
  }
}
