import { prisma } from "@/lib/db"

// Protótipo é single-tenant: sempre a primeira (e única) empresa cadastrada.
export async function getDefaultEmpresa() {
  const empresa = await prisma.empresa.findFirst({ orderBy: { id: "asc" } })
  if (!empresa) {
    throw new Error("Nenhuma empresa cadastrada — rode `npx prisma db seed`.")
  }
  return empresa
}
