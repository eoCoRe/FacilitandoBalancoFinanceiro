// Máximo de linhas de UMA extração confirmada (mapeadas + sem conta). Vale no servidor (POST /api/extracoes recusa mais que
// isso) e na tela, que decide o que cabe: as linhas COM conta (os valores a lançar) sempre vão; as sem conta (só
// histórico) entram enquanto couber.
export const EXTRACAO_ITENS_MAX = 500

// Decide o que enviar. As COM conta vão TODAS (se só elas já passarem do limite, o servidor recusa com um aviso
// visível — nunca se corta valor em silêncio); as SEM conta entram enquanto couber, e `omitidas` diz quantas ficaram
// de fora para a tela avisar.
export function selectEntriesToSend<T>(comConta: readonly T[], semConta: readonly T[], max = EXTRACAO_ITENS_MAX): { enviar: T[]; omitidas: number } {
  const enviadasSemConta = semConta.slice(0, Math.max(0, max - comConta.length))
  return { enviar: [...comConta, ...enviadasSemConta], omitidas: semConta.length - enviadasSemConta.length }
}
