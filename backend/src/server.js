const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API do Sistema Frottex rodando em http://localhost:${PORT}`);
});

// Sincronizacao automatica de posicao/hodometro via Onixsat. Cada empresa
// pode ter seu proprio intervalo (empresas.onixsat_poll_minutos, cadastro de
// Empresas - padrao 3min se nao configurado); ONIXSAT_POLL_MINUTOS aqui e so
// a granularidade do "tick" que verifica quem ja esta devendo sincronizar
// (default 1min, bem mais fino que qualquer intervalo razoavel por empresa)
// - ONIXSAT_POLL_MINUTOS=0 desativa o agendador inteiro.
const { iniciarAgendadorOnixsat } = require('./utils/onixsatScheduler');
iniciarAgendadorOnixsat(process.env.ONIXSAT_POLL_MINUTOS !== undefined ? Number(process.env.ONIXSAT_POLL_MINUTOS) : 1);

// Backup diario do banco (uma copia por dia, mantendo as 2 mais recentes - ver utils/backupDiario.js).
// BACKUP_DIARIO=0 desativa; BACKUP_DIR muda a pasta (padrao: <pasta do banco>/backups);
// BACKUP_HORA (padrao 3, horario de Brasilia) e BACKUP_MANTER (padrao 2) ajustam o resto.
if (process.env.BACKUP_DIARIO !== '0') {
  const db = require('./config/db');
  const path = require('node:path');
  const { iniciarBackupDiario } = require('./utils/backupDiario');
  const arquivoDoBanco = db.prepare('PRAGMA database_list').get().file;
  iniciarBackupDiario({
    db,
    dir: process.env.BACKUP_DIR || path.join(path.dirname(arquivoDoBanco), 'backups'),
    hora: process.env.BACKUP_HORA !== undefined ? Number(process.env.BACKUP_HORA) : 3,
    manter: process.env.BACKUP_MANTER !== undefined ? Number(process.env.BACKUP_MANTER) : 2,
  });
}
