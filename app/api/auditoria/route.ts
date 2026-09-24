import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseAuditQuery } from "@/lib/server/audit/auditoria"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Trilha de auditoria (RF08/RNF03), mais recentes primeiro. Sem parâmetros devolve os 50 últimos (o que a
// Tabulação mostra). Filtros opcionais (query string): usuario, acao, de, ate, q; paginação por cursor:
// `limite` (máx. 200) e `cursor` (id do último item recebido) — a resposta traz `proximoCursor`, ou null
// quando acabou. Com `opcoes=1` devolve também a lista de ações existentes (para o filtro da tela).
export async function GET(request: Request) {
  try {
    await requirePermission("consultar")
    const empresa = await getEmpresaAtual()
    const params = new URL(request.url).searchParams
    const { where, limite } = parseAuditQuery(params, empresa.id)

    const logs = await prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: limite })
    const proximoCursor = logs.length === limite ? logs[logs.length - 1].id : null

    let acoes: string[] | undefined
    if (params.get("opcoes") === "1") {
      const distintas = await prisma.auditLog.findMany({
        where: { empresaId: empresa.id },
        distinct: ["acao"],
        select: { acao: true },
        orderBy: { acao: "asc" },
      })
      acoes = distintas.map((d) => d.acao)
    }

    return NextResponse.json({ logs, proximoCursor, ...(acoes ? { acoes } : {}) })
  } catch (error) {
    return handleRouteError(error)
  }
}
