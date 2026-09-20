import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requireCurrentPassword } from "@/lib/server/auth/password-recheck"
import { regenerateRecoveryCodes } from "@/lib/server/auth/second-factor"
import { ValidationError } from "@/lib/server/validation"

// Gera um novo conjunto de códigos de recuperação; os anteriores (usados ou não) deixam de valer.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senha?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (!usuario.totpAtivo) throw new ValidationError("Ligue o aplicativo autenticador primeiro.")
    await requireCurrentPassword(usuario, body.senha)

    const codigosRecuperacao = await regenerateRecoveryCodes(usuario.id)
    const empresa = await getDefaultEmpresa()
    await logAudit(empresa.id, "Códigos de recuperação renovados", "Novos códigos gerados; os anteriores foram invalidados.", user.email)
    return NextResponse.json({ ok: true, codigosRecuperacao })
  } catch (error) {
    return handleRouteError(error)
  }
}
