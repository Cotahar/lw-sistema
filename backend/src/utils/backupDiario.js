const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agoraBrasilia, hojeIsoBrasilia } = require('./dataHora');

// Backup diario automatico do banco. Uma copia consistente por dia
// (VACUUM INTO, feita pela propria conexao do app - nao precisa parar nada) em
// <pasta do banco>/backups/frottex-auto-AAAA-MM-DD.db, conferida com
// PRAGMA quick_check antes de valer. Fica sempre com os `manter` backups mais
// recentes (padrao 2 = hoje e ontem); so apaga arquivos com ESTE padrao de nome -
// backups manuais da pasta nunca sao tocados.
const PADRAO = /^frottex-auto-(\d{4}-\d{2}-\d{2})\.db$/;

function nomeDoBackup(dataIso) {
  return `frottex-auto-${dataIso}.db`;
}

function listarBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((arquivo) => ({ arquivo, m: arquivo.match(PADRAO) }))
    .filter((x) => x.m)
    .map((x) => ({ arquivo: x.arquivo, data: x.m[1], caminho: path.join(dir, x.arquivo) }))
    .sort((a, b) => (a.data < b.data ? 1 : -1));
}

// Gera o backup do dia (se ainda nao existir). Escreve num .tmp, confere e so entao renomeia -
// um backup incompleto nunca aparece com o nome final.
function criarBackup({ db, dir, dataIso = hojeIsoBrasilia() }) {
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, nomeDoBackup(dataIso));
  if (fs.existsSync(destino)) return { criado: false, arquivo: destino };

  const tmp = `${destino}.tmp`;
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);

  const copia = new DatabaseSync(tmp, { readOnly: true });
  let resultado;
  try {
    resultado = copia.prepare('PRAGMA quick_check').get();
  } finally {
    copia.close();
  }
  if (!resultado || resultado.quick_check !== 'ok') {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Backup invalido (quick_check = ${resultado ? resultado.quick_check : 'sem resposta'}).`);
  }
  fs.renameSync(tmp, destino);
  return { criado: true, arquivo: destino, bytes: fs.statSync(destino).size };
}

// Mantem os `manter` backups automaticos mais recentes e apaga o resto (e .tmp esquecidos).
function aplicarRetencao({ dir, manter = 2 }) {
  const removidos = [];
  for (const b of listarBackups(dir).slice(manter)) {
    fs.rmSync(b.caminho, { force: true });
    removidos.push(b.arquivo);
  }
  if (fs.existsSync(dir)) {
    for (const arquivo of fs.readdirSync(dir)) {
      if (/^frottex-auto-.*\.db\.tmp$/.test(arquivo)) fs.rmSync(path.join(dir, arquivo), { force: true });
    }
  }
  return removidos;
}

function executarBackupDiario({ db, dir, manter = 2, dataIso }) {
  const backup = criarBackup({ db, dir, dataIso });
  const removidos = aplicarRetencao({ dir, manter });
  return { ...backup, removidos, mantidos: listarBackups(dir).map((b) => b.arquivo) };
}

// Agendador: confere a cada `intervaloMin` minutos se o backup de hoje ja existe e, passada a `hora` (Brasilia),
// gera. Ao subir o servidor, se hoje ainda nao tem backup gera logo (sem esperar a madrugada).
function iniciarBackupDiario({ db, dir, hora = 3, manter = 2, intervaloMin = 10, log = console }) {
  const rodar = (motivo) => {
    try {
      const r = executarBackupDiario({ db, dir, manter });
      if (r.criado) log.log(`Backup diario (${motivo}): ${path.basename(r.arquivo)} (${Math.round(r.bytes / 1024)} KB); mantidos: ${r.mantidos.join(', ')}${r.removidos.length ? `; removidos: ${r.removidos.join(', ')}` : ''}.`);
    } catch (err) {
      log.error('Backup diario FALHOU:', err.message);
    }
  };
  const jaTemHoje = () => fs.existsSync(path.join(dir, nomeDoBackup(hojeIsoBrasilia())));

  log.log(`Backup diario ativo: pasta ${dir}, apos as ${String(hora).padStart(2, '0')}h (Brasilia), mantendo os ${manter} mais recentes.`);
  setTimeout(() => { if (!jaTemHoje()) rodar('ao iniciar'); }, 30 * 1000).unref();
  return setInterval(() => {
    if (agoraBrasilia().getUTCHours() >= hora && !jaTemHoje()) rodar('agendado');
  }, intervaloMin * 60 * 1000).unref();
}

module.exports = { criarBackup, aplicarRetencao, executarBackupDiario, iniciarBackupDiario, listarBackups, nomeDoBackup };
