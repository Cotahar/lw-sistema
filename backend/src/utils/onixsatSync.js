const db = require('../config/db');
const ApiError = require('./ApiError');
const { registrarAuditoria } = require('./audit');
const { withTransaction } = require('./transaction');
const { verificarAlertasDoVeiculo } = require('./alertaEngine');
const { requestVeiculo, requestMensagemCB } = require('./onixsatClient');

function normalizarPlaca(txt) {
  return String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// "2009-07-22T11:25:04-03:00" -> "2009-07-22 11:25:04" (convencao do resto do app).
function converterDataHoraOnixsat(dt) {
  const m = String(dt || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : null;
}

// Campos lat/lon do Onixsat vem com virgula decimal ("-23,5425").
function paraNumeroDecimal(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = parseFloat(String(valor).replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}

// RequestVeiculo (mapeamento veiID<->placa) tem limite de 1 chamada a cada 5
// minutos, mas raramente muda (so quando um equipamento e instalado/trocado).
// Cacheamos por empresa em memoria por 30 min pra poder chamar
// RequestMensagemCB (limite de so 30 segundos) com mais frequencia sem
// esbarrar no limite do RequestVeiculo.
const CACHE_MAPEAMENTO_MS = 30 * 60 * 1000;
const cacheMapeamento = new Map(); // empresaId -> { mapa, veiculosOnixsat, atualizadoEm }

async function obterMapeamentoVeiculos(empresa) {
  const cache = cacheMapeamento.get(empresa.id);
  if (cache && Date.now() - cache.atualizadoEm < CACHE_MAPEAMENTO_MS) return cache;

  let veiculosOnixsat;
  try {
    veiculosOnixsat = await requestVeiculo(empresa.onixsat_usuario, empresa.onixsat_senha);
  } catch (err) {
    // Se a chamada falhar (ex.: 5 min ainda nao passaram desde a ultima vez,
    // ou instabilidade da Onixsat) mas ja houver um mapeamento em cache
    // (mesmo vencido), reaproveita ele em vez de travar a sincronizacao de
    // posicao - o mapeamento raramente muda de um ciclo pro outro.
    if (cache) return cache;
    if (err.codigoOnixsat === 7) throw new ApiError(429, 'Aguarde alguns minutos antes de sincronizar de novo (limite da Onixsat: 1 consulta de veiculos a cada 5 minutos).');
    throw new ApiError(502, err.message);
  }

  const nossosVeiculos = db.prepare('SELECT id, placa FROM veiculos WHERE empresa_id = ?').all(empresa.id);
  const mapaPorPlaca = new Map(nossosVeiculos.map((v) => [normalizarPlaca(v.placa), v.id]));
  const mapa = new Map();
  for (const v of veiculosOnixsat) {
    const veiculoId = mapaPorPlaca.get(normalizarPlaca(v.placa));
    if (veiculoId) mapa.set(String(v.veiID), veiculoId);
  }
  const resultado = { mapa, veiculosOnixsat: veiculosOnixsat.length, atualizadoEm: Date.now() };
  cacheMapeamento.set(empresa.id, resultado);
  return resultado;
}

// Puxa posicao/hodometro reais da Onixsat (RequestVeiculo + RequestMensagemCB,
// ver onixsatClient.js) e grava em hodometro_eventos/localizacao_eventos com
// origem='Onixsat'. Cursor de paginacao (mId) e global da conta, persistido em
// empresas.onixsat_ultimo_mid. usuarioId fica null quando chamado pelo
// agendador automatico (ver onixsatScheduler.js) - so a rota HTTP passa um usuario real.
async function sincronizarEmpresa(empresaId, usuarioId = null) {
  const empresa = db.prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
  if (!empresa.onixsat_usuario || !empresa.onixsat_senha) {
    throw new ApiError(400, 'Configure o usuario e senha do Onixsat no cadastro desta empresa antes de sincronizar.');
  }

  const { mapa: mapaVeiIdParaVeiculoId, veiculosOnixsat } = await obterMapeamentoVeiculos(empresa);

  if (!veiculosOnixsat) {
    return {
      veiculosOnixsat: 0, veiculosMapeados: 0, mensagensProcessadas: 0,
      hodometroAtualizados: 0, localizacaoAtualizados: 0, nivelTanqueAtualizados: 0, mensagensIgnoradas: 0,
      aviso: 'Nenhum equipamento Onixsat vinculado a esta conta ainda.',
    };
  }

  if (!mapaVeiIdParaVeiculoId.size) {
    return {
      veiculosOnixsat, veiculosMapeados: 0, mensagensProcessadas: 0,
      hodometroAtualizados: 0, localizacaoAtualizados: 0, nivelTanqueAtualizados: 0, mensagensIgnoradas: 0,
      aviso: 'Nenhuma placa dos equipamentos Onixsat bate com veiculos cadastrados nesta empresa.',
    };
  }

  const mIdInicial = empresa.onixsat_ultimo_mid || 1;
  let mensagens;
  try {
    mensagens = await requestMensagemCB(empresa.onixsat_usuario, empresa.onixsat_senha, mIdInicial);
  } catch (err) {
    if (err.codigoOnixsat === 7) throw new ApiError(429, 'Aguarde alguns segundos antes de sincronizar de novo (limite da Onixsat: 1 consulta de mensagens a cada 30 segundos).');
    throw new ApiError(502, err.message);
  }

  let hodometroAtualizados = 0;
  let localizacaoAtualizados = 0;
  let nivelTanqueAtualizados = 0;
  let mensagensIgnoradas = 0;
  let maiorMid = mIdInicial;
  const veiculosComHodometroAtualizado = new Set();

  withTransaction(db, () => {
    for (const msg of mensagens) {
      const msgId = Number(msg.mId);
      if (Number.isFinite(msgId) && msgId > maiorMid) maiorMid = msgId;

      const veiculoId = mapaVeiIdParaVeiculoId.get(String(msg.veiID));
      const dataHora = converterDataHoraOnixsat(msg.dt);
      if (!veiculoId || !dataHora) { mensagensIgnoradas++; continue; }

      // "lt" = litros no tanque nesse instante (RequestMensagemCB ja manda
      // esse campo junto do odometro/posicao, so nao era lido ate agora).
      // Usado pro calculo de media "ao vivo" do painel do motorista - ver
      // motorista.routes.js.
      const nivelTanque = paraNumeroDecimal(msg.lt);

      const odometro = msg.odm ? parseInt(msg.odm, 10) : null;
      if (odometro && Number.isFinite(odometro)) {
        const veiculo = db.prepare('SELECT hodometro_atual FROM veiculos WHERE id = ?').get(veiculoId);
        if (odometro > veiculo.hodometro_atual) {
          db.prepare(`
            INSERT INTO hodometro_eventos (empresa_id, veiculo_id, km, origem, data_hora, nivel_tanque_litros)
            VALUES (?, ?, ?, 'Onixsat', ?, ?)
          `).run(empresaId, veiculoId, odometro, dataHora, nivelTanque);
          db.prepare('UPDATE veiculos SET hodometro_atual = ? WHERE id = ?').run(odometro, veiculoId);
          hodometroAtualizados++;
          veiculosComHodometroAtualizado.add(veiculoId);
        }
      }

      // Cache do nivel de tanque mais recente atualiza independente do
      // hodometro ter avancado (mesmo padrao da localizacao logo abaixo) -
      // um abastecimento parado, por exemplo, nao move o odometro.
      if (nivelTanque !== null) {
        db.prepare('UPDATE veiculos SET nivel_tanque_litros = ? WHERE id = ?').run(nivelTanque, veiculoId);
        nivelTanqueAtualizados++;
      }

      const latitude = paraNumeroDecimal(msg.lat);
      const longitude = paraNumeroDecimal(msg.lon);
      if (latitude !== null && longitude !== null && msg.mun && msg.uf) {
        db.prepare(`
          INSERT INTO localizacao_eventos (empresa_id, veiculo_id, cidade, uf, latitude, longitude, origem, data_hora)
          VALUES (?, ?, ?, ?, ?, ?, 'Onixsat', ?)
        `).run(empresaId, veiculoId, msg.mun, String(msg.uf).toUpperCase(), latitude, longitude, dataHora);
        db.prepare(`
          UPDATE veiculos SET localizacao_cidade = ?, localizacao_uf = ?, localizacao_atualizado_em = datetime('now', '-3 hours') WHERE id = ?
        `).run(msg.mun, String(msg.uf).toUpperCase(), veiculoId);
        localizacaoAtualizados++;
      }
    }

    db.prepare('UPDATE empresas SET onixsat_ultimo_mid = ? WHERE id = ?').run(maiorMid, empresaId);
  });

  registrarAuditoria({
    usuarioId, empresaId, tabela: 'empresas', registroId: empresaId, acao: 'UPDATE',
    antes: { onixsat_ultimo_mid: mIdInicial }, depois: { onixsat_ultimo_mid: maiorMid },
  });

  const alertasDisparados = [];
  for (const veiculoId of veiculosComHodometroAtualizado) {
    alertasDisparados.push(...verificarAlertasDoVeiculo(veiculoId));
  }

  return {
    veiculosOnixsat,
    veiculosMapeados: mapaVeiIdParaVeiculoId.size,
    mensagensProcessadas: mensagens.length,
    hodometroAtualizados,
    localizacaoAtualizados,
    nivelTanqueAtualizados,
    mensagensIgnoradas,
    ultimoMid: maiorMid,
    alertasDisparados,
  };
}

module.exports = { sincronizarEmpresa };
