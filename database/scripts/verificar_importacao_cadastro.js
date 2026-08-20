// Verificacao pontual (read-only) do resultado da importacao oficial:
// veiculos/motoristas/conjuntos cadastrados + historico Drivvo importado
// sem impacto em caixa.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const hist = db.prepare("SELECT COUNT(*) c, SUM(valor) v FROM contas_pagar WHERE descricao LIKE ?").get('[Historico Drivvo]%');
console.log('Historico Drivvo - linhas:', hist.c, '- Soma: R$', (hist.v / 100).toFixed(2));

const caixa = db.prepare('SELECT COUNT(*) c FROM movimentacoes_caixa').get();
console.log('movimentacoes_caixa (deve ser 0):', caixa.c);

const veiculos = db.prepare('SELECT COUNT(*) c FROM veiculos').get();
const motoristas = db.prepare('SELECT COUNT(*) c FROM motoristas').get();
const conjuntos = db.prepare('SELECT COUNT(*) c FROM conjuntos').get();
console.log('veiculos:', veiculos.c, '| motoristas:', motoristas.c, '| conjuntos:', conjuntos.c);

console.log('\nAmostra de 5 lancamentos:');
db.prepare("SELECT data_vencimento, valor, descricao FROM contas_pagar WHERE descricao LIKE ? ORDER BY id LIMIT 5").all('[Historico Drivvo]%')
  .forEach((r) => console.log(r.data_vencimento, (r.valor / 100).toFixed(2).padStart(10), r.descricao));

db.close();
