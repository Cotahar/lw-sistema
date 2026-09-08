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
