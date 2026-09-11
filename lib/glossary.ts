// Explicações em linguagem simples para termos contábeis que aparecem nas telas —
// para que alguém sem formação financeira também entenda o que está vendo.
export const GLOSSARY: Record<string, string> = {
  Ativo: 'Tudo que a empresa possui: dinheiro, bens e valores a receber.',
  'Ativo Total': 'Tudo que a empresa possui: dinheiro, bens e valores a receber.',
  Passivo: 'Tudo que a empresa deve a terceiros: bancos, fornecedores e outras dívidas.',
  'Passivo Total': 'Tudo que a empresa deve a terceiros: bancos, fornecedores e outras dívidas.',
  'Liquidez Corrente':
    'Mostra se a empresa tem bens e direitos suficientes no curto prazo para pagar o que deve no curto prazo.',
  'Liquidez Seca':
    'A mesma ideia da liquidez corrente, mas sem contar com a venda dos estoques — um teste mais rígido.',
  'Endividamento Geral':
    'Qual fatia de tudo que a empresa possui foi financiada com dívidas, em vez de capital próprio dos sócios.',
  'Margem Líquida': 'De cada R$ 100 vendidos, quanto vira lucro depois de todas as despesas e impostos.',
  ROE: 'Quanto de lucro a empresa gerou para cada R$ 100 investidos pelos próprios sócios.',
  'Giro do Ativo': 'Quantas vezes, no ano, a empresa transforma em vendas tudo que ela possui.',
  'Ativo Circulante':
    'Bens e valores que a empresa deve transformar em dinheiro em até 12 meses (caixa, estoque, contas a receber).',
  'Ativo Realizável a Longo Prazo': 'Bens e valores a receber que só devem virar dinheiro depois de 12 meses.',
  'Ativo Permanente':
    'Bens que a empresa usa para operar, não para vender — imóveis, máquinas, marcas — e que não devem virar dinheiro tão cedo.',
  'Passivo Circulante': 'Dívidas que a empresa precisa pagar em até 12 meses.',
  'Exigível a Longo Prazo': 'Dívidas que a empresa só precisa pagar depois de 12 meses.',
  'Patrimônio Líquido':
    'O que sobraria para os sócios se a empresa vendesse tudo que tem e pagasse todas as dívidas — o capital próprio do negócio.',
  Balanço:
    'Uma foto da situação financeira da empresa em uma data: o que ela tem (Ativo) e de quem é esse dinheiro — dela (Patrimônio Líquido) ou de terceiros (Passivo).',
  'Balanço Patrimonial':
    'Uma foto da situação financeira da empresa em uma data: o que ela tem (Ativo) e de quem é esse dinheiro — dela (Patrimônio Líquido) ou de terceiros (Passivo).',
  DRE: 'Demonstração do Resultado do Exercício — mostra se a empresa deu lucro ou prejuízo num período, somando receitas e subtraindo custos e despesas.',
  DFC: 'Demonstração do Fluxo de Caixa — mostra quanto dinheiro de fato entrou e saiu do caixa da empresa no período.',
  Balancete: 'Lista de todas as contas do Plano de Contas com seu saldo em um período — o detalhe por trás do Balanço.',

  // Contas analíticas (folha) do Plano de Contas padrão — o que o analista de fato
  // preenche na Tabulação, uma por uma.
  Disponibilidades: 'Dinheiro em caixa e em contas bancárias, disponível para uso imediato.',
  'Aplicações Financeiras':
    'Dinheiro investido em produtos financeiros de curto prazo (CDB, fundos etc.), fácil de resgatar.',
  'Contas a Receber de Clientes': 'Valores que os clientes ainda vão pagar por vendas já feitas a prazo.',
  Estoques: 'Mercadorias, matéria-prima ou produtos que a empresa tem guardados para vender ou usar na produção.',
  'Outros Créditos': 'Outros valores a receber que não se encaixam nas categorias anteriores.',
  'Aplicações Financeiras LP': 'Investimentos financeiros que só devem virar dinheiro depois de 12 meses.',
  'Depósitos Judiciais':
    'Valores que a empresa depositou na Justiça enquanto discute um processo, e que podem voltar para ela no futuro.',
  Imobilizado: 'Bens físicos que a empresa usa para operar — imóveis, máquinas, veículos, computadores.',
  Intangível: 'Bens que a empresa possui mas não são físicos — marcas, patentes, softwares.',
  Fornecedores: 'Valores que a empresa ainda deve pagar por compras já feitas a prazo.',
  'Empréstimos e Financiamentos': 'Dívidas com bancos ou instituições financeiras que vencem em até 12 meses.',
  'Obrigações Tributárias': 'Impostos e tributos que a empresa ainda precisa pagar.',
  'Empréstimos LP': 'Dívidas com bancos ou instituições financeiras que só vencem depois de 12 meses.',
  'Capital Social': 'O valor que os sócios investiram na empresa para criá-la ou expandi-la.',
  'Reservas de Lucros': 'Parte do lucro de anos anteriores que a empresa guardou em vez de distribuir aos sócios.',

  // Linhas da DRE (nomes exatos, incluindo o prefixo "(-)"/"(+/-)" usado nas telas).
  'Receita Bruta': 'Tudo que a empresa vendeu no período, antes de descontar impostos, devoluções e descontos.',
  '(-) Deduções da Receita': 'Impostos sobre vendas, devoluções e descontos que são tirados da receita bruta.',
  'Receita Líquida': 'O que sobra da receita depois de tirar impostos, devoluções e descontos.',
  '(-) Custo das Mercadorias Vendidas': 'Quanto custou para a empresa comprar ou produzir o que foi vendido.',
  'Lucro Bruto': 'O que sobra da venda depois de pagar só o custo direto do produto.',
  '(-) Despesas Operacionais':
    'Gastos para manter a empresa funcionando — salários, aluguel, marketing — que não são o custo direto do produto.',
  'Resultado Operacional (EBIT)': 'O lucro do negócio em si, antes de contar juros e impostos sobre o lucro.',
  '(+/-) Resultado Financeiro':
    'Juros e outros ganhos ou gastos financeiros, que não vêm da operação principal da empresa.',
  'Resultado Antes do IR/CSLL': 'O lucro antes de descontar os impostos que incidem sobre o próprio lucro.',
  '(-) IR/CSLL':
    'Imposto de Renda e Contribuição Social sobre o Lucro — os impostos cobrados sobre o que a empresa lucrou.',
  'Lucro Líquido do Exercício': 'O que sobra de lucro depois de pagar absolutamente tudo, inclusive impostos sobre o lucro.',

  // Linhas da DFC (demonstração estática, ver lib/financial-data.ts).
  'Fluxo de Caixa Operacional': 'Quanto dinheiro entrou ou saiu por causa da operação normal do negócio (vender, comprar, pagar despesas).',
  'Fluxo de Caixa de Investimentos':
    'Quanto dinheiro entrou ou saiu com a compra ou venda de bens de longo prazo, como máquinas ou imóveis.',
  'Fluxo de Caixa de Financiamentos':
    'Quanto dinheiro entrou ou saiu com empréstimos, financiamentos ou aportes/retiradas dos sócios.',
  'Variação Líquida de Caixa': 'A diferença total de caixa da empresa entre o início e o fim do período.',
  'Caixa no Início do Período': 'Quanto dinheiro a empresa tinha em caixa e bancos no primeiro dia do período.',
  'Caixa no Fim do Período': 'Quanto dinheiro a empresa tinha em caixa e bancos no último dia do período.',
}
