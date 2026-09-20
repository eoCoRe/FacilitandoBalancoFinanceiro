import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { handleRouteError } from "@/lib/server/http"
import { PASSWORD_MAX_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/server/password"
import { clearFailures, isRateLimited, recordFailure } from "@/lib/server/rate-limit"
import { setSessionCookie, signSessionToken } from "@/lib/server/session"
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
    await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } })
    await logAuditSafe("Login realizado", "Entrada com e-mail e senha.", usuario.email)

    const response = NextResponse.json({
      user: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    })
    setSessionCookie(response, await signSessionToken(usuario.id))
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
