const db = require('../config/db');
const { sincronizarEmpresa } = require('./onixsatSync');

// Roda a sincronizacao de posicao/hodometro pra toda empresa com credenciais
// Onixsat configuradas. Chamado pelo agendador (server.js) e reusa a mesma
// logica/limites da rota manual - usuarioId fica null (origem automatica).
async function sincronizarTodasAsEmpresas() {
  const empresas = db.prepare(`
    SELECT id, razao_social FROM empresas
    WHERE ativo = 1 AND onixsat_usuario IS NOT NULL AND onixsat_senha IS NOT NULL
  `).all();

  for (const empresa of empresas) {
    try {
      const resultado = await sincronizarEmpresa(empresa.id, null);
      if (resultado.aviso) {
        console.log(`Onixsat auto [${empresa.razao_social}]: ${resultado.aviso}`);
      } else {
        console.log(`Onixsat auto [${empresa.razao_social}]: ${resultado.mensagensProcessadas} mensagem(ns), ${resultado.hodometroAtualizados} hodometro(s), ${resultado.localizacaoAtualizados} localizacao(oes).`);
      }
    } catch (err) {
      console.error(`Onixsat auto [${empresa.razao_social}]: falhou -`, err.message);
    }
  }
}

// Inicia o agendamento periodico (setInterval simples - processo unico, sem
// necessidade de lock distribuido). Retorna o timer para permitir stop() em testes.
function iniciarAgendadorOnixsat(intervaloMinutos) {
  if (!intervaloMinutos || intervaloMinutos <= 0) return null;
  const intervaloMs = intervaloMinutos * 60 * 1000;
  console.log(`Onixsat: sincronizacao automatica ativa a cada ${intervaloMinutos} minuto(s).`);
  return setInterval(() => {
    sincronizarTodasAsEmpresas().catch((err) => console.error('Onixsat auto: erro inesperado -', err.message));
  }, intervaloMs);
}

module.exports = { sincronizarTodasAsEmpresas, iniciarAgendadorOnixsat };
