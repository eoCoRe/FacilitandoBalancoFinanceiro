import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isPapel } from "@/lib/permissions"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { getEmpresaAtual } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { hashPassword, requireValidPassword } from "@/lib/server/auth/password"
import { toUsuarioDto } from "@/lib/server/data/usuarios"
import { requireNonEmptyString, requirePositiveInt, ValidationError } from "@/lib/server/validation"

interface RouteParams {
  params: Promise<{ id: string }>
}

// Altera nome, perfil, situação (ativo) e/ou redefine a senha de um usuário. Usuário não é
// apagado, só desativado — a trilha de auditoria continua apontando para alguém que existiu.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const admin = await requirePermission("gerir-usuarios")
    const { id } = await params
    const usuarioId = requirePositiveInt(Number(id), "id")

    const body = (await request.json()) as {
      nome?: unknown
      papel?: unknown
      ativo?: unknown
      senha?: unknown
      doisFatoresAtivo?: unknown
    }
    if (
      body.nome === undefined &&
      body.papel === undefined &&
      body.ativo === undefined &&
      body.senha === undefined &&
      body.doisFatoresAtivo === undefined
    ) {
      throw new ValidationError("Informe nome, papel, ativo, senha e/ou doisFatoresAtivo.")
    }

    const alvo = await prisma.usuario.findUnique({ where: { id: usuarioId } })
    if (!alvo) throw new ValidationError("Usuário não encontrado.")

    const data: {
      nome?: string
      papel?: "ANALISTA" | "COORDENADOR" | "ADMINISTRADOR"
      ativo?: boolean
      senhaHash?: string
      sessoesValidasDesde?: Date
      doisFatoresAtivo?: boolean
      totpAtivo?: boolean
      totpSegredo?: null
      totpUltimoPasso?: null
    } = {}
    const mudancas: string[] = []

    if (body.nome !== undefined) {
      data.nome = requireNonEmptyString(body.nome, "Nome")
      mudancas.push("nome")
    }
    if (body.papel !== undefined) {
      if (!isPapel(body.papel)) throw new ValidationError("Perfil inválido.")
      data.papel = body.papel
      mudancas.push(`perfil → ${body.papel}`)
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new ValidationError("ativo deve ser verdadeiro ou falso.")
      data.ativo = body.ativo
      // Mudar a situação (desativar OU reativar) zera as sessões abertas: sem isso, um cookie roubado antes da
      // desativação voltaria a valer se a conta fosse reativada dentro do prazo do token.
      data.sessoesValidasDesde = new Date()
      mudancas.push(body.ativo ? "reativado" : "desativado")
    }
    if (body.doisFatoresAtivo !== undefined) {
      // Só desligar: ligar exige o código do próprio usuário (e-mail ou app). O caso de uso é a pessoa
      // ter perdido o acesso à caixa de e-mail ou ao celular e não conseguir mais entrar — por isso
      // desliga TODOS os fatores (e-mail e app autenticador, com os códigos de recuperação).
      if (body.doisFatoresAtivo !== false) throw new ValidationError("O administrador só pode desligar o 2FA de um usuário.")
      data.doisFatoresAtivo = false
      data.totpAtivo = false
      data.totpSegredo = null
      data.totpUltimoPasso = null
      mudancas.push("2FA desligado (e-mail e aplicativo)")
    }
    if (body.senha !== undefined) {
      data.senhaHash = await hashPassword(requireValidPassword(body.senha, "Senha", { email: alvo.email }))
      // Encerra as sessões abertas dessa pessoa: redefinir a senha costuma ser resposta a
      // uma suspeita de acesso indevido.
      data.sessoesValidasDesde = new Date()
      mudancas.push("senha redefinida")
    }

    // Travas contra deixar o sistema sem ninguém que consiga administrá-lo.
    const perdeAdmin =
      alvo.papel === "ADMINISTRADOR" &&
      alvo.ativo &&
      ((data.papel !== undefined && data.papel !== "ADMINISTRADOR") || data.ativo === false)
    if (perdeAdmin) {
      if (alvo.id === admin.id) {
        throw new ValidationError("Você não pode rebaixar nem desativar a si mesmo. Peça a outro administrador.")
      }
    }

    const atualizado = perdeAdmin
      ? // Contar e atualizar precisam ser UMA operação: dois administradores se rebaixando ao mesmo tempo passariam os dois
        // pela contagem e deixariam o sistema sem nenhum. Travar as linhas dos administradores ativos faz o segundo esperar
        // o primeiro terminar e contar de novo.
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM usuario WHERE papel = 'ADMINISTRADOR' AND ativo = true FOR UPDATE`
          const outrosAdmins = await tx.usuario.count({
            where: { papel: "ADMINISTRADOR", ativo: true, id: { not: alvo.id } },
          })
          if (outrosAdmins === 0) throw new ValidationError("Não é possível remover o último administrador ativo.")
          return tx.usuario.update({ where: { id: usuarioId }, data })
        })
      : await prisma.usuario.update({ where: { id: usuarioId }, data })
    if (body.doisFatoresAtivo === false) await prisma.codigoRecuperacao.deleteMany({ where: { usuarioId } })

    const empresa = await getEmpresaAtual()
    await logAudit(empresa.id, "Usuário atualizado", `${alvo.email}: ${mudancas.join(", ")}.`, admin.email)

    return NextResponse.json(toUsuarioDto(atualizado))
  } catch (error) {
    return handleRouteError(error)
  }
}
