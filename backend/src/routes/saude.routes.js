const express = require('express');
const fs = require('node:fs');
const db = require('../config/db');
const { VERSAO_APP } = require('../utils/versaoApp');
const { configDoAmbiente, listarBackups, estado } = require('../utils/backupDiario');

// Rotas publicas (sem login) para monitoramento externo - UptimeRobot, o workflow agendado do GitHub
// (.github/workflows/monitor.yml) e o healthcheck de deploy do Railway. Nada sensivel: so "ok/nao ok".
const router = express.Router();

// O sistema esta no ar E o banco responde (antes so dizia ok: true, mesmo com o banco fora).
router.get('/', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, versao: VERSAO_APP, banco: 'ok' });
  } catch {
    res.status(503).json({ ok: false, versao: VERSAO_APP, banco: 'erro' });
  }
});

// O backup diario esta em dia? 503 quando o mais recente tem mais de 30h (perdeu um dia) ou quando a
// ultima copia externa falhou. Separado do "/" de proposito: backup atrasado nao pode derrubar deploy.
const HORAS_LIMITE = 30;
router.get('/backup', (req, res) => {
  const cfg = configDoAmbiente(db);
  if (!cfg.ativo) return res.json({ ok: true, backup: 'desativado' });
  const [maisRecente] = listarBackups(cfg.dir);
  const horas = maisRecente ? (Date.now() - fs.statSync(maisRecente.caminho).mtimeMs) / 3600000 : null;
  const envio = estado.ultimoEnvioExterno;
  const copiaExterna = !cfg.externo ? 'desligada' : !envio ? 'sem envio desde que o servidor iniciou' : envio.erro ? 'falhou' : 'ok';
  const problemas = [];
  if (horas === null) problemas.push('nenhum backup na pasta');
  else if (horas > HORAS_LIMITE) problemas.push(`ultimo backup ha ${Math.round(horas)}h`);
  if (copiaExterna === 'falhou') problemas.push('ultima copia externa falhou');
  res.status(problemas.length ? 503 : 200).json({
    ok: !problemas.length,
    ultimoBackup: maisRecente ? maisRecente.data : null,
    horasDesdeUltimo: horas === null ? null : Math.round(horas * 10) / 10,
    copiaExterna,
    problemas,
  });
});

module.exports = router;
