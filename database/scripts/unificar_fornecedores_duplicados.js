// Unifica dois cadastros de fornecedor duplicados: migra toda referencia do
// fornecedor "removido" pro "mantido" em TODAS as tabelas que tem FK real
// pra fornecedores(id) (ver verificar_fornecedores_duplicados.js pra achar
// os ids certos primeiro), opcionalmente renomeia o que ficou, e so entao
// apaga o duplicado. Generico de proposito - o mesmo tipo de duplicidade ja
// apareceu antes (ex.: "R.FARIAS TRANSPORTES" x "R FARIAS TRANSPORTE" na
// importacao retroativa) e deve aparecer de novo.
//
// Dry-run por padrao (so mostra quantos registros migrariam, sem tocar em
// nada). Uso:
//   node unificar_fornecedores_duplicados.js <id_manter> <id_remover> ["Nome final"] [--confirmo]
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2).filter((a) => a !== '--confirmo');
const CONFIRMAR = process.argv.includes('--confirmo');
const [idManterStr, idRemoverStr, nomeFinal] = args;

if (!idManterStr || !idRemoverStr) {
  console.error('Uso: node unificar_fornecedores_duplicados.js <id_manter> <id_remover> ["Nome final"] [--confirmo]');
  process.exit(1);
}
const idManter = Number(idManterStr);
const idRemover = Number(idRemoverStr);
if (idManter === idRemover) {
  console.error('id_manter e id_remover nao podem ser o mesmo.');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const TABELAS_REFERENCIA = [
  { tabela: 'estoque_movimentacoes', coluna: 'fornecedor_id' },
  { tabela: 'pneus', coluna: 'fornecedor_id' },
  { tabela: 'pneu_eventos', coluna: 'fornecedor_id' },
  { tabela: 'ordens_servico', coluna: 'fornecedor_id' },
  { tabela: 'fretes', coluna: 'transportadora_id' },
  { tabela: 'despesas_viagem', coluna: 'posto_fornecedor_id' },
  { tabela: 'financiamentos', coluna: 'credor_fornecedor_id' },
  { tabela: 'contas_pagar', coluna: 'fornecedor_id' },
];

try {
  const manter = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(idManter);
  const remover = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(idRemover);
  if (!manter) throw new Error(`Fornecedor #${idManter} (id_manter) nao encontrado.`);
  if (!remover) throw new Error(`Fornecedor #${idRemover} (id_remover) nao encontrado.`);
  if (manter.empresa_id !== remover.empresa_id) {
    throw new Error(`Os dois fornecedores sao de empresas diferentes (#${idManter}=empresa ${manter.empresa_id}, #${idRemover}=empresa ${remover.empresa_id}) - nao e seguro unificar entre tenants.`);
  }
  if (manter.tipo_id !== remover.tipo_id) {
    console.log(`AVISO: os dois fornecedores tem tipo_id diferente (#${idManter}=${manter.tipo_id}, #${idRemover}=${remover.tipo_id}). Confirme que sao mesmo a mesma entidade antes de prosseguir.`);
  }

  console.log(`Mantendo #${idManter} ("${manter.nome}"), removendo #${idRemover} ("${remover.nome}").`);
  if (nomeFinal) console.log(`Nome final: "${nomeFinal}"`);

  let totalMigrado = 0;
  const migracoes = [];
  for (const { tabela, coluna } of TABELAS_REFERENCIA) {
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM ${tabela} WHERE ${coluna} = ?`).get(idRemover);
    if (c > 0) {
      migracoes.push({ tabela, coluna, c });
      totalMigrado += c;
    }
  }
  if (!migracoes.length) {
    console.log('Nenhum lancamento aponta pro fornecedor a remover - so a exclusao (e o rename, se pedido) serao aplicados.');
  }
  for (const { tabela, coluna, c } of migracoes) {
    console.log(`${CONFIRMAR ? 'Migrando' : '[dry-run] migraria'} ${c} registro(s) de ${tabela}.${coluna}`);
  }

  if (!CONFIRMAR) {
    console.log(`\n[dry-run] Total: ${totalMigrado} lancamento(s) migrariam de #${idRemover} para #${idManter}, e #${idRemover} seria excluido. Rode com --confirmo para aplicar de verdade.`);
    db.close();
    process.exit(0);
  }

  db.exec('BEGIN');
  for (const { tabela, coluna } of migracoes) {
    db.prepare(`UPDATE ${tabela} SET ${coluna} = ? WHERE ${coluna} = ?`).run(idManter, idRemover);
  }
  if (nomeFinal) {
    db.prepare('UPDATE fornecedores SET nome = ? WHERE id = ?').run(nomeFinal, idManter);
  }
  db.prepare('DELETE FROM fornecedores WHERE id = ?').run(idRemover);

  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) {
    throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s) apos a unificacao: ${JSON.stringify(problemas.slice(0, 5))}`);
  }
  db.exec('COMMIT');

  console.log(`\n${totalMigrado} lancamento(s) migrado(s) de #${idRemover} para #${idManter}. Fornecedor #${idRemover} excluido.`);
  const final = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(idManter);
  console.log(`Fornecedor final: #${final.id} "${final.nome}"`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* nada em transacao pra desfazer (dry-run ou falhou antes do BEGIN) */ }
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
