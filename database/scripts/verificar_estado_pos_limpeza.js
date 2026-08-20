// Verificacao pontual (read-only) do estado do banco apos a limpeza para
// importacao oficial - confirma que o que devia ficar ficou, e o que devia
// ser apagado foi apagado.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function contar(tabela) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get().total;
}

console.log('=== Preservado (deve ter linhas) ===');
['usuarios', 'empresas', 'usuario_empresas', 'categorias_despesa', 'fornecedor_tipos', 'comissao_faixas'].forEach((t) => {
  console.log(`${t}: ${contar(t)}`);
});
console.log('centros_custo (Base):', db.prepare("SELECT COUNT(*) c FROM centros_custo WHERE tipo='Base'").get().c);

console.log('\n=== Zerado (deve ser 0) ===');
['veiculos', 'motoristas', 'fornecedores', 'conjuntos', 'viagens', 'fretes', 'despesas_viagem', 'contas_pagar', 'contas_receber', 'financiamentos', 'logs_auditoria', 'centros_custo'].forEach((t) => {
  const total = t === 'centros_custo' ? db.prepare("SELECT COUNT(*) c FROM centros_custo WHERE tipo='Veiculo'").get().c : contar(t);
  console.log(`${t}: ${total}`);
});

console.log('\n=== Usuarios (nenhum motorista_id orfao esperado) ===');
console.log(JSON.stringify(db.prepare('SELECT id, nome, username, perfil, motorista_id FROM usuarios').all(), null, 2));

db.close();
