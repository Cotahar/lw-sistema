const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { after } = require('node:test');
const request = require('supertest');

// Banco de teste isolado, nunca o de desenvolvimento/producao: cada arquivo
// de teste roda em processo proprio (comportamento padrao do `node --test`,
// um processo por arquivo), entao definir isso aqui - antes de qualquer
// require de ../src/app - garante um banco novo e vazio por arquivo.
process.env.DB_PATH = path.join(os.tmpdir(), `frottex-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.ADMIN_EMAIL = 'admin@teste.local';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_SENHA = 'admin123';

const app = require('../src/app');
const db = require('../src/config/db');

// Banco de teste e so um arquivo temporario - apaga ao final deste arquivo
// de teste (node --test roda cada arquivo em processo proprio) pra nao
// acumular lixo no diretorio temp da maquina.
after(() => {
  // No Windows um arquivo aberto nao pode ser apagado - fecha a conexao
  // primeiro (Unix apagaria mesmo com o arquivo aberto, mas fechar antes
  // funciona nos dois).
  try { db.close(); } catch { /* ja pode estar fechado */ }
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch { /* ja pode ter sido removido */ }
});

async function login(username = process.env.ADMIN_USERNAME, senha = process.env.ADMIN_SENHA) {
  const res = await request(app).post('/api/auth/login').send({ username, senha });
  if (res.status !== 200) throw new Error(`Login falhou no teste: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// Wrapper fino sobre supertest que ja injeta Authorization + X-Empresa-Id em
// toda chamada - as rotas de negocio exigem os dois, e repetir isso em cada
// teste polui o que o teste esta de fato verificando.
function api(token, empresaId) {
  const comHeaders = (req) => {
    req = req.set('Authorization', `Bearer ${token}`);
    if (empresaId !== undefined) req = req.set('X-Empresa-Id', String(empresaId));
    return req;
  };
  return {
    get: (url) => comHeaders(request(app).get(url)),
    post: (url) => comHeaders(request(app).post(url)),
    put: (url) => comHeaders(request(app).put(url)),
    delete: (url) => comHeaders(request(app).delete(url)),
  };
}

let contadorCnpj = 0;
function criarEmpresa({ razao_social = 'Empresa Teste LTDA' } = {}) {
  contadorCnpj += 1;
  const cnpj = String(10000000000000 + contadorCnpj + Date.now() % 100000);
  return db.prepare('INSERT INTO empresas (razao_social, cnpj) VALUES (?, ?)').run(razao_social, cnpj).lastInsertRowid;
}

function criarFornecedorTipo(nome = 'Posto') {
  const existente = db.prepare('SELECT id FROM fornecedor_tipos WHERE nome = ?').get(nome);
  if (existente) return existente.id;
  return db.prepare('INSERT INTO fornecedor_tipos (nome) VALUES (?)').run(nome).lastInsertRowid;
}

function criarFornecedor(empresaId, { nome = 'Fornecedor Teste', tipo_id } = {}) {
  const tipoId = tipo_id || criarFornecedorTipo();
  return db.prepare('INSERT INTO fornecedores (empresa_id, nome, tipo_id) VALUES (?, ?, ?)').run(empresaId, nome, tipoId).lastInsertRowid;
}

function criarContaBancaria(empresaId, { nome = 'Conta Teste', saldo_atual = 100000000 } = {}) {
  return db.prepare('INSERT INTO contas_bancarias (empresa_id, nome, saldo_atual) VALUES (?, ?, ?)').run(empresaId, nome, saldo_atual).lastInsertRowid;
}

function saldoContaBancaria(id) {
  return db.prepare('SELECT saldo_atual FROM contas_bancarias WHERE id = ?').get(id).saldo_atual;
}

let contadorPlaca = 0;
function criarVeiculo(empresaId, { placa, tipo = 'Truck', qtd_eixos = 2 } = {}) {
  contadorPlaca += 1;
  const placaFinal = placa || `TST${1000 + contadorPlaca}`;
  const info = db.prepare('INSERT INTO veiculos (empresa_id, placa, tipo, qtd_eixos) VALUES (?, ?, ?, ?)').run(empresaId, placaFinal, tipo, qtd_eixos);
  db.prepare('INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, ?, ?, ?)').run(empresaId, 'Veiculo', info.lastInsertRowid, placaFinal);
  return info.lastInsertRowid;
}

module.exports = {
  app, db, login, api,
  criarEmpresa, criarFornecedor, criarFornecedorTipo, criarContaBancaria, saldoContaBancaria, criarVeiculo,
};
