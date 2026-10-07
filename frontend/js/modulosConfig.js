// Espelha os modulos cadastrados em modulos_sistema (schema.sql) + suas
// rotas no frontend, agrupados para o menu lateral.
// Ordem por frequencia de uso real (nao por categoria): Operacao e Financeiro
// sao o dia a dia; Frota e Cadastros sao majoritariamente configuracao inicial
// (ver revisao de design - "Ordem do menu").
export const GRUPOS_MENU = [
  {
    titulo: 'Operacao',
    itens: [
      { chave: 'viagens', label: 'Viagens e Fretes', rota: '/viagens' },
      { chave: 'acertos', label: 'Acertos de Viagem', rota: '/acertos' },
      { chave: 'multas', label: 'Multas de Transito', rota: '/multas' },
      { chave: 'viagens', label: 'Calculo de Frete', rota: '/calculo-frete' },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { chave: 'contas_bancarias', label: 'Contas Bancarias', rota: '/contas-bancarias' },
      { chave: 'contas_pagar', label: 'Contas a Pagar', rota: '/contas-pagar' },
      { chave: 'contas_receber', label: 'Contas a Receber', rota: '/contas-receber' },
      { chave: 'despesas_fixas', label: 'Despesas Fixas', rota: '/despesas-fixas' },
      { chave: 'financiamentos', label: 'Financiamentos', rota: '/financiamentos' },
    ],
  },
  {
    titulo: 'Frota',
    itens: [
      { chave: 'estoque', label: 'Estoque', rota: '/estoque' },
      { chave: 'pneus', label: 'Pneus', rota: '/pneus' },
      { chave: 'manutencao', label: 'Manutencao (OS)', rota: '/manutencao' },
      { chave: 'alertas', label: 'Alertas', rota: '/alertas' },
      { chave: 'checklist', label: 'Checklist de Bordo', rota: '/checklist' },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { chave: 'fornecedores', label: 'Fornecedores', rota: '/fornecedores' },
      { chave: 'motoristas', label: 'Motoristas', rota: '/motoristas' },
      { chave: 'veiculos', label: 'Veiculos e Frota', rota: '/veiculos' },
      { chave: 'conjuntos', label: 'Composicoes', rota: '/conjuntos' },
    ],
  },
  {
    // "secao" (opcional, por item): sub-cabecalho visual dentro do grupo -
    // ver renderGrupoAccordion em main.js. So o grupo Relatorios usa isso
    // por enquanto (cresceu demais pra ficar tudo numa lista so), mas
    // qualquer grupo pode usar o mesmo campo.
    titulo: 'Relatorios',
    itens: [
      { chave: 'dre', label: 'DRE', rota: '/dre', secao: 'Financeiro' },
      { chave: 'dre', label: 'Saldos em Aberto', rota: '/relatorios/saldos-em-aberto', secao: 'Financeiro' },
      { chave: 'dre', label: 'Aging de Contas a Pagar', rota: '/relatorios/aging-contas-pagar', secao: 'Financeiro' },
      { chave: 'dre', label: 'Relatorio de Despesas', rota: '/relatorios/despesas', secao: 'Financeiro' },
      { chave: 'dre', label: 'Relatorio de Fretes/Receitas', rota: '/relatorios/fretes', secao: 'Financeiro' },
      { chave: 'dre', label: 'Extrato Conta Corrente Motorista', rota: '/relatorios/conta-corrente-motorista', secao: 'Financeiro' },
      { chave: 'dre', label: 'Despesas Fixas por Categoria', rota: '/relatorios/despesas-fixas', secao: 'Financeiro' },
      { chave: 'dre', label: 'Parcelas de Financiamento', rota: '/relatorios/parcelas-financiamento', secao: 'Financeiro' },
      { chave: 'dre', label: 'DRE Multi-periodo', rota: '/relatorios/dre-multi-periodo', secao: 'Gestao' },
      { chave: 'dre', label: 'Relatorio de Viagens', rota: '/relatorios/viagens', secao: 'Gestao' },
      { chave: 'dre', label: 'Fluxo de Caixa', rota: '/relatorios/fluxo-caixa', secao: 'Gestao' },
      { chave: 'dre', label: 'Ranking de Conjuntos', rota: '/relatorios/ranking-veiculos', secao: 'Gestao' },
      { chave: 'dre', label: 'Ranking de Motoristas', rota: '/relatorios/ranking-motoristas', secao: 'Gestao' },
      { chave: 'dre', label: 'Rentabilidade por Rota', rota: '/relatorios/rentabilidade-rota', secao: 'Gestao' },
      { chave: 'dre', label: 'Comparativo de Consumo', rota: '/relatorios/comparativo-consumo', secao: 'Combustivel' },
      { chave: 'dre', label: 'Divergencia de Consumo', rota: '/relatorios/divergencia-consumo', secao: 'Combustivel' },
      { chave: 'dre', label: 'Custo de Manutencao por Veiculo', rota: '/relatorios/manutencao-custo', secao: 'Frota' },
      { chave: 'dre', label: 'Historico de Manutencao', rota: '/relatorios/manutencao-historico', secao: 'Frota' },
      { chave: 'dre', label: 'Posicao e Consumo de Estoque', rota: '/relatorios/estoque', secao: 'Frota' },
      { chave: 'dre', label: 'Pneus - Custo e Vida Util', rota: '/relatorios/pneus', secao: 'Frota' },
      { chave: 'dre', label: 'Alertas de Manutencao', rota: '/relatorios/alertas', secao: 'Frota' },
      { chave: 'dre', label: 'Multas por Motorista/Veiculo', rota: '/relatorios/multas', secao: 'Compliance' },
      { chave: 'dre', label: 'CNH a Vencer', rota: '/relatorios/cnh-vencimento', secao: 'Compliance' },
    ],
  },
];

export const ROTA_PAINEL = '/dashboard';
export const ITEM_ADMIN = { label: 'Usuarios e Permissoes', rota: '/usuarios' };
export const ITEM_AUDITORIA = { label: 'Auditoria e Reversao', rota: '/auditoria' };
export const ITEM_ATIVIDADE_USUARIOS = { label: 'Atividade por Usuario', rota: '/relatorios/atividade-usuarios' };

// Telas de configuracao/taxonomia do sistema: restritas ao Admin, fora da
// matriz de permissoes por modulo (ver crudGenerico.js: somenteAdmin).
export const ITENS_CONFIGURACAO = [
  { label: 'Empresas', rota: '/config/empresas' },
  { label: 'Tipos de Fornecedor', rota: '/config/fornecedor-tipos' },
  { label: 'Categorias de Despesa', rota: '/config/categorias-despesa' },
  { label: 'Faixas de Comissao', rota: '/config/comissao-faixas' },
  { label: 'Catalogo de Checklist', rota: '/config/checklist-catalogo' },
];
