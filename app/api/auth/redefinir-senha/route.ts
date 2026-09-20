import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { clientIp } from "@/lib/server/client-ip"
import { handleRouteError } from "@/lib/server/http"
import { hashPassword, requireValidPassword } from "@/lib/server/password"
import { isRateLimited, recordFailure } from "@/lib/server/rate-limit"
import { TooManyRequestsError, ValidationError } from "@/lib/server/validation"
import { consumeResetToken } from "@/lib/server/verification"

const IP_MAX = 10

// Define a nova senha a partir do link recebido por e-mail. Efeitos: grava o hash, encerra TODAS
// as sessões abertas dessa conta e gasta o link (uso único). Link inexistente, adulterado,
// vencido ou já usado devolvem a mesma mensagem.
export async function POST(request: Request) {
  try {
    const ipKey = `reset-confirm:ip:${clientIp(request)}`
    if (isRateLimited(ipKey, IP_MAX)) {
      throw new TooManyRequestsError("Muitas tentativas. Aguarde 15 minutos e tente novamente.")
    }

    const body = (await request.json()) as { token?: unknown; novaSenha?: unknown }
    // A senha é validada ANTES de gastar o link: senha fraca não deve queimar o único uso.
    const novaSenha = requireValidPassword(body.novaSenha, "Nova senha")

    const usuarioId = await consumeResetToken(body.token)
    if (usuarioId === null) {
      recordFailure(ipKey)
      throw new ValidationError("Link inválido ou expirado. Peça uma nova recuperação de senha.")
    }

    const usuario = await prisma.usuario.update({
      where: { id: usuarioId },
      data: { senhaHash: await hashPassword(novaSenha), sessoesValidasDesde: new Date() },
    })
    await logAuditSafe("Senha redefinida por e-mail", "Nova senha definida pelo link de recuperação.", usuario.email)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
