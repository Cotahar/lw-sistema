// Script de investigacao pontual (READ-ONLY) - dois problemas reportados
// pelo usuario em 2026-09-30:
// 1) Acerto pago em Contas a Pagar nao reflete como pago em lugar nenhum
//    (fica "pendente" no app do motorista tambem).
// 2) Uma despesa "ABASTECIMENTO + ARLA - VIAGEM #5" de R$0,60 aparece em
//    Contas a Pagar mas nao aparece na lista de despesas da viagem #5.
// Nao faz parte da cadeia de migracoes. Rodar: `node database/scripts/investigar_bug_acerto_despesa_fantasma_20260930.js`
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function log(titulo, dados) {
  console.log(`\n=== ${titulo} ===`);
  console.log(JSON.stringify(dados, null, 2));
}

// ---------- Parte 1: despesa fantasma da viagem #5 ----------
log('viagens id=5', db.prepare('SELECT * FROM viagens WHERE id = 5').get());

log('despesas_viagem com viagem_id=5', db.prepare('SELECT * FROM despesas_viagem WHERE viagem_id = 5 ORDER BY id').all());

log(
  'contas_pagar com descricao mencionando VIAGEM #5',
  db.prepare("SELECT * FROM contas_pagar WHERE descricao LIKE '%VIAGEM #5%' ORDER BY id").all()
);

log(
  'contas_pagar origem_tipo=DespesaViagem cujo origem_id NAO existe mais em despesas_viagem (orfas)',
  db.prepare(`
    SELECT cp.* FROM contas_pagar cp
    WHERE cp.origem_tipo = 'DespesaViagem'
      AND NOT EXISTS (SELECT 1 FROM despesas_viagem dv WHERE dv.id = cp.origem_id)
  `).all()
);

log(
  'contas_pagar valor <= 100 centavos (R$1) com origem_tipo=DespesaViagem (achar o R$0,60)',
  db.prepare(`
    SELECT cp.id, cp.descricao, cp.valor, cp.status, cp.origem_id, cp.criado_em, cp.data_vencimento,
           dv.id AS despesa_id, dv.viagem_id AS despesa_viagem_id, dv.valor AS despesa_valor, dv.data AS despesa_data,
           dv.despesa_arla_id, dv.contas_pagar_id AS despesa_contas_pagar_id
    FROM contas_pagar cp
    LEFT JOIN despesas_viagem dv ON cp.origem_tipo = 'DespesaViagem' AND dv.id = cp.origem_id
    WHERE cp.origem_tipo = 'DespesaViagem' AND cp.valor <= 100
    ORDER BY cp.id DESC
  `).all()
);

// ---------- Parte 2: acerto pago que nao "baixa" ----------
log(
  'contas_pagar origem_tipo=AcertoViagem, status Pago, mais recentes',
  db.prepare(`
    SELECT * FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND status = 'Pago' ORDER BY id DESC LIMIT 10
  `).all()
);

log(
  'contas_pagar origem_tipo=AcertoViagem cujo origem_id NAO existe mais em acertos_viagem (orfas)',
  db.prepare(`
    SELECT cp.* FROM contas_pagar cp
    WHERE cp.origem_tipo = 'AcertoViagem'
      AND NOT EXISTS (SELECT 1 FROM acertos_viagem a WHERE a.id = cp.origem_id)
  `).all()
);

// Junta cada acerto com TODAS as contas_pagar vinculadas (pode haver 2: saldo
// + imposto) e com o status da propria viagem, pra ver o quadro completo.
log(
  'acertos_viagem recentes + suas contas_pagar vinculadas + status da viagem',
  db.prepare(`
    SELECT a.id AS acerto_id, a.viagem_id, a.status AS acerto_status, a.saldo_final, a.data_acerto,
           v.status AS viagem_status
    FROM acertos_viagem a
    JOIN viagens v ON v.id = a.viagem_id
    ORDER BY a.id DESC LIMIT 10
  `).all().map((a) => ({
    ...a,
    contas_pagar: db.prepare(`SELECT id, descricao, valor, status, valor_pago, valor_descontado, data_pagamento FROM contas_pagar WHERE origem_tipo = 'AcertoViagem' AND origem_id = ?`).all(a.acerto_id),
  }))
);

db.close();
