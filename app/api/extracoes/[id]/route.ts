import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { requirePositiveInt, ValidationError } from "@/lib/server/validation"

interface RouteParams {
  params: Promise<{ id: string }>
}

// Rastreabilidade (RF06): tudo o que o leitor extraiu de um documento — o texto original, a página, a
// confiança e a conta do Plano de Contas a que foi ligado (ou "sem conta"), inclusive as linhas que NÃO
// viraram valor. Só extrações do exercício da empresa.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    await requirePermission("consultar")
    const { id } = await params
    const extracaoId = requirePositiveInt(Number(id), "id")

    const empresa = await getDefaultEmpresa()
    const extracao = await prisma.extracao.findUnique({
      where: { id: extracaoId },
      include: {
        exercicio: true,
        valoresExtraidos: { orderBy: { id: "asc" }, include: { conta: { select: { codigo: true, descricao: true } } } },
      },
    })
    if (!extracao || extracao.exercicio.empresaId !== empresa.id) throw new ValidationError("Extração não encontrada.")

    return NextResponse.json({
      id: extracao.id,
      arquivoOrigem: extracao.arquivoOrigem,
      modeloLlm: extracao.modeloLlm,
      status: extracao.status,
      criadoEm: extracao.criadoEm,
      exercicio: extracao.exercicio.periodo,
      itens: extracao.valoresExtraidos.map((v) => ({
        id: v.id,
        rotulo: v.rotuloOrigem,
        valor: Number(v.valor),
        pagina: v.paginaOrigem,
        confianca: v.confianca,
        conta: v.conta ? { codigo: v.conta.codigo, descricao: v.conta.descricao } : null,
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
