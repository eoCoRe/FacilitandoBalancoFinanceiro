"use client"

import { AlertTriangle, Loader2, X } from "lucide-react"
import { EmpresaOnboarding } from "@/components/empresa-onboarding"
import { Button } from "@/components/ui/button"
import { useFinancialStore } from "@/lib/store"

// Tela cheia enquanto os dados vêm do banco na primeira carga, ou quando ela falha.
export function StoreLoadGate() {
  const { status, loadError, loadErrorCode, reload } = useFinancialStore()

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" />
        Carregando dados…
      </div>
    )
  }

  // Não é uma falha: só não há empresa ainda. O administrador cadastra; os demais são orientados.
  if (loadErrorCode === "SEM_EMPRESA") return <EmpresaOnboarding onDone={reload} />

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm font-medium text-foreground">Não foi possível carregar os dados</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <p className="text-xs text-muted-foreground">
          Confira se o banco está no ar (<span className="font-mono">docker compose up -d</span>) e se o seed foi aplicado.
        </p>
        <Button size="sm" onClick={reload}>
          Tentar novamente
        </Button>
      </div>
    </div>
  )
}

// Falha ao gravar uma alteração: a tela já voltou ao que está no servidor, então o usuário
// precisa saber que o que digitou não foi salvo.
export function MutationErrorBanner() {
  const { mutationError, dismissMutationError } = useFinancialStore()
  if (!mutationError) return null

  return (
    // Fundo opaco por baixo do tom vermelho: o aviso fica sobre qualquer tela e o contraste do texto
    // não pode depender do que está atrás dele.
    <div role="alert" className="fixed inset-x-0 top-0 z-50 bg-background print:hidden">
      <div className="flex items-center justify-center gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
      <AlertTriangle className="size-4 shrink-0" />
      <span>Não foi possível salvar: {mutationError}</span>
      <button
        type="button"
        onClick={dismissMutationError}
        aria-label="Fechar aviso"
        className="rounded p-1 hover:bg-destructive/10"
      >
        <X className="size-3.5" />
      </button>
      </div>
    </div>
  )
}
