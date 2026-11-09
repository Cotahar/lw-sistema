const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { db, login, api, criarEmpresa } = require('./helpers');
const migracao041 = require('../../database/migrations/041_categorias_conta_como_manutencao');

// Manutencao tem duas origens: Ordem de Servico (oficina) e manutencao de beira de estrada lancada como despesa da viagem
// (categoria marcada "conta como manutencao"). As duas aparecem juntas, diferenciadas pela classe.

let admin, veiculoId, viagemId, catEstradaId, catOutraId;

before(async () => {
  const token = await login();
  const empresa = criarEmpresa({ razao_social: 'Manutencao Unificada LTDA' });
  admin = () => api(token, empresa);
  const veiculo = await admin().post('/api/veiculos').send({ placa: 'MNT1A23', tipo: 'Cavalo', qtd_eixos: 3 });
  assert.equal(veiculo.status, 201, JSON.stringify(veiculo.body));
  veiculoId = veiculo.body.id;
  const conjunto = await admin().post('/api/conjuntos').send({ nome: 'Conjunto Manutencao', itens: [{ veiculo_id: veiculoId }] });
  const motorista = await admin().post('/api/motoristas').send({ nome: 'Motorista Estrada', cpf: `${Date.now()}`.slice(-11), cnh: '1', cnh_validade: '2030-01-01' });
  const viagem = await admin().post('/api/viagens').send({ conjunto_id: conjunto.body.id, motorista_id: motorista.body.id, data_inicio: '2026-10-01', km_inicial: 1000 });
  assert.equal(viagem.status, 201, JSON.stringify(viagem.body));
  viagemId = viagem.body.id;
  await admin().post(`/api/viagens/${viagemId}/fretes`).send({ origem_cidade: 'A', origem_uf: 'SP', destino_cidade: 'B', destino_uf: 'PR', frete_bruto: 500000 });
  const cat = await admin().post('/api/categorias-despesa').send({ nome: 'SOCORRO TESTE', conta_como_manutencao: 1 });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
  catEstradaId = cat.body.id;
  const outra = await admin().post('/api/categorias-despesa').send({ nome: 'LANCHE TESTE' });
  catOutraId = outra.body.id;
});

async function lancar(categoria_id, valor, descricao) {
  const r = await admin().post(`/api/viagens/${viagemId}/despesas`).send({ categoria_id, valor, pago_por: 'Empresa', descricao, data: '2026-10-05' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('manutencao de estrada (despesa da viagem) aparece junto da OS, com classe diferente; despesa comum nao aparece', async () => {
  const os = await admin().post('/api/ordens-servico').send({ veiculo_id: veiculoId, tipo: 'Preventiva', data: '2026-10-10', valor_pecas: 30000, valor_mao_obra: 20000, descricao: 'Revisao 125 mil km' });
  assert.equal(os.status, 201, JSON.stringify(os.body));
  const osCorretiva = await admin().post('/api/ordens-servico').send({ veiculo_id: veiculoId, tipo: 'Corretiva', data: '2026-10-12', valor_pecas: 10000, valor_mao_obra: 0, descricao: 'Troca de mangueira' });
  const estrada = await lancar(catEstradaId, 25000, 'FURO NO PNEU NA BR 116');
  const comum = await lancar(catOutraId, 3000, 'lanche');

  const lista = await admin().get('/api/manutencoes');
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const chaves = lista.body.map((r) => r.chave);
  assert.ok(chaves.includes(`OS-${os.body.id}`) && chaves.includes(`OS-${osCorretiva.body.id}`) && chaves.includes(`VG-${estrada}`));
  assert.ok(!chaves.includes(`VG-${comum}`), 'categoria sem a marca nao conta como manutencao');

  const linhaEstrada = lista.body.find((r) => r.chave === `VG-${estrada}`);
  assert.equal(linhaEstrada.classe, 'Estrada');
  assert.equal(linhaEstrada.origem, 'Viagem');
  assert.equal(linhaEstrada.veiculo_placa, 'MNT1A23');
  assert.equal(linhaEstrada.valor_total, 25000);
  assert.equal(linhaEstrada.viagem_id, viagemId);
  assert.equal(linhaEstrada.motorista_nome, 'MOTORISTA ESTRADA');
  assert.equal(linhaEstrada.categoria, 'SOCORRO TESTE');
  const linhaOs = lista.body.find((r) => r.chave === `OS-${os.body.id}`);
  assert.equal(linhaOs.classe, 'Preventiva');
  assert.equal(linhaOs.valor_total, 50000);

  const soOs = await admin().get('/api/manutencoes?origem=OS');
  assert.ok(soOs.body.every((r) => r.origem === 'OS'));
  const soEstrada = await admin().get('/api/manutencoes?origem=Viagem');
  assert.deepEqual(soEstrada.body.map((r) => r.chave), [`VG-${estrada}`]);
  const soCorretiva = await admin().get('/api/manutencoes?classe=Corretiva');
  assert.deepEqual(soCorretiva.body.map((r) => r.chave), [`OS-${osCorretiva.body.id}`]);
  const periodo = await admin().get('/api/manutencoes?data_de=2026-10-11&data_ate=2026-10-31');
  assert.ok(!periodo.body.some((r) => r.chave === `VG-${estrada}`) && periodo.body.some((r) => r.chave === `OS-${osCorretiva.body.id}`));

  // Relatorio (mesma fonte): o filtro "tipo" agora aceita Estrada; sem filtro traz as duas origens.
  const rel = await admin().get('/api/relatorios/ordens-servico');
  assert.ok(rel.body.some((r) => r.chave === `VG-${estrada}` && r.tipo === 'Estrada' && r.valor_pecas === 0));
  const relEstrada = await admin().get('/api/relatorios/ordens-servico?tipo=Estrada');
  assert.ok(relEstrada.body.length >= 1 && relEstrada.body.every((r) => r.tipo === 'Estrada'));
  const relPreventiva = await admin().get('/api/relatorios/ordens-servico?tipo=Preventiva');
  assert.ok(relPreventiva.body.length >= 1 && relPreventiva.body.every((r) => r.tipo === 'Preventiva'));
});

test('desmarcar a categoria tira os lancamentos dela da lista de manutencao (sem apagar a despesa da viagem)', async () => {
  const id = await lancar(catEstradaId, 1234, 'teste desmarcar');
  assert.ok((await admin().get('/api/manutencoes')).body.some((r) => r.chave === `VG-${id}`));
  const upd = await admin().put(`/api/categorias-despesa/${catEstradaId}`).send({ conta_como_manutencao: 0 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.ok(!(await admin().get('/api/manutencoes')).body.some((r) => r.chave === `VG-${id}`));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM despesas_viagem WHERE id = ?').get(id).n, 1);
  await admin().put(`/api/categorias-despesa/${catEstradaId}`).send({ conta_como_manutencao: 1 });
});

test('migracao 041: categorias existentes (Manutencao, Borracharia, Guincho...) ja nascem marcadas; as demais nao', () => {
  const antigo = new DatabaseSync(':memory:');
  antigo.exec(`CREATE TABLE categorias_despesa (id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, oculta_na_busca INTEGER NOT NULL DEFAULT 0);
    INSERT INTO categorias_despesa (nome) VALUES ('MANUTENÇÃO'), ('BORRACHARIA'), ('GUINCHO'), ('ABASTECIMENTO'), ('LAVAÇÃO'), ('PEDÁGIO');`);
  migracao041.up(antigo);
  migracao041.up(antigo); // idempotente
  const marcadas = antigo.prepare('SELECT nome FROM categorias_despesa WHERE conta_como_manutencao = 1 ORDER BY nome').all().map((r) => r.nome);
  assert.deepEqual(marcadas, ['BORRACHARIA', 'GUINCHO', 'MANUTENÇÃO']);
});
