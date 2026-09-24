"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { ArrowLeft, Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react"
import { AuthMessage } from "@/components/auth/auth-shell"
import { EmpresaForm } from "@/components/empresa-form"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { onlyDigits } from "@/lib/cnpj"
import { can } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface EmpresaResumo {
  id: number
  cnpj: string
  razaoSocial: string
  setor: string | null
}

// Cartão "Empresa" da barra lateral: mostra a empresa em análise e, ao clicar, abre a lista para trocar de empresa ou
// cadastrar uma nova. Trocar grava a escolha no servidor (cookie) e recarrega a página: todas as telas passam a mostrar
// a empresa escolhida, sem sobrar dado da anterior na memória.
export function EmpresaSwitcher() {
  const { companyName, cnpj } = useFinancialStore()
  const [open, setOpen] = useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={`Empresa em análise: ${companyName}. Trocar de empresa`}
        className="group/empresa w-full rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-ring/50"
      >
        <span className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Empresa
          <ChevronsUpDown className="size-3.5 text-muted-foreground group-hover/empresa:text-foreground" />
        </span>
        <span className="mt-1 block text-sm font-medium leading-tight text-foreground text-pretty">{companyName}</span>
        <span className="mt-0.5 block font-mono text-xs text-muted-foreground tabular-nums">{cnpj}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
          {/* O corpo só existe com a janela aberta: cada abertura recarrega a lista, sem estado a limpar. */}
          <SwitcherBody />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SwitcherBody() {
  const { user } = useFinancialStore()
  const [empresas, setEmpresas] = useState<EmpresaResumo[] | null>(null)
  const [atualId, setAtualId] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [trocando, setTrocando] = useState<number | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const podeCadastrar = can(user.papel, "cadastrar-empresa")

  useEffect(() => {
    let cancelled = false
    api<{ empresas: EmpresaResumo[]; atualId: number }>("/api/empresas")
      .then((r) => {
        if (cancelled) return
        setEmpresas(r.empresas)
        setAtualId(r.atualId)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [])

  const filtradas = useMemo(() => {
    if (!empresas) return []
    const termo = query.trim().toLowerCase()
    if (!termo) return empresas
    const digitos = onlyDigits(termo)
    return empresas.filter((e) => e.razaoSocial.toLowerCase().includes(termo) || (digitos !== "" && onlyDigits(e.cnpj).includes(digitos)))
  }, [empresas, query])

  async function escolher(id: number) {
    if (trocando !== null) return
    if (id === atualId) {
      window.location.reload()
      return
    }
    setTrocando(id)
    setError(null)
    try {
      await api("/api/empresas/selecionar", { method: "POST", body: { id } })
      window.location.reload()
    } catch (err) {
      setError(errorMessage(err))
      setTrocando(null)
    }
  }

  if (cadastrando) {
    return (
      <div className="flex flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCadastrando(false)}
            aria-label="Voltar para a lista de empresas"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <Dialog.Title className="font-display text-base font-bold text-foreground">Nova empresa</Dialog.Title>
        </div>
        <EmpresaForm onCreated={() => window.location.reload()} submitLabel="Cadastrar e abrir" />
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-4">
        <Dialog.Title className="font-display text-base font-bold text-foreground">Trocar de empresa</Dialog.Title>
        {podeCadastrar && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setCadastrando(true)}>
            <Plus className="size-3.5" />
            Nova empresa
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Search className="size-4 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por razão social ou CNPJ…"
          aria-label="Buscar empresa"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error && (
        <div className="px-4 pt-3">
          <AuthMessage kind="error">{error}</AuthMessage>
        </div>
      )}
      {empresas === null && !error ? (
        <p role="status" className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando empresas…
        </p>
      ) : filtradas.length === 0 && empresas !== null ? (
        <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma empresa encontrada.
        </p>
      ) : (
        <ul aria-label="Empresas" className="overflow-y-auto p-1.5">
          {filtradas.map((e) => {
            const atual = e.id === atualId
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => escolher(e.id)}
                  disabled={trocando !== null}
                  aria-current={atual ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60",
                    atual && "bg-accent/60",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{e.razaoSocial}</span>
                    <span className="block font-mono text-xs text-muted-foreground tabular-nums">
                      {e.cnpj}
                      {e.setor ? ` · ${e.setor}` : ""}
                    </span>
                  </span>
                  {trocando === e.id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    atual && <Check className="size-4 shrink-0 text-primary-text" aria-label="Empresa atual" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
