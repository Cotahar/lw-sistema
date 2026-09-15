// Importacao pontual (nao-destrutiva) de dados NOVOS do Drivvo para as
// viagens ja abertas de Leandro (viagem existente, conjunto TPN8E74/
// TWT4B11) e Nazareno (conjunto TVP0B82/TWC0A52), a partir de planilhas
// mais recentes/completas que as usadas em importar_viagens_atuais.js.
//
// Pula explicitamente as linhas ja importadas antes (ver DUPLICADAS abaixo,
// resolvidas manualmente comparando com o banco). Corrige data_inicio/
// km_inicial da viagem do Leandro pra tras: a planilha nova revelou
// abastecimentos anteriores ao que foi usado como inicio da viagem da vez
// passada.
//
// Por pedido do usuario: Despesas e Adiantamentos Salariais recebem baixa
// automatica (status Pago / lancados em viagem_adiantamentos) com a data
// de vencimento = data do lancamento, SEM gerar movimentacao de caixa.
// Fretes (Receita) seguem o mesmo tratamento de importar_viagens_atuais.js
// (Conta a Receber Pendente, baixada so onde o texto da planilha menciona
// adiantamento/pagamento).
//
// Roda uma vez, com confirmacao explicita e o caminho do JSON (gerado por
// scripts/extrair_viagens2.py a partir dos .xlsx originais):
//   node database/scripts/importar_atualizacao_viagens.js --confirmo <caminho-do-json>
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (!args.includes('--confirmo')) {
  console.error('Nada foi importado. Rode com --confirmo e o caminho do JSON:');
  console.error('  node database/scripts/importar_atualizacao_viagens.js --confirmo <caminho-do-json>');
  process.exit(1);
}
const jsonPath = args.find((a) => a !== '--confirmo' && a !== '--forcar');
if (!jsonPath) { console.error('Informe o caminho do JSON extraido das planilhas.'); process.exit(1); }

process.env.DB_PATH = process.env.DB_PATH || './data/frotista.db';
const BACKEND_ROOT = path.resolve(__dirname, '../../backend');
const db = require(path.join(BACKEND_ROOT, 'src/config/db'));
const { withTransaction } = require(path.join(BACKEND_ROOT, 'src/utils/transaction'));
const { criarDespesaViagem } = require(path.join(BACKEND_ROOT, 'src/utils/despesaViagemHelper'));
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require(path.join(BACKEND_ROOT, 'src/utils/conjuntoHelper'));

function paraCentavos(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  return Math.round(Number(valor) * 100);
}
function paraDataIso(brDate) {
  if (!brDate) return null;
  const [d, m, y] = String(brDate).split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
function normalizarChave(txt) {
  return String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function ehTanqueCompleto(valor) {
  return normalizarChave(valor) === 'sim';
}

// Linhas ja importadas em importar_viagens_atuais.js - (data_iso, valor)
// identificam a linha de forma unica o suficiente pra esse caso (conferido
// manualmente contra o banco antes de escrever este script).
const DUPLICADAS = {
  leandro: {
    abastecimentos: new Set(['2026-08-27|475091', '2026-09-01|356698', '2026-09-02|278308']),
    servicos: new Set(['2026-08-31|5000', '2026-08-29|40000']),
    receitas: new Set(['2026-09-01|1700000']),
  },
  nazareno: {
    despesas: new Set(['2026-09-03|106250']),
  },
};
function ehDuplicada(chaveTruck, secao, dataIso, valor) {
  const set = DUPLICADAS[chaveTruck]?.[secao];
  return set ? set.has(`${dataIso}|${paraCentavos(valor)}`) : false;
}

const CAMINHOES = {
  leandro: { motoristaCpf: '60358718015', conjuntoNomeContem: 'Leandro' },
  nazareno: { motoristaCpf: '69372284904', conjuntoNomeContem: 'Nazareno' },
};

// Fretes resolvidos manualmente com o usuario.
const FRETES_NOVOS = {
  leandro: [
    { data: '2026-09-15', origem_cidade: 'Vacaria', origem_uf: 'RS', destino_cidade: 'São José', destino_uf: 'SC', transportadora: 'TRANSJARDENZ', frete_bruto: 380000, baixas: [{ tipo: 'Adiantamento', valor: 270000, data: '2026-09-15' }] },
    { data: '2026-09-10', origem_cidade: 'Promissão', origem_uf: 'SP', destino_cidade: 'Gaurama', destino_uf: 'RS', transportadora: 'OTIMIZE TRANSPORTES', frete_bruto: 807463, baixas: [{ tipo: 'Saldo', valor: 807463, data: '2026-09-10', descricao: 'Pago integral apos carregamento' }] },
    { data: '2026-08-21', origem_cidade: 'Campo Largo', origem_uf: 'PR', destino_cidade: 'São Luís', destino_uf: 'MA', transportadora: 'ANGELUS TRANSPORTES', frete_bruto: 3000000, baixas: [{ tipo: 'Adiantamento', valor: 2100000, data: '2026-08-21' }] },
    { data: '2026-08-17', origem_cidade: 'Juazeiro do Norte', origem_uf: 'CE', destino_cidade: 'Itapema', destino_uf: 'SC', transportadora: 'B.NUNES', frete_bruto: 1960000, baixas: [] },
    { data: '2026-08-05', hora: '06:58', origem_cidade: 'Urussanga', origem_uf: 'SC', destino_cidade: 'Recife', destino_uf: 'PE', transportadora: 'GILVANIO TRANSPORTES', frete_bruto: 650000, baixas: [{ tipo: 'Adiantamento', valor: 450000, data: '2026-08-05' }] },
    { data: '2026-08-05', hora: '09:25', origem_cidade: 'Orleans', origem_uf: 'SC', destino_cidade: 'Não informado', destino_uf: 'PE', transportadora: 'B.NUNES', frete_bruto: 2800000, baixas: [{ tipo: 'Adiantamento', valor: 1960000, data: '2026-08-05' }] },
  ],
  nazareno: [
    { data: '2026-09-12', origem_cidade: 'Uberaba', origem_uf: 'MG', destino_cidade: 'Taquari', destino_uf: 'RS', transportadora: 'DEXCO', frete_bruto: 1250000, baixas: [{ tipo: 'Adiantamento', valor: 1012500, data: '2026-09-12' }] },
    { data: '2026-09-04', origem_cidade: 'Conde', origem_uf: 'PB', destino_cidade: 'Valparaíso de Goiás', destino_uf: 'GO', transportadora: 'R.FARIAS TRANSPORTES', frete_bruto: 1201835, baixas: [] },
  ],
};

const MAPA_CATEGORIA = {
  'estacionamento': 'estacionamento',
  'descarga': 'descarga',
  'acessórios': 'acessórios',
  'revisão': 'manutenção',
  'lava-rápido': 'lavação',
  'pneus - calibragem': 'pneus',
  'engraxar': 'engraxar',
  'guincho': 'guincho',
};

// ---------------------------------------------------------------------

const empresa = db.prepare('SELECT id FROM empresas LIMIT 1').get();
if (!empresa) { console.error('Nenhuma empresa cadastrada.'); process.exit(1); }
const empresaId = empresa.id;

const responsavel = db.prepare("SELECT id FROM usuarios WHERE username = 'ruan' OR nome LIKE 'Ruan%' ORDER BY id LIMIT 1").get()
  || db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY id LIMIT 1").get();
if (!responsavel) { console.error('Nenhum usuario Admin encontrado.'); process.exit(1); }
const usuarioId = responsavel.id;

function categoriaId(nome) {
  const existente = db.prepare('SELECT id FROM categorias_despesa WHERE LOWER(TRIM(nome)) = ?').get(String(nome).trim().toLowerCase());
  if (existente) return existente.id;
  const info = db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(nome);
  console.log(`categoria criada: ${nome} (id ${info.lastInsertRowid})`);
  return info.lastInsertRowid;
}
const catAbastecimento = categoriaId('Abastecimento');
categoriaId('Arla');
const categoriasResolvidas = {};
for (const chave of Object.keys(MAPA_CATEGORIA)) categoriasResolvidas[normalizarChave(chave)] = categoriaId(MAPA_CATEGORIA[chave]);

const tipoTransportadora = db.prepare("SELECT id FROM fornecedor_tipos WHERE LOWER(nome) = 'transportadora'").get().id;
const tipoPosto = db.prepare("SELECT id FROM fornecedor_tipos WHERE LOWER(nome) = 'posto'").get().id;

function fornecedorId(nome, tipoId) {
  if (!nome) return null;
  const nomeLimpo = String(nome).trim();
  const existente = db.prepare('SELECT id FROM fornecedores WHERE empresa_id = ? AND LOWER(nome) = ?').get(empresaId, nomeLimpo.toLowerCase());
  if (existente) return existente.id;
  const info = db.prepare('INSERT INTO fornecedores (empresa_id, tipo_id, nome) VALUES (?, ?, ?)').run(empresaId, tipoId, nomeLimpo);
  console.log(`fornecedor criado: ${nomeLimpo} (id ${info.lastInsertRowid})`);
  return info.lastInsertRowid;
}

const dados = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const transportadoraIds = {};
for (const lista of Object.values(FRETES_NOVOS)) {
  for (const f of lista) {
    if (f.transportadora && !(f.transportadora in transportadoraIds)) {
      transportadoraIds[f.transportadora] = fornecedorId(f.transportadora, tipoTransportadora);
    }
  }
}
const postoIds = {};
for (const truck of Object.values(dados)) {
  for (const linha of truck.abastecimentos || []) {
    const nome = linha['Posto de combustível'];
    if (nome && !(nome in postoIds)) postoIds[nome] = fornecedorId(nome, tipoPosto);
  }
}

// Marca a conta a pagar de uma despesa recem-criada como Pago (baixa
// automatica, data_pagamento = data_vencimento, sem movimentacao_caixa).
function baixarContaAutomatica(despesaId) {
  const despesa = db.prepare('SELECT contas_pagar_id FROM despesas_viagem WHERE id = ?').get(despesaId);
  if (!despesa || !despesa.contas_pagar_id) return;
  db.prepare(`
    UPDATE contas_pagar SET status = 'Pago', valor_pago = valor, data_pagamento = data_vencimento
    WHERE id = ?
  `).run(despesa.contas_pagar_id);
}

const resumoGeral = [];

for (const [chave, config] of Object.entries(CAMINHOES)) {
  const truck = dados[chave];
  if (!truck) { console.log(`\n=== ${chave}: sem dados no JSON, pulando ===`); continue; }

  const motorista = db.prepare('SELECT id, nome FROM motoristas WHERE empresa_id = ? AND cpf = ?').get(empresaId, config.motoristaCpf);
  if (!motorista) { console.log(`\n=== ${chave}: motorista nao encontrado, pulando ===`); continue; }
  const conjunto = db.prepare('SELECT id, nome FROM conjuntos WHERE empresa_id = ? AND nome LIKE ?').get(empresaId, `%${config.conjuntoNomeContem}%`);
  if (!conjunto) { console.log(`\n=== ${chave}: conjunto nao encontrado, pulando ===`); continue; }
  const viagem = db.prepare("SELECT * FROM viagens WHERE conjunto_id = ? AND status = 'EmAndamento' ORDER BY id DESC LIMIT 1").get(conjunto.id);
  if (!viagem) { console.log(`\n=== ${chave}: nenhuma viagem EmAndamento encontrada pro conjunto, pulando ===`); continue; }

  console.log(`\n=== ${chave}: viagem #${viagem.id}, motorista ${motorista.nome}, conjunto "${conjunto.nome}" ===`);

  const tratora = buscarUnidadeTratora(conjunto.id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) { console.log('  Centro de custo nao encontrado, pulando.'); continue; }

  const eventos = [];
  let puladas = 0;
  for (const linha of truck.abastecimentos || []) {
    const dataIso = paraDataIso(linha.Data);
    if (ehDuplicada(chave, 'abastecimentos', dataIso, linha['Valor total'])) { puladas++; continue; }
    eventos.push({ tipo: 'abastecimento', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const linha of truck.despesas || []) {
    const dataIso = paraDataIso(linha.Data);
    if (ehDuplicada(chave, 'despesas', dataIso, linha['Valor total'])) { puladas++; continue; }
    const ehAdiantamento = /adiantamento salarial/i.test(linha['Tipo de despesa'] || '');
    eventos.push({ tipo: ehAdiantamento ? 'adiantamento' : 'despesa', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const linha of truck.servicos || []) {
    const dataIso = paraDataIso(linha.Data);
    if (ehDuplicada(chave, 'servicos', dataIso, linha['Valor total'])) { puladas++; continue; }
    eventos.push({ tipo: 'servico', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const frete of FRETES_NOVOS[chave] || []) {
    const dataIso = frete.data;
    if (ehDuplicada(chave, 'receitas', dataIso, frete.frete_bruto / 100)) { puladas++; continue; }
    eventos.push({ tipo: 'frete', dataIso, hora: frete.hora || '12:00', frete });
  }
  eventos.sort((a, b) => `${a.dataIso} ${a.hora}`.localeCompare(`${b.dataIso} ${b.hora}`));

  if (!eventos.length) { console.log('  Nenhum evento novo, pulando.'); continue; }

  // Corrige data_inicio/km_inicial pra tras se a planilha nova revelou um
  // abastecimento anterior ao inicio ja registrado da viagem.
  const primeiroAbastecimentoNovo = eventos.find((e) => e.tipo === 'abastecimento');
  if (primeiroAbastecimentoNovo) {
    const kmNovo = primeiroAbastecimentoNovo.linha['Odômetro (km)'];
    const dataNova = primeiroAbastecimentoNovo.dataIso;
    if (kmNovo < viagem.km_inicial && dataNova < viagem.data_inicio) {
      db.prepare('UPDATE viagens SET km_inicial = ?, data_inicio = ? WHERE id = ?').run(kmNovo, dataNova, viagem.id);
      console.log(`  data_inicio/km_inicial corrigidos para ${dataNova} / ${kmNovo} (dado mais antigo revelado pela planilha nova).`);
      viagem.km_inicial = kmNovo;
      viagem.data_inicio = dataNova;
    }
  }

  // Ultimo frete ja existente da viagem (se houver) - novas despesas antes
  // do primeiro frete NOVO ainda devem apontar pra ele, nao ficar sem frete.
  let ultimoFreteId = db.prepare('SELECT id FROM fretes WHERE viagem_id = ? ORDER BY id DESC LIMIT 1').get(viagem.id)?.id || null;
  const contagem = { abastecimento: 0, arla: 0, despesa: 0, servico: 0, adiantamento: 0, frete: 0, duplicadasPuladas: puladas };

  for (const evento of eventos) {
    if (evento.tipo === 'frete') {
      const f = evento.frete;
      const transportadoraId = f.transportadora ? transportadoraIds[f.transportadora] : null;
      const freteId = withTransaction(db, () => {
        const info = db.prepare(`
          INSERT INTO fretes (empresa_id, viagem_id, transportadora_id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto, data_carregamento)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(empresaId, viagem.id, transportadoraId, f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf, f.frete_bruto, f.data);
        const novoFreteId = info.lastInsertRowid;
        db.prepare(`
          INSERT INTO contas_receber (empresa_id, frete_id, centro_custo_id, valor, data_prevista, status)
          VALUES (?, ?, ?, ?, ?, 'Pendente')
        `).run(empresaId, novoFreteId, centroCusto.id, f.frete_bruto, f.data);
        if (ultimoFreteId === null) {
          db.prepare('UPDATE despesas_viagem SET frete_id = ? WHERE viagem_id = ? AND frete_id IS NULL').run(novoFreteId, viagem.id);
        }
        return novoFreteId;
      });
      for (const baixa of f.baixas) {
        withTransaction(db, () => {
          const receber = db.prepare('SELECT * FROM contas_receber WHERE frete_id = ?').get(freteId);
          db.prepare(`
            INSERT INTO contas_receber_baixas (empresa_id, contas_receber_id, tipo, valor, data, descricao, criado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(empresaId, receber.id, baixa.tipo, baixa.valor, baixa.data, baixa.descricao || null, usuarioId);
          const novoValorRecebido = receber.valor_recebido + (baixa.tipo === 'Desconto' ? 0 : baixa.valor);
          const novoValorDescontado = receber.valor_descontado + (baixa.tipo === 'Desconto' ? baixa.valor : 0);
          const totalBaixado = novoValorRecebido + novoValorDescontado;
          const novoStatus = totalBaixado >= receber.valor ? 'Recebido' : (totalBaixado > 0 ? 'Parcial' : 'Pendente');
          db.prepare('UPDATE contas_receber SET valor_recebido = ?, valor_descontado = ?, status = ?, data_recebimento = ? WHERE id = ?')
            .run(novoValorRecebido, novoValorDescontado, novoStatus, baixa.data, receber.id);
        });
      }
      ultimoFreteId = freteId;
      contagem.frete++;
      console.log(`  frete #${freteId} (${f.origem_cidade}/${f.origem_uf} -> ${f.destino_cidade}/${f.destino_uf}, R$ ${(f.frete_bruto / 100).toFixed(2)})`);
      continue;
    }

    if (evento.tipo === 'adiantamento') {
      const l = evento.linha;
      db.prepare(`
        INSERT INTO viagem_adiantamentos (empresa_id, viagem_id, valor, data, descricao, criado_por)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(empresaId, viagem.id, paraCentavos(l['Valor total']), evento.dataIso, l.Observação || l.Motivo || 'Adiantamento salarial', usuarioId);
      contagem.adiantamento++;
      continue;
    }

    if (evento.tipo === 'abastecimento') {
      const l = evento.linha;
      const valorDiesel = paraCentavos(l['Valor total']);
      if (valorDiesel <= 0) continue;
      const temArla = l['Segundo combustível'] && paraCentavos(l['Valor total 2']) > 0;
      const despesa = criarDespesaViagem({
        empresaId, viagem: { id: viagem.id }, freteId: ultimoFreteId, centroCustoId: centroCusto.id, categoriaId: catAbastecimento,
        valor: valorDiesel, data: evento.dataIso, pagoPor: 'Empresa',
        postoFornecedorId: postoIds[l['Posto de combustível']] || null,
        precoLitro: paraCentavos(l['Preço / gal']), litragem: l.Volume || null, kmAbastecimento: l['Odômetro (km)'] || null,
        tanqueCompleto: ehTanqueCompleto(l['Completou o tanque']),
        arla: temArla ? { valor: paraCentavos(l['Valor total 2']), preco_litro: paraCentavos(l['Preço / gal 2']), litragem: l['Volume 2'] || null } : undefined,
        usuarioId,
      });
      baixarContaAutomatica(despesa.id);
      contagem.abastecimento++;
      if (temArla) contagem.arla++;
      continue;
    }

    // despesa / servico
    const l = evento.linha;
    const valor = paraCentavos(l['Valor total']);
    if (valor <= 0) continue;
    const tipoTexto = evento.tipo === 'servico' ? l['Tipo de serviço'] : l['Tipo de despesa'];
    const local = evento.tipo === 'servico' ? l['Local do serviço'] : l['Local da despesa'];
    const catId = categoriasResolvidas[normalizarChave(tipoTexto)] || null;
    if (!catId) { console.log(`  [aviso] categoria nao mapeada para "${tipoTexto}" (${evento.tipo}), pulando lancamento de R$ ${(valor / 100).toFixed(2)}`); continue; }
    const descricao = [local, l.Observação, l.Motivo].filter(Boolean).join(' - ') || null;
    const despesa = criarDespesaViagem({
      empresaId, viagem: { id: viagem.id }, freteId: ultimoFreteId, centroCustoId: centroCusto.id, categoriaId: catId,
      valor, data: evento.dataIso, pagoPor: 'Empresa', descricao, usuarioId,
    });
    baixarContaAutomatica(despesa.id);
    contagem[evento.tipo]++;
  }

  console.log(`  resumo: ${JSON.stringify(contagem)}`);
  resumoGeral.push({ chave, viagemId: viagem.id, ...contagem });
}

console.log('\n=== RESUMO GERAL ===');
console.log(JSON.stringify(resumoGeral, null, 2));
