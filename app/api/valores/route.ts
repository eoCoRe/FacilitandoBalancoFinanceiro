import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { logAudit } from "@/lib/server/audit"
import { requirePermission } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { requireBoundedNumber, requirePositiveInt, ValidationError } from "@/lib/server/validation"
import { upsertOrDeleteValor } from "@/lib/server/valores"

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

    // Só valida existência ao gravar — apagar um lançamento de um par
    // conta/exercício inexistente é inofensivo (deleteMany não acha nada e não
    // falha). Sem isso, um id inválido só apareceria como violação de FK do
    // Postgres (500 cru) em vez de um 400 com mensagem clara.
    if (valor !== null) {
      const [conta, exercicio] = await Promise.all([
        prisma.conta.findUnique({ where: { id: contaId } }),
        prisma.exercicio.findUnique({ where: { id: exercicioId } }),
      ])
      if (!conta) throw new ValidationError("Conta não encontrada.")
      if (!exercicio) throw new ValidationError("Exercício não encontrado.")
    }

    const registro = await upsertOrDeleteValor(contaId, exercicioId, valor)

    const empresa = await getDefaultEmpresa()
    await logAudit(
      empresa.id,
      valor === null ? "Valor removido" : "Valor lançado",
      valor === null ? `conta ${contaId} · exercício ${exercicioId} limpo.` : `conta ${contaId} · exercício ${exercicioId} = ${valor}`,
      user.email,
    )

    if (registro === null) return NextResponse.json({ ok: true })
    return NextResponse.json(registro)
  } catch (error) {
    return handleRouteError(error)
  }
}
