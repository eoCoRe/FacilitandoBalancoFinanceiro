import { flattenAccounts, INDICATORS, type Account } from "./financial-data"
import { ADMIN_NAV, ANALISE_NAV, DETALHADO_NAV, INICIO_NAV, type ScreenId } from "./navigation"

// Busca rápida (⌘K / Ctrl+K): leva a uma tela, a um índice ou a uma conta do Plano de Contas. Puro (sem React):
// monta a lista de destinos e filtra por texto sem depender de acento nem de maiúsculas.

export type SearchKind = "Tela" | "Índice" | "Conta"

export interface SearchEntry {
  id: string
  kind: SearchKind
  label: string
  // Texto extra que também conta na busca (ex.: o código da conta, a fórmula do índice).
  hint: string
  screen: ScreenId
}

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

export function buildSearchEntries({ accounts, isAdmin }: { accounts: Account[]; isAdmin: boolean }): SearchEntry[] {
  const screens = [...INICIO_NAV, ...ANALISE_NAV, ...DETALHADO_NAV, ...(isAdmin ? ADMIN_NAV : [])].map(
    (item): SearchEntry => ({ id: `tela:${item.id}`, kind: "Tela", label: item.label, hint: item.keywords ?? "", screen: item.id }),
  )
  const indices = INDICATORS.map(
    (indicator): SearchEntry => ({
      id: `indice:${indicator.id}`,
      kind: "Índice",
      label: indicator.name,
      hint: `${indicator.group} ${indicator.formula}`,
      screen: "indices",
    }),
  )
  const contas = flattenAccounts(accounts).map(
    ({ account }): SearchEntry => ({
      id: `conta:${account.code}`,
      kind: "Conta",
      label: account.name,
      hint: account.code,
      screen: "plano-de-contas",
    }),
  )
  return [...screens, ...indices, ...contas]
}

const MAX_RESULTS = 30

// Todas as palavras da busca precisam aparecer (no nome ou na dica). Ordem: nome começa com a busca, depois nome
// contém, depois só a dica; dentro de cada faixa, telas antes de índices antes de contas. Busca vazia = só as telas.
export function searchEntries(entries: SearchEntry[], query: string): SearchEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries.filter((e) => e.kind === "Tela")

  const kindOrder: Record<SearchKind, number> = { Tela: 0, Índice: 1, Conta: 2 }
  const scored: { entry: SearchEntry; rank: number }[] = []
  const whole = words.join(" ")
  for (const entry of entries) {
    const label = normalize(entry.label)
    const haystack = `${label} ${normalize(entry.hint)}`
    if (!words.every((w) => haystack.includes(w))) continue
    const rank = label.startsWith(whole) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2
    scored.push({ entry, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || kindOrder[a.entry.kind] - kindOrder[b.entry.kind])
  return scored.slice(0, MAX_RESULTS).map((s) => s.entry)
}
