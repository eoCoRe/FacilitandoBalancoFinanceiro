# Pendentes do TCC

Lista do que falta fazer, em ordem de prioridade. Riscar (ou apagar) quando entrar na `main`.

## 1. Extração com IA de verdade (obrigatório)

Hoje a tela "Extração via IA" usa um leitor **por regras** (`lib/extraction/`): texto do PDF → rótulo + valor →
sinônimos e distância de edição. **Não há IA nenhuma.** O TCC exige IA, então:

- [ ] Chamar um LLM (ex.: Claude via API) com o texto do PDF para ler as contas e sugerir o mapeamento para o
      Plano de Contas e a DRE, devolvendo o mesmo formato `ExtractedRow` que a tela de revisão já usa.
- [ ] A chamada vai **no servidor** (rota nova em `app/api/`), com a chave em `LLM_API_KEY` (já prevista no
      `.env.example`), nunca no navegador.
- [ ] Anonimizar antes de enviar: `lib/redaction.ts` (CNPJ, CPF, razão social) já existe e está testada.
- [ ] Guardar o modelo usado em `Extracao.modeloLlm` (o campo já existe; hoje grava `leitor-pdf-local`).
- [ ] Manter o leitor por regras como alternativa (sem internet ou sem chave) e **comparar os dois** com
      `pnpm avaliar:extracao` → resultado para o capítulo de avaliação da monografia.
- [ ] Revisão humana continua obrigatória (human-in-the-loop): a IA só sugere.
- [ ] PDF escaneado (imagem): hoje não é lido; um modelo com visão resolve.

## 2. Esperando o PDF com as regras do TCC

- [ ] Cruzar os requisitos (RF/RNF) com o que já existe e montar o cronograma até a entrega.

## 3. Conferir na tela (depois das correções de 24/09)

- [ ] Extração de um balanço real ponta a ponta: seletor "Valores do documento em", DRE preenchida, índices.
- [ ] Tabulação: editar valor com centavos e digitar vírgula.
