"use client"

import { useMemo, useState } from "react"
import { Check, History, Plus, X } from "lucide-react"
import { GlossaryTerm } from "@/components/glossary-term"
import { PageHeader } from "@/components/page-header"
import { ScaleToggle } from "@/components/scale-toggle"
import { useFinancialStore } from "@/lib/store"
import {
  DRE_LINES,
  DRE_MEMO_LINE,
  accountTotalByName,
  computeDre,
  flattenAccounts,
  formatScaled,
  sumAccount,
  type Account,
  type Scale,
} from "@/lib/financial-data"
import { cn } from "@/lib/utils"

type SubTab = "balanco" | "dre"

function parseInputNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const num = Number.parseFloat(trimmed.replace(/\./g, "").replace(",", "."))
  return Number.isNaN(num) ? undefined : num
}

function displayValue(value: number | undefined): string {
  return value === undefined ? "" : String(value)
}

export function TabulacaoScreen() {
  const store = useFinancialStore()
  const [tab, setTab] = useState<SubTab>("balanco")
  const [scale, setScale] = useState<Scale>("milhares")
  const [exercicioId, setExercicioId] = useState<string>(store.exercicios[store.exercicios.length - 1]?.id ?? "")
  const [creatingExercicio, setCreatingExercicio] = useState(false)
  const [newExercicioLabel, setNewExercicioLabel] = useState("")

  const activeExercicioId = store.exercicios.some((e) => e.id === exercicioId)
    ? exercicioId
    : (store.exercicios[store.exercicios.length - 1]?.id ?? "")

  const rows = useMemo(() => flattenAccounts(store.accounts), [store.accounts])

  const ativoTotal = accountTotalByName(store.accounts, "Ativo", activeExercicioId)
  const passivoTotal = accountTotalByName(store.accounts, "Passivo", activeExercicioId)
  const hasAnyValue = rows.some(
    (r) => !r.account.children && r.account.values?.[activeExercicioId] !== undefined,
  )
  const consistency: "pendente" | "ok" | "risco" =
    !hasAnyValue || ativoTotal === undefined || passivoTotal === undefined
      ? "pendente"
      : Math.abs(ativoTotal - passivoTotal) < 0.005
        ? "ok"
        : "risco"

  const dreInputs = store.dreByExercicio[activeExercicioId] ?? {}
  const dreComputed = computeDre(dreInputs)

  const recentAudit = store.auditLog.slice(0, 6)

  function handleCreateExercicio() {
    const label = newExercicioLabel.trim()
    if (!label) return
    const id = store.addExercicio(label)
    setExercicioId(id)
    setNewExercicioLabel("")
    setCreatingExercicio(false)
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Lançamentos"
        title="Tabulação"
        subtitle="Informe os valores do Balanço e da DRE por exercício. Os totalizadores são calculados automaticamente."
        actions={<ScaleToggle value={scale} onChange={setScale} />}
      />

      {/* Sub-abas + seletor de exercício */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-8">
        <div className="flex gap-1" role="tablist" aria-label="Demonstração">
          {(
            [
              { id: "balanco" as const, label: "Balanço Patrimonial" },
              { id: "dre" as const, label: "DRE" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
                tab === t.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 py-2">
          <label htmlFor="exercicio-select" className="text-xs text-muted-foreground">
            Exercício
          </label>
          <select
            id="exercicio-select"
            value={activeExercicioId}
            onChange={(e) => setExercicioId(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
          >
            {store.exercicios.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.label}
              </option>
            ))}
          </select>

          {creatingExercicio ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newExercicioLabel}
                onChange={(e) => setNewExercicioLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateExercicio()
                  if (e.key === "Escape") setCreatingExercicio(false)
                }}
                placeholder="ex: 2T2026"
                className="w-28 rounded-md border border-ring bg-background px-2 py-1.5 text-sm text-foreground outline-none"
              />
              <button
                type="button"
                onClick={handleCreateExercicio}
                className="flex size-7 items-center justify-center rounded-md text-ok hover:bg-ok-muted"
                aria-label="Confirmar novo exercício"
              >
                <Check className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCreatingExercicio(false)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Cancelar"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingExercicio(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Novo exercício
            </button>
          )}
        </div>
      </div>

      <div className="px-8 py-6">
        {tab === "balanco" && (
          <BalancoTab
            rows={rows}
            exercicioId={activeExercicioId}
            scale={scale}
            onChange={(code, raw) => store.updateAccountValue(code, activeExercicioId, parseInputNumber(raw))}
          />
        )}

        {tab === "dre" && (
          <DreTab
            inputs={dreInputs}
            computed={dreComputed}
            exercicioId={activeExercicioId}
            scale={scale}
            onChange={(lineId, raw) => store.updateDreValue(activeExercicioId, lineId, parseInputNumber(raw))}
          />
        )}
      </div>

      {/* Rodapé: verificação de consistência (RF05) */}
      {tab === "balanco" && (
        <div className="px-8 pb-4">
          <div
            className={cn(
              "flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
              consistency === "ok" && "border-ok/30 bg-ok-muted",
              consistency === "risco" && "border-risk/30 bg-risk-muted",
              consistency === "pendente" && "border-border bg-muted/40",
            )}
          >
            <p
              className={cn(
                "text-[11px] font-medium uppercase tracking-wider",
                consistency === "ok" && "text-ok/80",
                consistency === "risco" && "text-risk/80",
                consistency === "pendente" && "text-muted-foreground",
              )}
            >
              Consistência Ativo × Passivo — {activeExercicioId}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums",
                consistency === "ok" && "border-ok/30 text-ok",
                consistency === "risco" && "border-risk/30 text-risk",
                consistency === "pendente" && "border-border text-muted-foreground",
              )}
            >
              {consistency === "ok" && (
                <>
                  <Check className="size-3.5" /> OK
                </>
              )}
              {consistency === "risco" && (
                <>
                  <X className="size-3.5" /> Inconsistente · Δ{" "}
                  {formatScaled((ativoTotal ?? 0) - (passivoTotal ?? 0), scale)}
                </>
              )}
              {consistency === "pendente" && "Sem dados suficientes"}
            </span>
          </div>
        </div>
      )}

      {/* Trilha de auditoria (RF08) */}
      <div className="mx-8 mb-6 rounded-md border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <History className="size-3.5 text-muted-foreground" />
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Últimas alterações
          </p>
        </div>
        <ul className="max-h-40 divide-y divide-border overflow-auto">
          {recentAudit.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
              <span className="text-foreground">
                <span className="font-medium">{entry.user}</span> · {entry.action} — {entry.detail}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {new Date(entry.timestamp).toLocaleString("pt-BR")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function BalancoTab({
  rows,
  exercicioId,
  scale,
  onChange,
}: {
  rows: { account: Account; depth: number }[]
  exercicioId: string
  scale: Scale
  onChange: (code: string, raw: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="max-h-[calc(100dvh-26rem)] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-card">
              <th className="sticky left-0 z-20 bg-card px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Conta
              </th>
              <th className="w-40 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, depth }) => {
              const isLeaf = !account.children
              const isRoot = depth === 0
              return (
                <tr key={account.code} className={cn("border-b border-border last:border-0", isRoot && "bg-primary/[0.03]")}>
                  <td
                    className={cn("sticky left-0 z-[1] bg-card px-4 py-1.5", isRoot && "bg-muted")}
                    style={{ paddingLeft: `${depth * 18 + 16}px` }}
                  >
                    <span className="mr-2 font-mono text-[11px] tabular-nums text-muted-foreground">{account.code}</span>
                    <GlossaryTerm
                      term={account.name}
                      className={cn("text-foreground", isRoot ? "font-semibold" : !isLeaf ? "font-medium" : "")}
                    />
                  </td>
                  <td className="px-2 py-1">
                    {isLeaf ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={displayValue(account.values?.[exercicioId])}
                        onChange={(e) => onChange(account.code, e.target.value)}
                        placeholder="—"
                        className="w-full rounded-[calc(var(--radius)*0.6)] border border-transparent bg-transparent px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground outline-none transition-colors hover:border-border focus:border-ring focus:bg-background"
                        aria-label={`${account.name} — ${exercicioId}`}
                      />
                    ) : (
                      <div
                        className={cn(
                          "px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground",
                          isRoot ? "font-semibold" : "font-medium",
                        )}
                      >
                        {formatScaled(sumAccount(account, exercicioId), scale)}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DreTab({
  inputs,
  computed,
  exercicioId,
  scale,
  onChange,
}: {
  inputs: Record<string, number | undefined>
  computed: Record<string, number | undefined>
  exercicioId: string
  scale: Scale
  onChange: (lineId: string, raw: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Descrição
              </th>
              <th className="w-40 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {exercicioId}
              </th>
            </tr>
          </thead>
          <tbody>
            {DRE_LINES.map((line) => {
              const isComputed = line.kind === "computed"
              return (
                <tr key={line.id} className={cn("border-b border-border last:border-0", line.isTotal && "bg-primary/[0.03]")}>
                  <td className="px-4 py-1.5">
                    <GlossaryTerm
                      term={line.name}
                      className={cn(
                        "text-foreground",
                        line.isTotal ? "font-semibold" : isComputed ? "font-medium" : line.deduction ? "text-muted-foreground" : "",
                      )}
                    />
                  </td>
                  <td className="px-2 py-1">
                    {isComputed ? (
                      <div
                        className={cn(
                          "px-2 py-1 text-right font-mono text-sm tabular-nums",
                          line.isTotal ? "font-semibold text-foreground" : "font-medium text-foreground",
                        )}
                      >
                        {formatScaled(computed[line.id], scale)}
                      </div>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={displayValue(inputs[line.id])}
                        onChange={(e) => onChange(line.id, e.target.value)}
                        placeholder="—"
                        className="w-full rounded-[calc(var(--radius)*0.6)] border border-transparent bg-transparent px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground outline-none transition-colors hover:border-border focus:border-ring focus:bg-background"
                        aria-label={`${line.name} — ${exercicioId}`}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Linha complementar — usada só pelo índice PMPC */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-2.5">
        <div>
          <p className="text-sm text-foreground">{DRE_MEMO_LINE.name}</p>
          <p className="text-xs text-muted-foreground">Não integra o resultado — usado apenas no cálculo do PMPC.</p>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={displayValue(inputs[DRE_MEMO_LINE.id])}
          onChange={(e) => onChange(DRE_MEMO_LINE.id, e.target.value)}
          placeholder="—"
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground outline-none focus:border-ring"
          aria-label={DRE_MEMO_LINE.name}
        />
      </div>
    </div>
  )
}
