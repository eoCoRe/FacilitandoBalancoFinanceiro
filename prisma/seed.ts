import "dotenv/config"
import {
  COMPANY,
  createSeedAccounts,
  createSeedDfc,
  createSeedDre,
  DRE_LINES,
  DRE_MEMO_LINE,
  INDICATORS,
  SEED_EXERCICIOS,
  type Account,
} from "../lib/financial-data"
import { DEFAULT_SECTOR_ID, sectorLabel } from "../lib/sector-benchmarks"
import { prisma } from "../lib/db" // o mesmo cliente do app: assim o registro de auditoria inicial já nasce SELADO (logAudit)
import { logAudit } from "../lib/server/audit/audit"
import { assertAdminEnvValid, ensureAdmin } from "../lib/server/auth/ensure-admin"


function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Grava no Postgres a empresa, os exercícios e o Plano de Contas de demonstração de
// lib/financial-data.ts (createSeed*). Só o seed e os testes usam esses dados de exemplo;
// a interface lê tudo do banco pelas rotas de API.
async function seedContaTree(accounts: Account[], parentId: number | null, exercicioIdByPeriodo: Map<string, number>) {
  for (const account of accounts) {
    const conta = await prisma.conta.create({
      data: { codigo: account.code, descricao: account.name, tipo: "BP", contaPaiId: parentId, ehGrupo: !!account.children },
    })
    if (account.values) {
      for (const [periodo, valor] of Object.entries(account.values)) {
        const exercicioId = exercicioIdByPeriodo.get(periodo)
        if (exercicioId === undefined) continue
        await prisma.valor.create({ data: { exercicioId, contaId: conta.id, valor } })
      }
    }
    if (account.children) {
      await seedContaTree(account.children, conta.id, exercicioIdByPeriodo)
    }
  }
}

// O seed é para DESENVOLVIMENTO e demonstração: apaga empresa, plano de contas, valores, extrações e a
// auditoria (os usuários ficam). Em produção isso destruiria dados reais, então ele se recusa a rodar lá
// sem confirmação explícita. Para só criar/restabelecer o administrador, use `pnpm admin:ensure`.
function refuseInProduction() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_CONFIRM_WIPE !== "sim") {
    throw new Error(
      "O seed APAGA os dados de negócio (empresa, plano de contas, valores, extrações e auditoria) e está em NODE_ENV=production. " +
        "Para só criar o administrador, rode `pnpm admin:ensure`. Se realmente quer apagar tudo, defina SEED_CONFIRM_WIPE=sim.",
    )
  }
}

async function main() {
  refuseInProduction()
  // Antes de apagar qualquer coisa: uma SEED_ADMIN_PASSWORD que a política recusa não pode derrubar os dados e só então falhar.
  assertAdminEnvValid()
  console.log("Limpando dados existentes...")
  await prisma.valorExtraido.deleteMany()
  await prisma.extracao.deleteMany()
  await prisma.valor.deleteMany()
  await prisma.conta.deleteMany()
  await prisma.indice.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.exercicio.deleteMany()
  await prisma.empresa.deleteMany()

  console.log("Criando empresa...")
  const empresa = await prisma.empresa.create({
    data: { cnpj: COMPANY.cnpj, razaoSocial: COMPANY.name, setor: sectorLabel(DEFAULT_SECTOR_ID) },
  })

  console.log("Criando exercícios...")
  const exercicioIdByPeriodo = new Map<string, number>()
  for (const periodo of SEED_EXERCICIOS) {
    const exercicio = await prisma.exercicio.create({ data: { empresaId: empresa.id, periodo } })
    exercicioIdByPeriodo.set(periodo, exercicio.id)
  }

  console.log("Criando Plano de Contas (Balanço)...")
  await seedContaTree(createSeedAccounts(), null, exercicioIdByPeriodo)

  // Só as linhas de ENTRADA da DRE viram Conta/Valor — os totalizadores
  // (Receita Líquida, Lucro Bruto, EBIT, ...) são calculados em runtime a
  // partir delas, do mesmo jeito que computeDre() faz no frontend.
  console.log("Criando contas de DRE (linhas de entrada)...")
  const dreByExercicio = createSeedDre()
  const dreInputLines = [...DRE_LINES.filter((l) => l.kind === "input"), DRE_MEMO_LINE]
  for (const line of dreInputLines) {
    const conta = await prisma.conta.create({
      data: { codigo: line.id, descricao: line.name, tipo: "DRE" },
    })
    for (const periodo of SEED_EXERCICIOS) {
      const valor = dreByExercicio[periodo]?.[line.id]
      if (valor === undefined) continue
      const exercicioId = exercicioIdByPeriodo.get(periodo)!
      await prisma.valor.create({ data: { exercicioId, contaId: conta.id, valor } })
    }
  }

  // DFC é fora do escopo funcional (ver §2.6 do RFC) — visualização estática,
  // todas as linhas (inclusive subtotais) já vêm com valor fixo no seed.
  console.log("Criando contas de DFC...")
  for (const line of createSeedDfc()) {
    const conta = await prisma.conta.create({
      data: { codigo: slugify(line.name), descricao: line.name, tipo: "DFC" },
    })
    for (const [periodo, valor] of Object.entries(line.values)) {
      const exercicioId = exercicioIdByPeriodo.get(periodo)
      if (exercicioId === undefined) continue
      await prisma.valor.create({ data: { exercicioId, contaId: conta.id, valor } })
    }
  }

  console.log("Criando índices financeiros...")
  for (const indicator of INDICATORS) {
    await prisma.indice.create({
      data: { nome: indicator.name, formula: indicator.formula, unidade: indicator.unit },
    })
  }

  console.log("Registrando log de auditoria inicial...")
  await logAudit(
    empresa.id,
    "Dados de exemplo carregados",
    `${SEED_EXERCICIOS.length} exercícios de demonstração (${SEED_EXERCICIOS.join(", ")}).`,
    "Sistema",
  )

  await ensureAdmin(prisma)

  console.log("Seed concluído.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
