import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { ValidationError } from "@/lib/server/validation"

// Máximo de registros da trilha incluídos no arquivo (as ações mais recentes da pessoa).
const ACOES_MAX = 5000

// Direito de acesso do TITULAR (LGPD Art. 18, II) para quem USA o sistema: cada pessoa baixa os dados pessoais
// que o sistema guarda sobre ELA — cadastro, forma de acesso, últimos acessos e as ações que ela registrou.
// (O /api/lgpd/exportacao, só do administrador, trata os dados da empresa-cliente.)
//
// Só a própria pessoa: o usuário vem da sessão, nunca de parâmetro. E só o que é dela ou útil a ela — o hash da
// senha, o identificador interno do Google e o controle de sessões NÃO saem (segredos/mecanismo interno).
export async function GET() {
  try {
    const user = await requireUser()
    const usuario = await prisma.usuario.findUnique({ where: { id: user.id } })
    if (!usuario) throw new ValidationError("Usuário não encontrado.")

    const acoes = await prisma.auditLog.findMany({
      where: { usuario: usuario.email },
      orderBy: { id: "desc" },
      take: ACOES_MAX,
      select: { criadoEm: true, acao: true, detalhe: true },
    })

    const agora = new Date()
    const corpo = {
      geradoEm: agora.toISOString(),
      sobre:
        "Dados pessoais que a Central de Balanços guarda sobre você. Não inclui segredos (senha, chaves) nem dados de outras pessoas.",
      cadastro: {
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.papel,
        ativo: usuario.ativo,
        criadoEm: usuario.criadoEm,
        ultimoAcessoEm: usuario.ultimoLoginEm,
      },
      formasDeAcesso: {
        senha: usuario.senhaHash !== null,
        contaGoogleVinculada: usuario.googleSub !== null,
        verificacaoEmDuasEtapas: usuario.doisFatoresAtivo,
        aplicativoAutenticador: usuario.totpAtivo,
      },
      acoesRegistradas: {
        total: acoes.length,
        limitadoA: ACOES_MAX,
        itens: acoes.map((a) => ({ quando: a.criadoEm, acao: a.acao, detalhe: a.detalhe })),
      },
      retencao:
        "A trilha de auditoria é guardada pelo prazo de retenção definido pela organização (padrão: 730 dias) e o cadastro enquanto a conta existir. Para corrigir ou eliminar dados, fale com um administrador.",
    }

    await logAuditSafe("Dados pessoais exportados", "O próprio usuário baixou os seus dados (LGPD, direito de acesso).", usuario.email)

    return new NextResponse(JSON.stringify(corpo, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="meus-dados-${agora.toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
