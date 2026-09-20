import { after } from "next/server"

// Roda `task` DEPOIS de a resposta ser enviada. Usado no envio de e-mail da recuperação de
// senha: se a resposta esperasse o envio, o tempo dela diria se o e-mail existe. Falha da
// tarefa é só registrada — não há mais ninguém esperando para receber o erro.
// (Isolado aqui para os testes poderem substituir por execução imediata.)
export function afterResponse(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task()
    } catch (error) {
      console.error("Falha em tarefa pós-resposta:", error instanceof Error ? error.message : error)
    }
  })
}
