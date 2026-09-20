"use client"

import Link from "next/link"
import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Erro inesperado ao renderizar uma tela. (Nesta versão do Next o segundo prop é `retry` — na API
// antiga era `reset`.) A mensagem real NÃO é mostrada: em componentes de servidor ela vem
// genérica de propósito, e só o `digest` identifica o erro no log do servidor.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Erro de renderização:", error.digest ?? error.name)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Algo deu errado</h1>
        <p className="text-sm text-muted-foreground">
          Não foi possível exibir esta tela. Tente novamente; se o problema continuar, avise o administrador.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">
            Código do erro: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <Button onClick={() => retry()}>Tentar novamente</Button>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  )
}
