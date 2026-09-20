import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit"
import { requireUser } from "@/lib/server/authz"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { PASSWORD_MAX_LENGTH, verifyPassword } from "@/lib/server/password"
import { clearFailures, isRateLimited, PASSWORD_CHECK_KEY, recordFailure } from "@/lib/server/rate-limit"
import { TooManyRequestsError, ValidationError } from "@/lib/server/validation"

// Desliga o 2FA da própria conta. Exige a senha (uma sessão emprestada não basta para
// enfraquecer a conta) e é recusado se o perfil do usuário for obrigado a usar 2 etapas.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senha?: unknown }

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")
    if (!usuario.doisFatoresAtivo) throw new ValidationError("A verificação em 2 etapas já está desligada.")

    const politica = await prisma.politicaSeguranca.findUnique({ where: { papel: usuario.papel } })
    if (politica?.doisFatoresObrigatorio) {
      throw new ValidationError("O seu perfil exige verificação em 2 etapas; não é possível desligá-la.")
    }

    const senha = body.senha
    if (typeof senha !== "string" || !senha || senha.length > PASSWORD_MAX_LENGTH) {
      throw new ValidationError("Informe a sua senha para confirmar.")
    }
    const key = PASSWORD_CHECK_KEY(user.id)
    if (isRateLimited(key)) {
      throw new TooManyRequestsError("Muitas tentativas com a senha. Aguarde 15 minutos e tente novamente.")
    }
    if (!usuario.senhaHash || !(await verifyPassword(senha, usuario.senhaHash))) {
      recordFailure(key)
      throw new ValidationError("Senha incorreta.")
    }
    clearFailures(key)

    await prisma.usuario.update({ where: { id: user.id }, data: { doisFatoresAtivo: false } })
    const empresa = await getDefaultEmpresa()
    await logAudit(empresa.id, "2FA desativado", "Verificação em 2 etapas desligada pelo próprio usuário.", user.email)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
