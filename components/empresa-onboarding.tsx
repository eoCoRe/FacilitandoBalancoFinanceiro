"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { EmpresaForm } from "@/components/empresa-form"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api-client"
import { can, type Papel } from "@/lib/permissions"

// Mostrada no lugar do app quando NÃO há nenhuma empresa cadastrada (instalação nova, ou depois de eliminar pela LGPD a
// última que havia). Quem pode cadastrar empresas (coordenador ou acima) cadastra aqui; os demais são avisados de que
// precisam pedir. Com empresas cadastradas, as seguintes entram pelo seletor de empresa da barra lateral.
export function EmpresaOnboarding({ onDone }: { onDone: () => void }) {
  const [papel, setPapel] = useState<Papel | null | undefined>(undefined) // undefined = carregando

  useEffect(() => {
    let cancelled = false
    api<{ user: { papel: Papel } }>("/api/auth/me")
      .then((r) => !cancelled && setPapel(r.user.papel))
      .catch(() => !cancelled && setPapel(null))
    return () => {
      cancelled = true
    }
  }, [])

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
      <AuthShell title="Nenhuma empresa cadastrada" subtitle="Peça a um coordenador ou administrador para cadastrar a empresa. Depois é só recarregar a página.">
        <Button onClick={onDone} className="w-full">
          Recarregar
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Cadastrar a empresa" subtitle="O sistema ainda não tem nenhuma empresa. Informe os dados para começar.">
      <EmpresaForm onCreated={onDone} />
    </AuthShell>
  )
}
