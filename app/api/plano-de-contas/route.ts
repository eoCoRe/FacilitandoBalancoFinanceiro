import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { logAudit } from "@/lib/server/audit"
import { requirePermission } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { requireNonEmptyString, requirePositiveInt, ValidationError } from "@/lib/server/validation"

interface ContaNode {
  id: number
  codigo: string
  descricao: string
  ehGrupo: boolean
  valores: Record<string, number>
  subcontas?: ContaNode[]
}

// Árvore do Balanço Patrimonial (tipo BP), com os valores lançados por exercício —
// equivalente a `store.accounts` no frontend, só que lido do Postgres.
export async function GET() {
  try {
    await requirePermission("consultar")
    return NextResponse.json({ contas: await buildTree() })
  } catch (error) {
    return handleRouteError(error)
  }
}

async function buildTree(): Promise<ContaNode[]> {
  const contas = await prisma.conta.findMany({
    where: { tipo: "BP" },
    include: { valores: { include: { exercicio: true } } },
    orderBy: { codigo: "asc" },
  })

  const nodeById = new Map<number, ContaNode>()
  for (const conta of contas) {
    const valores: Record<string, number> = {}
    for (const v of conta.valores) valores[v.exercicio.periodo] = Number(v.valor)
    nodeById.set(conta.id, { id: conta.id, codigo: conta.codigo, descricao: conta.descricao, ehGrupo: conta.ehGrupo, valores })
  }

  const roots: ContaNode[] = []
  for (const conta of contas) {
    const node = nodeById.get(conta.id)!
    if (conta.contaPaiId === null) {
      roots.push(node)
      continue
    }
    const parent = nodeById.get(conta.contaPaiId)
    if (parent) parent.subcontas = [...(parent.subcontas ?? []), node]
  }

  return roots
}

// Cria uma conta raiz (parentId null) ou subconta — equivalente a
// `store.addAccountNode`, gerando o próximo código na mesma convenção
// (raiz: "1", "2", ...; filha: "<pai>.<n>"). `ehGrupo` distingue grupo (agrupa
// subcontas) de conta analítica (recebe valores); padrão: analítica.
export async function POST(request: Request) {
  try {
    const user = await requirePermission("gerir-plano-de-contas")
    const body = await request.json()
    const { parentId: rawParentId, nome: rawNome, ehGrupo: rawEhGrupo } = body as {
      parentId: number | null
      nome: unknown
      ehGrupo?: unknown
    }

    const nome = requireNonEmptyString(rawNome, "Nome")
    const parentId = rawParentId === null || rawParentId === undefined ? null : requirePositiveInt(rawParentId, "parentId")

    if (rawEhGrupo !== undefined && typeof rawEhGrupo !== "boolean") {
      throw new ValidationError("ehGrupo deve ser verdadeiro ou falso.")
    }
    const ehGrupo = rawEhGrupo ?? false

    const codigo = await nextCodigo(parentId)
    const conta = await prisma.conta.create({
      data: { codigo, descricao: nome, tipo: "BP", contaPaiId: parentId, ehGrupo },
    })

    const empresa = await getDefaultEmpresa()
    await logAudit(
      empresa.id,
      "Conta criada",
      parentId === null ? `Grupo raiz "${nome}" (${codigo}).` : `"${nome}" adicionada em ${codigo}.`,
      user.email,
    )

    return NextResponse.json(conta, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

async function nextCodigo(parentId: number | null): Promise<string> {
  if (parentId === null) {
    const roots = await prisma.conta.findMany({ where: { tipo: "BP", contaPaiId: null } })
    const used = new Set(roots.map((r) => r.codigo))
    let n = 1
    while (used.has(String(n))) n++
    return String(n)
  }

  const parent = await prisma.conta.findUnique({ where: { id: parentId } })
  if (!parent) throw new ValidationError("Conta pai não encontrada.")
  const siblings = await prisma.conta.findMany({ where: { contaPaiId: parentId } })
  const used = new Set(siblings.map((s) => s.codigo))
  let n = 1
  while (used.has(`${parent.codigo}.${n}`)) n++
  return `${parent.codigo}.${n}`
}
