// Importa faturas ANTIGAS do Sem Parar (ago/set-2026) ja quitadas fora do Frottex e tira do DRE o "pedagio da viagem"
// lancado de uma vez so na importacao retroativa (passa para o campo informativo da viagem, como nas viagens novas):
// com TODAS as faturas importadas, o pedagio que entra no DRE e so o do Sem Parar.
//   node database/scripts/importar_faturas_sem_parar_20261023.js --payloads=a.json,b.json                  (so simula)
//   node database/scripts/importar_faturas_sem_parar_20261023.js --payloads=a.json,b.json --aplicar
//   (em producao: --backend=/app/backend)
// Cada payload e o JSON das abas da fatura (as mesmas que o navegador manda para a tela "Importar Fatura Sem Parar").
const fs = require('node:fs');
const path = require('node:path');

const aplicar = process.argv.includes('--aplicar');
const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const BACKEND = arg('backend') || path.resolve(__dirname, '../../backend');
const payloads = arg('payloads').split(',').filter(Boolean);
if (!payloads.length) { console.error('Informe --payloads=arquivo1.json,arquivo2.json'); process.exit(1); }

const db = require(path.join(BACKEND, 'src/config/db'));
const { importarFatura, analisarParaEmpresa } = require(path.join(BACKEND, 'src/utils/importacaoSemParar'));

const EMPRESA_ID = 1;
const usuario = db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY (username = 'ruan.figueiredo21') DESC, id LIMIT 1").get();
const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE nome = 'PEDÁGIO'").get();
const fornecedor = db.prepare("SELECT id FROM fornecedores WHERE empresa_id = ? AND upper(nome) LIKE '%SEM PARAR%' ORDER BY id LIMIT 1").get(EMPRESA_ID);
if (!usuario || !categoria || !fornecedor) { console.error('Faltou usuario admin, categoria PEDÁGIO ou fornecedor Sem Parar.'); process.exit(1); }
const reais = (c) => (c / 100).toFixed(2);

console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} (usuario #${usuario.id}, categoria #${categoria.id}, fornecedor #${fornecedor.id})\n`);

// ---- 1) faturas
const abasPorArquivo = payloads.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
for (const abas of abasPorArquivo) {
  const a = analisarParaEmpresa(EMPRESA_ID, abas);
  console.log(`Fatura ${a.fatura.numero} venc. ${a.fatura.vencimento} total R$ ${reais(a.fatura.total)} | soma das placas R$ ${reais(a.soma_placas)} | ja importada: ${a.ja_importada ? 'SIM' : 'nao'}`);
  a.placas.forEach((p) => console.log(`   ${p.placa} -> ${p.centro_custo_nome || 'SEM CADASTRO'}: R$ ${reais(p.liquido)}`));
  if (a.avisos.length) console.log(`   AVISOS: ${a.avisos.join(' | ')}`);
}

// ---- 2) pedagio da viagem lancado de uma vez so
const lumps = db.prepare(`
  SELECT dv.*, vg.valor_pedagio AS viagem_pedagio FROM despesas_viagem dv JOIN viagens vg ON vg.id = dv.viagem_id
  WHERE dv.descricao LIKE 'PEDÁGIO DA VIAGEM (LANÇAMENTO ÚNICO%' ORDER BY dv.id
`).all();
console.log(`\nPedagio da viagem em lancamento unico (sai do DRE; o valor vai para o pedagio informativo da viagem): ${lumps.length}`);
const planoLumps = [];
for (const l of lumps) {
  const conta = l.contas_pagar_id ? db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(l.contas_pagar_id) : null;
  const vinculos = conta ? db.prepare("SELECT (SELECT COUNT(*) FROM movimentacoes_caixa WHERE origem_tipo = 'ContaPagar' AND origem_id = ?) + (SELECT COUNT(*) FROM ocorrencias WHERE entidade_tipo = 'ContaPagar' AND entidade_id = ?) + (SELECT COUNT(*) FROM anexos WHERE entidade_tipo = 'ContaPagar' AND entidade_id = ?) AS n").get(conta.id, conta.id, conta.id).n : 0;
  const problemas = [];
  if (l.viagem_pedagio) problemas.push(`a viagem #${l.viagem_id} ja tem pedagio informativo (R$ ${reais(l.viagem_pedagio)})`);
  if (vinculos) problemas.push(`a conta #${conta.id} tem movimento de caixa/ocorrencia/anexo`);
  console.log(`   despesa #${l.id} viagem #${l.viagem_id} R$ ${reais(l.valor)} (conta #${conta ? conta.id : '-'} ${conta ? conta.status : ''})${problemas.length ? ` -> PULADA: ${problemas.join('; ')}` : ''}`);
  if (!problemas.length) planoLumps.push({ l, conta });
}

if (!aplicar) { console.log('\nNada foi alterado. Para aplicar: --aplicar'); process.exit(0); }

for (const abas of abasPorArquivo) {
  try {
    const r = importarFatura({ empresaId: EMPRESA_ID, usuarioId: usuario.id, abas, categoria_id: categoria.id, fornecedor_id: fornecedor.id, jaPaga: true });
    console.log(`\nImportada a fatura ${r.fatura.numero}: conta a pagar #${r.conta_pagar_id} de R$ ${reais(r.valor_total)} (paga sem movimento de caixa), ${r.despesas.length} despesas.`);
  } catch (err) {
    console.log(`\nFatura NAO importada: ${err.message}`);
  }
}

const auditar = (tabela, id, acao, antes, depois) => db.prepare(
  'INSERT INTO logs_auditoria (empresa_id, usuario_id, tabela_afetada, registro_id, acao, dados_antes, dados_depois) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(EMPRESA_ID, usuario.id, tabela, id, acao, antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null);
try {
  db.exec('BEGIN');
  for (const { l, conta } of planoLumps) {
    const { viagem_pedagio: _ignorar, ...despesa } = l;
    db.prepare('UPDATE viagens SET valor_pedagio = ? WHERE id = ?').run(l.valor, l.viagem_id);
    auditar('viagens', l.viagem_id, 'UPDATE', { valor_pedagio: 0 }, { valor_pedagio: l.valor });
    db.prepare('DELETE FROM despesas_viagem WHERE id = ?').run(l.id);
    auditar('despesas_viagem', l.id, 'DELETE', despesa, null);
    if (conta) {
      db.prepare('DELETE FROM contas_pagar WHERE id = ?').run(conta.id);
      auditar('contas_pagar', conta.id, 'DELETE', conta, null);
    }
    console.log(`Pedagio da viagem #${l.viagem_id}: R$ ${reais(l.valor)} saiu das despesas e foi para o pedagio informativo.`);
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ERRO ao mover o pedagio das viagens (nada foi alterado nessa etapa):', err.message);
  process.exitCode = 1;
}
console.log('\nConcluido.');
