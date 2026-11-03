const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agoraBrasilia, hojeIsoBrasilia, agoraDataHoraIsoBrasilia } = require('./dataHora');
const backupExterno = require('./backupExterno');

// Backup diario automatico do banco. Uma copia consistente por dia
// (VACUUM INTO, feita pela propria conexao do app - nao precisa parar nada) em
// <pasta do banco>/backups/frottex-auto-AAAA-MM-DD.db, conferida com
// PRAGMA quick_check antes de valer. Retencao: os `manter` backups mais
// recentes + o primeiro backup de cada um dos `manterMensal` meses mais
// recentes; so apaga arquivos com ESTE padrao de nome - backups manuais da
// pasta nunca sao tocados.
//
// A pasta local mora no MESMO volume do banco: protege contra erro de operacao
// (apagou/corrompeu dados), nao contra perder o volume. Para isso existe a copia
// externa (backupExterno.js), enviada logo depois de cada backup quando
// BACKUP_S3_* estiver configurado.
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

// Espaco livre no disco da pasta (bytes), ou null se o sistema nao informar.
function espacoLivre(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// Gera o backup do dia (se ainda nao existir). Escreve num .tmp, confere e so entao renomeia -
// um backup incompleto nunca aparece com o nome final. Se o disco nao tiver folga (2x o banco),
// nao tenta: encher o volume derrubaria as gravacoes do proprio sistema.
function criarBackup({ db, dir, dataIso = hojeIsoBrasilia() }) {
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, nomeDoBackup(dataIso));
  if (fs.existsSync(destino)) return { criado: false, arquivo: destino };

  const arquivoDoBanco = db.prepare('PRAGMA database_list').get().file;
  const tamanhoBanco = arquivoDoBanco && fs.existsSync(arquivoDoBanco) ? fs.statSync(arquivoDoBanco).size : 0;
  const livre = espacoLivre(dir);
  if (livre !== null && livre < tamanhoBanco * 2) {
    throw new Error(`Espaco em disco insuficiente para o backup (livre ${Math.round(livre / 1048576)} MB, banco ${Math.round(tamanhoBanco / 1048576)} MB).`);
  }

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

// Datas (AAAA-MM-DD) que a retencao preserva: as `manter` mais recentes + a primeira de cada um dos
// `manterMensal` meses mais recentes. `datas` em qualquer ordem.
function datasPreservadas(datas, { manter = 2, manterMensal = 0 } = {}) {
  const ordenadas = [...datas].sort().reverse();
  const preservar = new Set(ordenadas.slice(0, manter));
  const primeiraDoMes = new Map();
  for (const d of [...ordenadas].reverse()) if (!primeiraDoMes.has(d.slice(0, 7))) primeiraDoMes.set(d.slice(0, 7), d);
  const meses = [...primeiraDoMes.keys()].sort().reverse().slice(0, manterMensal);
  for (const mes of meses) preservar.add(primeiraDoMes.get(mes));
  return preservar;
}

// Aplica a retencao e apaga o resto (e .tmp esquecidos).
function aplicarRetencao({ dir, manter = 2, manterMensal = 0 }) {
  const backups = listarBackups(dir);
  const preservar = datasPreservadas(backups.map((b) => b.data), { manter, manterMensal });
  const removidos = [];
  for (const b of backups) {
    if (preservar.has(b.data)) continue;
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

function executarBackupDiario({ db, dir, manter = 2, manterMensal = 0, dataIso }) {
  const backup = criarBackup({ db, dir, dataIso });
  const removidos = aplicarRetencao({ dir, manter, manterMensal });
  return { ...backup, removidos, mantidos: listarBackups(dir).map((b) => b.arquivo) };
}

// Configuracao unica, lida do ambiente - usada pelo agendador (server.js) e pela tela de Backups.
function configDoAmbiente(db, env = process.env) {
  const arquivoDoBanco = db.prepare('PRAGMA database_list').get().file;
  return {
    ativo: env.BACKUP_DIARIO !== '0',
    dir: env.BACKUP_DIR || path.join(path.dirname(arquivoDoBanco), 'backups'),
    hora: env.BACKUP_HORA !== undefined ? Number(env.BACKUP_HORA) : 3,
    manter: env.BACKUP_MANTER !== undefined ? Number(env.BACKUP_MANTER) : 7,
    manterMensal: env.BACKUP_MANTER_MENSAL !== undefined ? Number(env.BACKUP_MANTER_MENSAL) : 3,
    pastaUploads: env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'),
    externo: backupExterno.configDoAmbiente(env),
  };
}

// Ultimo resultado de cada etapa, para a tela de Backups (memoria do processo: zera num restart, e o
// proximo ciclo refaz a copia externa do dia - um PUT repetido e inofensivo).
const estado = {
  ultimoBackupLocal: null, // { em, arquivo, bytes } | { em, erro }
  ultimoEnvioExterno: null, // { em, dataIso, enviados, bytesBanco, uploads } | { em, erro }
  dataEnviadaExterno: null,
};

// Envia o backup do dia (e os anexos novos) para fora. `primeiroDoMes` = este e o backup mais antigo
// do mes ainda na pasta (o "mensal" que a retencao local tambem guarda).
async function enviarCopiaExterna({ cfg, dataIso = hojeIsoBrasilia(), fetchImpl } = {}) {
  if (!cfg.externo) return null;
  const backups = listarBackups(cfg.dir);
  const doDia = backups.find((b) => b.data === dataIso);
  if (!doDia) throw new Error(`Nao ha backup local de ${dataIso} para enviar.`);
  const primeiroDoMes = !backups.some((b) => b.data.slice(0, 7) === dataIso.slice(0, 7) && b.data < dataIso);
  const banco = await backupExterno.enviarBanco(cfg.externo, { arquivo: doDia.caminho, dataIso, primeiroDoMes, fetchImpl });
  const uploads = await backupExterno.enviarUploadsNovos(cfg.externo, {
    pastaUploads: cfg.pastaUploads, manifesto: path.join(cfg.dir, '.uploads-enviados.json'), fetchImpl,
  });
  return { dataIso, enviados: banco.enviados, bytesBanco: banco.bytes, uploads };
}

// Um ciclo completo: backup local do dia (se faltar) + retencao + copia externa (se ainda nao foi hoje).
async function rodarCiclo({ db, cfg, motivo = 'agendado', log = console, fetchImpl, forcarEnvio = false }) {
  const hoje = hojeIsoBrasilia();
  try {
    const r = executarBackupDiario({ db, dir: cfg.dir, manter: cfg.manter, manterMensal: cfg.manterMensal, dataIso: hoje });
    if (r.criado) {
      estado.ultimoBackupLocal = { em: agoraDataHoraIsoBrasilia(), arquivo: path.basename(r.arquivo), bytes: r.bytes };
      log.log(`Backup diario (${motivo}): ${path.basename(r.arquivo)} (${Math.round(r.bytes / 1024)} KB); mantidos: ${r.mantidos.join(', ')}${r.removidos.length ? `; removidos: ${r.removidos.join(', ')}` : ''}.`);
    }
  } catch (err) {
    estado.ultimoBackupLocal = { em: agoraDataHoraIsoBrasilia(), erro: err.message };
    log.error('Backup diario FALHOU:', err.message);
    return;
  }
  if (!cfg.externo || (estado.dataEnviadaExterno === hoje && !forcarEnvio)) return;
  try {
    const envio = await enviarCopiaExterna({ cfg, dataIso: hoje, fetchImpl });
    estado.dataEnviadaExterno = hoje;
    estado.ultimoEnvioExterno = { em: agoraDataHoraIsoBrasilia(), ...envio };
    log.log(`Copia externa do backup (${motivo}): ${envio.enviados.join(', ')} (${Math.round(envio.bytesBanco / 1024)} KB) + ${envio.uploads.quantidade} anexo(s) novo(s).`);
  } catch (err) {
    estado.ultimoEnvioExterno = { em: agoraDataHoraIsoBrasilia(), erro: err.message };
    log.error('Copia externa do backup FALHOU (tenta de novo no proximo ciclo):', err.message);
  }
}

// Agendador: confere a cada `intervaloMin` minutos se o backup de hoje ja existe e, passada a `hora` (Brasilia),
// gera. Ao subir o servidor, se hoje ainda nao tem backup gera logo (sem esperar a madrugada). Uma copia externa
// que falhou e tentada de novo a cada ciclo ate dar certo.
function iniciarBackupDiario({ db, cfg, intervaloMin = 10, log = console }) {
  let rodando = false;
  const rodar = (motivo) => {
    if (rodando) return;
    rodando = true;
    rodarCiclo({ db, cfg, motivo, log }).finally(() => { rodando = false; });
  };
  const jaTemHoje = () => fs.existsSync(path.join(cfg.dir, nomeDoBackup(hojeIsoBrasilia())));
  const faltaEnvio = () => cfg.externo && jaTemHoje() && estado.dataEnviadaExterno !== hojeIsoBrasilia();

  log.log(`Backup diario ativo: pasta ${cfg.dir}, apos as ${String(cfg.hora).padStart(2, '0')}h (Brasilia), mantendo ${cfg.manter} diario(s) + ${cfg.manterMensal} mensal(is); copia externa ${cfg.externo ? `LIGADA (${cfg.externo.bucket})` : 'DESLIGADA (configure BACKUP_S3_*)'}.`);
  setTimeout(() => { if (!jaTemHoje() || faltaEnvio()) rodar('ao iniciar'); }, 30 * 1000).unref();
  return setInterval(() => {
    if ((agoraBrasilia().getUTCHours() >= cfg.hora && !jaTemHoje()) || faltaEnvio()) rodar('agendado');
  }, intervaloMin * 60 * 1000).unref();
}

module.exports = {
  criarBackup, aplicarRetencao, datasPreservadas, executarBackupDiario, iniciarBackupDiario, listarBackups, nomeDoBackup,
  configDoAmbiente, rodarCiclo, enviarCopiaExterna, estado, PADRAO,
};
