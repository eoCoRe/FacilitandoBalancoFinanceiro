import { prisma } from "@/lib/db"
import { UnauthorizedError, ValidationError } from "./validation"

// Guarda de acesso provisória para os endpoints de direitos do titular (LGPD Art. 18):
// exercer o direito de acesso/exportação ou de eliminação não pode ficar aberto sem
// nenhum controle, mas o sistema ainda não tem autenticação real (RNF02, decisão
// explícita do usuário de deixar para depois — ver SECURITY.md). Um segredo compartilhado
// é o mínimo defensável até existir login de verdade; não é a solução final.
// Fail-closed: sem a variável configurada, o endpoint não funciona (não abre sozinho).
export function requireLgpdToken(request: Request): void {
  const expected = process.env.LGPD_ADMIN_TOKEN
  if (!expected) {
    throw new Error("LGPD_ADMIN_TOKEN não configurada — veja .env.example")
  }
  const provided = request.headers.get("x-lgpd-token")
  if (provided !== expected) {
    throw new UnauthorizedError("Token de acesso LGPD ausente ou inválido (header x-lgpd-token).")
  }
}

// Direito de acesso e portabilidade (LGPD Art. 18, II e V) — snapshot de tudo que o
// sistema tem sobre a empresa (protótipo é single-tenant, então "a empresa" é sempre a
// mesma), pronto para entregar ao titular ou a quem ele autorizar.
export async function exportEmpresaData(empresaId: number) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    include: {
      exercicios: {
        include: {
          valores: { include: { conta: true } },
          extracoes: { include: { valoresExtraidos: true } },
        },
      },
      auditLogs: true,
    },
  })
  if (!empresa) throw new ValidationError("Empresa não encontrada.")
  return empresa
}

// Direito de eliminação (LGPD Art. 18, VI). Conta/Indice não têm empresaId (são
// estrutura global do Plano de Contas/catálogo, não dado pessoal) e por isso não são
// apagados — só Exercicio/Valor/Extracao/ValorExtraido/AuditLog da empresa, via cascade
// do schema ao apagar Empresa. O próprio apagamento é registrado em LgpdErasureLog (sem
// relação com Empresa, de propósito) na mesma transação, para sobreviver à exclusão que
// documenta.
export async function eraseEmpresaData(empresaId: number, solicitadoPor?: string) {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } })
  if (!empresa) throw new ValidationError("Empresa não encontrada.")

  const [exercicios, valores, extracoes, auditLogs] = await Promise.all([
    prisma.exercicio.count({ where: { empresaId } }),
    prisma.valor.count({ where: { exercicio: { empresaId } } }),
    prisma.extracao.count({ where: { exercicio: { empresaId } } }),
    prisma.auditLog.count({ where: { empresaId } }),
  ])
  const registrosApagados = { exercicios, valores, extracoes, auditLogs }

  await prisma.$transaction([
    prisma.lgpdErasureLog.create({
      data: {
        empresaId,
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        registrosApagados,
        solicitadoPor: solicitadoPor ?? "Sistema",
      },
    }),
    prisma.empresa.delete({ where: { id: empresaId } }),
  ])

  return { empresaId, cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, registrosApagados }
}
