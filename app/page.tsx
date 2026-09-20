"use client"

import { useState } from "react"
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
  const { status, user } = useFinancialStore()

  if (status !== "ready") return <StoreLoadGate />

  return (
    <div className="flex min-h-dvh bg-background">
      <MutationErrorBanner />
      <div className="sticky top-0 h-dvh print:hidden">
        <AppSidebar active={screen} onNavigate={setScreen} />
      </div>

      <main className="min-w-0 flex-1">
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
