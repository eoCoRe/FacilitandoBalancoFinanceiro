import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireUser } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { mailAvailable, sendMail } from "@/lib/server/mail/mail"
import { activationCodeMail } from "@/lib/server/mail/mail-templates"
import { isRateLimited, recordFailure } from "@/lib/server/auth/rate-limit"
import { ServiceUnavailableError, TooManyRequestsError, ValidationError } from "@/lib/server/validation"
import { CODE_TTL_MS, createCodeChallenge } from "@/lib/server/auth/verification"

// Primeiro passo de LIGAR a verificação em 2 etapas: manda um código ao e-mail da conta. Só
// depois de o usuário digitá-lo (/api/auth/2fa/confirmar) o 2FA passa a valer — assim ninguém
// se tranca por ligar o recurso com um e-mail que não recebe mensagens.
export async function POST() {
  try {
    const user = await requireUser()
    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (usuario.doisFatoresAtivo) throw new ValidationError("A verificação em 2 etapas já está ligada.")
    if (!mailAvailable()) {
      throw new ServiceUnavailableError("O envio de e-mail não está configurado neste ambiente.")
    }

    const key = `2fa:ativar:${usuario.id}`
    if (isRateLimited(key, 3)) throw new TooManyRequestsError("Muitos códigos solicitados. Aguarde 15 minutos.")
    recordFailure(key)

    const { code } = await createCodeChallenge(usuario.id, "ATIVACAO_2FA")
    try {
      await sendMail(activationCodeMail(usuario.email, code, CODE_TTL_MS / 60_000))
    } catch (error) {
      console.error("Falha ao enviar código de ativação:", error instanceof Error ? error.message : error)
      throw new ServiceUnavailableError("Não foi possível enviar o código. Tente novamente em instantes.")
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
