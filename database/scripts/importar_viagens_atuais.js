// Importacao pontual (nao-destrutiva) das 4 viagens em andamento (Jesse,
// Leandro, Maicon, Nazareno), a partir do JSON extraido das planilhas reais
// de cada motorista (abastecimento/servico/despesa/receita), para "ligar"
// de fato a operacao no Frottex.
//
// Ao contrario do historico Drivvo (importar_historico_drivvo.js), aqui as
// despesas/abastecimentos nascem como Contas a Pagar 'Pendente' de verdade
// (ainda nao foram pagas) e os fretes viram Contas a Receber reais - e por
// isso o script reaproveita as MESMAS funcoes que a API usa
// (criarDespesaViagem, buscarUnidadeTratora/buscarCentroCustoDoVeiculo) em
// vez de reescrever a logica na mao, garantindo o mesmo comportamento
// (despesa de Arla ligada via despesa_arla_id + 1 conta a pagar combinada,
// centro de custo = unidade tratora do conjunto, etc.).
//
// Fretes (origem/destino/transportadora/baixas) foram resolvidos em
// conversa com o usuario a partir do texto livre da Observacao de cada
// planilha (nem sempre tem cidade+UF completos) - ver FRETES_RESOLVIDOS.
//
// Roda uma vez, com confirmacao explicita e o caminho do JSON (gerado por
// scripts/extrair_viagens.py a partir dos .xlsx originais):
//   node database/scripts/importar_viagens_atuais.js --confirmo <caminho-do-json>
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (!args.includes('--confirmo')) {
  console.error('Nada foi importado. Rode com --confirmo e o caminho do JSON:');
  console.error('  node database/scripts/importar_viagens_atuais.js --confirmo <caminho-do-json>');
  process.exit(1);
}
const jsonPath = args.find((a) => a !== '--confirmo' && a !== '--forcar');
if (!jsonPath) { console.error('Informe o caminho do JSON extraido das planilhas.'); process.exit(1); }
const forcar = args.includes('--forcar');

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

// ---------------------------------------------------------------------
// Configuracao fixa: motorista/conjunto de cada arquivo (ja cadastrados
// por importar_cadastro_veiculos_motoristas.js e pelo proprio usuario, no
// caso do Nazareno).
const CAMINHOES = {
  jesse: { motoristaCpf: '95648429053', conjuntoNomeContem: 'Jesse' },
  leandro: { motoristaCpf: '60358718015', conjuntoNomeContem: 'Leandro' },
  maicon: { motoristaCpf: '08769327904', conjuntoNomeContem: 'Maicon' },
  nazareno: { motoristaCpf: '69372284904', conjuntoNomeContem: 'Nazareno' },
};

// Fretes resolvidos manualmente com o usuario (o texto livre da planilha
// nao tinha cidade+UF completos em varios casos). Valores em centavos.
const FRETES_RESOLVIDOS = {
  jesse: [
    { data: '2026-09-02', origem_cidade: 'Itajaí', origem_uf: 'SC', destino_cidade: 'Imperatriz', destino_uf: 'MA', transportadora: 'B.NUNES', frete_bruto: 3000000, baixas: [{ tipo: 'Adiantamento', valor: 2100000, data: '2026-09-02' }] },
    { data: '2026-08-28', origem_cidade: 'Trindade do Sul', origem_uf: 'RS', destino_cidade: 'Porto Amazonas', destino_uf: 'PR', transportadora: 'TRP LOGÍSTICA', frete_bruto: 430000, baixas: [] },
    { data: '2026-08-21', origem_cidade: 'Tutoia', origem_uf: 'MA', destino_cidade: 'Sarandi', destino_uf: 'RS', transportadora: null, frete_bruto: 3172000, baixas: [{ tipo: 'Adiantamento', valor: 2220000, data: '2026-08-21' }] },
    { data: '2026-08-19', origem_cidade: 'São Luís', origem_uf: 'MA', destino_cidade: 'Tutoia', destino_uf: 'MA', transportadora: 'B.NUNES', frete_bruto: 298000, baixas: [{ tipo: 'Saldo', valor: 298000, data: '2026-08-19', descricao: 'Frete quitado' }] },
    { data: '2026-08-16', origem_cidade: 'Belém', origem_uf: 'PA', destino_cidade: 'São Luís', destino_uf: 'MA', transportadora: 'B.NUNES', frete_bruto: 1000000, baixas: [] },
    { data: '2026-08-05', origem_cidade: 'Orleans', origem_uf: 'SC', destino_cidade: 'Bragança', destino_uf: 'PA', transportadora: 'B.NUNES', frete_bruto: 3650000, baixas: [{ tipo: 'Adiantamento', valor: 2420000, data: '2026-08-05' }] },
  ],
  leandro: [
    { data: '2026-09-01', origem_cidade: 'Limoeiro do Norte', origem_uf: 'CE', destino_cidade: 'Rio Claro', destino_uf: 'SP', transportadora: 'B.NUNES', frete_bruto: 1700000, baixas: [{ tipo: 'Adiantamento', valor: 1190000, data: '2026-09-01' }] },
  ],
  maicon: [
    { data: '2026-08-28', origem_cidade: 'Campo Largo', origem_uf: 'PR', destino_cidade: 'Fortaleza', destino_uf: 'CE', transportadora: 'B.NUNES', frete_bruto: 3427200, baixas: [{ tipo: 'Adiantamento', valor: 2135000, data: '2026-08-27' }] },
    { data: '2026-08-26', origem_cidade: 'Turvo', origem_uf: 'SC', destino_cidade: 'Porto Belo', destino_uf: 'SC', transportadora: 'B.NUNES', frete_bruto: 400000, baixas: [{ tipo: 'Adiantamento', valor: 280000, data: '2026-08-26' }] },
  ],
  nazareno: [
    { data: '2026-08-31', origem_cidade: 'Curitiba', origem_uf: 'PR', destino_cidade: 'Salgueiro', destino_uf: 'PE', transportadora: null, frete_bruto: 388700, baixas: [{ tipo: 'Saldo', valor: 388700, data: '2026-09-02', descricao: 'Recebido em dinheiro na entrega' }] },
    { data: '2026-08-28', origem_cidade: 'Campo Largo', origem_uf: 'PR', destino_cidade: 'Caicó', destino_uf: 'RN', transportadora: 'B.NUNES', frete_bruto: 2750000, baixas: [{ tipo: 'Adiantamento', valor: 1925000, data: '2026-08-28' }] },
    { data: '2026-08-26', origem_cidade: 'Americana', origem_uf: 'SP', destino_cidade: 'Curitiba', destino_uf: 'PR', transportadora: 'BS TRANSPORTES', frete_bruto: 320000, baixas: [] },
  ],
};

const MAPA_CATEGORIA = {
  'borracharia': 'borracharia',
  'descarga': 'descarga',
  'rastreador': 'rastreamento',
  'acessórios': 'acessórios',
  'alinhamento': 'manutenção',
  'revisão': 'manutenção',
  'lava-rápido': 'lavação',
  'pneus - calibragem': 'pneus',
};

// ---------------------------------------------------------------------

const empresa = db.prepare('SELECT id FROM empresas LIMIT 1').get();
if (!empresa) { console.error('Nenhuma empresa cadastrada.'); process.exit(1); }
const empresaId = empresa.id;

const responsavel = db.prepare("SELECT id FROM usuarios WHERE username = 'ruan' OR nome LIKE 'Ruan%' ORDER BY id LIMIT 1").get()
  || db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY id LIMIT 1").get();
if (!responsavel) { console.error('Nenhum usuario Admin encontrado.'); process.exit(1); }
const usuarioId = responsavel.id;

const jaExiste = db.prepare("SELECT COUNT(*) c FROM viagens WHERE empresa_id = ? AND status = 'EmAndamento'").get(empresaId).c;
if (jaExiste > 0 && !forcar) {
  console.error(`Ja existem ${jaExiste} viagem(ns) EmAndamento - parece que essa importacao ja rodou.`);
  console.error('Rode de novo com --forcar se quiser importar mesmo assim (pode duplicar).');
  process.exit(1);
}

// --- categorias: garante que existem (cria as que faltarem) ---
function categoriaId(nome) {
  const existente = db.prepare('SELECT id FROM categorias_despesa WHERE LOWER(TRIM(nome)) = ?').get(String(nome).trim().toLowerCase());
  if (existente) return existente.id;
  const info = db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(nome);
  console.log(`categoria criada: ${nome} (id ${info.lastInsertRowid})`);
  return info.lastInsertRowid;
}
const catAbastecimento = categoriaId('Abastecimento');
categoriaId('Arla'); // criarDespesaViagem resolve Arla sozinho por nome
const catPneus = categoriaId('Pneus');
const categoriasResolvidas = {};
for (const chave of Object.keys(MAPA_CATEGORIA)) categoriasResolvidas[normalizarChave(chave)] = categoriaId(MAPA_CATEGORIA[chave]);

// --- fornecedores: transportadoras + postos (cria os que faltarem) ---
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

// Cria os fornecedores de transportadora usados nos fretes resolvidos.
const transportadoraIds = {};
for (const lista of Object.values(FRETES_RESOLVIDOS)) {
  for (const f of lista) {
    if (f.transportadora && !(f.transportadora in transportadoraIds)) {
      transportadoraIds[f.transportadora] = fornecedorId(f.transportadora, tipoTransportadora);
    }
  }
}
// Cria os fornecedores de posto usados nos abastecimentos (nome exato da planilha).
const postoIds = {};
for (const truck of Object.values(dados)) {
  for (const linha of truck.abastecimentos || []) {
    const nome = linha['Posto de combustível'];
    if (nome && !(nome in postoIds)) postoIds[nome] = fornecedorId(nome, tipoPosto);
  }
}

const resumoGeral = [];

for (const [chave, config] of Object.entries(CAMINHOES)) {
  const truck = dados[chave];
  if (!truck) { console.log(`\n=== ${chave}: sem dados no JSON, pulando ===`); continue; }

  const motorista = db.prepare('SELECT id, nome FROM motoristas WHERE empresa_id = ? AND cpf = ?').get(empresaId, config.motoristaCpf);
  if (!motorista) { console.log(`\n=== ${chave}: motorista (CPF ${config.motoristaCpf}) nao encontrado, pulando ===`); continue; }
  const conjunto = db.prepare('SELECT id, nome FROM conjuntos WHERE empresa_id = ? AND nome LIKE ?').get(empresaId, `%${config.conjuntoNomeContem}%`);
  if (!conjunto) { console.log(`\n=== ${chave}: conjunto contendo "${config.conjuntoNomeContem}" nao encontrado, pulando ===`); continue; }

  console.log(`\n=== ${chave}: motorista ${motorista.nome} (id ${motorista.id}), conjunto "${conjunto.nome}" (id ${conjunto.id}) ===`);

  const tratora = buscarUnidadeTratora(conjunto.id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) { console.log('  Centro de custo da unidade tratora nao encontrado, pulando.'); continue; }

  // --- monta a lista de eventos ordenada cronologicamente ---
  const eventos = [];
  for (const linha of truck.abastecimentos || []) {
    const dataIso = paraDataIso(linha.Data);
    eventos.push({ tipo: 'abastecimento', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const linha of truck.despesas || []) {
    const dataIso = paraDataIso(linha.Data);
    const ehAdiantamento = /adiantamento salarial/i.test(linha['Tipo de despesa'] || '');
    eventos.push({ tipo: ehAdiantamento ? 'adiantamento' : 'despesa', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const linha of truck.servicos || []) {
    const dataIso = paraDataIso(linha.Data);
    eventos.push({ tipo: 'servico', dataIso, hora: linha.Hora || '00:00', linha });
  }
  for (const frete of FRETES_RESOLVIDOS[chave] || []) {
    eventos.push({ tipo: 'frete', dataIso: frete.data, hora: '12:00', frete });
  }
  eventos.sort((a, b) => `${a.dataIso} ${a.hora}`.localeCompare(`${b.dataIso} ${b.hora}`));

  if (!eventos.length) { console.log('  Nenhum evento, pulando.'); continue; }

  const primeiroAbastecimento = eventos.find((e) => e.tipo === 'abastecimento');
  const dataInicio = eventos[0].dataIso;
  const kmInicial = primeiroAbastecimento ? primeiroAbastecimento.linha['Odômetro (km)'] : 0;

  const viagemId = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO viagens (empresa_id, data_inicio, conjunto_id, motorista_id, status, km_inicial, criado_por)
      VALUES (?, ?, ?, ?, 'EmAndamento', ?, ?)
    `).run(empresaId, dataInicio, conjunto.id, motorista.id, kmInicial, usuarioId);
    return info.lastInsertRowid;
  });
  console.log(`  viagem #${viagemId} aberta: inicio ${dataInicio}, km_inicial ${kmInicial}`);

  let ultimoFreteId = null;
  const contagem = { abastecimento: 0, arla: 0, despesa: 0, servico: 0, adiantamento: 0, frete: 0 };

  for (const evento of eventos) {
    if (evento.tipo === 'frete') {
      const f = evento.frete;
      const transportadoraId = f.transportadora ? transportadoraIds[f.transportadora] : null;
      const freteId = withTransaction(db, () => {
        const info = db.prepare(`
          INSERT INTO fretes (empresa_id, viagem_id, transportadora_id, origem_cidade, origem_uf, destino_cidade, destino_uf, peso_carga_kg, frete_bruto, data_carregamento)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(empresaId, viagemId, transportadoraId, f.origem_cidade, f.origem_uf, f.destino_cidade, f.destino_uf, f.frete_bruto, f.data);
        const novoFreteId = info.lastInsertRowid;

        db.prepare(`
          INSERT INTO contas_receber (empresa_id, frete_id, centro_custo_id, valor, data_prevista, status)
          VALUES (?, ?, ?, ?, ?, 'Pendente')
        `).run(empresaId, novoFreteId, centroCusto.id, f.frete_bruto, f.data);

        if (ultimoFreteId === null) {
          db.prepare('UPDATE despesas_viagem SET frete_id = ? WHERE viagem_id = ? AND frete_id IS NULL').run(novoFreteId, viagemId);
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
      `).run(empresaId, viagemId, paraCentavos(l['Valor total']), evento.dataIso, l.Observação || l.Motivo || 'Adiantamento salarial', usuarioId);
      contagem.adiantamento++;
      continue;
    }

    if (evento.tipo === 'abastecimento') {
      const l = evento.linha;
      const valorDiesel = paraCentavos(l['Valor total']);
      if (valorDiesel <= 0) continue;
      const temArla = l['Segundo combustível'] && paraCentavos(l['Valor total 2']) > 0;
      criarDespesaViagem({
        empresaId, viagem: { id: viagemId }, freteId: ultimoFreteId, centroCustoId: centroCusto.id, categoriaId: catAbastecimento,
        valor: valorDiesel, data: evento.dataIso, pagoPor: 'Empresa',
        postoFornecedorId: postoIds[l['Posto de combustível']] || null,
        precoLitro: paraCentavos(l['Preço / gal']), litragem: l.Volume || null, kmAbastecimento: l['Odômetro (km)'] || null,
        arla: temArla ? { valor: paraCentavos(l['Valor total 2']), preco_litro: paraCentavos(l['Preço / gal 2']), litragem: l['Volume 2'] || null } : undefined,
        usuarioId,
      });
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
    criarDespesaViagem({
      empresaId, viagem: { id: viagemId }, freteId: ultimoFreteId, centroCustoId: centroCusto.id, categoriaId: catId,
      valor, data: evento.dataIso, pagoPor: 'Empresa', descricao, usuarioId,
    });
    contagem[evento.tipo]++;
  }

  console.log(`  resumo: ${JSON.stringify(contagem)}`);
  resumoGeral.push({ chave, viagemId, ...contagem });
}

console.log('\n=== RESUMO GERAL ===');
console.log(JSON.stringify(resumoGeral, null, 2));
