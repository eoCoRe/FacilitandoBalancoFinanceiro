import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import { NoCompanyError } from "@/lib/server/validation"

// Várias empresas: a que o usuário está analisando fica no cookie `cb_empresa` (gravado por
// POST /api/empresas/selecionar e ao cadastrar uma empresa). Não é segredo nem autorização — todo usuário logado
// enxerga todas as empresas, limitado só pelo perfil (ver SECURITY.md) —, então basta ser um id que existe.
export const EMPRESA_COOKIE = "cb_empresa"

export const EMPRESA_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
}

async function selectedEmpresaId(): Promise<number | null> {
  let raw: string | undefined
  try {
    raw = (await cookies()).get(EMPRESA_COOKIE)?.value
  } catch {
    return null // fora de uma requisição (scripts, testes): sem escolha, vale a primeira empresa
  }
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// A empresa escolhida; sem escolha, ou se ela não existe mais (ex.: eliminada pela LGPD), a primeira cadastrada.
export async function getEmpresaAtual() {
  const id = await selectedEmpresaId()
  const escolhida = id === null ? null : await prisma.empresa.findUnique({ where: { id } })
  const empresa = escolhida ?? (await prisma.empresa.findFirst({ orderBy: { id: "asc" } }))
  if (!empresa) {
    throw new NoCompanyError("Nenhuma empresa cadastrada.")
  }
  return empresa
}
