// Cadastro pontual (nao-destrutivo, idempotente) dos veiculos, motoristas e
// conjuntos reais da LOWELL LTDA a partir dos documentos oficiais
// (CRLV/CNH) enviados pelo usuario, como parte da importacao oficial pos
// limpar_dados_para_importacao_oficial.js. Nao faz parte da cadeia de
// migracoes. Roda uma vez, com confirmacao explicita:
//   node database/scripts/importar_cadastro_veiculos_motoristas.js --confirmo
//
// Fonte dos dados: CRLV-e (placa/marca/modelo/ano/eixos) e CNH (nome/CPF/
// numero de registro/validade) de cada conjunto, lidos diretamente dos PDFs
// enviados. Duas divergencias entre nome de pasta/CSV Drivvo e o CRLV real
// foram corrigidas aqui (fonte de verdade = CRLV):
//   pasta "JESSE-TWC9C94"  -> placa real do cavalo e TWA9C94
//   pasta "MAICON-TWJ8C60" -> placa real do cavalo e TWJ8C06
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

if (!process.argv.includes('--confirmo')) {
  console.error('Nada foi cadastrado. Rode com --confirmo no final pra executar de verdade:');
  console.error('  node database/scripts/importar_cadastro_veiculos_motoristas.js --confirmo');
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
const db = new DatabaseSync(DB_PATH);

const VEICULOS = [
  // Conjunto TVP0B82 / TWC0A52 - sem motorista por enquanto
  { placa: 'TVP0B82', tipo: 'Cavalo', qtd_eixos: 3, marca: 'VW', modelo: '28.480 MTM 6X2 HD', ano_fabricacao: 2026 },
  { placa: 'TWC0A52', tipo: 'Carreta', qtd_eixos: 4, marca: 'SR', modelo: 'GUERRA SRFSI 3E1ED', ano_fabricacao: 2026 },
  // Conjunto Jesse Campos Alves
  { placa: 'TWA9C94', tipo: 'Cavalo', qtd_eixos: 3, marca: 'IVECO', modelo: 'S-WAY 480-6X2', ano_fabricacao: 2026 },
  { placa: 'TWG9J05', tipo: 'Carreta', qtd_eixos: 4, marca: 'SR', modelo: 'GUERRASP SRFSI 3E1ED', ano_fabricacao: 2026 },
  // Conjunto Leandro Campos Alves
  { placa: 'TPN8E74', tipo: 'Cavalo', qtd_eixos: 3, marca: 'VW', modelo: '28.480 MTM 6X2 HD', ano_fabricacao: 2025 },
  { placa: 'TWT4B11', tipo: 'Carreta', qtd_eixos: 4, marca: 'SR', modelo: 'GUERRA SRFSI 3E1ED', ano_fabricacao: 2026 },
  // Conjunto Maicon Cunha da Silva
  { placa: 'TWJ8C06', tipo: 'Cavalo', qtd_eixos: 3, marca: 'IVECO', modelo: 'S-WAY 480-6X2', ano_fabricacao: 2026 },
  { placa: 'TWJ8B96', tipo: 'Carreta', qtd_eixos: 4, marca: 'SR', modelo: 'GUERRASP SRFSI 3E1ED', ano_fabricacao: 2026 },
];

const MOTORISTAS = [
  { nome: 'Jesse Campos Alves', cpf: '95648429053', cnh: '00428231661', cnh_validade: '2034-01-29' },
  { nome: 'Leandro Campos Alves', cpf: '60358718015', cnh: '02094251055', cnh_validade: '2033-09-18' },
  { nome: 'Maicon Cunha da Silva', cpf: '08769327904', cnh: '05565666032', cnh_validade: '2034-05-20' },
];

// cavalo/carreta por conjunto + motorista responsavel (null = sem motorista por enquanto)
const CONJUNTOS = [
  { nome: 'TVP0B82 / TWC0A52', cavalo: 'TVP0B82', carreta: 'TWC0A52', motorista: null },
  { nome: 'TWA9C94 / TWG9J05 - Jesse', cavalo: 'TWA9C94', carreta: 'TWG9J05', motorista: 'Jesse Campos Alves' },
  { nome: 'TPN8E74 / TWT4B11 - Leandro', cavalo: 'TPN8E74', carreta: 'TWT4B11', motorista: 'Leandro Campos Alves' },
  { nome: 'TWJ8C06 / TWJ8B96 - Maicon', cavalo: 'TWJ8C06', carreta: 'TWJ8B96', motorista: 'Maicon Cunha da Silva' },
];

const empresa = db.prepare('SELECT id, razao_social FROM empresas LIMIT 1').get();
if (!empresa) {
  console.error('Nenhuma empresa cadastrada no banco - nada a fazer.');
  process.exit(1);
}
const empresaId = empresa.id;
console.log(`Empresa: ${empresa.razao_social} (id ${empresaId})\n`);

db.exec('BEGIN');
try {
  const veiculoIdPorPlaca = {};
  for (const v of VEICULOS) {
    const existente = db.prepare('SELECT id FROM veiculos WHERE placa = ? AND empresa_id = ?').get(v.placa, empresaId);
    if (existente) {
      veiculoIdPorPlaca[v.placa] = existente.id;
      console.log(`veiculo ${v.placa}: ja existe (id ${existente.id}), pulando.`);
      continue;
    }
    const info = db.prepare(`
      INSERT INTO veiculos (empresa_id, placa, tipo, qtd_eixos, marca, modelo, ano_fabricacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, v.placa, v.tipo, v.qtd_eixos, v.marca, v.modelo, v.ano_fabricacao);
    db.prepare('INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, ?, ?, ?)')
      .run(empresaId, 'Veiculo', info.lastInsertRowid, v.placa);
    veiculoIdPorPlaca[v.placa] = info.lastInsertRowid;
    console.log(`veiculo ${v.placa} (${v.tipo}, ${v.marca}/${v.modelo}): cadastrado (id ${info.lastInsertRowid}).`);
  }

  const motoristaIdPorNome = {};
  for (const m of MOTORISTAS) {
    const existente = db.prepare('SELECT id FROM motoristas WHERE cpf = ? AND empresa_id = ?').get(m.cpf, empresaId);
    if (existente) {
      motoristaIdPorNome[m.nome] = existente.id;
      console.log(`motorista ${m.nome}: ja existe (id ${existente.id}), pulando.`);
      continue;
    }
    const info = db.prepare(`
      INSERT INTO motoristas (empresa_id, nome, cpf, cnh, cnh_validade)
      VALUES (?, ?, ?, ?, ?)
    `).run(empresaId, m.nome, m.cpf, m.cnh, m.cnh_validade);
    motoristaIdPorNome[m.nome] = info.lastInsertRowid;
    console.log(`motorista ${m.nome}: cadastrado (id ${info.lastInsertRowid}).`);
  }

  for (const c of CONJUNTOS) {
    const existente = db.prepare(`
      SELECT conjunto_id FROM conjunto_itens WHERE empresa_id = ? AND veiculo_id = ?
      INTERSECT
      SELECT conjunto_id FROM conjunto_itens WHERE empresa_id = ? AND veiculo_id = ?
    `).get(empresaId, veiculoIdPorPlaca[c.cavalo], empresaId, veiculoIdPorPlaca[c.carreta]);
    if (existente) {
      console.log(`conjunto "${c.nome}": ja existe (id ${existente.conjunto_id}), pulando.`);
      continue;
    }
    const infoConjunto = db.prepare('INSERT INTO conjuntos (empresa_id, nome) VALUES (?, ?)').run(empresaId, c.nome);
    const conjuntoId = infoConjunto.lastInsertRowid;
    db.prepare('INSERT INTO conjunto_itens (empresa_id, conjunto_id, veiculo_id, ordem) VALUES (?, ?, ?, 1)')
      .run(empresaId, conjuntoId, veiculoIdPorPlaca[c.cavalo]);
    db.prepare('INSERT INTO conjunto_itens (empresa_id, conjunto_id, veiculo_id, ordem) VALUES (?, ?, ?, 2)')
      .run(empresaId, conjuntoId, veiculoIdPorPlaca[c.carreta]);
    db.prepare('UPDATE veiculos SET carreta_padrao_id = ? WHERE id = ?')
      .run(veiculoIdPorPlaca[c.carreta], veiculoIdPorPlaca[c.cavalo]);
    const motoristaTxt = c.motorista ? `motorista: ${c.motorista} (id ${motoristaIdPorNome[c.motorista]})` : 'sem motorista';
    console.log(`conjunto "${c.nome}": cadastrado (id ${conjuntoId}), ${motoristaTxt}.`);
  }

  db.exec('COMMIT');
  console.log('\nCadastro concluido com sucesso.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\nErro no cadastro, rollback aplicado:', err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
