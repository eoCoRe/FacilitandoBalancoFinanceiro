// Balanços não têm padrão: um traz "Receita Bruta" e "Deduções", outro traz "Receita Bruta" e "Receita Líquida" (e não
// as deduções), outro traz os três. O mesmo no Balanço: às vezes vem o total do grupo (Ativo Circulante), às vezes
// não. Este módulo trata cada relação "total = soma das partes" como uma identidade e, com o que o analista digitou:
//  - se falta exatamente UM termo, calcula esse termo (no Balanço, só o total: ver `derivaPartes`);
//  - se estão todos, confere e aponta a diferença quando a soma não bate (acima da tolerância de arredondamento).
// Repete até não haver mais o que calcular (um valor calculado pode destravar outra identidade: Receita Líquida →
// Lucro Bruto → ...). Puro e testado; a tela de digitação manual usa.

import { DRE_LINES, type Account } from "./financial-data"

export interface Identidade {
  total: string
  partes: string[]
  // Nome para as mensagens ("Receita Líquida", "Ativo Circulante").
  nome: string
  // Se falta uma PARTE, pode calculá-la pela diferença? Na DRE, sim: cada linha é um degrau completo (Receita Líquida -
  // Receita Bruta = Deduções). No Balanço, NÃO: o documento pode ter linhas que o Plano de Contas não tem
  // ("Créditos com partes relacionadas"), e a sobra do grupo iria parar na única conta em branco, que é outra coisa.
  // Lá o sistema só calcula o total e aponta quanto sobra sem conta.
  derivaPartes: boolean
}

export interface Conflito {
  total: string
  nome: string
  informado: number
  somaDasPartes: number
}

export interface Resultado {
  valores: Map<string, number>
  // Códigos calculados pelo sistema (não digitados).
  calculados: Set<string>
  conflitos: Conflito[]
  // Cálculos RECUSADOS porque o resultado teria o sinal errado para a linha (ex.: imposto positivo): sinal de que o
  // documento tem linhas que o sistema não tem, e a diferença não é daquela linha.
  recusados: { code: string; valor: number }[]
}

// Diferença aceita como arredondamento do próprio documento (na unidade em que foi digitado).
export const TOLERANCIA = 1

const arred = (x: number) => Math.round(x * 100) / 100

// `sinais`: sinal esperado de uma linha (-1 sempre negativa, 1 sempre positiva). Um cálculo que desse o sinal errado
// não é feito (fica em `recusados`).
export function completar(
  digitados: Map<string, number>,
  identidades: Identidade[],
  { tolerancia = TOLERANCIA, sinais = new Map<string, 1 | -1>() }: { tolerancia?: number; sinais?: Map<string, 1 | -1> } = {},
): Resultado {
  const valores = new Map(digitados)
  const calculados = new Set<string>()
  const recusados = new Map<string, number>()
  let mudou = true
  while (mudou) {
    mudou = false
    for (const id of identidades) {
      const faltando = [id.total, ...id.partes].filter((c) => !valores.has(c))
      if (faltando.length !== 1) continue
      const [alvo] = faltando
      if (alvo !== id.total && !id.derivaPartes) continue
      const soma = id.partes.reduce((s, p) => s + (valores.get(p) ?? 0), 0)
      const valor = arred(alvo === id.total ? soma : valores.get(id.total)! - soma)
      const sinal = sinais.get(alvo)
      if (sinal !== undefined && valor * sinal < -tolerancia) {
        recusados.set(alvo, valor)
        continue
      }
      valores.set(alvo, valor)
      calculados.add(alvo)
      mudou = true
    }
  }
  const conflitos: Conflito[] = []
  for (const id of identidades) {
    // Com o total informado: todas as partes (ou, no Balanço, as que se conhecem) precisam fechar com ele.
    const conhecidas = id.partes.filter((p) => valores.has(p))
    if (!valores.has(id.total) || conhecidas.length === 0) continue
    if (id.derivaPartes && conhecidas.length < id.partes.length) continue
    const somaDasPartes = arred(conhecidas.reduce((s, p) => s + valores.get(p)!, 0))
    const informado = valores.get(id.total)!
    if (Math.abs(informado - somaDasPartes) > tolerancia) conflitos.push({ total: id.total, nome: id.nome, informado, somaDasPartes })
  }
  return { valores, calculados, conflitos, recusados: [...recusados].map(([code, valor]) => ({ code, valor })) }
}

// DRE: cada linha calculada = a anterior + a linha de entrada (as deduções já negativas). Códigos da extração:
// "dre:<linha>" para as de entrada e "dre=calculada:<linha>" para os totais.
export const DRE_TOTAL_PREFIX = "dre=calculada:"
export function identidadesDre(): Identidade[] {
  const cod = (id: string) => {
    const linha = DRE_LINES.find((l) => l.id === id)!
    return linha.kind === "computed" ? `${DRE_TOTAL_PREFIX}${id}` : `dre:${id}`
  }
  const nome = (id: string) => DRE_LINES.find((l) => l.id === id)!.name
  const passo = (total: string, anterior: string, entrada: string): Identidade => ({
    total: cod(total),
    partes: [cod(anterior), cod(entrada)],
    nome: nome(total),
    derivaPartes: true,
  })
  return [
    passo("receita-liquida", "receita-bruta", "deducoes"),
    passo("lucro-bruto", "receita-liquida", "cmv"),
    passo("ebit", "lucro-bruto", "despesas-operacionais"),
    passo("resultado-antes-ir", "ebit", "resultado-financeiro"),
    passo("lucro-liquido", "resultado-antes-ir", "ir-csll"),
  ]
}

// Sinal esperado das linhas de entrada da DRE: deduções (deduções, custo, despesas, IR) negativas; receita e compras
// positivas. O resultado financeiro pode ser dos dois lados.
export function sinaisDre(): Map<string, 1 | -1> {
  const m = new Map<string, 1 | -1>([["dre:receita-bruta", 1], ["dre:compras", 1]])
  for (const l of DRE_LINES) if (l.deduction) m.set(`dre:${l.id}`, -1)
  return m
}

// Balanço: cada grupo = soma dos filhos (ex.: Ativo Circulante = Disponibilidades + ... ; Passivo = Circulante +
// Exigível a LP + PL).
export function identidadesBalanco(accounts: Account[]): Identidade[] {
  const out: Identidade[] = []
  const visitar = (conta: Account) => {
    if (!conta.children?.length) return
    out.push({ total: conta.code, partes: conta.children.map((f) => f.code), nome: conta.name, derivaPartes: false })
    conta.children.forEach(visitar)
  }
  accounts.forEach(visitar)
  return out
}
