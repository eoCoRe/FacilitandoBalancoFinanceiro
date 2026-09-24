import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { mediasPorSetor, SETORES_CVM, type ContasEmpresa } from "@/lib/setores/medias-cvm"
import { lerArquivoDoZip } from "./lib/zip"

// Recalcula as referências setoriais dos índices (tela Índices, coluna "Mediana do setor") a partir dos dados abertos
// da CVM e grava lib/setores/medias-cvm.json, que vai para o repositório — o app não acessa a internet para isso.
//
//   pnpm setores:atualizar            (exercício do ano passado)
//   pnpm setores:atualizar --ano 2024
//
// Metodologia em lib/setores/medias-cvm.ts. Fontes (Portal de Dados Abertos da CVM, licença aberta):
//   DFP: https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp
//   Cadastro (setor de atividade): https://dados.cvm.gov.br/dataset/cia_aberta-cad

const BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA"
const argAno = process.argv.indexOf("--ano")
const ANO = argAno >= 0 ? Number(process.argv[argAno + 1]) : new Date().getFullYear() - 1

const latin1 = new TextDecoder("latin1")

async function baixar(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// CSV da CVM: ";" como separador, sem aspas, primeira linha = cabeçalho, codificação ISO-8859-1.
function* linhas(csv: string): Generator<Record<string, string>> {
  const texto = csv.split(/\r?\n/)
  const cabecalho = texto[0].split(";")
  for (let i = 1; i < texto.length; i++) {
    if (!texto[i]) continue
    const campos = texto[i].split(";")
    yield Object.fromEntries(cabecalho.map((c, j) => [c, campos[j] ?? ""]))
  }
}

class Contas implements ContasEmpresa {
  valores = new Map<string, number>()
  descricoes = new Map<string, string>()
  valor(codigo: string) {
    return this.valores.get(codigo)
  }
  descricao(codigo: string) {
    return this.descricoes.get(codigo)
  }
}

async function main() {
  if (!Number.isInteger(ANO) || ANO < 2010) throw new Error("Use --ano com um ano de 2010 em diante.")
  console.log(`Baixando a DFP ${ANO} e o cadastro de companhias da CVM...`)
  const [zip, cadastro] = await Promise.all([baixar(`${BASE}/DOC/DFP/DADOS/dfp_cia_aberta_${ANO}.zip`), baixar(`${BASE}/CAD/DADOS/cad_cia_aberta.csv`)])
  const arquivo = (nome: string) => {
    const conteudo = lerArquivoDoZip(zip, nome)
    if (!conteudo) throw new Error(`${nome} não está no ZIP da CVM.`)
    return latin1.decode(conteudo)
  }

  // Setor de cada companhia (um CNPJ pode ter mais de um registro: vale o que está ATIVO, se houver).
  const setor = new Map<string, string>()
  for (const l of linhas(latin1.decode(cadastro))) {
    if (!l.SETOR_ATIV) continue
    if (!setor.has(l.CNPJ_CIA) || l.SIT === "ATIVO") setor.set(l.CNPJ_CIA, l.SETOR_ATIV)
  }

  // Versão mais recente da DFP de cada companhia (reapresentações têm VERSAO maior).
  const versao = new Map<string, string>()
  for (const l of linhas(arquivo(`dfp_cia_aberta_${ANO}.csv`))) {
    if (!versao.has(l.CNPJ_CIA) || Number(l.VERSAO) > Number(versao.get(l.CNPJ_CIA))) versao.set(l.CNPJ_CIA, l.VERSAO)
  }

  // Contas do exercício mais recente, consolidadas e individuais.
  const contas = { con: new Map<string, Contas>(), ind: new Map<string, Contas>() }
  for (const tipo of ["con", "ind"] as const) {
    for (const demo of ["BPA", "BPP", "DRE"]) {
      for (const l of linhas(arquivo(`dfp_cia_aberta_${demo}_${tipo}_${ANO}.csv`))) {
        if (l.ORDEM_EXERC !== "ÚLTIMO" || l.VERSAO !== versao.get(l.CNPJ_CIA)) continue
        let c = contas[tipo].get(l.CNPJ_CIA)
        if (!c) contas[tipo].set(l.CNPJ_CIA, (c = new Contas()))
        c.valores.set(l.CD_CONTA, Number(l.VL_CONTA))
        c.descricoes.set(l.CD_CONTA, l.DS_CONTA)
      }
    }
  }

  // Consolidada quando existe (reflete o grupo econômico); senão, a individual.
  const empresas = [...versao.keys()].flatMap((cnpj) => {
    const c = contas.con.get(cnpj)?.valor("1") !== undefined ? contas.con.get(cnpj) : contas.ind.get(cnpj)
    const s = setor.get(cnpj)
    return c && s ? [{ setorCvm: s, contas: c }] : []
  })

  const setores = mediasPorSetor(empresas)
  const saida = {
    fonte: "CVM — Portal de Dados Abertos: DFP (Demonstrações Financeiras Padronizadas) das companhias abertas",
    url: "https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp",
    exercicio: ANO,
    geradoEm: new Date().toISOString().slice(0, 10),
    estatistica: "mediana",
    setoresCvm: SETORES_CVM,
    setores,
  }
  const destino = fileURLToPath(new URL("../lib/setores/medias-cvm.json", import.meta.url))
  writeFileSync(destino, JSON.stringify(saida, null, 2) + "\n")

  console.log(`\n${empresas.length} companhias com setor na DFP ${ANO}. Referências por setor (mediana):`)
  for (const [id, s] of Object.entries(setores)) {
    console.log(`  ${id}: ${s.empresas} empresas · LC ${s.medianas["liquidez-corrente"]} · Endiv. ${s.medianas["endividamento-geral"]}% · Margem líq. ${s.medianas["margem-liquida"]}%`)
  }
  console.log(`\nGravado em ${destino}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
