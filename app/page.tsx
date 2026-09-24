"use client"

import { useEffect, useState } from "react"
import { Menu, X } from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { DashboardScreen } from "@/components/screens/dashboard-screen"
import { PlanoDeContasScreen } from "@/components/screens/plano-de-contas-screen"
import { TabulacaoScreen } from "@/components/screens/tabulacao-screen"
import { DemonstracoesScreen } from "@/components/screens/demonstracoes-screen"
import { IndicesScreen } from "@/components/screens/indices-screen"
import { OpiniaoDeVendaScreen } from "@/components/screens/opiniao-de-venda-screen"
import { ExtracaoIaScreen } from "@/components/screens/extracao-ia-screen"
import { MutationErrorBanner, StoreLoadGate } from "@/components/store-status"
import type { ScreenId } from "@/lib/navigation"
import { AuditoriaScreen } from "@/components/screens/auditoria-screen"
import { UsuariosScreen } from "@/components/screens/usuarios-screen"
import { can } from "@/lib/permissions"
import { FinancialDataProvider, useFinancialStore } from "@/lib/store"

// O provider mora aqui (e não no layout) porque carrega os dados da API, que exigem login:
// no layout ele também rodaria em /login e tomaria 401.
export default function Page() {
  return (
    <FinancialDataProvider>
      <App />
    </FinancialDataProvider>
  )
}

function App() {
  const [screen, setScreen] = useState<ScreenId>("opiniao-de-venda")
  // Celular/tablet estreito: a barra lateral vira uma gaveta aberta pelo botão do topo.
  const [menuOpen, setMenuOpen] = useState(false)
  const { status, user } = useFinancialStore()

  if (status !== "ready") return <StoreLoadGate />

  function navigate(id: ScreenId) {
    setScreen(id)
    setMenuOpen(false)
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <MutationErrorBanner />
      <div className="sticky top-0 hidden h-dvh md:block print:hidden">
        <AppSidebar active={screen} onNavigate={navigate} />
      </div>

      {menuOpen && <MobileDrawer onClose={() => setMenuOpen(false)}><AppSidebar active={screen} onNavigate={navigate} /></MobileDrawer>}

      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-2 md:hidden print:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-haspopup="dialog"
            className="flex size-9 items-center justify-center rounded-md border border-border text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <span className="font-display text-sm font-bold tracking-tight text-foreground">Central de Balanços</span>
        </div>
        {screen === "dashboard" && <DashboardScreen />}
        {screen === "plano-de-contas" && <PlanoDeContasScreen />}
        {screen === "tabulacao" && <TabulacaoScreen />}
        {screen === "demonstracoes" && <DemonstracoesScreen />}
        {screen === "indices" && <IndicesScreen />}
        {screen === "opiniao-de-venda" && <OpiniaoDeVendaScreen onNavigate={setScreen} />}
        {screen === "extracao-ia" && <ExtracaoIaScreen onNavigate={setScreen} />}
        {screen === "auditoria" && <AuditoriaScreen />}
        {screen === "usuarios" && can(user.papel, "gerir-usuarios") && <UsuariosScreen />}
      </main>
    </div>
  )
}

// Gaveta do menu no celular: fundo escurecido que fecha ao clicar, Esc fecha, foco vai para o menu ao abrir.
function MobileDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex md:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="relative">
        {children}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </div>
      <button type="button" aria-label="Fechar menu" tabIndex={-1} onClick={onClose} className="flex-1 bg-foreground/40" />
    </div>
  )
}
