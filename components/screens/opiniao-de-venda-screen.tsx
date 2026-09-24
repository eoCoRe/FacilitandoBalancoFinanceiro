"use client"

import { useMemo, useState } from "react"
import { ArrowRight, CheckCircle2, AlertTriangle, ChevronDown, XCircle, Gavel, FileText, Sparkles } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { HistoricoPareceres, RegistrarDecisao } from "@/components/parecer-registro"
import { Button } from "@/components/ui/button"
import { can } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import {
  buildSalesOpinion,
  computeDre,
  formatBRL,
  suggestedCreditLimit,
  type CriterionStatus,
  type OpinionRating,
} from "@/lib/financial-data"
import type { ScreenId } from "@/lib/navigation"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<
  CriterionStatus,
  { icon: typeof CheckCircle2; dot: string; text: string; bg: string; label: string }
> = {
  ok: {
    icon: CheckCircle2,
    dot: "bg-ok",
    text: "text-ok",
    bg: "bg-ok-muted",
    label: "Adequado",
  },
  atencao: {
    icon: AlertTriangle,
    dot: "bg-attention",
    text: "text-attention",
    bg: "bg-attention-muted",
    label: "Atenção",
  },
  risco: {
    icon: XCircle,
    dot: "bg-risk",
    text: "text-risk",
    bg: "bg-risk-muted",
    label: "Risco",
  },
}

const RATING_STATUS: Record<OpinionRating, CriterionStatus> = {
  favoravel: "ok",
  ressalvas: "atencao",
  desfavoravel: "risco",
}

// Formata dígitos em moeda BRL enquanto o usuário digita.
function parseCurrency(raw: string): number {
  const digits = raw.replace(/\D/g, "")
  return digits ? Number(digits) / 100 : 0
}

export function OpiniaoDeVendaScreen({ onNavigate }: { onNavigate: (id: ScreenId) => void }) {
  const store = useFinancialStore()
  const exercicioIds = useMemo(() => store.exercicios.map((e) => e.id), [store.exercicios])
  const current = exercicioIds[exercicioIds.length - 1]
  const previous = exercicioIds[exercicioIds.length - 2]

  const defaultLimit = useMemo(
    () =>
      current
        ? (suggestedCreditLimit(store.accounts, computeDre(store.dreByExercicio[current] ?? {}), store.dfc, current) ?? 0)
        : 0,
    [store.accounts, store.dreByExercicio, store.dfc, current],
  )
  const [requestedValue, setRequestedValue] = useState<number>(Math.round(defaultLimit * 0.8))
  const [historicoVersao, setHistoricoVersao] = useState(0)

  const opinion = useMemo(
    () =>
      current
        ? buildSalesOpinion(store.accounts, store.dreByExercicio, store.dfc, current, previous, requestedValue)
        : null,
    [store.accounts, store.dreByExercicio, store.dfc, current, previous, requestedValue],
  )
  if (!opinion) {
    return (
      <div className="flex flex-col">
        <PageHeader eyebrow="Início" title="Parecer de Crédito" subtitle={`Nenhum exercício tabulado ainda para ${store.companyName}.`} />
        <div className="px-4 md:px-8 py-6">
          <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-card px-6 py-14 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Para gerar o parecer automático, primeiro cadastre os valores do Balanço e da DRE de pelo menos um
              exercício — pela extração de PDF ou lançamento manual na Tabulação.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => onNavigate("extracao-ia")}>
                <Sparkles className="size-3.5" />
                Extração de PDF
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onNavigate("tabulacao")}>
                Ir para Tabulação
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  const ratingStatus = RATING_STATUS[opinion.rating]
  const ratingStyle = STATUS_STYLES[ratingStatus]
  const RatingIcon = ratingStyle.icon

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Início"
        title="Parecer de Crédito"
        subtitle={`Parecer automático para ${store.companyName}, com base nos indicadores de ${current} (${store.exercicios.find((e) => e.id === current)?.auditado ? "exercício auditado" : "exercício não auditado"}).`}
        actions={
          <>
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Ver números completos
              <ArrowRight className="size-3.5" />
            </button>
            {/* Abre a impressão do navegador: dá para imprimir ou "Salvar como PDF". A barra lateral e os
                botões saem do papel (print:hidden). */}
            <Button size="sm" className="h-8 gap-1.5" onClick={() => window.print()}>
              <FileText className="size-3.5" />
              Exportar parecer
            </Button>
          </>
        }
      />

      <div className="grid gap-5 px-4 md:px-8 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Coluna principal — parecer */}
        <div className="flex flex-col gap-5">
          {/* Cabeçalho do parecer */}
          <section
            className={cn(
              "flex flex-col gap-4 rounded-md border border-border p-5 sm:flex-row sm:items-center sm:justify-between",
              ratingStyle.bg,
            )}
          >
            <div className="flex items-start gap-3">
              <RatingIcon className={cn("mt-0.5 size-6 shrink-0", ratingStyle.text)} />
              <div className="min-w-0">
                <p className={cn("font-display text-lg font-bold", ratingStyle.text)}>{opinion.ratingLabel}</p>
                <p className="mt-0.5 text-sm text-foreground/80 text-pretty">{opinion.headline}</p>
              </div>
            </div>
            <ScoreGauge score={opinion.score} status={ratingStatus} />
          </section>

          {/* Critérios avaliados */}
          <section className="overflow-hidden rounded-md border border-border bg-card">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Critérios avaliados
              </h2>
            </div>
            <ul>
              {opinion.criteria.map((c) => {
                const s = STATUS_STYLES[c.status]
                const CIcon = s.icon
                return (
                  <li
                    key={c.label}
                    className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
                  >
                    <CIcon className={cn("size-4 shrink-0", s.text)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{c.detail}</p>
                    </div>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      peso {Math.round(c.weight * 100)}%
                    </span>
                    <span className="w-20 text-right font-mono text-sm tabular-nums text-foreground">{c.value}</span>
                    <span
                      className={cn(
                        "inline-flex w-20 justify-center rounded border px-2 py-0.5 text-[11px] font-medium",
                        s.text,
                        "border-current/30",
                      )}
                    >
                      {s.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Texto do parecer */}
          <section className="rounded-md border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Gavel className="size-4 text-muted-foreground" />
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Parecer do analista
              </h2>
            </div>
            <div className="flex flex-col gap-2.5">
              {opinion.narrative.map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90 text-pretty">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          <HistoricoPareceres recarregar={historicoVersao} />
        </div>

        {/* Coluna lateral — entrada, limite e registro da decisão */}
        <aside className="flex flex-col gap-5">
          <section className="rounded-md border border-border bg-card p-5">
            <label htmlFor="valor-solicitacao" className="text-sm font-medium text-foreground">
              Valor da solicitação
            </label>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Informe o valor de crédito pleiteado.</p>
            <div className="flex items-center rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
              <span className="pl-3 pr-1 text-sm font-medium text-muted-foreground">R$</span>
              <input
                id="valor-solicitacao"
                inputMode="numeric"
                value={requestedValue > 0 ? formatBRL(requestedValue, 2) : ""}
                onChange={(e) => setRequestedValue(parseCurrency(e.target.value))}
                placeholder="0,00"
                className="w-full bg-transparent py-2 pr-3 text-right font-mono text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Limite sugerido</span>
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {opinion.limitAvailable ? `R$ ${formatBRL(opinion.suggestedLimit, 2)}` : "Dados insuficientes"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Cobertura</span>
                <span
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    opinion.coverage >= 1
                      ? "text-ok"
                      : opinion.coverage >= 0.75
                        ? "text-attention"
                        : "text-risk",
                  )}
                >
                  {requestedValue > 0 && opinion.limitAvailable ? `${formatBRL(opinion.coverage, 2)}×` : "—"}
                </span>
              </div>
            </div>

            {/* Barra de utilização do limite */}
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Utilização do limite</span>
                <span className="tabular-nums">
                  {opinion.suggestedLimit > 0
                    ? `${formatBRL(Math.min(999, (requestedValue / opinion.suggestedLimit) * 100), 0)}%`
                    : "—"}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    requestedValue <= opinion.suggestedLimit ? "bg-ok" : "bg-risk",
                  )}
                  style={{
                    width: `${Math.min(100, opinion.suggestedLimit > 0 ? (requestedValue / opinion.suggestedLimit) * 100 : 0)}%`,
                  }}
                />
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border bg-muted/40 p-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              O limite sugerido é uma estimativa de quanto essa empresa consegue pagar com segurança, calculada de
              três formas diferentes — usamos sempre a mais conservadora. Pode ser revisado pelo comitê de crédito.
            </p>
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground">
                <ChevronDown className="size-3 shrink-0 transition-transform group-open:rotate-180" />
                Ver como é calculado
              </summary>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Menor valor entre: 25% da receita líquida anualizada, 1,2× o Patrimônio Líquido e 3× a geração de caixa
                operacional anualizada (DFC). Exercício trimestral (1T2025) é anualizado ×4, semestral (1S2025) ×2 e os demais
                são tratados como anuais. Critério sem dado no período fica de fora do cálculo.
              </p>
            </details>
          </section>

          {can(store.user.papel, "registrar-parecer") && (
            <RegistrarDecisao exercicioId={current} opinion={opinion} onRegistrado={() => setHistoricoVersao((v) => v + 1)} />
          )}
        </aside>
      </div>
      {/* Só aparece no papel/PDF: quem emitiu e quando, para o parecer impresso ter origem. */}
      <p className="hidden px-4 md:px-8 pb-6 text-xs text-muted-foreground print:block">
        Emitido em {new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })} por {store.user.nome} (
        {store.user.email}) — Central de Balanços.
      </p>
    </div>
  )
}

function ScoreGauge({ score, status }: { score: number; status: CriterionStatus }) {
  const style = STATUS_STYLES[status]
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)

  return (
    <div className="flex items-center gap-3">
      <div className="relative size-16">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-border" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("transition-all", style.text)}
            stroke="currentColor"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-bold tabular-nums text-foreground">{score}</span>
        </div>
      </div>
      <div className="leading-tight">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Score</p>
        <p className="text-xs text-muted-foreground">de 0 a 100</p>
      </div>
    </div>
  )
}
