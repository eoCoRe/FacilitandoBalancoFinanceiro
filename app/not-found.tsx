import type { Metadata } from "next"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Página não encontrada · Central de Balanços" }

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço não existe ou foi movido.</p>
        <Link href="/" className={cn(buttonVariants(), "mt-2")}>
          Voltar ao início
        </Link>
      </div>
    </main>
  )
}
