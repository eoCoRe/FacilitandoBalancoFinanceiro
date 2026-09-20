import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireUser } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { mailAvailable } from "@/lib/server/mail"

// Quem está logado — o front usa para mostrar o nome, decidir o que exibir por perfil e mostrar
// o estado da verificação em 2 etapas.
export async function GET() {
  try {
    const { id, nome, email, papel } = await requireUser()
    const [usuario, politica] = await Promise.all([
      prisma.usuario.findUnique({ where: { id }, select: { doisFatoresAtivo: true, totpAtivo: true } }),
      prisma.politicaSeguranca.findUnique({ where: { papel } }),
    ])
    return NextResponse.json({
      user: {
        id,
        nome,
        email,
        papel,
        doisFatoresAtivo: usuario?.doisFatoresAtivo ?? false,
        totpAtivo: usuario?.totpAtivo ?? false,
        doisFatoresObrigatorio: politica?.doisFatoresObrigatorio ?? false,
      },
      emailDisponivel: mailAvailable(),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
