const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAdmin } = require('../middleware/auth');
const { configDoAmbiente, listarBackups, rodarCiclo, estado, PADRAO } = require('../utils/backupDiario');

// Tela de Backups (Admin): ver os backups do volume, a situacao da copia externa, forcar um ciclo
// e BAIXAR um backup para o computador (a copia "fora do Railway" que nao depende de configurar nada).
const router = express.Router();
router.use(requerAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const cfg = configDoAmbiente(db);
  res.json({
    ativo: cfg.ativo,
    hora: cfg.hora,
    manter: cfg.manter,
    manterMensal: cfg.manterMensal,
    externo: cfg.externo ? { configurado: true, bucket: cfg.externo.bucket, endpoint: cfg.externo.endpoint, prefixo: cfg.externo.prefixo } : { configurado: false },
    backups: listarBackups(cfg.dir).map((b) => ({ arquivo: b.arquivo, data: b.data, bytes: fs.statSync(b.caminho).size })),
    ultimoBackupLocal: estado.ultimoBackupLocal,
    ultimoEnvioExterno: estado.ultimoEnvioExterno,
  });
}));

// Roda um ciclo agora (gera o de hoje se faltar e reenvia a copia externa). Espera terminar para a tela
// mostrar o resultado.
router.post('/executar', asyncHandler(async (req, res) => {
  const cfg = configDoAmbiente(db);
  await rodarCiclo({ db, cfg, motivo: `manual por ${req.usuario.nome}`, forcarEnvio: true });
  res.json({ ultimoBackupLocal: estado.ultimoBackupLocal, ultimoEnvioExterno: estado.ultimoEnvioExterno });
}));

router.get('/:arquivo/download', asyncHandler(async (req, res) => {
  const { arquivo } = req.params;
  // So nomes do backup automatico: nada de caminho, nada de outro arquivo do volume.
  if (!PADRAO.test(arquivo)) throw new ApiError(400, 'Arquivo de backup invalido.');
  const caminho = path.join(configDoAmbiente(db).dir, arquivo);
  if (!fs.existsSync(caminho)) throw new ApiError(404, 'Backup nao encontrado.');
  res.download(caminho, arquivo);
}));

module.exports = router;
