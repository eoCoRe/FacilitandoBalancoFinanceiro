"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { AuthMessage, AuthShell, authInputClass } from "@/components/auth-shell"
import { Button, buttonVariants } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { cn } from "@/lib/utils"

interface LoginFormProps {
  googleEnabled: boolean
  recoveryEnabled: boolean
  initialError: string | null
}

function goHome() {
  // Navegação completa de propósito: recarrega tudo já com o cookie de sessão novo.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/")
}

export function LoginForm({ googleEnabled, recoveryEnabled, initialError }: LoginFormProps) {
  const [step, setStep] = useState<"senha" | "codigo">("senha")
  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [codigo, setCodigo] = useState("")
  const [error, setError] = useState<string | null>(initialError)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function run(action: () => Promise<void>) {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handlePassword(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      // 401 aqui é "credenciais inválidas", não sessão expirada: não redireciona.
      const result = await api<{ segundoFator?: boolean }>("/api/auth/login", {
        method: "POST",
        body: { email, senha },
        redirectOn401: false,
      })
      if (result.segundoFator) {
        setStep("codigo")
        setInfo("Enviamos um código de 6 dígitos para o seu e-mail.")
      } else {
        goHome()
      }
    })
  }

  function handleCode(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api("/api/auth/2fa/verificar", { method: "POST", body: { codigo }, redirectOn401: false })
      goHome()
    })
  }

  function handleResend() {
    void run(async () => {
      await api("/api/auth/2fa/reenviar", { method: "POST", redirectOn401: false })
      setCodigo("")
      setInfo("Enviamos um novo código. O anterior deixou de valer.")
    })
  }

  if (step === "codigo") {
    return (
      <AuthShell title="Verificação em 2 etapas" subtitle="Digite o código enviado ao seu e-mail.">
        <form onSubmit={handleCode} className="flex flex-col gap-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          {info && !error && <AuthMessage kind="success">{info}</AuthMessage>}

          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Código de verificação
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={cn(authInputClass, "text-center font-mono text-lg tracking-[0.4em]")}
            />
          </label>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Confirmar
          </Button>

          <div className="flex justify-between text-sm">
            <button type="button" onClick={handleResend} disabled={submitting} className="text-primary hover:underline">
              Reenviar código
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("senha")
                setSenha("")
                setCodigo("")
                setError(null)
                setInfo(null)
              }}
              className="text-muted-foreground hover:underline"
            >
              Voltar
            </button>
          </div>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Entrar" subtitle="Use o acesso cadastrado pelo administrador.">
      <form onSubmit={handlePassword} className="flex flex-col gap-4">
        {error && <AuthMessage kind="error">{error}</AuthMessage>}

        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          E-mail
          <input
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
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
            className={authInputClass}
          />
        </label>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Entrar
        </Button>

        {recoveryEnabled && (
          <Link href="/esqueci-senha" className="text-center text-sm text-primary hover:underline">
            Esqueci minha senha
          </Link>
        )}

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
    </AuthShell>
  )
}
