import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getDefaultEmpresa } from "@/lib/server/empresa"
import { logAudit } from "@/lib/server/audit"
import { requirePermission } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import {
  requireBoundedNumber,
  requireNonEmptyString,
  requirePositiveInt,
  requireRange,
  ValidationError,
} from "@/lib/server/validation"
import { upsertOrDeleteValor } from "@/lib/server/valores"

interface ExtracaoItemInput {
  contaId: number | null
  valor: number
  confianca: number
  paginaOrigem?: number
}

const MAX_ITENS = 200

function parseItem(raw: unknown, index: number): ExtracaoItemInput {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError(`itens[${index}] inválido.`)
  }
  const item = raw as Record<string, unknown>
  const contaId = item.contaId === null || item.contaId === undefined ? null : requirePositiveInt(item.contaId, `itens[${index}].contaId`)
  const valor = requireBoundedNumber(item.valor, `itens[${index}].valor`)
  const confianca = requireRange(requireBoundedNumber(item.confianca, `itens[${index}].confianca`), `itens[${index}].confianca`, 0, 100)
  const paginaOrigem =
    item.paginaOrigem === undefined || item.paginaOrigem === null
      ? undefined
      : requirePositiveInt(item.paginaOrigem, `itens[${index}].paginaOrigem`)
  return { contaId, valor, confianca, paginaOrigem }
}

// Registra o resultado de uma extração (Extração via IA) já revisada e
// confirmada pelo analista: grava a Extracao + um ValorExtraido por item
// (rastreabilidade, inclusive dos não mapeados), e só os itens com conta
// mapeada viram Valor de verdade — equivalente a store.confirmExtraction.
export async function POST(request: Request) {
  try {
    const user = await requirePermission("lancar-valores")
    const body = await request.json()
    const { exercicioId: rawExercicioId, arquivoOrigem: rawArquivoOrigem, modeloLlm, itens: rawItens } = body as {
      exercicioId: number
      arquivoOrigem: string
      modeloLlm?: string
      itens: unknown
    }

    const exercicioId = requirePositiveInt(rawExercicioId, "exercicioId")
    const arquivoOrigem = requireNonEmptyString(rawArquivoOrigem, "arquivoOrigem")
    if (!Array.isArray(rawItens) || rawItens.length === 0) {
      throw new ValidationError("itens é obrigatório e não pode ser vazio.")
    }
    if (rawItens.length > MAX_ITENS) {
      throw new ValidationError(`itens excede o máximo de ${MAX_ITENS}.`)
    }
    const itens = rawItens.map(parseItem)

    const extracao = await prisma.extracao.create({
      data: {
        exercicioId,
        arquivoOrigem,
        modeloLlm: modeloLlm ? requireNonEmptyString(modeloLlm, "modeloLlm") : "mock-demo-v1",
        status: "CONCLUIDA",
      },
    })

    await prisma.valorExtraido.createMany({
      data: itens.map((item) => ({
        extracaoId: extracao.id,
        contaId: item.contaId,
        valor: item.valor,
        paginaOrigem: item.paginaOrigem,
        confianca: item.confianca,
      })),
    })

    let gravados = 0
    for (const item of itens) {
      if (item.contaId === null) continue
      await upsertOrDeleteValor(item.contaId, exercicioId, item.valor)
      gravados++
    }

    const empresa = await getDefaultEmpresa()
    await logAudit(
      empresa.id,
      "Extração confirmada",
      `${gravados} conta(s) de "${arquivoOrigem}" gravada(s) (revisão humana concluída).`,
      user.email,
    )

    return NextResponse.json({ extracaoId: extracao.id, gravados }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function GET() {
  try {
    await requirePermission("consultar")
    const extracoes = await prisma.extracao.findMany({
      orderBy: { criadoEm: "desc" },
      take: 20,
      include: { _count: { select: { valoresExtraidos: true } }, exercicio: true },
    })

    return NextResponse.json({
      extracoes: extracoes.map((e) => ({
        id: e.id,
        arquivoOrigem: e.arquivoOrigem,
        modeloLlm: e.modeloLlm,
        status: e.status,
        criadoEm: e.criadoEm,
        exercicio: e.exercicio.periodo,
        totalItens: e._count.valoresExtraidos,
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
