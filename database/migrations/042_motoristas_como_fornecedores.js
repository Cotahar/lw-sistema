// Motorista tambem e fornecedor: precisa receber por contas a pagar (rescisao, acerto, ressarcimento...), e o contas a pagar
// so aceita fornecedor. Cada motorista passa a ter um fornecedor "espelho" (fornecedores.motorista_id) do tipo MOTORISTA, mantido
// por gatilhos do proprio banco - vale para qualquer caminho que crie/renomeie/inative/exclua motorista (tela, app, scripts).
//   - motorista novo        -> cria o fornecedor espelho;
//   - mudou nome ou ativo   -> acompanha (e recria o espelho se ele foi apagado);
//   - motorista excluido    -> o fornecedor fica (historico de contas a pagar), so perde a ligacao.
// Motorista inativo (desligado) tambem tem espelho: e justamente quem recebe a rescisao.
// Nos motoristas que ja existem, se ja houver um fornecedor com o MESMO NOME (ex.: cadastrado como ajudante/chapa), a ligacao
// e feita nele em vez de criar outro, para nao duplicar nem perder o historico dele.

const GARANTIR_TIPO = `INSERT INTO fornecedor_tipos (nome)
  SELECT 'MOTORISTA' WHERE NOT EXISTS (SELECT 1 FROM fornecedor_tipos WHERE upper(trim(nome)) = 'MOTORISTA');`;

const CRIAR_ESPELHO = `INSERT INTO fornecedores (empresa_id, nome, tipo_id, ativo, motorista_id)
  SELECT NEW.empresa_id, NEW.nome, (SELECT id FROM fornecedor_tipos WHERE upper(trim(nome)) = 'MOTORISTA' ORDER BY id LIMIT 1), NEW.ativo, NEW.id
  WHERE NOT EXISTS (SELECT 1 FROM fornecedores WHERE motorista_id = NEW.id);`;

const TRIGGERS = [
  `CREATE TRIGGER trg_motoristas_fornecedor_ins AFTER INSERT ON motoristas
BEGIN
  ${GARANTIR_TIPO}
  ${CRIAR_ESPELHO}
END`,
  `CREATE TRIGGER trg_motoristas_fornecedor_upd AFTER UPDATE OF nome, ativo ON motoristas
BEGIN
  UPDATE fornecedores SET nome = NEW.nome, ativo = NEW.ativo, atualizado_em = datetime('now', '-3 hours') WHERE motorista_id = NEW.id;
  ${GARANTIR_TIPO}
  ${CRIAR_ESPELHO}
END`,
  `CREATE TRIGGER trg_motoristas_fornecedor_del AFTER DELETE ON motoristas
BEGIN
  UPDATE fornecedores SET motorista_id = NULL WHERE motorista_id = OLD.id;
END`,
];

module.exports.up = function up(db) {
  const colunas = db.prepare('PRAGMA table_info(fornecedores)').all().map((c) => c.name);
  if (!colunas.includes('motorista_id')) db.exec('ALTER TABLE fornecedores ADD COLUMN motorista_id INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fornecedores_motorista ON fornecedores(motorista_id) WHERE motorista_id IS NOT NULL');

  db.exec(GARANTIR_TIPO);
  const tipoId = db.prepare("SELECT id FROM fornecedor_tipos WHERE upper(trim(nome)) = 'MOTORISTA' ORDER BY id LIMIT 1").get().id;

  // Motoristas que ja existem: liga ao fornecedor de mesmo nome (se houver) ou cria o espelho.
  const jaLigado = db.prepare('SELECT 1 FROM fornecedores WHERE motorista_id = ?');
  const mesmoNome = db.prepare('SELECT id FROM fornecedores WHERE empresa_id = ? AND motorista_id IS NULL AND upper(trim(nome)) = upper(trim(?)) ORDER BY id LIMIT 1');
  const ligar = db.prepare('UPDATE fornecedores SET motorista_id = ? WHERE id = ?');
  const criar = db.prepare('INSERT INTO fornecedores (empresa_id, nome, tipo_id, ativo, motorista_id) VALUES (?, ?, ?, ?, ?)');
  for (const m of db.prepare('SELECT id, empresa_id, nome, ativo FROM motoristas ORDER BY id').all()) {
    if (jaLigado.get(m.id)) continue;
    const existente = mesmoNome.get(m.empresa_id, m.nome);
    if (existente) ligar.run(m.id, existente.id);
    else criar.run(m.empresa_id, m.nome, tipoId, m.ativo, m.id);
  }

  for (const nome of ['trg_motoristas_fornecedor_ins', 'trg_motoristas_fornecedor_upd', 'trg_motoristas_fornecedor_del']) {
    db.exec(`DROP TRIGGER IF EXISTS ${nome}`);
  }
  for (const sql of TRIGGERS) db.exec(sql);
};

module.exports.TRIGGERS = TRIGGERS;
