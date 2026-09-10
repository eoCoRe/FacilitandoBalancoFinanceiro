import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requireNonEmptyString, ValidationError } from "@/lib/server/validation"

export async function GET() {
  const empresa = await getDefaultEmpresa()
  const exercicios = await prisma.exercicio.findMany({
    where: { empresaId: empresa.id },
    orderBy: { id: "asc" },
  })

  return NextResponse.json({
    id: empresa.id,
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razaoSocial,
    setor: empresa.setor,
    exercicios: exercicios.map((e) => ({ id: e.id, periodo: e.periodo, auditado: e.auditado })),
  })
}

// Atualiza cadastro da empresa (razão social e/ou setor) — equivalente a
// `store.setSector` (hoje só o setor tem tela própria no frontend), persistido.
// Só os campos informados são alterados; nenhum dos dois é obrigatório sozinho.
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { razaoSocial: rawRazaoSocial, setor: rawSetor } = body as { razaoSocial?: unknown; setor?: unknown }

    if (rawRazaoSocial === undefined && rawSetor === undefined) {
      throw new ValidationError("Informe razaoSocial e/ou setor.")
    }

    const data: { razaoSocial?: string; setor?: string } = {}
    if (rawRazaoSocial !== undefined) data.razaoSocial = requireNonEmptyString(rawRazaoSocial, "razaoSocial")
    if (rawSetor !== undefined) data.setor = requireNonEmptyString(rawSetor, "setor")

    const empresa = await getDefaultEmpresa()
    const atualizada = await prisma.empresa.update({ where: { id: empresa.id }, data })

    await logAudit(empresa.id, "Empresa atualizada", `Cadastro atualizado: ${Object.keys(data).join(", ")}.`)

    return NextResponse.json(atualizada)
  } catch (error) {
    return handleRouteError(error)
  }
}
