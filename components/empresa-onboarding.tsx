"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Building2, Loader2 } from "lucide-react"
import { AuthMessage, AuthShell, authInputClass } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj"
import { can, type Papel } from "@/lib/permissions"
import { SECTORS } from "@/lib/sector-benchmarks"

// Mostrada no lugar do app quando NÃO há empresa cadastrada (instalação nova, ou depois da eliminação LGPD). O sistema
// trabalha com uma empresa só: o administrador a cadastra aqui; os demais são avisados de que precisam pedir a ele.
export function EmpresaOnboarding({ onDone }: { onDone: () => void }) {
  const [papel, setPapel] = useState<Papel | null | undefined>(undefined) // undefined = carregando
  const [cnpj, setCnpj] = useState("")
  const [razaoSocial, setRazaoSocial] = useState("")
  const [setor, setSetor] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ user: { papel: Papel } }>("/api/auth/me")
      .then((r) => !cancelled && setPapel(r.user.papel))
      .catch(() => !cancelled && setPapel(null))
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!isValidCnpj(cnpj)) {
      setError("CNPJ inválido. Confira os 14 dígitos.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api("/api/empresa", { method: "POST", body: { cnpj, razaoSocial, ...(setor ? { setor } : {}) }, redirectOn401: false })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  if (papel === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" />
        Carregando…
      </div>
    )
  }

  if (!can(papel, "cadastrar-empresa")) {
    return (
      <AuthShell title="Nenhuma empresa cadastrada" subtitle="Peça a um administrador para cadastrar a empresa. Depois é só recarregar a página.">
        <Button onClick={onDone} className="w-full">
          Recarregar
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Cadastrar a empresa" subtitle="O sistema ainda não tem nenhuma empresa. Informe os dados para começar.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <AuthMessage kind="error">{error}</AuthMessage>}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          CNPJ
          <input
            inputMode="numeric"
            autoComplete="off"
            required
            autoFocus
            value={cnpj}
            onChange={(e) => setCnpj(onlyDigits(e.target.value).length === 14 ? formatCnpj(e.target.value) : e.target.value)}
            className={authInputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          Razão social
          <input required maxLength={200} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} className={authInputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
          Setor
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className={authInputClass}>
            <option value="">Padrão ({SECTORS[0].label})</option>
            {SECTORS.map((s) => (
              <option key={s.id} value={s.label}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
          Cadastrar empresa
        </Button>
      </form>
    </AuthShell>
  )
}
