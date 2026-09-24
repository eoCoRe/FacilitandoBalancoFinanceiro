import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import {
  requireBoundedNumber,
  requireNonEmptyString,
  requirePositiveInt,
  requireRange,
  ValidationError,
} from "@/lib/server/validation"
import { upsertOrDeleteValor } from "@/lib/server/data/valores"
import { EXTRACAO_ITENS_MAX as MAX_ITENS } from "@/lib/extraction/limits"

interface ExtracaoItemInput {
  contaId: number | null
  valor: number
  confianca: number
  paginaOrigem?: number
  rotulo?: string
}


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
  const rotulo =
    item.rotulo === undefined || item.rotulo === null || item.rotulo === ""
      ? undefined
      : requireNonEmptyString(item.rotulo, `itens[${index}].rotulo`, 200)
  return { contaId, valor, confianca, paginaOrigem, rotulo }
}

// Registra o resultado de uma extração (Extração de PDF) já revisada e
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

    const empresa = await getEmpresaAtual()
    // O exercício precisa ser da empresa e as contas precisam existir: sem isso o banco recusaria no meio da
    // gravação com um erro de chave estrangeira (500), depois de parte do trabalho já feito.
    const exercicio = await prisma.exercicio.findUnique({ where: { id: exercicioId } })
    if (!exercicio || exercicio.empresaId !== empresa.id) throw new ValidationError("Exercício não encontrado.")
    const contaIds = [...new Set(itens.flatMap((item) => (item.contaId === null ? [] : [item.contaId])))]
    if (contaIds.length > 0) {
      const existentes = await prisma.conta.findMany({ where: { id: { in: contaIds } }, select: { id: true } })
      if (existentes.length !== contaIds.length) {
        throw new ValidationError("Alguma conta do Plano de Contas não existe mais. Atualize a página e revise a extração.")
      }
    }
    const modelo = modeloLlm ? requireNonEmptyString(modeloLlm, "modeloLlm") : "mock-demo-v1"

    // Tudo ou nada: a extração, as linhas lidas e os valores lançados entram juntos. Uma falha no meio não deixa
    // uma extração "concluída" no histórico com itens faltando, nem valores gravados sem o registro de auditoria.
    const { extracao, gravados } = await prisma.$transaction(
      async (tx) => {
        const criada = await tx.extracao.create({
          data: { exercicioId, arquivoOrigem, modeloLlm: modelo, status: "CONCLUIDA" },
        })
        await tx.valorExtraido.createMany({
          data: itens.map((item) => ({
            extracaoId: criada.id,
            contaId: item.contaId,
            valor: item.valor,
            paginaOrigem: item.paginaOrigem,
            confianca: item.confianca,
            rotuloOrigem: item.rotulo,
          })),
        })
        let lancados = 0
        for (const item of itens) {
          if (item.contaId === null) continue
          await upsertOrDeleteValor(item.contaId, exercicioId, item.valor, tx)
          lancados++
        }
        return { extracao: criada, gravados: lancados }
      },
      { timeout: 30_000, maxWait: 10_000 },
    )

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
    const empresa = await getEmpresaAtual()
    const extracoes = await prisma.extracao.findMany({
      // Só as da empresa (igual ao detalhe /api/extracoes/:id, que recusa extração de outra empresa).
      where: { exercicio: { empresaId: empresa.id } },
      orderBy: { criadoEm: "desc" },
      take: 20,
      include: { _count: { select: { valoresExtraidos: true } }, exercicio: true },
    })

    // Quantos itens de cada extração viraram valor (têm conta) e quantos ficaram sem conta.
    const ids = extracoes.map((e) => e.id)
    const comConta = ids.length
      ? await prisma.valorExtraido.groupBy({
          by: ["extracaoId"],
          where: { extracaoId: { in: ids }, contaId: { not: null } },
          _count: { _all: true },
        })
      : []
    const mapeadosPorExtracao = new Map(comConta.map((g) => [g.extracaoId, g._count._all]))

    return NextResponse.json({
      extracoes: extracoes.map((e) => {
        const mapeados = mapeadosPorExtracao.get(e.id) ?? 0
        return {
          id: e.id,
          arquivoOrigem: e.arquivoOrigem,
          modeloLlm: e.modeloLlm,
          status: e.status,
          criadoEm: e.criadoEm,
          exercicio: e.exercicio.periodo,
          totalItens: e._count.valoresExtraidos,
          mapeados,
          naoMapeados: e._count.valoresExtraidos - mapeados,
        }
      }),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
