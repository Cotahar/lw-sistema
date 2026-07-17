// Espelha os modulos cadastrados em modulos_sistema (schema.sql) + suas
// rotas no frontend, agrupados para o menu lateral.
export const GRUPOS_MENU = [
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
    titulo: 'Operacao',
    itens: [
      { chave: 'viagens', label: 'Viagens e Fretes', rota: '/viagens' },
      { chave: 'acertos', label: 'Acertos de Viagem', rota: '/acertos' },
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
    titulo: 'Relatorios',
    itens: [{ chave: 'dre', label: 'DRE', rota: '/dre' }],
  },
];

export const ROTA_PAINEL = '/dashboard';
export const ITEM_ADMIN = { label: 'Usuarios e Permissoes', rota: '/usuarios' };
export const ITEM_AUDITORIA = { label: 'Auditoria e Reversao', rota: '/auditoria' };

// Telas de configuracao/taxonomia do sistema: restritas ao Admin, fora da
// matriz de permissoes por modulo (ver crudGenerico.js: somenteAdmin).
export const ITENS_CONFIGURACAO = [
  { label: 'Tipos de Fornecedor', rota: '/config/fornecedor-tipos' },
  { label: 'Categorias de Despesa', rota: '/config/categorias-despesa' },
  { label: 'Faixas de Comissao', rota: '/config/comissao-faixas' },
  { label: 'Catalogo de Checklist', rota: '/config/checklist-catalogo' },
];
