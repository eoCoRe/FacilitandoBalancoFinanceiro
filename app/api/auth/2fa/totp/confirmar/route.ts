import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { clearFailures, reserveAttempt } from "@/lib/server/auth/rate-limit"
import { confirmTotpEnrollment, TOTP_ENROLL_KEY } from "@/lib/server/auth/second-factor"
import { TooManyRequestsError, ValidationError } from "@/lib/server/validation"

// Passo 2: o primeiro código do app prova que ele foi cadastrado direito; só então o app autenticador
// passa a ser exigido no login. Devolve os códigos de recuperação — esta é a única vez que aparecem.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { codigo?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (usuario.totpAtivo) throw new ValidationError("O aplicativo autenticador já está ligado.")
    if (!usuario.totpSegredo) throw new ValidationError("Comece o cadastro do aplicativo primeiro.")

    const key = TOTP_ENROLL_KEY(usuario.id)
    // Reserva a tentativa antes de conferir (uma rajada paralela não passa toda pela checagem).
    if (!reserveAttempt(key)) throw new TooManyRequestsError("Muitas tentativas incorretas. Aguarde 15 minutos.")

    const codigosRecuperacao = await confirmTotpEnrollment(usuario, body.codigo)
    if (!codigosRecuperacao) {
      throw new ValidationError("Código incorreto. Confira a hora do celular e tente o código atual do aplicativo.")
    }
    clearFailures(key)

    // "Safe": o app JÁ está ligado e os códigos de recuperação só aparecem nesta resposta — uma falha da auditoria não
    // pode escondê-los (a pessoa ficaria com o 2FA ligado, sem os códigos, e a nova tentativa diria "já ligado").
    await logAuditSafe("App autenticador ativado", "Verificação em 2 etapas por aplicativo ligada.", user.email)
    return NextResponse.json({ ok: true, codigosRecuperacao })
  } catch (error) {
    return handleRouteError(error)
  }
}
