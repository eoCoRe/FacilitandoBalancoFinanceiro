// Médias (medianas) setoriais dos índices a partir das demonstrações das companhias abertas publicadas pela CVM
// (Dados Abertos, DFP — Demonstrações Financeiras Padronizadas). Puro, sem rede nem arquivo: o script
// scripts/atualizar-medias-setoriais.ts baixa os dados e chama estas funções; os testes usam empresas sintéticas.
//
// Metodologia (vai para a tela e para a monografia):
//  - Uma empresa entra se usa o plano de contas padrão da CVM para empresas não financeiras (1.01 = "Ativo Circulante",
//    3.01 = "Receita de Venda de Bens e/ou Serviços"). Bancos, seguradoras e afins ficam de fora (outro plano de contas).
//  - Demonstração consolidada quando existe; senão, a individual. Exercício mais recente (ORDEM_EXERC = "ÚLTIMO").
//  - Cada índice só é calculado quando o denominador é positivo (ROE e imobilização exigem PL positivo).
//  - A referência do setor é a MEDIANA das empresas do setor: resiste a valores extremos, que a média não aguenta.
//  - Aproximações declaradas: PMRV usa a receita LÍQUIDA (a DFP não traz a bruta); PMPC não tem referência (a DFP não
//    traz as compras).

export interface ContasEmpresa {
  valor(codigo: string): number | undefined
  descricao(codigo: string): string | undefined
}

export function usaPlanoPadrao(c: ContasEmpresa): boolean {
  return c.descricao("1.01") === "Ativo Circulante" && (c.descricao("3.01") ?? "").startsWith("Receita de Venda")
}

function razao(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined || !(b > 0)) return undefined
  return a / b
}
const vezes = (x: number | undefined, k: number) => (x === undefined ? undefined : x * k)

// Os mesmos índices de lib/financial-data.ts (INDICATORS), com as contas da DFP.
export function indicadoresDaEmpresa(c: ContasEmpresa): Record<string, number | undefined> {
  const v = (codigo: string) => c.valor(codigo)
  const ativo = v("1")
  const ac = v("1.01")
  const pc = v("2.01")
  const pnc = v("2.02") ?? 0
  const pl = v("2.03")
  const rlp = v("1.02.01") ?? 0
  const estoques = c.descricao("1.01.04")?.startsWith("Estoque") ? (v("1.01.04") ?? 0) : 0
  const receita = v("3.01")
  const custo = v("3.02")
  const lucro = v("3.11")
  const permanente = (v("1.02.02") ?? 0) + (v("1.02.03") ?? 0) + (v("1.02.04") ?? 0)
  const dividas = pc === undefined ? undefined : pc + pnc
  const plPositivo = pl !== undefined && pl > 0 ? pl : undefined

  return {
    "liquidez-corrente": razao(ac, pc),
    "liquidez-seca": razao(ac === undefined ? undefined : ac - estoques, pc),
    "liquidez-geral": razao(ac === undefined ? undefined : ac + rlp, dividas),
    "liquidez-imediata": razao(v("1.01.01"), pc),
    "endividamento-geral": vezes(razao(dividas, ativo), 100),
    "composicao-endividamento": vezes(razao(pc, dividas), 100),
    "imobilizacao-pl": vezes(razao(permanente, plPositivo), 100),
    "margem-bruta": vezes(razao(v("3.03"), receita), 100),
    "margem-liquida": vezes(razao(lucro, receita), 100),
    roe: vezes(razao(lucro, plPositivo), 100),
    roa: vezes(razao(lucro, ativo), 100),
    // Sem receita (pré-operacional, holding pura) o giro seria 0 e puxaria a mediana: fica sem valor.
    "giro-ativo": receita !== undefined && receita > 0 ? razao(receita, ativo) : undefined,
    pmre: vezes(razao(estoques, custo === undefined ? undefined : Math.abs(custo)), 360),
    pmrv: vezes(razao(v("1.01.03"), receita), 360),
  }
}

export function mediana(valores: number[]): number | undefined {
  const xs = valores.filter(Number.isFinite).sort((a, b) => a - b)
  if (xs.length === 0) return undefined
  const meio = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[meio] : (xs[meio - 1] + xs[meio]) / 2
}

// Setor da CVM (campo SETOR_ATIV do cadastro) → setor do sistema (lib/sector-benchmarks.ts). As holdings
// ("Emp. Adm. Part. - <setor>") entram no setor de que participam: a demonstração consolidada é a das controladas.
// Fora (null): financeiras (outro plano de contas) e setores regulados de infraestrutura (energia, saneamento,
// petróleo, mineração), cuja estrutura de capital é muito diferente da de um cliente típico de análise de crédito.
export const SETORES_CVM: Record<string, string[]> = {
  "comercio-varejista": ["Comércio (Atacado e Varejo)"],
  industria: [
    "Máquinas, Equipamentos, Veículos e Peças",
    "Máqs., Equip., Veíc. e Peças",
    "Metalurgia e Siderurgia",
    "Têxtil e Vestuário",
    "Alimentos",
    "Bebidas e Fumo",
    "Farmacêutico e Higiene",
    "Petroquímicos e Borracha",
    "Papel e Celulose",
    "Embalagens",
  ],
  servicos: [
    "Serviços Transporte e Logística",
    "Serviços Médicos",
    "Serviços médicos",
    "Comunicação e Informática",
    "Telecomunicações",
    "Educação",
    "Hospedagem e Turismo",
    "Brinquedos e Lazer",
  ],
  "construcao-civil": ["Construção Civil, Mat. Constr. e Decoração", "Const. Civil, Mat. Const. e Decoração"],
  agronegocio: ["Agricultura (Açúcar, Álcool e Cana)"],
}

export function setorDoSistema(setorCvm: string): string | null {
  const setor = setorCvm.replace(/^Emp\. Adm\. Part\. - /, "").trim()
  for (const [id, nomes] of Object.entries(SETORES_CVM)) if (nomes.includes(setor)) return id
  return null
}

export interface MediasDoSetor {
  empresas: number
  medianas: Record<string, number>
  // Quantas empresas entraram em cada índice (as outras não tinham o dado, ou o denominador não era positivo).
  amostras: Record<string, number>
}

export function mediasPorSetor(empresas: { setorCvm: string; contas: ContasEmpresa }[]): Record<string, MediasDoSetor> {
  const porSetor: Record<string, Record<string, number>[]> = {}
  for (const { setorCvm, contas } of empresas) {
    const setor = setorDoSistema(setorCvm)
    if (!setor || !usaPlanoPadrao(contas)) continue
    ;(porSetor[setor] ??= []).push(
      Object.fromEntries(Object.entries(indicadoresDaEmpresa(contas)).filter(([, x]) => x !== undefined)) as Record<string, number>,
    )
  }
  const resultado: Record<string, MediasDoSetor> = {}
  for (const [setor, linhas] of Object.entries(porSetor)) {
    const medianas: Record<string, number> = {}
    const amostras: Record<string, number> = {}
    for (const indicador of new Set(linhas.flatMap((l) => Object.keys(l)))) {
      const valores = linhas.flatMap((l) => (l[indicador] === undefined ? [] : [l[indicador]]))
      const m = mediana(valores)
      if (m === undefined) continue
      medianas[indicador] = Math.round(m * 100) / 100
      amostras[indicador] = valores.length
    }
    resultado[setor] = { empresas: linhas.length, medianas, amostras }
  }
  return resultado
}
