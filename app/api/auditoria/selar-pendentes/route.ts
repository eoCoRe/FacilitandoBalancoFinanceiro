import { NextResponse } from "next/server"
import { logAudit } from "@/lib/server/audit/audit"
import { SEAL_MAX_PER_CALL, sealPendingDetailed } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Selo à mão dos registros que estão SEM selo (ver "quem sela o quê" em audit-seal.ts). O servidor só sela o que ele mesmo
// acabou de gravar; este é o caminho para o resto: uma falha de selagem seguida de reinício, ou o histórico anterior à
// selagem. Só administrador, e é uma decisão: ele atesta que os registros pendentes estão certos (quem tivesse só o banco
// não pode fazer isso). Só os da empresa em análise (cada empresa tem a sua cadeia). A ação — com quantos registros e a
// faixa de ids — entra na própria trilha, já selada.
export async function POST() {
  try {
    const admin = await requirePermission("selar-auditoria")
    const empresa = await getEmpresaAtual()

    // Uma chamada sela até SEAL_MAX_PER_CALL; um histórico maior precisa de várias, e o administrador não deve ter que
    // clicar de novo. Continua enquanto cada rodada encher o limite (então pode haver mais).
    // O que vai para a trilha é o que FOI selado (contagem e faixa de ids devolvidas pela própria selagem), não uma
    // estimativa feita antes.
    let selados = 0
    let primeiroId: number | null = null
    let ultimoId: number | null = null
    for (let rodada = 0; rodada < 1000; rodada++) {
      const r = await sealPendingDetailed({ all: true, empresaId: empresa.id })
      selados += r.count
      if (r.primeiroId !== null) primeiroId = primeiroId === null ? r.primeiroId : Math.min(primeiroId, r.primeiroId)
      if (r.ultimoId !== null) ultimoId = ultimoId === null ? r.ultimoId : Math.max(ultimoId, r.ultimoId)
      if (r.count < SEAL_MAX_PER_CALL) break
    }

    if (selados > 0) {
      await logAudit(
        empresa.id,
        "Registros pendentes selados manualmente",
        `${selados} registro(s) sem selo (#${primeiroId} a #${ultimoId}) foram selados por decisão do administrador.`,
        admin.email,
      )
    }
    return NextResponse.json({ selados })
  } catch (error) {
    return handleRouteError(error)
  }
}
