"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Check, Loader2, X } from "lucide-react"
import { DocumentoViewer } from "@/components/documento-viewer"
import { ExercicioPicker } from "@/components/exercicio-picker"
import { Button } from "@/components/ui/button"
import { completar, DRE_TOTAL_PREFIX, identidadesBalanco, identidadesDre, sinaisDre } from "@/lib/completar-demonstracoes"
import { collectLeaves, DRE_LINES, DRE_MEMO_LINE, flattenAccounts, formatBRL } from "@/lib/financial-data"
import { toSystemUnit, type DocumentUnit } from "@/lib/extraction/pdf-extraction"
import { parseExpressao } from "@/lib/number-input"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

// Digitação manual, com o documento ao lado (PDF escaneado, imagem, ou quando a leitura automática não serve) ou sem
// documento nenhum (o analista tem os números em mãos, no papel ou numa planilha).
//
// Balanços não têm padrão (um traz Receita Bruta e Deduções, outro traz Bruta e Líquida, outro os três), então:
//  - todo campo aceita uma conta simples ("4.133.297,81 - 3.152.704,65");
//  - os TOTAIS (grupos do Balanço, Receita Líquida, Lucro Bruto...) também são campos, opcionais: com eles, o sistema
//    calcula a parte que faltar e confere se a soma bate (lib/completar-demonstracoes.ts);
//  - só as contas analíticas e as linhas de entrada da DRE são gravadas: os totais o sistema recalcula.
// Ao confirmar, os valores vão para a Tabulação pelo mesmo caminho da extração e ficam no histórico como "Digitado pelo
// analista" (ou "Calculado a partir dos totais do documento"), com o nome do arquivo ou "Sem documento"
// (rastreabilidade, RF06).

export const SEM_DOCUMENTO = "Sem documento"

type Campo = { code: string; nome: string; recuo: number; total: boolean; dica?: string }

const SINAIS_DRE = sinaisDre()
const DEDUCOES = new Set(DRE_LINES.filter((l) => l.deduction).map((l) => `dre:${l.id}`))

const CAMPOS_DRE: Campo[] = [
  ...DRE_LINES.map((l) =>
    l.kind === "computed"
      ? { code: `${DRE_TOTAL_PREFIX}${l.id}`, nome: l.name, recuo: 0, total: true }
      : { code: `dre:${l.id}`, nome: l.name, recuo: 14, total: false, dica: l.deduction ? "pode digitar sem o sinal" : undefined },
  ),
  { code: `dre:${DRE_MEMO_LINE.id}`, nome: "Compras", recuo: 14, total: false, dica: "informativo, usado no PMPC" },
]

export function DigitacaoManual({
  file,
  exercicioInicial,
  unidadeInicial,
  valoresIniciais,
  onCancelar,
  onConcluido,
}: {
  file: File | null
  exercicioInicial: string
  unidadeInicial: DocumentUnit
  // Valores já conhecidos (ex.: o que a leitura automática achou, inclusive totais), na unidade do documento.
  valoresIniciais: Record<string, number>
  onCancelar: () => void
  onConcluido: (quantos: number, exercicio: string) => void
}) {
  const store = useFinancialStore()
  const [exercicioId, setExercicioId] = useState(exercicioInicial)
  const [unidade, setUnidade] = useState<DocumentUnit>(unidadeInicial)
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    // Com separador de milhar, como no documento ("2.278.211,52"), para conferir de olho.
    Object.fromEntries(Object.entries(valoresIniciais).map(([code, v]) => [code, v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })])),
  )
  const [salvando, setSalvando] = useState(false)

  const camposBalanco: Campo[] = useMemo(
    () => flattenAccounts(store.accounts).map(({ account, depth }) => ({ code: account.code, nome: `${account.code} ${account.name}`, recuo: depth * 14, total: !!account.children?.length })),
    [store.accounts],
  )
  const folhas = useMemo(() => new Set(collectLeaves(store.accounts).map((a) => a.code)), [store.accounts])
  const identidades = useMemo(() => [...identidadesBalanco(store.accounts), ...identidadesDre()], [store.accounts])

  // O que foi digitado (válido), com as deduções da DRE sempre negativas; depois, o que dá para calcular e conferir.
  const invalidos = Object.entries(textos).filter(([, t]) => t.trim() !== "" && parseExpressao(t) === null).map(([c]) => c)
  const { resultado, digitados } = useMemo(() => {
    const d = new Map<string, number>()
    for (const [code, texto] of Object.entries(textos)) {
      const v = parseExpressao(texto)
      if (v !== null) d.set(code, DEDUCOES.has(code) ? -Math.abs(v) : v)
    }
    return { digitados: d, resultado: completar(d, identidades, { sinais: SINAIS_DRE }) }
  }, [textos, identidades])

  // Só vai para o banco o que o sistema guarda: contas analíticas e linhas de entrada da DRE.
  const gravaveis = [...resultado.valores.entries()].filter(([code]) => folhas.has(code) || code.startsWith("dre:"))
  const bloqueado = salvando || gravaveis.length === 0 || invalidos.length > 0 || !exercicioId

  async function confirmar() {
    if (bloqueado) return
    const entries = gravaveis.map(([code, valor]) => ({
      code,
      value: toSystemUnit(valor, unidade),
      confidence: 100,
      label: resultado.calculados.has(code) ? "Calculado a partir dos totais do documento" : "Digitado pelo analista",
    }))
    setSalvando(true)
    const ok = await store.confirmExtraction(exercicioId, entries, file?.name ?? SEM_DOCUMENTO, "digitacao-manual")
    setSalvando(false)
    // Se o servidor recusou, o motivo aparece no aviso global e o que foi digitado continua na tela.
    if (ok) onConcluido(entries.length, exercicioId)
  }

  const nomeDe = (code: string) => [...camposBalanco, ...CAMPOS_DRE].find((c) => c.code === code)?.nome ?? code

  const linha = (c: Campo) => {
    const texto = textos[c.code] ?? ""
    const invalido = invalidos.includes(c.code)
    const calculado = !digitados.has(c.code) && resultado.calculados.has(c.code) ? resultado.valores.get(c.code) : undefined
    const conflito = resultado.conflitos.some((x) => x.total === c.code)
    return (
      <label
        key={c.code}
        className={cn("flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-0", c.total && "bg-muted/40")}
        style={{ paddingLeft: 12 + c.recuo }}
      >
        <span className={cn("min-w-0 flex-1 text-sm", c.total ? "font-medium text-muted-foreground" : "text-foreground")}>
          {c.nome}
          {c.total && <span className="ml-1 text-[11px] font-normal">(total, opcional)</span>}
          {c.dica && <span className="ml-1 text-[11px] text-muted-foreground">{c.dica}</span>}
          {calculado !== undefined && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary-text">calculado</span>}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTextos((t) => ({ ...t, [c.code]: e.target.value }))}
          placeholder={calculado !== undefined ? `= ${formatBRL(calculado, 2)}` : "—"}
          aria-invalid={invalido}
          aria-label={c.nome}
          className={cn(
            "w-40 rounded border bg-background px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground focus:border-ring",
            invalido || conflito ? "border-risk" : "border-border",
          )}
        />
      </label>
    )
  }

  return (
    <div className={cn("grid gap-4", file && "lg:grid-cols-2")}>
      {file && (
        <div className="h-[60vh] lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]">
          <DocumentoViewer file={file} />
        </div>
      )}

      <div className={cn("flex flex-col gap-4", !file && "mx-auto w-full max-w-3xl")}>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3">
          <label htmlFor="dm-unidade" className="text-xs text-muted-foreground">
            Valores do documento em
          </label>
          <select
            id="dm-unidade"
            value={unidade}
            onChange={(e) => setUnidade(e.target.value as DocumentUnit)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="reais">Reais (R$)</option>
            <option value="milhares">Milhares (R$ mil)</option>
          </select>
          <label htmlFor="dm-exercicio" className="text-xs text-muted-foreground">
            Gravar em
          </label>
          <ExercicioPicker id="dm-exercicio" value={exercicioId} onChange={setExercicioId} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Digite os valores como estão no {file ? "documento" : "balanço"} (ex.: 12.663.067,45). Se o documento traz um valor como conta, digite a
          conta: <code className="font-mono">4.133.297,81 - 3.152.704,65</code>. Os totais são opcionais: com eles, o
          sistema calcula a parte que faltar e confere se a soma bate. Campos em branco não mudam o que já está lançado.
        </p>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <h2 className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Balanço Patrimonial
          </h2>
          {camposBalanco.map(linha)}
        </section>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <h2 className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">DRE</h2>
          {CAMPOS_DRE.map(linha)}
        </section>

        {resultado.recusados.length > 0 && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-attention/40 bg-attention-muted px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attention" />
            <div className="text-xs leading-relaxed text-foreground">
              <p className="font-medium">Não calculei, porque o valor não faz sentido:</p>
              <ul className="mt-1 list-disc pl-4">
                {resultado.recusados.map((r) => (
                  <li key={r.code}>
                    {nomeDe(r.code)} daria {formatBRL(r.valor, 2)}, com o sinal trocado para esta linha. O documento provavelmente
                    tem linhas que a DRE do sistema não tem (ex.: outras receitas ou despesas operacionais): some-as na linha
                    correspondente ou digite este valor à mão.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {resultado.conflitos.length > 0 && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-attention/40 bg-attention-muted px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attention" />
            <div className="text-xs leading-relaxed text-foreground">
              <p className="font-medium">A soma não bate com o total informado:</p>
              <ul className="mt-1 list-disc pl-4">
                {resultado.conflitos.map((c) => {
                  const diferenca = c.informado - c.somaDasPartes
                  return (
                    <li key={c.total}>
                      {nomeDe(c.total)}: o documento diz {formatBRL(c.informado, 2)}, as contas somam {formatBRL(c.somaDasPartes, 2)}
                      {c.total.startsWith(DRE_TOTAL_PREFIX)
                        ? ` (diferença de ${formatBRL(diferenca, 2)}).`
                        : diferenca > 0
                          ? `: sobram ${formatBRL(diferenca, 2)} sem conta. O documento pode ter linhas que o Plano de Contas não tem — some o valor na conta que representa a mesma coisa (dá para digitar a conta, ex.: "2.593.791,44 + 3.800.000"), ou crie a conta no Plano de Contas.`
                          : `: as contas passam do total em ${formatBRL(-diferenca, 2)}. Confira se algum valor foi digitado duas vezes.`}
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1 text-muted-foreground">Confira a digitação. Se o documento estiver assim mesmo, você pode gravar.</p>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {invalidos.length > 0
              ? `${invalidos.length} campo(s) com valor inválido`
              : `${gravaveis.length} valor(es) a gravar${resultado.calculados.size > 0 ? `, ${[...resultado.calculados].filter((c) => folhas.has(c) || c.startsWith("dre:")).length} calculado(s)` : ""}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onCancelar} disabled={salvando}>
              <X className="size-3.5" />
              Voltar
            </Button>
            <Button size="sm" className="gap-1.5" onClick={confirmar} disabled={bloqueado}>
              {salvando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Gravar {gravaveis.length} valor(es) em {exercicioId || "—"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
