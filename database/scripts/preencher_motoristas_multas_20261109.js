// Preenche o motorista das multas importadas do portal Senatran.
//   node database/scripts/preencher_motoristas_multas_20261109.js            (so simula)
//   node database/scripts/preencher_motoristas_multas_20261109.js --aplicar
//   (em producao: --backend=/app/backend)
// 1) VIAGENS DO FROTTEX: multa sem motorista cuja data da infracao cai na viagem de um conjunto que tem o veiculo,
//    com UM so motorista possivel -> preenche como "Indicar condutor" (status CondutorIndicado). Multa por nao
//    identificacao do condutor (status NaoIndicado) nao entra: a data dela nao e a da infracao original.
// 2) DADOS ANTIGOS (antes das viagens do Frottex): motoristas apurados em documentos fora do sistema (acertos, cargas,
//    contestacao trabalhista, CT-e/MDF-e). Entram com a marca "dados antigos" + a fonte e o grau de confianca,
//    SEM mudar o status (continua aguardando indicacao ate o operador confirmar em "Indicar condutor").
// Idempotente: so mexe em multa que ainda esta sem motorista.
const path = require('node:path');

const aplicar = process.argv.includes('--aplicar');
const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const BACKEND = arg('backend') || path.resolve(__dirname, '../../backend');
const EMPRESA_ID = 1;

const db = require(path.join(BACKEND, 'src/config/db'));
const { withTransaction } = require(path.join(BACKEND, 'src/utils/transaction'));
const { registrarAuditoria } = require(path.join(BACKEND, 'src/utils/audit'));
const usuario = db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY (username = 'ruan.figueiredo21') DESC, id LIMIT 1").get();
if (!usuario) { console.error('Nenhum usuario Admin encontrado.'); process.exit(1); }

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fonteEdvaldo = 'Edvaldo Laurindo Vieira dirigiu a TPN8E74 de 02/03 a 03/08/2026 (contestacao trabalhista; acertos de 04/03 a 27/05; cargas e CT-e de marco a junho). Confianca ALTA.';
const fonteEdvaldoCarreta = 'Carreta TWT4B11 atrelada a TPN8E74 (Edvaldo) em CT-e de 05/03 e de 16/04 a 16/05/2026; Edvaldo dirigiu a TPN8E74 ate 03/08/2026. Sem documento de junho/julho. Confianca MEDIA.';
const fonteJesseTvp = 'Jesse Campos Alves na TVP0B82 de 08/04 a 01/07/2026 (planilha de Acertos, aba TVP-0B82; cargas de 03/06 e 17/06). Confianca ALTA.';
const fonteJesseCarreta = 'Carreta TWC0A52 era da TVP0B82, conduzida pelo Jesse ate 01/07/2026 (planilha de Acertos; cargas de junho). Confianca MEDIA.';
const fonteMaicon = 'Cargas da TVP0B82 em nome de Maicon Cunha da Silva em 06/07 e 30/07/2026 (sem acerto fechado). Confianca MEDIA.';
const DECISOES = [
  ...['1L 8046122', 'SC01251974', 'SC01251975', 'J009678697', 'J010019427', 'Z001168414', 'SC01266479', '1VA4558587'].map((ait) => ['TPN8E74', ait, 'EDVALDO LAURINDO VIEIRA', fonteEdvaldo]),
  ...['LS00013917', 'AI09492636', 'AI09492637', 'J009314983', '1VA3831883', 'J009766868'].map((ait) => ['TVP0B82', ait, 'JESSE CAMPOS ALVES', fonteJesseTvp]),
  ...['N005686991', 'N005686992', 'FD00042240', 'J010179177'].map((ait) => ['TVP0B82', ait, 'MAICON CUNHA DA SILVA', fonteMaicon]),
  ...['ATV0751561', 'VSV1025799', 'AI08007125', 'S049988049', 'S049988234', 'S050258952', '1VA3974586', 'TG00575836', 'TG00575837', 'S050513494', 'S050515342', 'J009963878', 'J009963893', '1VA4351170', 'S050640501', 'S050695050', 'S050755764'].map((ait) => ['TWT4B11', ait, 'EDVALDO LAURINDO VIEIRA', fonteEdvaldoCarreta]),
  ...['S050218994', 'J009771746', 'J009774354'].map((ait) => ['TWC0A52', ait, 'JESSE CAMPOS ALVES', fonteJesseCarreta]),
  // Multas por NAO IDENTIFICACAO do condutor (5002-0): a penalidade e emitida ~6 a 8 semanas depois da infracao de origem,
  // e o responsavel e o motorista da infracao de origem. Ligadas ao Edvaldo (a pedido do usuario):
  ...[['TPN8E74', '1AA6328465', '1L 8046122 (07/05/2026)'], ['TPN8E74', '1AA2906936', '1VA4558587 (29/07/2026)'], ['TWT4B11', 'N000090515', 'VSV1025799 (28/03/2026)'],
    ['TWT4B11', 'N000091099', 'ATV0751561 (28/03/2026)'], ['TWT4B11', '1AA0220416', '1VA3974586 (25/06/2026)'], ['TWT4B11', '1AA2204536', '1VA4351170 (17/07/2026)']]
    .map(([placa, ait, origem]) => [placa, ait, 'EDVALDO LAURINDO VIEIRA', `Penalidade por nao identificacao do condutor, originada do auto ${origem}, atribuido ao Edvaldo. Confianca ALTA.`]),
  ['TPN8E74', 'D009134588', 'EDVALDO LAURINDO VIEIRA', 'Penalidade por nao identificacao do condutor emitida em 05/05/2026 contra a TPN8E74 (auto de origem DETRAN-RS E032741607, de cerca de marco); o Edvaldo dirigia a TPN8E74 de 02/03 a 03/08/2026. Confianca ALTA.'],
  ['TPN8E74', 'N003139009', 'EDVALDO LAURINDO VIEIRA', 'Penalidade por nao identificacao do condutor emitida em 03/06/2026 contra a TPN8E74 (infracao de origem estimada em abril/maio); o Edvaldo dirigia a TPN8E74 de 02/03 a 03/08/2026. Confianca MEDIA.'],
  ['TPN8E74', '1AA2780885', 'EDVALDO LAURINDO VIEIRA', 'Penalidade por nao identificacao do condutor emitida em 23/04/2026 contra a TPN8E74 (origem: auto 1K 404316-9, data desconhecida, estimada em marco). Pode ser de antes da admissao do Edvaldo (02/03/2026). Confianca MEDIA.'],
  ['TPN8E74', 'NIC1175800', 'EDVALDO LAURINDO VIEIRA', 'Penalidade por nao identificacao do condutor (DER-PR, 01/09/2026); a infracao de origem estimada e o auto Z001168414 (DER-PR, 16/07/2026), atribuido ao Edvaldo. Confianca MEDIA.'],
  ...[['N003241114', '25/05/2026 (S049988049/S049988234)'], ['N003247188', '25/05/2026 (S049988049/S049988234)'], ['N003308990', '18/06/2026 (S050258952)'], ['N003338158', 'inicio de julho (TG00575836/37 ou S0505...)'],
    ['N003346437', 'inicio de julho (TG00575836/37 ou S0505...)'], ['N003371768', 'meados de julho (J009963878/893)'], ['N003386296', 'meados de julho (J009963878/893)'], ['N003401514', 'fim de julho (S050640501/S050695050/S050755764)']]
    .map(([ait, origem]) => ['TWT4B11', ait, 'EDVALDO LAURINDO VIEIRA', `Penalidade por nao identificacao do condutor (DNIT) contra a carreta TWT4B11; infracao de origem estimada pela data da penalidade: ${origem}, no periodo do Edvaldo. Confianca MEDIA.`]),
];

console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} (usuario #${usuario.id}, empresa #${EMPRESA_ID})\n`);

const motoristas = db.prepare('SELECT id, nome, cpf FROM motoristas WHERE empresa_id = ?').all(EMPRESA_ID);
let edvaldo = motoristas.find((m) => m.cpf === '04907160917' || norm(m.nome).startsWith('EDVALDO'));
const motoristaPorNome = (nome) => motoristas.find((m) => norm(m.nome) === norm(nome)) || (norm(nome).startsWith('EDVALDO') ? edvaldo : null);
console.log(`Motorista Edvaldo: ${edvaldo ? `ja cadastrado (#${edvaldo.id})` : 'NAO cadastrado - sera criado como INATIVO (dispensado em 03/08/2026)'}`);

const multas = db.prepare(`
  SELECT m.*, v.placa FROM multas m JOIN veiculos v ON v.id = m.veiculo_id
  WHERE m.empresa_id = ? AND m.motorista_id IS NULL ORDER BY v.placa, m.data_infracao
`).all(EMPRESA_ID);

const planoViagem = [];
const ambiguas = [];
for (const m of multas) {
  if (m.status === 'NaoIndicado' || !m.data_infracao) continue;
  const cand = db.prepare(`
    SELECT DISTINCT vg.id AS viagem_id, vg.motorista_id, mo.nome FROM viagens vg
    JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id JOIN motoristas mo ON mo.id = vg.motorista_id
    WHERE ci.veiculo_id = ? AND vg.data_inicio <= ? AND (vg.data_fim IS NULL OR vg.data_fim >= ?)
  `).all(m.veiculo_id, m.data_infracao, m.data_infracao);
  const motoristasDistintos = [...new Set(cand.map((c) => c.motorista_id))];
  if (motoristasDistintos.length === 1) planoViagem.push({ multa: m, motorista_id: motoristasDistintos[0], nome: cand[0].nome, viagem_id: cand[0].viagem_id });
  else if (motoristasDistintos.length > 1) ambiguas.push(`${m.placa} ${m.numero_ait} (${m.data_infracao}): ${cand.map((c) => c.nome).join(' / ')}`);
}
const jaPlanejadas = new Set(planoViagem.map((p) => p.multa.id));

const planoAntigo = [];
const naoAchadas = [];
for (const [placa, ait, nome, fonte] of DECISOES) {
  const m = multas.find((x) => x.placa === placa && norm(x.numero_ait) === norm(ait));
  if (!m) { naoAchadas.push(`${placa} ${ait} (nao esta sem motorista, ou nao existe)`); continue; }
  if (jaPlanejadas.has(m.id)) continue;
  planoAntigo.push({ multa: m, nome, fonte });
}

console.log(`\n1) Pelas viagens do Frottex: ${planoViagem.length} multa(s)`);
for (const p of planoViagem) console.log(`   #${p.multa.id} ${p.multa.placa} ${p.multa.numero_ait} ${p.multa.data_infracao} -> ${p.nome} (viagem #${p.viagem_id})`);
if (ambiguas.length) { console.log(`   Ambiguas (mais de um motorista na data - nao preenchidas): ${ambiguas.length}`); ambiguas.forEach((a) => console.log(`   ? ${a}`)); }
console.log(`\n2) Dados antigos (com marca e fonte): ${planoAntigo.length} multa(s)`);
for (const p of planoAntigo) console.log(`   #${p.multa.id} ${p.multa.placa} ${p.multa.numero_ait} ${p.multa.data_infracao} -> ${p.nome}`);
if (naoAchadas.length) { console.log('\n   Nao aplicadas:'); naoAchadas.forEach((n) => console.log(`   - ${n}`)); }
const restantes = multas.filter((m) => !jaPlanejadas.has(m.id) && !planoAntigo.some((p) => p.multa.id === m.id));
console.log(`\nSem motorista apos isto: ${restantes.length} (${restantes.filter((m) => m.status === 'NaoIndicado').length} sao multas por nao identificacao do condutor)`);
if (!aplicar) { console.log('\n(simulacao - nada foi gravado; use --aplicar)'); process.exit(0); }

withTransaction(db, () => {
  if (!edvaldo) {
    const info = db.prepare("INSERT INTO motoristas (empresa_id, nome, cpf, cnh, cnh_validade, ativo) VALUES (?, 'EDVALDO LAURINDO VIEIRA', '04907160917', 'NAO INFORMADA', '2000-01-01', 0)").run(EMPRESA_ID);
    edvaldo = { id: Number(info.lastInsertRowid), nome: 'EDVALDO LAURINDO VIEIRA', cpf: '04907160917' };
    motoristas.push(edvaldo);
    registrarAuditoria({ usuarioId: usuario.id, empresaId: EMPRESA_ID, tabela: 'motoristas', registroId: edvaldo.id, acao: 'INSERT', depois: edvaldo });
    console.log(`Motorista Edvaldo criado (#${edvaldo.id}, inativo).`);
  }
  for (const p of planoViagem) {
    const obs = `${p.multa.observacoes ? `${p.multa.observacoes} ` : ''}MOTORISTA IDENTIFICADO PELA VIAGEM #${p.viagem_id} DO FROTTEX.`;
    db.prepare(`UPDATE multas SET motorista_id = ?, status = 'CondutorIndicado', condutor_indicado_em = datetime('now', '-3 hours'),
      condutor_origem = NULL, condutor_fonte = NULL, observacoes = ?, atualizado_em = datetime('now', '-3 hours') WHERE id = ?`).run(p.motorista_id, obs, p.multa.id);
    registrarAuditoria({ usuarioId: usuario.id, empresaId: EMPRESA_ID, tabela: 'multas', registroId: p.multa.id, acao: 'UPDATE', antes: p.multa, depois: db.prepare('SELECT * FROM multas WHERE id = ?').get(p.multa.id) });
  }
  for (const p of planoAntigo) {
    const mot = motoristaPorNome(p.nome);
    if (!mot) throw new Error(`Motorista ${p.nome} nao encontrado.`);
    db.prepare(`UPDATE multas SET motorista_id = ?, condutor_origem = 'DadosAntigos', condutor_fonte = ?, atualizado_em = datetime('now', '-3 hours') WHERE id = ?`).run(mot.id, p.fonte, p.multa.id);
    registrarAuditoria({ usuarioId: usuario.id, empresaId: EMPRESA_ID, tabela: 'multas', registroId: p.multa.id, acao: 'UPDATE', antes: p.multa, depois: db.prepare('SELECT * FROM multas WHERE id = ?').get(p.multa.id) });
  }
});
console.log(`\nFEITO: ${planoViagem.length} pelas viagens do Frottex, ${planoAntigo.length} por dados antigos.`);
