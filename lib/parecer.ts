// Parecer de crédito registrado (app/api/pareceres): tipos e rótulos usados pelo servidor e pela tela.

export const DECISOES = ["APROVADO", "APROVADO_COM_RESSALVAS", "REPROVADO"] as const
export type Decisao = (typeof DECISOES)[number]

export const DECISAO_LABEL: Record<Decisao, string> = {
  APROVADO: "Aprovado",
  APROVADO_COM_RESSALVAS: "Aprovado com ressalvas",
  REPROVADO: "Reprovado",
}

export interface ParecerRegistrado {
  id: number
  exercicio: string
  registradoPor: string
  criadoEm: string
  classificacao: "favoravel" | "ressalvas" | "desfavoravel"
  score: number
  valorSolicitado: number
  limiteSugerido: number | null
  criterios: { label: string; value: string; status: "ok" | "atencao" | "risco"; weight: number; insuficiente: boolean }[]
  decisao: Decisao
  limiteAprovado: number | null
  validadeAte: string | null
  justificativa: string
}
