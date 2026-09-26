// Lancamento retroativo pedido pelo usuario em 26/09/2026: abastecimento
// (Diesel + Arla, Posto Rede Sao Marcos) da viagem ja ENCERRADA do motorista
// Leandro Campos Alves / cavalo TPN8E74, que passou batido na hora.
//
// Reaproveita criarDespesaViagem() (backend/src/utils/despesaViagemHelper.js)
// - a MESMA funcao usada por POST /viagens/:id/despesas - pra garantir que a
// despesa de diesel, a despesa de Arla vinculada (despesa_arla_id) e a conta
// a pagar COMBINADA (diesel+arla, uma so, como qualquer abastecimento normal)
// nascem exatamente like a rota de verdade criaria. A viagem ja esta
// Finalizada (a rota bloqueia despesa nova nesse estado de proposito, pra
// nao alterar as contas de uma viagem cujo Acerto ja foi fechado e pago) -
// aqui e uma insercao direta no banco, ciente disso: o Acerto ja fechado NAO
// e recalculado (fica intocado, snapshot antigo), so o registro historico da
// despesa entra pra completar o DRE do veiculo. So rode isto sabendo que o
// Acerto da viagem #2 nao vai refletir este gasto adicional.
//
// A conta a pagar combinada gerada nasce Pendente (mesma regra de sempre) -
// em seguida este script a marca "Pago" com data_pagamento = data do
// abastecimento e SEM conta bancaria vinculada (pedido explicito do usuario:
// "sem influencia no caixa", o pagamento ja aconteceu antes do sistema
// rastrear caixa).
//
// Uso (a DATA e obrigatoria, formato AAAA-MM-DD):
//   node database/scripts/backfill_abastecimento_leandro.js <data> [--confirmo]
const path = require('node:path');

const CONFIRMAR = process.argv.includes('--confirmo');
const data = process.argv[2];
if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
  console.error('Uso: node database/scripts/backfill_abastecimento_leandro.js <data AAAA-MM-DD> [--confirmo]');
  process.exit(1);
}

const db = require(path.resolve(__dirname, '../../backend/src/config/db'));
const { criarDespesaViagem } = require(path.resolve(__dirname, '../../backend/src/utils/despesaViagemHelper'));

const DIESEL_LITROS = 700;
const DIESEL_VALOR = 444500; // R$ 4.445,00
const ARLA_LITROS = 58.22;
const ARLA_VALOR = 17408; // R$ 174,08

try {
  const viagem = db.prepare(`
    SELECT vg.* FROM viagens vg
    JOIN motoristas mo ON mo.id = vg.motorista_id
    JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
    JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE mo.nome LIKE '%LEANDRO%' AND v.placa = 'TPN8E74' AND vg.status = 'Finalizada'
  `).get();
  if (!viagem) throw new Error('Viagem do Leandro / TPN8E74 (Finalizada) nao encontrada.');

  const centro = db.prepare(`
    SELECT cc.id FROM centros_custo cc JOIN veiculos v ON v.id = cc.veiculo_id WHERE v.placa = 'TPN8E74'
  `).get();
  if (!centro) throw new Error('Centro de custo do TPN8E74 nao encontrado.');

  const categoriaAbastecimento = db.prepare(`SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'`).get();
  if (!categoriaAbastecimento) throw new Error('Categoria Abastecimento nao encontrada.');

  const fornecedor = db.prepare(`SELECT id, nome FROM fornecedores WHERE nome LIKE '%MARCOS%'`).get();
  if (!fornecedor) throw new Error('Fornecedor "Rede Sao Marcos" nao encontrado.');

  const frete = db.prepare('SELECT id FROM fretes WHERE viagem_id = ? ORDER BY id DESC LIMIT 1').get(viagem.id);

  const admin = db.prepare(`SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY id LIMIT 1`).get();
  if (!admin) throw new Error('Nenhum usuario Admin encontrado para atribuir como criador do lancamento.');

  const precoLitroDiesel = Math.round(DIESEL_VALOR / DIESEL_LITROS);
  const precoLitroArla = Math.round(ARLA_VALOR / ARLA_LITROS);

  console.log('Lancamento planejado:');
  console.log(`  Viagem #${viagem.id} (${viagem.data_inicio} a ${viagem.data_fim}), frete ${frete ? `#${frete.id}` : '(nenhum ainda)'}`);
  console.log(`  Centro de custo #${centro.id} (TPN8E74), fornecedor "${fornecedor.nome}" (#${fornecedor.id})`);
  console.log(`  Diesel: ${DIESEL_LITROS} L a R$ ${(precoLitroDiesel / 100).toFixed(2)}/L = R$ ${(DIESEL_VALOR / 100).toFixed(2)}`);
  console.log(`  Arla: ${ARLA_LITROS} L a R$ ${(precoLitroArla / 100).toFixed(2)}/L = R$ ${(ARLA_VALOR / 100).toFixed(2)}`);
  console.log(`  Data: ${data} | Total combinado: R$ ${((DIESEL_VALOR + ARLA_VALOR) / 100).toFixed(2)}`);

  if (!CONFIRMAR) {
    console.log('\n[dry-run] Nada foi gravado. Rode novamente com --confirmo para aplicar de verdade.');
    process.exit(0);
  }

  const despesa = criarDespesaViagem({
    empresaId: viagem.empresa_id,
    viagem,
    freteId: frete ? frete.id : null,
    centroCustoId: centro.id,
    categoriaId: categoriaAbastecimento.id,
    valor: DIESEL_VALOR,
    data,
    pagoPor: 'Empresa',
    postoFornecedorId: fornecedor.id,
    precoLitro: precoLitroDiesel,
    litragem: DIESEL_LITROS,
    dataVencimento: data,
    arla: { valor: ARLA_VALOR, preco_litro: precoLitroArla, litragem: ARLA_LITROS },
    usuarioId: admin.id,
    tanqueCompleto: false,
  });

  const contaPagar = db.prepare(`SELECT * FROM contas_pagar WHERE id = ?`).get(despesa.contas_pagar_id);
  if (!contaPagar) throw new Error('Despesa criada, mas a conta a pagar combinada nao foi encontrada - confira manualmente.');

  db.prepare(`
    UPDATE contas_pagar SET status = 'Pago', data_pagamento = ?, valor_pago = valor, conta_bancaria_id = NULL WHERE id = ?
  `).run(data, contaPagar.id);

  const problemas = db.prepare('PRAGMA foreign_key_check').all();
  if (problemas.length) throw new Error(`foreign_key_check encontrou ${problemas.length} problema(s): ${JSON.stringify(problemas.slice(0, 5))}`);

  console.log(`\nDespesa #${despesa.id} (diesel) + Arla (#${despesa.despesa_arla_id}) criadas. Conta a pagar #${contaPagar.id} marcada como Paga (sem conta bancaria).`);
} catch (err) {
  console.error('\nErro:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
