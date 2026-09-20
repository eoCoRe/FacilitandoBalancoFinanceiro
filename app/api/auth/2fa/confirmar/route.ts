import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit"
import { requireUser } from "@/lib/server/authz"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { ValidationError } from "@/lib/server/validation"
import { checkCode, latestPendingChallengeId } from "@/lib/server/verification"

// Segundo passo de LIGAR o 2FA: confere o código recebido por e-mail e só então ativa.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { codigo?: unknown }

    const challengeId = await latestPendingChallengeId(user.id, "ATIVACAO_2FA")
    if (!challengeId) throw new ValidationError("Nenhum código pendente. Peça um novo.")

    const resultado = await checkCode(challengeId, user.id, "ATIVACAO_2FA", body.codigo)
    if (resultado === "expirado") throw new ValidationError("O código expirou. Peça um novo.")
    if (resultado === "bloqueado") throw new ValidationError("Muitas tentativas incorretas. Peça um novo código.")
    if (resultado !== "ok") throw new ValidationError("Código incorreto.")

    await prisma.usuario.update({ where: { id: user.id }, data: { doisFatoresAtivo: true } })
    const empresa = await getDefaultEmpresa()
    await logAudit(empresa.id, "2FA ativado", "Verificação em 2 etapas por e-mail ligada.", user.email)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
