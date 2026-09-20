import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { afterResponse } from "@/lib/server/after-response"
import { publicOrigin } from "@/lib/server/auth/app-url"
import { clientIp } from "@/lib/server/auth/client-ip"
import { handleRouteError } from "@/lib/server/http"
import { mailAvailable, sendMail } from "@/lib/server/mail/mail"
import { resetPasswordMail } from "@/lib/server/mail/mail-templates"
import { isRateLimited, recordFailure } from "@/lib/server/auth/rate-limit"
import { requireEmail, ServiceUnavailableError, TooManyRequestsError } from "@/lib/server/validation"
import { createResetToken, RESET_TTL_MS } from "@/lib/server/auth/verification"

const EMAIL_MAX = 3
const IP_MAX = 10

// "Esqueci minha senha": manda um link de uso único por e-mail. A resposta é SEMPRE a mesma,
// exista ou não a conta — e o e-mail sai depois da resposta — para não revelar quem está
// cadastrado. Os pedidos contam para o limite mesmo quando o e-mail não existe, então o 429
// também não entrega nada.
export async function POST(request: Request) {
  try {
    if (!mailAvailable()) {
      throw new ServiceUnavailableError("A recuperação de senha não está disponível. Fale com um administrador.")
    }
    // Antes de tudo (igual para qualquer e-mail): em produção sem APP_URL o link seria montado com o Host
    // da requisição, que o atacante controla.
    const origin = publicOrigin(request)
    const body = (await request.json()) as { email?: unknown }
    const email = requireEmail(body.email)

    const emailKey = `reset:email:${email}`
    const ipKey = `reset:ip:${clientIp(request)}`
    if (isRateLimited(emailKey, EMAIL_MAX) || isRateLimited(ipKey, IP_MAX)) {
      throw new TooManyRequestsError("Muitos pedidos de recuperação. Aguarde 15 minutos e tente novamente.")
    }
    recordFailure(emailKey)
    recordFailure(ipKey)

    const usuario = await prisma.usuario.findUnique({ where: { email } })
    if (usuario?.ativo) {
      // Token e e-mail saem DEPOIS da resposta: o caminho síncrono é o mesmo (um SELECT) exista a
      // conta ou não, então nem o corpo nem o tempo de resposta revelam quem está cadastrado.
      afterResponse(async () => {
        const token = await createResetToken(usuario.id)
        const link = `${origin}/redefinir-senha?token=${encodeURIComponent(token)}`
        await sendMail(resetPasswordMail(usuario.email, link, RESET_TTL_MS / 60_000))
        await logAuditSafe("Recuperação de senha solicitada", "Link de redefinição enviado por e-mail.", usuario.email)
      })
    }

    return NextResponse.json({
      ok: true,
      mensagem: "Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha.",
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
