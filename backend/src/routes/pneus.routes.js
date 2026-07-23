const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { condicaoEmpresa } = require('../utils/empresaScope');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');

const router = express.Router();

function registrarEvento({ empresaId, pneuId, tipoEvento, veiculoId, eixo, lado, kmVeiculo, fornecedorId, custo, observacao, usuarioId }) {
  const info = db.prepare(`
    INSERT INTO pneu_eventos (empresa_id, pneu_id, tipo_evento, veiculo_id, eixo, lado, km_veiculo, fornecedor_id, custo, observacao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(empresaId, pneuId, tipoEvento, veiculoId || null, eixo || null, lado || null, kmVeiculo || null, fornecedorId || null, custo ?? null, observacao || null, usuarioId);
  return db.prepare('SELECT * FROM pneu_eventos WHERE id = ?').get(info.lastInsertRowid);
}

router.get('/', requerAcessoModulo('pneus', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { status, veiculo_id, search } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (status) { condicoes.push('status = ?'); params.push(status); }
  if (veiculo_id) { condicoes.push('veiculo_id = ?'); params.push(veiculo_id); }
  if (search) { condicoes.push('numero_fogo LIKE ?'); params.push(`%${search}%`); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  res.json(db.prepare(`SELECT * FROM pneus ${where} ORDER BY numero_fogo`).all(...params));
}));

router.get('/:id', requerAcessoModulo('pneus', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const pneu = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!pneu) throw new ApiError(404, 'Pneu nao encontrado.');
  res.json(pneu);
}));

router.get('/:id/eventos', requerAcessoModulo('pneus', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const pneu = db.prepare('SELECT id FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!pneu) throw new ApiError(404, 'Pneu nao encontrado.');
  res.json(db.prepare('SELECT * FROM pneu_eventos WHERE pneu_id = ? ORDER BY data DESC, id DESC').all(req.params.id));
}));

// Aquisicao de pneu novo: entra no estoque e gera Conta a Pagar. O custo fica
// "pendente" ate a primeira instalacao, quando finalmente bate no DRE do veiculo.
router.post('/', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { numero_fogo, marca, modelo, medida, custo_unitario, fornecedor_id, data_aquisicao } = req.body;
  if (!numero_fogo || !medida || custo_unitario === undefined) {
    throw new ApiError(400, 'Preencha numero_fogo, medida e custo_unitario.');
  }

  const pneu = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO pneus (empresa_id, numero_fogo, marca, modelo, medida, custo_unitario, status, custo_pendente_dre, fornecedor_id, data_aquisicao)
      VALUES (?, ?, ?, ?, ?, ?, 'Estoque', ?, ?, COALESCE(?, date('now', '-3 hours')))
    `).run(req.empresaId, numero_fogo, marca || null, modelo || null, medida, custo_unitario, custo_unitario, fornecedor_id || null, data_aquisicao || null);
    const novoPneu = db.prepare('SELECT * FROM pneus WHERE id = ?').get(info.lastInsertRowid);

    const evento = registrarEvento({
      empresaId: req.empresaId, pneuId: novoPneu.id, tipoEvento: 'Aquisicao', fornecedorId: fornecedor_id, custo: custo_unitario, usuarioId: req.usuario.id,
    });

    db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
      VALUES (?, ?, ?, ?, date('now', '-3 hours'), 'Pendente', 'PneuEvento', ?)
    `).run(req.empresaId, fornecedor_id || null, `Compra de pneu: ${novoPneu.numero_fogo}`, custo_unitario, evento.id);

    return novoPneu;
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'INSERT', depois: pneu });
  res.status(201).json(pneu);
}));

router.put('/:id', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Pneu nao encontrado.');
  // Apenas dados cadastrais. Status/posicao so mudam pelas acoes dedicadas abaixo.
  const campos = ['numero_fogo', 'marca', 'modelo', 'medida', 'fornecedor_id'];
  const sets = [];
  const valores = [];
  for (const campo of campos) {
    if (req.body[campo] !== undefined) { sets.push(`${campo} = ?`); valores.push(req.body[campo]); }
  }
  if (!sets.length) throw new ApiError(400, 'Nenhum campo valido informado.');
  db.prepare(`UPDATE pneus SET ${sets.join(', ')} WHERE id = ?`).run(...valores, req.params.id);
  const depois = db.prepare('SELECT * FROM pneus WHERE id = ?').get(req.params.id);
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: depois.id, acao: 'UPDATE', antes, depois });
  res.json(depois);
}));

router.post('/:id/instalar', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { veiculo_id, eixo, lado, km_veiculo } = req.body;
  if (!veiculo_id || !eixo || !lado) throw new ApiError(400, 'Preencha veiculo_id, eixo e lado.');
  if (!['Esquerdo', 'Direito'].includes(lado)) throw new ApiError(400, "Lado deve ser 'Esquerdo' ou 'Direito'.");

  let pneuAntes;
  const pneu = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Pneu nao encontrado.');
    if (atual.status !== 'Estoque') throw new ApiError(400, `So e possivel instalar um pneu que esta em Estoque (status atual: ${atual.status}).`);
    const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(veiculo_id, req.empresaId);
    if (!veiculo) throw new ApiError(400, 'Veiculo nao encontrado nesta empresa.');
    pneuAntes = atual;

    // custo_pendente_dre e o que ainda nao foi lancado no DRE de nenhum veiculo:
    // custo de aquisicao na 1a instalacao, ou so o valor da ultima recapagem
    // nas instalacoes seguintes. E consumido (zerado) aqui.
    registrarEvento({
      empresaId: req.empresaId, pneuId: atual.id, tipoEvento: 'Instalacao', veiculoId: veiculo_id, eixo, lado, kmVeiculo: km_veiculo,
      custo: atual.custo_pendente_dre, usuarioId: req.usuario.id,
    });

    db.prepare(`
      UPDATE pneus SET status = 'Instalado', veiculo_id = ?, eixo = ?, lado = ?, custo_pendente_dre = 0 WHERE id = ?
    `).run(veiculo_id, eixo, lado, atual.id);

    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(atual.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'UPDATE', antes: pneuAntes, depois: pneu });
  res.json(pneu);
}));

router.post('/:id/remover', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { km_veiculo, observacao } = req.body;

  let pneuAntes;
  const pneu = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Pneu nao encontrado.');
    if (atual.status !== 'Instalado') throw new ApiError(400, 'So e possivel remover um pneu que esta Instalado.');
    pneuAntes = atual;

    registrarEvento({
      empresaId: req.empresaId, pneuId: atual.id, tipoEvento: 'Remocao', veiculoId: atual.veiculo_id, eixo: atual.eixo, lado: atual.lado,
      kmVeiculo: km_veiculo, observacao, usuarioId: req.usuario.id,
    });

    db.prepare(`UPDATE pneus SET status = 'Estoque', veiculo_id = NULL, eixo = NULL, lado = NULL WHERE id = ?`).run(atual.id);
    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(atual.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'UPDATE', antes: pneuAntes, depois: pneu });
  res.json(pneu);
}));

router.post('/:id/enviar-recapagem', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { fornecedor_id, observacao } = req.body;
  if (!fornecedor_id) throw new ApiError(400, 'Informe a recapadora (fornecedor_id).');

  let pneuAntes;
  const pneu = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Pneu nao encontrado.');
    if (atual.status !== 'Estoque') throw new ApiError(400, 'So e possivel enviar para recapagem um pneu que esta em Estoque.');
    pneuAntes = atual;

    registrarEvento({ empresaId: req.empresaId, pneuId: atual.id, tipoEvento: 'EnvioRecapagem', fornecedorId: fornecedor_id, observacao, usuarioId: req.usuario.id });
    db.prepare(`UPDATE pneus SET status = 'EmRecapagem' WHERE id = ?`).run(atual.id);
    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(atual.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'UPDATE', antes: pneuAntes, depois: pneu });
  res.json(pneu);
}));

// Retorno da recapadora: gera Conta a Pagar so do valor da recapagem (o custo de
// aquisicao original ja foi reconhecido na 1a instalacao) e acumula esse valor em
// custo_pendente_dre, para bater no DRE somente quando o pneu for reinstalado.
router.post('/:id/retornar-recapagem', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { custo, fornecedor_id, observacao } = req.body;
  if (custo === undefined || custo === null) throw new ApiError(400, 'Informe o custo da recapagem.');

  let pneuAntes;
  const pneu = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Pneu nao encontrado.');
    if (atual.status !== 'EmRecapagem') throw new ApiError(400, 'Este pneu nao esta em recapagem.');
    pneuAntes = atual;

    const evento = registrarEvento({
      empresaId: req.empresaId, pneuId: atual.id, tipoEvento: 'RetornoRecapagem', fornecedorId: fornecedor_id, custo, observacao, usuarioId: req.usuario.id,
    });

    db.prepare(`
      UPDATE pneus SET status = 'Estoque', numero_recapagens = numero_recapagens + 1, custo_pendente_dre = custo_pendente_dre + ?
      WHERE id = ?
    `).run(custo, atual.id);

    db.prepare(`
      INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
      VALUES (?, ?, ?, ?, date('now', '-3 hours'), 'Pendente', 'PneuEvento', ?)
    `).run(req.empresaId, fornecedor_id || null, `Recapagem do pneu: ${atual.numero_fogo}`, custo, evento.id);

    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(atual.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'UPDATE', antes: pneuAntes, depois: pneu });
  res.json(pneu);
}));

router.post('/:id/sucatear', requerAcessoModulo('pneus', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { observacao } = req.body;

  let pneuAntes;
  const pneu = withTransaction(db, () => {
    const atual = db.prepare('SELECT * FROM pneus WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
    if (!atual) throw new ApiError(404, 'Pneu nao encontrado.');
    if (!['Estoque', 'Instalado'].includes(atual.status)) throw new ApiError(400, `Nao e possivel sucatear um pneu com status ${atual.status}.`);
    pneuAntes = atual;

    registrarEvento({
      empresaId: req.empresaId, pneuId: atual.id, tipoEvento: 'Sucateamento', veiculoId: atual.veiculo_id, eixo: atual.eixo, lado: atual.lado,
      observacao, usuarioId: req.usuario.id,
    });

    db.prepare(`UPDATE pneus SET status = 'Sucata', veiculo_id = NULL, eixo = NULL, lado = NULL WHERE id = ?`).run(atual.id);
    return db.prepare('SELECT * FROM pneus WHERE id = ?').get(atual.id);
  });

  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'pneus', registroId: pneu.id, acao: 'UPDATE', antes: pneuAntes, depois: pneu });
  res.json(pneu);
}));

module.exports = router;
