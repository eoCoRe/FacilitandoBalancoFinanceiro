"use client"

import { useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { useFinancialStore } from "@/lib/store"

const NOVO = "__novo__"

// Onde gravar um balanço: escolhe um exercício da empresa ou abre um novo ali mesmo. Uma empresa recém-cadastrada não
// tem exercício nenhum, então o campo já começa pedindo o período.
export function ExercicioPicker({ id, value, onChange }: { id: string; value: string; onChange: (exercicioId: string) => void }) {
  const store = useFinancialStore()
  const vazio = store.exercicios.length === 0
  const [criando, setCriando] = useState(false)
  const [periodo, setPeriodo] = useState("")
  const [salvando, setSalvando] = useState(false)

  async function criar() {
    const label = periodo.trim()
    if (!label || salvando) return
    setSalvando(true)
    const criado = await store.addExercicio(label)
    setSalvando(false)
    // Se o servidor recusou (ex.: período repetido), o motivo aparece no aviso global e o campo continua aberto.
    if (!criado) return
    onChange(criado)
    setPeriodo("")
    setCriando(false)
  }

  if (criando || vazio) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          id={id}
          autoFocus={!vazio}
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void criar()
            if (e.key === "Escape" && !vazio) setCriando(false)
          }}
          placeholder="Novo exercício: 2025, 2T2026…"
          title='Anual: "2025". Trimestre: "1T2026". Semestre: "1S2026" (o tipo define a anualização no parecer).'
          maxLength={50}
          className="h-8 w-52 rounded-md border border-ring bg-background px-2 text-sm text-foreground outline-none"
        />
        <button
          type="button"
          onClick={() => void criar()}
          disabled={!periodo.trim() || salvando}
          className="flex size-8 items-center justify-center rounded-md text-ok hover:bg-ok-muted disabled:opacity-50"
          aria-label="Criar exercício"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        {!vazio && (
          <button
            type="button"
            onClick={() => setCriando(false)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Cancelar novo exercício"
          >
            <X className="size-4" />
          </button>
        )}
      </span>
    )
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => (e.target.value === NOVO ? setCriando(true) : onChange(e.target.value))}
      className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
    >
      {store.exercicios.map((ex) => (
        <option key={ex.id} value={ex.id}>
          {ex.label}
        </option>
      ))}
      <option value={NOVO}>+ Novo exercício…</option>
    </select>
  )
}

// A empresa já tem algum valor lançado (Balanço ou DRE) em algum exercício?
export function temBalancos(store: ReturnType<typeof useFinancialStore>): boolean {
  const temValor = (accounts: typeof store.accounts): boolean =>
    accounts.some((a) => (a.children?.length ? temValor(a.children) : Object.keys(a.values ?? {}).length > 0))
  return temValor(store.accounts) || Object.values(store.dreByExercicio).some((dre) => Object.keys(dre ?? {}).length > 0)
}
