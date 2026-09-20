import { prisma } from "@/lib/db"
import { NoCompanyError } from "@/lib/server/validation"

// Protótipo é single-tenant: sempre a primeira (e única) empresa cadastrada.
export async function getDefaultEmpresa() {
  const empresa = await prisma.empresa.findFirst({ orderBy: { id: "asc" } })
  if (!empresa) {
    throw new NoCompanyError("Nenhuma empresa cadastrada.")
  }
  return empresa
}
