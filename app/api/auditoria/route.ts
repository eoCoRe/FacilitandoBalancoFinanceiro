import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePermission } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { getDefaultEmpresa } from "@/lib/server/empresa"

// Trilha de auditoria (RF08) — equivalente a `store.auditLog`, agora persistida.
export async function GET() {
  try {
    await requirePermission("consultar")
    const empresa = await getDefaultEmpresa()
    const logs = await prisma.auditLog.findMany({
      where: { empresaId: empresa.id },
      orderBy: { criadoEm: "desc" },
      take: 50,
    })
    return NextResponse.json({ logs })
  } catch (error) {
    return handleRouteError(error)
  }
}
