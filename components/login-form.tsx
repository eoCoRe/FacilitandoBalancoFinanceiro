"use client"

import { useState, type FormEvent } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { cn } from "@/lib/utils"

export function LoginForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string | null }) {
  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [error, setError] = useState<string | null>(initialError)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      // 401 aqui é "credenciais inválidas", não sessão expirada: não redireciona.
      await api("/api/auth/login", { method: "POST", body: { email, senha }, redirectOn401: false })
      // Navegação completa de propósito: recarrega tudo já com o cookie de sessão novo.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/")
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
            CB
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-foreground">Central de Balanços</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Entrar</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use o acesso cadastrado pelo administrador.</p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            E-mail
            <input
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-ring"
            />
          </label>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Entrar
          </Button>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
              </div>
              {/* Navegação completa (não fetch): o fluxo OAuth redireciona o navegador inteiro. */}
              <a href="/api/auth/google" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                Entrar com Google
              </a>
            </>
          )}
        </form>
      </div>
    </main>
  )
}
