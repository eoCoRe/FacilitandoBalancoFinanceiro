import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

// Moldura comum das telas de quem ainda não entrou (login, esqueci a senha, redefinir senha).
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
            CB
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-foreground">Central de Balanços</span>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}

export function AuthMessage({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  const isError = kind === "error"
  const Icon = isError ? AlertTriangle : CheckCircle2
  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "flex items-start gap-2 rounded-md border border-ok/30 bg-ok-muted px-3 py-2 text-sm text-ok"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export const authInputClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-ring"
