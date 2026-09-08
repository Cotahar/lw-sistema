// Consulta pontual (read-only): lista contas a pagar cuja data_pagamento
// e igual a data_vencimento (pagas exatamente no dia do vencimento),
// exportando como CSV pra download.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const linhas = db.prepare(`
  SELECT cp.id, f.nome AS fornecedor, cc.nome AS centro_custo, cp.descricao, cp.valor, cp.valor_pago,
         cp.data_vencimento, cp.data_pagamento, cp.status, cp.origem_tipo
  FROM contas_pagar cp
  LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
  LEFT JOIN centros_custo cc ON cc.id = cp.centro_custo_id
  WHERE cp.data_pagamento IS NOT NULL AND cp.data_pagamento = cp.data_vencimento
    AND cp.data_vencimento <= '2026-09-07'
  ORDER BY cp.data_vencimento, cp.id
`).all();

console.log(`Encontradas ${linhas.length} conta(s) a pagar com data_pagamento = data_vencimento.`);

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const cabecalho = ['id', 'fornecedor', 'centro_custo', 'descricao', 'valor', 'valor_pago', 'data_vencimento', 'data_pagamento', 'status', 'origem_tipo'];
const csv = [cabecalho.join(';')]
  .concat(linhas.map((l) => [
    l.id, l.fornecedor, l.centro_custo, l.descricao,
    (l.valor / 100).toFixed(2).replace('.', ','),
    (l.valor_pago / 100).toFixed(2).replace('.', ','),
    l.data_vencimento, l.data_pagamento, l.status, l.origem_tipo,
  ].map(csvEscape).join(';')))
  .join('\n');

console.log('===CSV-INICIO===');
console.log(csv);
console.log('===CSV-FIM===');

db.close();
