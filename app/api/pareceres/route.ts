import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { formatBRL } from "@/lib/financial-data"
import { DECISAO_LABEL, DECISOES, type Decisao } from "@/lib/parecer"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { calcularParecer } from "@/lib/server/data/parecer"
import { handleRouteError } from "@/lib/server/http"
import { requireBoundedNumber, requireNonEmptyString, requirePositiveInt, ValidationError } from "@/lib/server/validation"

const JUSTIFICATIVA_MIN = 10
const VALIDADE_MAX_ANOS = 3

type ParecerRow = Awaited<ReturnType<typeof prisma.parecer.findMany<{ include: { exercicio: true } }>>>[number]

function toJson(p: ParecerRow) {
  return {
    id: p.id,
    exercicio: p.exercicio.periodo,
    registradoPor: p.registradoPor,
    criadoEm: p.criadoEm,
    classificacao: p.classificacao,
    score: p.score,
    valorSolicitado: Number(p.valorSolicitado),
    limiteSugerido: p.limiteSugerido === null ? null : Number(p.limiteSugerido),
    criterios: p.criterios,
    decisao: p.decisao,
    limiteAprovado: p.limiteAprovado === null ? null : Number(p.limiteAprovado),
    validadeAte: p.validadeAte === null ? null : p.validadeAte.toISOString().slice(0, 10),
    justificativa: p.justificativa,
  }
}

// Histórico de pareceres registrados da empresa em análise, do mais recente para o mais antigo.
export async function GET() {
  try {
    await requirePermission("consultar")
    const empresa = await getEmpresaAtual()
    const pareceres = await prisma.parecer.findMany({
      where: { empresaId: empresa.id },
      orderBy: { criadoEm: "desc" },
      take: 50,
      include: { exercicio: true },
    })
    return NextResponse.json({ pareceres: pareceres.map(toJson) })
  } catch (error) {
    return handleRouteError(error)
  }
}

// Registra a decisão de crédito (coordenador ou acima — a alçada de aprovação). A análise automática que vai junto
// (classificação, score, limite sugerido e critérios) é recalculada AQUI com os dados do banco, não vem da tela.
// Não há edição nem exclusão: uma decisão nova é outro parecer, e tudo fica na trilha de auditoria.
export async function POST(request: Request) {
  try {
    const user = await requirePermission("registrar-parecer")
    const body = (await request.json()) as Record<string, unknown>

    const exercicioId = requirePositiveInt(body.exercicioId, "exercicioId")
    const valorSolicitado = requireBoundedNumber(body.valorSolicitado, "Valor solicitado")
    if (!(valorSolicitado > 0)) throw new ValidationError("Informe o valor solicitado.")
    if (typeof body.decisao !== "string" || !(DECISOES as readonly string[]).includes(body.decisao)) {
      throw new ValidationError("Escolha a decisão: aprovado, aprovado com ressalvas ou reprovado.")
    }
    const decisao = body.decisao as Decisao
    const justificativa = requireNonEmptyString(body.justificativa, "Justificativa", 2000)
    if (justificativa.length < JUSTIFICATIVA_MIN) throw new ValidationError(`Escreva a justificativa (pelo menos ${JUSTIFICATIVA_MIN} caracteres).`)

    // Reprovado não tem limite nem validade; aprovado precisa de limite positivo e pode ter validade.
    let limiteAprovado: number | null = null
    let validadeAte: Date | null = null
    if (decisao !== "REPROVADO") {
      limiteAprovado = requireBoundedNumber(body.limiteAprovado, "Limite aprovado")
      if (!(limiteAprovado > 0)) throw new ValidationError("Informe o limite aprovado.")
      if (body.validadeAte !== undefined && body.validadeAte !== null && body.validadeAte !== "") {
        const texto = requireNonEmptyString(body.validadeAte, "Validade", 10)
        const data = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? new Date(`${texto}T00:00:00Z`) : new Date(Number.NaN)
        if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== texto) throw new ValidationError("Validade inválida.")
        const hoje = new Date().toISOString().slice(0, 10)
        const limite = new Date()
        limite.setUTCFullYear(limite.getUTCFullYear() + VALIDADE_MAX_ANOS)
        if (texto < hoje) throw new ValidationError("A validade não pode estar no passado.")
        if (data > limite) throw new ValidationError(`A validade pode ser de no máximo ${VALIDADE_MAX_ANOS} anos.`)
        validadeAte = data
      }
    }

    const empresa = await getEmpresaAtual()
    const { periodo, opiniao } = await calcularParecer(empresa.id, exercicioId, valorSolicitado)

    const parecer = await prisma.parecer.create({
      data: {
        empresaId: empresa.id,
        exercicioId,
        registradoPor: user.email,
        classificacao: opiniao.rating,
        score: opiniao.score,
        valorSolicitado,
        limiteSugerido: opiniao.limitAvailable ? opiniao.suggestedLimit : null,
        criterios: opiniao.criteria.map(({ label, value, status, weight, insuficiente }) => ({ label, value, status, weight, insuficiente })),
        decisao,
        limiteAprovado,
        validadeAte,
        justificativa,
      },
      include: { exercicio: true },
    })

    await logAudit(
      empresa.id,
      "Parecer de crédito registrado",
      `${periodo}: ${DECISAO_LABEL[decisao]}` +
        (limiteAprovado === null ? "" : `, limite R$ ${formatBRL(limiteAprovado, 2)}`) +
        ` (solicitado R$ ${formatBRL(valorSolicitado, 2)}; análise automática: ${opiniao.ratingLabel}, score ${opiniao.score}).`,
      user.email,
    )
    return NextResponse.json(toJson(parecer), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
