const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { verificarAlertasDoVeiculo } = require('../utils/alertaEngine');

const router = express.Router();
const TIPOS = ['Cavalo', 'Carreta', 'Dolly', 'Truck', 'Toco'];

function validarCarretaPadrao(tipo, carretaPadraoId, empresaId) {
  if (carretaPadraoId === undefined || carretaPadraoId === null) return;
  if (tipo !== 'Cavalo') throw new ApiError(400, 'Carreta padrao so pode ser definida para veiculos do tipo Cavalo.');
  const carreta = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(carretaPadraoId, empresaId);
  if (!carreta) throw new ApiError(400, 'Carreta padrao informada nao existe.');
  if (carreta.tipo !== 'Carreta') throw new ApiError(400, 'Carreta padrao deve ser um veiculo do tipo Carreta.');
}

router.get('/', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { search, tipo } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (search) { condicoes.push('(placa LIKE ? OR marca LIKE ? OR modelo LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (tipo) { condicoes.push('tipo = ?'); params.push(tipo); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM veiculos ${where} ORDER BY placa`).all(...params));
}));

router.get('/:id', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  res.json(veiculo);
}));

router.post('/', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { placa, tipo, qtd_eixos, marca, modelo, ano_fabricacao, carreta_padrao_id, hodometro_atual } = req.body;
  if (!placa || !tipo || !qtd_eixos) throw new ApiError(400, 'Preencha placa, tipo e quantidade de eixos.');
  if (!TIPOS.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS.join(', ')}`);
  validarCarretaPadrao(tipo, carreta_padrao_id, req.empresaId);

  const veiculo = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO veiculos (empresa_id, placa, tipo, qtd_eixos, marca, modelo, ano_fabricacao, carreta_padrao_id, hodometro_atual)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, placa.toUpperCase(), tipo, qtd_eixos, marca || null, modelo || null, ano_fabricacao || null, carreta_padrao_id || null, hodometro_atual || 0);
    // Todo veiculo e, por si so, um centro de custo (usado por despesas, OS, DRE...).
    db.prepare('INSERT INTO centros_custo (empresa_id, tipo, veiculo_id, nome) VALUES (?, ?, ?, ?)')
      .run(req.empresaId, 'Veiculo', info.lastInsertRowid, placa.toUpperCase());
    return db.prepare('SELECT * FROM veiculos WHERE id = ?').get(info.lastInsertRowid);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: veiculo.id, acao: 'INSERT', depois: veiculo });
  res.status(201).json(veiculo);
}));

router.put('/:id', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Veiculo nao encontrado.');

  const tipo = req.body.tipo !== undefined ? req.body.tipo : antes.tipo;
  if (req.body.tipo !== undefined && !TIPOS.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS.join(', ')}`);
  const carretaPadraoId = req.body.carreta_padrao_id !== undefined ? req.body.carreta_padrao_id : antes.carreta_padrao_id;
  validarCarretaPadrao(tipo, carretaPadraoId, req.empresaId);

  const campos = { placa: 'placa', tipo: 'tipo', qtd_eixos: 'qtd_eixos', marca: 'marca', modelo: 'modelo', ano_fabricacao: 'ano_fabricacao', carreta_padrao_id: 'carreta_padrao_id', ativo: 'ativo' };
  const sets = [];
  const valores = [];
  for (const [campo, coluna] of Object.entries(campos)) {
    if (req.body[campo] !== undefined) {
      sets.push(`${coluna} = ?`);
      valores.push(campo === 'placa' ? String(req.body[campo]).toUpperCase() : req.body[campo]);
    }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE veiculos SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  if (req.body.placa !== undefined) {
    db.prepare('UPDATE centros_custo SET nome = ? WHERE veiculo_id = ?').run(String(req.body.placa).toUpperCase(), req.params.id);
  }

  const depois = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.delete('/:id', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Veiculo nao encontrado.');
  db.prepare('DELETE FROM veiculos WHERE id = ?').run(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// Historico de hodometro e ajuste manual (fallback quando a telemetria Onixsat falha).
router.get('/:id/hodometro', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const eventos = db.prepare('SELECT * FROM hodometro_eventos WHERE veiculo_id = ? ORDER BY data_hora DESC').all(req.params.id);
  res.json(eventos);
}));

router.post('/:id/hodometro', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const { km, observacao } = req.body;
  if (km === undefined || km === null) throw new ApiError(400, 'Informe o km.');
  if (km < veiculo.hodometro_atual) throw new ApiError(400, `O km informado (${km}) e menor que o hodometro atual (${veiculo.hodometro_atual}).`);

  const evento = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO hodometro_eventos (empresa_id, veiculo_id, km, origem, usuario_id, observacao)
      VALUES (?, ?, ?, 'Manual', ?, ?)
    `).run(req.empresaId, veiculo.id, km, req.usuario.id, observacao || null);
    db.prepare('UPDATE veiculos SET hodometro_atual = ? WHERE id = ?').run(km, veiculo.id);
    return db.prepare('SELECT * FROM hodometro_eventos WHERE id = ?').get(info.lastInsertRowid);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: veiculo.id, acao: 'UPDATE', antes: { hodometro_atual: veiculo.hodometro_atual }, depois: { hodometro_atual: km } });
  const alertasDisparados = verificarAlertasDoVeiculo(veiculo.id);
  res.status(201).json({ ...evento, alertasDisparados });
}));

// Localizacao: mesmo fallback manual do hodometro (arquitetura pronta para a
// integracao real com a Onixsat, que preencheria origem='Onixsat' e lat/lng).
router.get('/:id/localizacao', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const eventos = db.prepare('SELECT * FROM localizacao_eventos WHERE veiculo_id = ? ORDER BY data_hora DESC').all(req.params.id);
  res.json(eventos);
}));

router.post('/:id/localizacao', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const { cidade, uf, observacao } = req.body;
  if (!cidade || !uf) throw new ApiError(400, 'Informe cidade e uf.');

  const evento = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO localizacao_eventos (empresa_id, veiculo_id, cidade, uf, origem, usuario_id, observacao)
      VALUES (?, ?, ?, ?, 'Manual', ?, ?)
    `).run(req.empresaId, veiculo.id, cidade, uf.toUpperCase(), req.usuario.id, observacao || null);
    db.prepare(`
      UPDATE veiculos SET localizacao_cidade = ?, localizacao_uf = ?, localizacao_atualizado_em = datetime('now', '-3 hours') WHERE id = ?
    `).run(cidade, uf.toUpperCase(), veiculo.id);
    return db.prepare('SELECT * FROM localizacao_eventos WHERE id = ?').get(info.lastInsertRowid);
  });

  registrarAuditoria({
    usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: veiculo.id, acao: 'UPDATE',
    antes: { localizacao_cidade: veiculo.localizacao_cidade, localizacao_uf: veiculo.localizacao_uf },
    depois: { localizacao_cidade: cidade, localizacao_uf: uf.toUpperCase() },
  });
  res.status(201).json(evento);
}));

module.exports = router;
