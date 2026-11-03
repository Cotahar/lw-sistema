const app = require('./app');

// Sem segredo o login quebraria so na primeira tentativa (500); melhor nem subir.
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET nao configurado - defina no .env (local) ou nas variaveis do Railway.');
  process.exit(1);
}

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

// Backup diario do banco + copia externa (ver utils/backupDiario.js e utils/backupExterno.js).
// BACKUP_DIARIO=0 desativa; BACKUP_DIR muda a pasta (padrao: <pasta do banco>/backups);
// BACKUP_HORA (padrao 3, horario de Brasilia), BACKUP_MANTER (padrao 7 diarios) e
// BACKUP_MANTER_MENSAL (padrao 3 mensais) ajustam o resto; BACKUP_S3_* liga a copia externa.
{
  const db = require('./config/db');
  const { iniciarBackupDiario, configDoAmbiente } = require('./utils/backupDiario');
  const cfg = configDoAmbiente(db);
  if (cfg.ativo) iniciarBackupDiario({ db, cfg });
}
