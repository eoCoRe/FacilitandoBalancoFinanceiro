import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { requireNonEmptyString, requirePositiveInt, ValidationError } from "@/lib/server/validation"

interface RouteParams {
  params: Promise<{ id: string }>
}

// Renomeia uma conta do Plano de Contas — equivalente a `store.renameAccountNode`.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await requirePermission("gerir-plano-de-contas")
    const { id } = await params
    const contaId = requirePositiveInt(Number(id), "id")

    const body = await request.json()
    const nome = requireNonEmptyString((body as { nome: unknown }).nome, "Nome")

    const conta = await prisma.conta.findUnique({ where: { id: contaId } })
    if (!conta) throw new ValidationError("Conta não encontrada.")

    const atualizada = await prisma.conta.update({ where: { id: contaId }, data: { descricao: nome } })

    const empresa = await getEmpresaAtual()
    await logAudit(empresa.id, "Conta renomeada", `${conta.codigo} → "${nome}".`, user.email)

    return NextResponse.json(atualizada)
  } catch (error) {
    return handleRouteError(error)
  }
}

// Remove uma conta — equivalente a `store.deleteAccountNode`. O cascade do schema
// (Conta.contaPai / Valor.conta com onDelete: Cascade) apaga subcontas e valores
// lançados junto; ValorExtraido.contaId vira null (onDelete: SetNull), preservando o
// histórico da extração mesmo depois que a conta é excluída.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const user = await requirePermission("gerir-plano-de-contas")
    const { id } = await params
    const contaId = requirePositiveInt(Number(id), "id")

    const conta = await prisma.conta.findUnique({ where: { id: contaId } })
    if (!conta) throw new ValidationError("Conta não encontrada.")

    await prisma.conta.delete({ where: { id: contaId } })

    const empresa = await getEmpresaAtual()
    await logAudit(empresa.id, "Conta removida", `${conta.codigo} excluída do Plano de Contas.`, user.email)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
