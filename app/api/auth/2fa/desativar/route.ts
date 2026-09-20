import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requireCurrentPassword } from "@/lib/server/auth/password-recheck"
import { ValidationError } from "@/lib/server/validation"

// Desliga o 2FA por e-mail da própria conta. Exige a senha (uma sessão emprestada não basta para
// enfraquecer a conta) e é recusado se o perfil for obrigado a usar 2 etapas e este for o único fator
// (com o app autenticador ligado, a exigência continua atendida).
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senha?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (!usuario.doisFatoresAtivo) throw new ValidationError("A verificação em 2 etapas já está desligada.")

    const politica = await prisma.politicaSeguranca.findUnique({ where: { papel: usuario.papel } })
    if (politica?.doisFatoresObrigatorio && !usuario.totpAtivo) {
      throw new ValidationError("O seu perfil exige verificação em 2 etapas; não é possível desligá-la.")
    }

    await requireCurrentPassword(usuario, body.senha)

    await prisma.usuario.update({ where: { id: user.id }, data: { doisFatoresAtivo: false } })
    const empresa = await getDefaultEmpresa()
    await logAudit(empresa.id, "2FA desativado", "Verificação em 2 etapas desligada pelo próprio usuário.", user.email)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
