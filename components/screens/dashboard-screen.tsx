"use client"

import { useMemo, useState } from "react"
import { ArrowDownRight, ArrowUpRight, Droplets, Landmark, PiggyBank, Wallet, type LucideIcon } from "lucide-react"
import { GlossaryTerm } from "@/components/glossary-term"
import { PageHeader } from "@/components/page-header"
import { ScaleToggle } from "@/components/scale-toggle"
import { Sparkline } from "@/components/sparkline"
import { useFinancialStore } from "@/lib/store"
import {
  accountTotalByName,
  computeDre,
  deltaPercent,
  formatBRL,
  formatIndicatorValue,
  formatScaled,
  indicatorStatus,
  INDICATORS,
  makeIndicatorContext,
  SCALE_LABEL,
  type Indicator,
  type IndicatorContext,
  type IndicatorStatus,
  type Scale,
} from "@/lib/financial-data"
import { cn } from "@/lib/utils"

const liquidezCorrente = INDICATORS.find((i) => i.id === "liquidez-corrente")!

// Um representante de cada grupo (Liquidez, Endividamento, Rentabilidade, Atividade),
// para o resumo do dashboard cobrir toda a análise, não só liquidez — a lista completa
// com todos os 14 índices fica na tela Índices Financeiros.
const COMPARISON_INDICATOR_IDS = ["liquidez-seca", "endividamento-geral", "margem-liquida", "roe", "giro-ativo"]

const STATUS_DOT: Record<IndicatorStatus, string> = {
  ok: "bg-ok",
  atencao: "bg-attention",
  risco: "bg-risk",
  indisponivel: "bg-muted-foreground/40",
}

const STATUS_LABEL: Record<IndicatorStatus, string> = {
  ok: "Adequado",
  atencao: "Atenção",
  risco: "Risco",
  indisponivel: "Sem dados",
}

function StatusDot({ status }: { status: IndicatorStatus }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status])} title={STATUS_LABEL[status]} />
}

function TrendBadge({ delta, invert = false }: { delta: number | undefined; invert?: boolean }) {
  if (delta === undefined) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        —
      </span>
    )
  }
  const up = delta >= 0
  const good = invert ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-xs tabular-nums",
        good ? "bg-ok-muted text-ok" : "bg-risk-muted text-risk",
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : ""}
      {formatBRL(delta, 1)}%
    </span>
  )
}

function KpiCard({
  label,
  value,
  unit,
  delta,
  icon: Icon,
  status,
}: {
  label: string
  value: string
  unit: string
  delta: number | undefined
  icon: LucideIcon
  status?: IndicatorStatus
}) {
  return (
    <div className="group rounded-md border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md hover:shadow-primary/10">
      <div className="flex items-start justify-between gap-2">
        <GlossaryTerm term={label} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground" />
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
          <Icon className="size-3.5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <TrendBadge delta={delta} />
        <span className="text-xs text-muted-foreground">vs. período anterior</span>
        {status && (
          <span className="ml-auto flex items-center gap-1">
            <StatusDot status={status} />
          </span>
        )}
      </div>
    </div>
  )
}

type AlertTone = "risk" | "attention" | "ok"

interface DashboardAlert {
  tone: AlertTone
  title: string
  detail: string
}

const toneDot: Record<AlertTone, string> = {
  risk: "bg-risk",
  attention: "bg-attention",
  ok: "bg-ok",
}

function evaluateIndicator(indicator: Indicator, ctx: IndicatorContext) {
  const value = indicator.compute(ctx)
  return { indicator, value, status: indicatorStatus(indicator, value) }
}

const SEVERITY: Record<IndicatorStatus, number> = { risco: 0, atencao: 1, ok: 2, indisponivel: 3 }

// Pontos de atenção calculados de verdade a partir dos índices do período — não é texto
// fixo: se os dados mudam (novo lançamento, novo exercício), os alertas mudam junto.
// Prioriza risco > atenção; se não houver nenhum, celebra o indicador mais forte.
function buildAlerts(ctx: IndicatorContext | undefined): DashboardAlert[] {
  if (!ctx) return []

  const evaluated = INDICATORS.map((i) => evaluateIndicator(i, ctx))
    .filter((e) => e.status !== "indisponivel")
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])

  const concerning = evaluated.filter((e) => e.status !== "ok").slice(0, 3)
  if (concerning.length > 0) {
    return concerning.map((e) => ({
      tone: e.status === "risco" ? "risk" : "attention",
      title: `${e.indicator.name} ${e.status === "risco" ? "em nível de risco" : "pede atenção"}`,
      detail: `${formatIndicatorValue(e.indicator, e.value)} — ${e.indicator.description}`,
    }))
  }

  const best = evaluated[0]
  if (!best) return []
  return [
    {
      tone: "ok",
      title: "Indicadores dentro do esperado",
      detail: `Nenhum índice em atenção ou risco neste período. ${best.indicator.name} está em ${formatIndicatorValue(best.indicator, best.value)}.`,
    },
  ]
}

export function DashboardScreen() {
  const store = useFinancialStore()
  const [scale, setScale] = useState<Scale>("milhares")
  const exercicioIds = useMemo(() => store.exercicios.map((e) => e.id), [store.exercicios])
  const current = exercicioIds[exercicioIds.length - 1]
  const previous = exercicioIds[exercicioIds.length - 2]

  const ctxByPeriod = useMemo(() => {
    const out: Record<string, IndicatorContext> = {}
    for (const id of exercicioIds) {
      out[id] = makeIndicatorContext(store.accounts, computeDre(store.dreByExercicio[id] ?? {}), id)
    }
    return out
  }, [exercicioIds, store.accounts, store.dreByExercicio])

  const ativo = current ? accountTotalByName(store.accounts, "Ativo", current) : undefined
  const passivoCirc = current ? accountTotalByName(store.accounts, "Passivo Circulante", current) : undefined
  const exigivelLP = current ? accountTotalByName(store.accounts, "Exigível a Longo Prazo", current) : undefined
  const passivoTotal = passivoCirc !== undefined && exigivelLP !== undefined ? passivoCirc + exigivelLP : undefined
  const pl = current ? accountTotalByName(store.accounts, "Patrimônio Líquido", current) : undefined
  const lc = current ? liquidezCorrente.compute(ctxByPeriod[current]) : undefined
  const lcStatus = indicatorStatus(liquidezCorrente, lc)

  const ativoPrev = previous ? accountTotalByName(store.accounts, "Ativo", previous) : undefined
  const passivoCircPrev = previous ? accountTotalByName(store.accounts, "Passivo Circulante", previous) : undefined
  const exigivelLPPrev = previous ? accountTotalByName(store.accounts, "Exigível a Longo Prazo", previous) : undefined
  const passivoPrev =
    passivoCircPrev !== undefined && exigivelLPPrev !== undefined ? passivoCircPrev + exigivelLPPrev : undefined
  const plPrev = previous ? accountTotalByName(store.accounts, "Patrimônio Líquido", previous) : undefined
  const lcPrev = previous ? liquidezCorrente.compute(ctxByPeriod[previous]) : undefined

  const comparisonIndicators = COMPARISON_INDICATOR_IDS.map((id) => INDICATORS.find((i) => i.id === id)!)
  const comparison = comparisonIndicators.map((ind) => ({
    indicator: ind,
    values: exercicioIds.map((id) => ind.compute(ctxByPeriod[id])),
  }))

  const alerts = useMemo(() => buildAlerts(current ? ctxByPeriod[current] : undefined), [current, ctxByPeriod])

  const sparkValues = exercicioIds.map((id) => liquidezCorrente.compute(ctxByPeriod[id]))
  const sparkReady = sparkValues.length > 1 && sparkValues.every((v): v is number => v !== undefined)

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Visão geral"
        title="Dashboard"
        subtitle={`Resumo da posição financeira e indicadores-chave do período ${current ?? "—"}.`}
        actions={<ScaleToggle value={scale} onChange={setScale} />}
      />

      <div className="flex flex-col gap-6 px-8 py-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Ativo Total"
            value={ativo === undefined ? "—" : formatScaled(ativo, scale)}
            unit={SCALE_LABEL[scale]}
            delta={deltaPercent(ativo, ativoPrev)}
            icon={Wallet}
          />
          <KpiCard
            label="Passivo Total"
            value={passivoTotal === undefined ? "—" : formatScaled(passivoTotal, scale)}
            unit={SCALE_LABEL[scale]}
            delta={deltaPercent(passivoTotal, passivoPrev)}
            icon={Landmark}
          />
          <KpiCard
            label="Patrimônio Líquido"
            value={pl === undefined ? "—" : formatScaled(pl, scale)}
            unit={SCALE_LABEL[scale]}
            delta={deltaPercent(pl, plPrev)}
            icon={PiggyBank}
          />
          <KpiCard
            label="Liquidez Corrente"
            value={lc === undefined ? "—" : formatIndicatorValue(liquidezCorrente, lc)}
            unit="índice"
            delta={deltaPercent(lc, lcPrev)}
            icon={Droplets}
            status={lcStatus}
          />
        </div>

        {/* Gráfico + Alertas */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-5 shadow-sm transition-shadow duration-200 hover:shadow-md lg:col-span-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-primary">Evolução</p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">Liquidez Corrente</h2>
            <div className="mt-4 h-52">
              {sparkReady ? (
                <Sparkline points={sparkValues as number[]} labels={exercicioIds} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Dados insuficientes para exibir a evolução.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-wider text-primary">Alertas</p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">Pontos de atenção</h2>
            {alerts.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Ainda não há período com dados suficientes para calcular alertas.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-4">
                {alerts.map((alert) => (
                  <li key={alert.title} className="flex gap-3">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneDot[alert.tone])} aria-hidden />
                    <div>
                      <p className="text-sm font-medium leading-tight text-foreground">{alert.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{alert.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Tabela de comparação */}
        <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-primary">Comparativo</p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">
              Indicadores por período <span className="font-normal text-muted-foreground">— um de cada grupo de análise</span>
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-5 py-2.5 text-left text-xs font-medium">Indicador</th>
                {exercicioIds.map((id) => (
                  <th key={id} className="px-5 py-2.5 text-right text-xs font-medium tabular-nums">
                    {id}
                  </th>
                ))}
                <th className="px-5 py-2.5 text-right text-xs font-medium">Δ período</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => {
                const last = row.values[row.values.length - 1]
                const prev = row.values[row.values.length - 2]
                const delta = deltaPercent(last, prev)
                const status = indicatorStatus(row.indicator, last)
                return (
                  <tr key={row.indicator.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 text-foreground">
                      <span className="flex items-center gap-2">
                        <StatusDot status={status} />
                        <GlossaryTerm term={row.indicator.name} />
                      </span>
                    </td>
                    {row.values.map((val, i) => (
                      <td key={i} className="px-5 py-2.5 text-right font-mono tabular-nums text-foreground">
                        {val === undefined ? "—" : formatIndicatorValue(row.indicator, val)}
                      </td>
                    ))}
                    <td className="px-5 py-2.5 text-right">
                      <TrendBadge delta={delta} invert={!row.indicator.higherIsBetter} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
