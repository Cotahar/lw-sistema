const db = require('../config/db');
const { sincronizarEmpresa } = require('./onixsatSync');

// Padrao quando a empresa nao configurou o proprio intervalo
// (empresas.onixsat_poll_minutos) - ver cadastro de Empresas.
const INTERVALO_PADRAO_MINUTOS = 3;

// Ultima sincronizacao automatica de cada empresa (em memoria - nao precisa
// sobreviver a um restart do processo; pior caso, sincroniza todo mundo de
// novo assim que o servidor sobe, o que e inofensivo). Chave: empresa_id.
const ultimaSincronizacaoPorEmpresa = new Map();

// Roda a sincronizacao de posicao/hodometro so pras empresas cujo proprio
// intervalo (onixsat_poll_minutos, configuravel no cadastro de Empresas) ja
// tenha vencido - cada empresa pode ter um intervalo diferente. Chamado pelo
// agendador (server.js) e reusa a mesma logica/limites da rota manual -
// usuarioId fica null (origem automatica).
async function sincronizarEmpresasDevidas() {
  const empresas = db.prepare(`
    SELECT id, razao_social, onixsat_poll_minutos FROM empresas
    WHERE ativo = 1 AND onixsat_usuario IS NOT NULL AND onixsat_senha IS NOT NULL
  `).all();

  const agora = Date.now();
  for (const empresa of empresas) {
    const intervaloMinutos = empresa.onixsat_poll_minutos || INTERVALO_PADRAO_MINUTOS;
    const ultimaVez = ultimaSincronizacaoPorEmpresa.get(empresa.id);
    if (ultimaVez && (agora - ultimaVez) < intervaloMinutos * 60 * 1000) continue;

    ultimaSincronizacaoPorEmpresa.set(empresa.id, agora);
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

// Inicia o agendamento periodico. O "tick" roda numa granularidade fixa
// (default 1 minuto) e a cada tick decide, empresa por empresa, se ja
// passou o intervalo proprio dela - setInterval simples, processo unico,
// sem necessidade de lock distribuido. tickMinutos=0 desativa o agendador
// inteiro (ver ONIXSAT_POLL_MINUTOS em server.js).
function iniciarAgendadorOnixsat(tickMinutos = 1) {
  if (!tickMinutos || tickMinutos <= 0) return null;
  const intervaloMs = tickMinutos * 60 * 1000;
  console.log(`Onixsat: agendador ativo (verifica a cada ${tickMinutos} minuto(s); cada empresa usa seu proprio intervalo, padrao ${INTERVALO_PADRAO_MINUTOS} min).`);
  return setInterval(() => {
    sincronizarEmpresasDevidas().catch((err) => console.error('Onixsat auto: erro inesperado -', err.message));
  }, intervaloMs);
}

module.exports = { sincronizarEmpresasDevidas, iniciarAgendadorOnixsat };
