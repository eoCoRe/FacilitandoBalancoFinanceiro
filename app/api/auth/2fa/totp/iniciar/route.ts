import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireUser } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { requireCurrentPassword } from "@/lib/server/auth/password-recheck"
import { startTotpEnrollment } from "@/lib/server/auth/second-factor"
import { ValidationError } from "@/lib/server/validation"

// Passo 1 de ligar o app autenticador: exige a senha e devolve uma chave nova (mostrada só agora)
// para a pessoa cadastrar no app. Ainda não vale nada — só passa a valer em /totp/confirmar.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senha?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (usuario.totpAtivo) throw new ValidationError("O aplicativo autenticador já está ligado.")
    await requireCurrentPassword(usuario, body.senha)

    return NextResponse.json(await startTotpEnrollment(usuario))
  } catch (error) {
    return handleRouteError(error)
  }
}
