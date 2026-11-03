const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db } = require('./helpers');
const { criarBackup, aplicarRetencao, executarBackupDiario, listarBackups, nomeDoBackup } = require('../src/utils/backupDiario');

// Backup diario: uma copia por dia (VACUUM INTO), conferida, mantendo so as 2 mais recentes e sem tocar
// em nenhum outro arquivo da pasta (backups manuais).

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frottex-backup-'));
}

test('cria o backup do dia: arquivo legivel com os mesmos dados e sem .tmp sobrando', () => {
  const dir = pastaTemporaria();
  const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  const r = criarBackup({ db, dir, dataIso: '2026-11-03' });
  assert.equal(r.criado, true);
  assert.equal(path.basename(r.arquivo), nomeDoBackup('2026-11-03'));
  assert.deepEqual(fs.readdirSync(dir), ['frottex-auto-2026-11-03.db']);

  const copia = new DatabaseSync(r.arquivo, { readOnly: true });
  assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, total);
  copia.close();

  // segunda chamada no mesmo dia nao refaz nem sobrescreve
  const repetido = criarBackup({ db, dir, dataIso: '2026-11-03' });
  assert.equal(repetido.criado, false);
});

test('retencao: fica com os 2 mais recentes e nunca apaga arquivos que nao sao do backup automatico', () => {
  const dir = pastaTemporaria();
  for (const d of ['2026-10-30', '2026-10-31', '2026-11-01']) fs.writeFileSync(path.join(dir, nomeDoBackup(d)), 'x');
  fs.writeFileSync(path.join(dir, 'frotista-backup-manual-20260928.db'), 'manual');
  fs.writeFileSync(path.join(dir, 'frottex-auto-2026-11-02.db.tmp'), 'incompleto');

  const removidos = aplicarRetencao({ dir, manter: 2 });
  assert.deepEqual(removidos, ['frottex-auto-2026-10-30.db']);
  assert.deepEqual(listarBackups(dir).map((b) => b.data), ['2026-11-01', '2026-10-31']);
  assert.ok(fs.existsSync(path.join(dir, 'frotista-backup-manual-20260928.db')), 'backup manual intocado');
  assert.ok(!fs.existsSync(path.join(dir, 'frottex-auto-2026-11-02.db.tmp')), '.tmp esquecido e limpo');
});

test('execucao diaria: dia apos dia sempre sobram exatamente os 2 ultimos', () => {
  const dir = pastaTemporaria();
  for (const dia of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) executarBackupDiario({ db, dir, manter: 2, dataIso: dia });
  assert.deepEqual(listarBackups(dir).map((b) => b.data), ['2026-11-04', '2026-11-03']);
});
