"use client"

import { useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { AuthMessage, AuthShell, authInputClass, authLinkClass } from "@/components/auth/auth-shell"
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
  // De onde vem o código do 2º passo: e-mail, aplicativo autenticador, ou um código de recuperação.
  const [metodo, setMetodo] = useState<"email" | "app" | "recuperacao">("email")
  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [codigo, setCodigo] = useState("")
  const [error, setError] = useState<string | null>(initialError)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const senhaRef = useRef<HTMLInputElement>(null)
  const codigoRef = useRef<HTMLInputElement>(null)

  // `onError` devolve o foco a um campo: o botão de enviar fica desabilitado durante a requisição e, ao
  // perder o foco, quem navega só pelo teclado voltaria ao início da página depois de um erro.
  async function run(action: () => Promise<void>, focusOnError?: () => HTMLInputElement | null) {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
      setTimeout(() => focusOnError?.()?.focus(), 0)
    } finally {
      setSubmitting(false)
    }
  }

  function handlePassword(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      // 401 aqui é "credenciais inválidas", não sessão expirada: não redireciona.
      const result = await api<{ segundoFator?: boolean; metodo?: "email" | "app" }>("/api/auth/login", {
        method: "POST",
        body: { email, senha },
        redirectOn401: false,
      })
      if (result.segundoFator) {
        setStep("codigo")
        setMetodo(result.metodo === "app" ? "app" : "email")
        setInfo(result.metodo === "app" ? null : "Enviamos um código de 6 dígitos para o seu e-mail.")
      } else {
        goHome()
      }
    }, () => senhaRef.current)
  }

  function handleCode(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api("/api/auth/2fa/verificar", { method: "POST", body: { codigo }, redirectOn401: false })
      goHome()
    }, () => codigoRef.current)
  }

  function handleResend() {
    void run(async () => {
      await api("/api/auth/2fa/reenviar", { method: "POST", redirectOn401: false })
      setCodigo("")
      setInfo("Enviamos um novo código. O anterior deixou de valer.")
    }, () => codigoRef.current)
  }

  if (step === "codigo") {
    const porEmail = metodo === "email"
    const recuperacao = metodo === "recuperacao"
    return (
      <AuthShell
        title="Verificação em 2 etapas"
        subtitle={
          porEmail
            ? "Digite o código enviado ao seu e-mail."
            : recuperacao
              ? "Digite um dos seus códigos de recuperação."
              : "Digite o código do seu aplicativo autenticador."
        }
      >
        <form onSubmit={handleCode} className="flex flex-col gap-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          {info && !error && <AuthMessage kind="success">{info}</AuthMessage>}

          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            {recuperacao ? "Código de recuperação" : "Código de verificação"}
            <input
              // Recuperação tem letras e hífen; os outros são 6 dígitos.
              inputMode={recuperacao ? "text" : "numeric"}
              autoComplete="one-time-code"
              pattern={recuperacao ? undefined : "[0-9 ]{6,7}"}
              maxLength={recuperacao ? 12 : 7}
              required
              autoFocus
              ref={codigoRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className={cn(authInputClass, "text-center font-mono text-lg", recuperacao ? "uppercase tracking-widest" : "tracking-[0.4em]")}
            />
          </label>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Confirmar
          </Button>

          <div className="flex justify-between text-sm">
            {porEmail ? (
              <button type="button" onClick={handleResend} disabled={submitting} className={authLinkClass}>
                Reenviar código
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMetodo(recuperacao ? "app" : "recuperacao")
                  setCodigo("")
                  setError(null)
                  setTimeout(() => codigoRef.current?.focus(), 0)
                }}
                className={authLinkClass}
              >
                {recuperacao ? "Usar o aplicativo" : "Usar código de recuperação"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStep("senha")
                setMetodo("email")
                setSenha("")
                setCodigo("")
                setError(null)
                setInfo(null)
              }}
              className={authLinkClass}
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
            ref={senhaRef}
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
          <Link href="/esqueci-senha" className={authLinkClass}>
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
