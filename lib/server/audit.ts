import { prisma } from "@/lib/db"

// RNF03 (Auditabilidade). `usuario` é o e-mail de quem agiu (o da sessão); "Sistema" fica só
// para o que não tem pessoa por trás (seed, rotinas). Guardamos o texto e não uma FK para
// que a trilha sobreviva mesmo se o cadastro do usuário mudar.
export async function logAudit(empresaId: number, acao: string, detalhe: string, usuario = "Sistema") {
  return prisma.auditLog.create({ data: { empresaId, usuario, acao, detalhe } })
}

// Para eventos que acontecem ANTES de haver sessão (login, login recusado): falhar em
// registrar a auditoria não pode impedir nem mascarar o resultado do login.
export async function logAuditSafe(acao: string, detalhe: string, usuario: string) {
  try {
    const empresa = await prisma.empresa.findFirst({ orderBy: { id: "asc" } })
    if (empresa) await logAudit(empresa.id, acao, detalhe, usuario.slice(0, 254))
  } catch {
    // sem empresa cadastrada ou banco indisponível — o login segue o seu curso.
  }
}
