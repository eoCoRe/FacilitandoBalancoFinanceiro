import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { requireBoundedNumber, requirePositiveInt, ValidationError } from "@/lib/server/validation"
import { upsertOrDeleteValor } from "@/lib/server/data/valores"

// Lança (ou apaga, se valor:null) o valor de uma conta num exercício —
// equivalente a `store.updateAccountValue` / `store.updateDreValue`. Funciona
// para qualquer tipo de conta (BP, DRE ou DFC), já que Valor é genérico.
export async function PUT(request: Request) {
  try {
    const user = await requirePermission("lancar-valores")
    const body = await request.json()
    const { contaId: rawContaId, exercicioId: rawExercicioId, valor: rawValor } = body as {
      contaId: number
      exercicioId: number
      valor: number | null
    }

    const contaId = requirePositiveInt(rawContaId, "contaId")
    const exercicioId = requirePositiveInt(rawExercicioId, "exercicioId")
    const valor = rawValor === null || rawValor === undefined ? null : requireBoundedNumber(rawValor, "valor")

    // Só EXIGE que existam ao gravar — apagar um lançamento de um par
    // conta/exercício inexistente é inofensivo (deleteMany não acha nada e não
    // falha). Sem isso, um id inválido só apareceria como violação de FK do
    // Postgres (500 cru) em vez de um 400 com mensagem clara. A consulta vale
    // também ao apagar, para a auditoria mostrar código e período, não ids internos.
    const [conta, exercicio, empresa] = await Promise.all([
      prisma.conta.findUnique({ where: { id: contaId } }),
      prisma.exercicio.findUnique({ where: { id: exercicioId } }),
      getEmpresaAtual(),
    ])
    if (valor !== null) {
      if (!conta) throw new ValidationError("Conta não encontrada.")
      if (!exercicio) throw new ValidationError("Exercício não encontrado.")
    }
    // O exercício precisa ser da empresa em análise: com a troca de empresa em outra aba, esta aba ainda mostraria a
    // anterior, e o valor iria para uma empresa enquanto a auditoria registraria na outra.
    if (exercicio && exercicio.empresaId !== empresa.id) {
      throw new ValidationError("Este exercício é de outra empresa (a empresa em análise foi trocada, talvez em outra aba). Recarregue a página.")
    }
    const rotulo = `${conta?.codigo ?? `conta ${contaId}`} · ${exercicio?.periodo ?? `exercício ${exercicioId}`}`

    const registro = await upsertOrDeleteValor(contaId, exercicioId, valor)

    await logAudit(
      empresa.id,
      valor === null ? "Valor removido" : "Valor lançado",
      valor === null ? `${rotulo} limpo.` : `${rotulo} = ${valor}`,
      user.email,
    )

    if (registro === null) return NextResponse.json({ ok: true })
    return NextResponse.json(registro)
  } catch (error) {
    return handleRouteError(error)
  }
}
