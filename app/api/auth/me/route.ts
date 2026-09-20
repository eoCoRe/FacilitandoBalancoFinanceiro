import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"

// Quem está logado — o front usa para mostrar o nome e decidir o que exibir por perfil.
export async function GET() {
  try {
    const { id, nome, email, papel } = await requireUser()
    return NextResponse.json({ user: { id, nome, email, papel } })
  } catch (error) {
    return handleRouteError(error)
  }
}
