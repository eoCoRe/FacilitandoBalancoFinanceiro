import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isPapel, PAPEIS } from "@/lib/permissions"
import { logAudit } from "@/lib/server/audit/audit"
import { requirePermission } from "@/lib/server/auth/authz"
import { getDefaultEmpresa } from "@/lib/server/data/empresa"
import { handleRouteError } from "@/lib/server/http"
import { mailAvailable } from "@/lib/server/mail/mail"
import { ValidationError } from "@/lib/server/validation"

// Política de segurança — só administrador. Hoje: exigir verificação em 2 etapas por perfil.
export async function GET() {
  try {
    await requirePermission("gerir-usuarios")
    const linhas = await prisma.politicaSeguranca.findMany()
    return NextResponse.json({
      emailDisponivel: mailAvailable(),
      politicas: PAPEIS.map((papel) => ({
        papel,
        doisFatoresObrigatorio: linhas.find((l) => l.papel === papel)?.doisFatoresObrigatorio ?? false,
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requirePermission("gerir-usuarios")
    const body = (await request.json()) as { papel?: unknown; doisFatoresObrigatorio?: unknown }

    if (!isPapel(body.papel)) throw new ValidationError("Perfil inválido.")
    if (typeof body.doisFatoresObrigatorio !== "boolean") {
      throw new ValidationError("doisFatoresObrigatorio deve ser verdadeiro ou falso.")
    }
    // Exigir o código por e-mail sem conseguir enviar e-mail trancaria todo mundo do lado de fora.
    if (body.doisFatoresObrigatorio && !mailAvailable()) {
      throw new ValidationError("Configure o envio de e-mail (SMTP) antes de exigir a verificação em 2 etapas.")
    }

    await prisma.politicaSeguranca.upsert({
      where: { papel: body.papel },
      update: { doisFatoresObrigatorio: body.doisFatoresObrigatorio },
      create: { papel: body.papel, doisFatoresObrigatorio: body.doisFatoresObrigatorio },
    })

    const empresa = await getDefaultEmpresa()
    await logAudit(
      empresa.id,
      "Política de 2FA alterada",
      `Perfil ${body.papel}: verificação em 2 etapas ${body.doisFatoresObrigatorio ? "obrigatória" : "opcional"}.`,
      admin.email,
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
