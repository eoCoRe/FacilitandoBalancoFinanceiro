import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { formatCnpj, isValidCnpj } from "@/lib/cnpj"
import { DEFAULT_SECTOR_ID, sectorLabel } from "@/lib/sector-benchmarks"
import { requireNonEmptyString, ValidationError } from "@/lib/server/validation"

export async function GET() {
  try {
    await requirePermission("consultar")
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
  } catch (error) {
    return handleRouteError(error)
  }
}

// Cadastra a empresa — só quando NÃO existe nenhuma (instalação nova, ou depois da eliminação LGPD): o sistema trabalha
// com uma empresa só. Só administrador. O Plano de Contas e o catálogo de índices são globais e continuam no banco; os
// exercícios se abrem depois, na Tabulação.
export async function POST(request: Request) {
  try {
    const user = await requirePermission("cadastrar-empresa")
    const body = (await request.json()) as { cnpj?: unknown; razaoSocial?: unknown; setor?: unknown }

    const cnpjInformado = requireNonEmptyString(body.cnpj, "CNPJ", 30)
    if (!isValidCnpj(cnpjInformado)) throw new ValidationError("CNPJ inválido. Confira os 14 dígitos.")
    const razaoSocial = requireNonEmptyString(body.razaoSocial, "Razão social", 200)
    const setor = body.setor === undefined || body.setor === null || body.setor === "" ? sectorLabel(DEFAULT_SECTOR_ID) : requireNonEmptyString(body.setor, "Setor", 100)

    if (await prisma.empresa.findFirst()) throw new ValidationError("Já existe uma empresa cadastrada.")
    const empresa = await prisma.empresa.create({ data: { cnpj: formatCnpj(cnpjInformado), razaoSocial, setor } })

    await logAudit(empresa.id, "Empresa cadastrada", `${razaoSocial} (${empresa.cnpj}).`, user.email)
    return NextResponse.json(empresa, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

// Atualiza cadastro da empresa (razão social e/ou setor) — equivalente a
// `store.setSector` (hoje só o setor tem tela própria no frontend), persistido.
// Só os campos informados são alterados; nenhum dos dois é obrigatório sozinho.
export async function PATCH(request: Request) {
  try {
    const user = await requirePermission("editar-empresa")
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

    await logAudit(empresa.id, "Empresa atualizada", `Cadastro atualizado: ${Object.keys(data).join(", ")}.`, user.email)

    return NextResponse.json(atualizada)
  } catch (error) {
    return handleRouteError(error)
  }
}
