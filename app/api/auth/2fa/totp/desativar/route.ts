import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requireCurrentPassword } from "@/lib/server/auth/password-recheck"
import { disableTotp } from "@/lib/server/auth/second-factor"
import { ValidationError } from "@/lib/server/validation"

// Desliga o app autenticador (e apaga os códigos de recuperação). Exige a senha e é recusado se o
// perfil for obrigado a usar 2 etapas e este for o único fator ligado.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senha?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (!usuario.totpAtivo) throw new ValidationError("O aplicativo autenticador já está desligado.")

    const politica = await prisma.politicaSeguranca.findUnique({ where: { papel: usuario.papel } })
    if (politica?.doisFatoresObrigatorio && !usuario.doisFatoresAtivo) {
      throw new ValidationError(
        "O seu perfil exige verificação em 2 etapas; ligue a verificação por e-mail antes de desligar o aplicativo.",
      )
    }
    await requireCurrentPassword(usuario, body.senha)

    await disableTotp(usuario.id)
    const empresa = await getEmpresaAtual()
    await logAudit(empresa.id, "App autenticador desativado", "Desligado pelo próprio usuário.", user.email)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
