import medias from "@/lib/setores/medias-cvm.json"

// Referências de mercado por setor, para comparar os índices da empresa analisada com o setor. Vêm das demonstrações
// das companhias abertas publicadas pela CVM (Dados Abertos, DFP): a MEDIANA de cada índice entre as empresas do
// setor. Metodologia em lib/setores/medias-cvm.ts; os números são gerados por `pnpm setores:atualizar`, que grava
// lib/setores/medias-cvm.json (o app não acessa a internet para isso).

export interface Sector {
  id: string
  label: string
}

export const SECTORS: Sector[] = [
  { id: "comercio-varejista", label: "Comércio Varejista" },
  { id: "industria", label: "Indústria de Transformação" },
  { id: "servicos", label: "Serviços" },
  { id: "construcao-civil", label: "Construção Civil" },
  { id: "agronegocio", label: "Agronegócio" },
]

export const DEFAULT_SECTOR_ID = SECTORS[0].id

type SetorCvm = { empresas: number; medianas: Record<string, number>; amostras: Record<string, number> }
const SETORES = medias.setores as Record<string, SetorCvm>

// De onde vêm as referências (para a tela e para a monografia).
export const BENCHMARK_SOURCE = {
  fonte: medias.fonte,
  url: medias.url,
  exercicio: medias.exercicio,
  estatistica: medias.estatistica,
}

export function sectorBenchmarkFor(sectorId: string, indicatorId: string): number | undefined {
  return SETORES[sectorId]?.medianas[indicatorId]
}

// Quantas companhias do setor entraram na referência do índice (0 = sem referência).
export function sectorBenchmarkSample(sectorId: string, indicatorId: string): number {
  return SETORES[sectorId]?.amostras[indicatorId] ?? 0
}

export function sectorCompanies(sectorId: string): number {
  return SETORES[sectorId]?.empresas ?? 0
}

export function sectorLabel(sectorId: string): string {
  return SECTORS.find((s) => s.id === sectorId)?.label ?? sectorId
}
