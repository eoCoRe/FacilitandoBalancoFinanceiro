import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/server/audit/audit"
import { SEAL_MAX_PER_CALL, sealPending } from "@/lib/server/audit/audit-seal"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"

// Selo à mão dos registros que estão SEM selo (ver "quem sela o quê" em audit-seal.ts). O servidor só sela o que ele mesmo
// acabou de gravar; este é o caminho para o resto: uma falha de selagem seguida de reinício, ou o histórico anterior à
// selagem. Só administrador, e é uma decisão: ele atesta que os registros pendentes estão certos (quem tivesse só o banco
// não pode fazer isso). A ação — com quantos registros e a faixa de ids — entra na própria trilha, já selada.
export async function POST() {
  try {
    const admin = await requirePermission("selar-auditoria")
    const empresa = await getDefaultEmpresa()

    const antes = await prisma.auditLog.aggregate({ _min: { id: true }, _max: { id: true }, where: { selo: null } })

    // Uma chamada sela até SEAL_MAX_PER_CALL; um histórico maior precisa de várias, e o administrador não deve ter que
    // clicar de novo. Continua enquanto cada rodada encher o limite (então pode haver mais).
    let selados = 0
    for (let rodada = 0; rodada < 1000; rodada++) {
      const n = await sealPending({ all: true })
      selados += n
      if (n < SEAL_MAX_PER_CALL) break
    }

    if (selados > 0) {
      await logAudit(
        empresa.id,
        "Registros pendentes selados manualmente",
        `${selados} registro(s) sem selo (#${antes._min.id} a #${antes._max.id}) foram selados por decisão do administrador.`,
        admin.email,
      )
    }
    return NextResponse.json({ selados })
  } catch (error) {
    return handleRouteError(error)
  }
}
