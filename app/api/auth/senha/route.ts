import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { requireUser } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { hashPassword, PASSWORD_MAX_LENGTH, requireValidPassword, verifyPassword } from "@/lib/server/password"
import { setSessionCookie, signSessionToken } from "@/lib/server/session"
import { ValidationError } from "@/lib/server/validation"

// Troca a própria senha. Exige a senha atual (quem só entra pelo Google e ainda não tem senha
// pode definir a primeira sem ela). Encerra as sessões abertas em outros lugares e reemite a
// desta, para quem trocou continuar logado.
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = (await request.json()) as { senhaAtual?: unknown; novaSenha?: unknown }
    const novaSenha = requireValidPassword(body.novaSenha, "Nova senha")

    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")

    if (usuario.senhaHash) {
      const atual = body.senhaAtual
      if (typeof atual !== "string" || !atual || atual.length > PASSWORD_MAX_LENGTH) {
        throw new ValidationError("Informe a senha atual.")
      }
      if (!(await verifyPassword(atual, usuario.senhaHash))) {
        throw new ValidationError("A senha atual está incorreta.")
      }
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash: await hashPassword(novaSenha), sessoesValidasDesde: new Date() },
    })
    await logAuditSafe("Senha alterada", "O próprio usuário trocou a senha.", usuario.email)

    const response = NextResponse.json({ ok: true })
    setSessionCookie(response, await signSessionToken(usuario.id))
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
