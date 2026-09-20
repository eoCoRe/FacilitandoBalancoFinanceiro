import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isPapel } from "@/lib/permissions"
import { logAudit } from "@/lib/server/audit"
import { requirePermission } from "@/lib/server/authz"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { hashPassword, requireValidPassword } from "@/lib/server/password"
import { requireEmail, requireNonEmptyString, ValidationError } from "@/lib/server/validation"
import { toUsuarioDto } from "@/lib/server/usuarios"

// Gestão de usuários — só administrador. Nunca devolve o hash da senha nem o googleSub: a
// tela só precisa saber SE a pessoa tem senha / conta Google vinculada.
export async function GET() {
  try {
    await requirePermission("gerir-usuarios")
    const usuarios = await prisma.usuario.findMany({ orderBy: { nome: "asc" } })
    return NextResponse.json({ usuarios: usuarios.map(toUsuarioDto) })
  } catch (error) {
    return handleRouteError(error)
  }
}

// Cria um usuário. `senha` é opcional: quem só vai entrar pelo Google não precisa de uma.
export async function POST(request: Request) {
  try {
    const admin = await requirePermission("gerir-usuarios")
    const body = (await request.json()) as { nome?: unknown; email?: unknown; papel?: unknown; senha?: unknown }

    const nome = requireNonEmptyString(body.nome, "Nome")
    const email = requireEmail(body.email)
    if (!isPapel(body.papel)) throw new ValidationError("Perfil inválido.")
    const senhaHash =
      body.senha === undefined || body.senha === null || body.senha === ""
        ? null
        : await hashPassword(requireValidPassword(body.senha))

    if (await prisma.usuario.findUnique({ where: { email } })) {
      throw new ValidationError("Já existe um usuário com este e-mail.")
    }

    const usuario = await prisma.usuario.create({ data: { nome, email, papel: body.papel, senhaHash } })

    const empresa = await getDefaultEmpresa()
    await logAudit(empresa.id, "Usuário criado", `${email} com perfil ${body.papel}.`, admin.email)

    return NextResponse.json(toUsuarioDto(usuario), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
