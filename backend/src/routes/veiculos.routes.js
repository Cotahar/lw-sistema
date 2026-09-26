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

// A tela de cadastro (form de edicao do Cavalo) precisa mostrar a PLACA da
// carreta padrao ja salva, nao so o id cru guardado em carreta_padrao_id -
// sem isso o campo de busca aparecia vazio toda vez que o cadastro era
// reaberto (o valor continuava certo por baixo - "salva mas nao aparece o
// registro salvo antes"). Busca em lote (1 query) em vez de por linha pra
// nao virar N+1 numa lista com varios Cavalos.
function comCarretaPadraoPlaca(veiculos, empresaId) {
  const ids = [...new Set(veiculos.map((v) => v.carreta_padrao_id).filter(Boolean))];
  const placaPorId = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`SELECT id, placa FROM veiculos WHERE id IN (${placeholders}) AND empresa_id = ?`).all(...ids, empresaId)
      .forEach((c) => { placaPorId[c.id] = c.placa; });
  }
  return veiculos.map((v) => ({ ...v, carreta_padrao_placa: v.carreta_padrao_id ? placaPorId[v.carreta_padrao_id] || null : null }));
}

router.get('/', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { search, tipo } = req.query;
  const condicoes = [];
  const params = [];
  condicaoEmpresa(condicoes, params, req);
  if (search) { condicoes.push('(placa LIKE ? OR marca LIKE ? OR modelo LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (tipo) { condicoes.push('tipo = ?'); params.push(tipo); }
  const where = `WHERE ${condicoes.join(' AND ')}`;
  const veiculos = db.prepare(`SELECT * FROM veiculos ${where} ORDER BY placa`).all(...params);
  res.json(comCarretaPadraoPlaca(veiculos, req.empresaId));
}));

router.get('/:id', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  res.json(comCarretaPadraoPlaca([veiculo], req.empresaId)[0]);
}));

router.post('/', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { placa, tipo, qtd_eixos, marca, modelo, ano_fabricacao, carreta_padrao_id, hodometro_atual, tipo_tracao } = req.body;
  if (!placa || !tipo || !qtd_eixos) throw new ApiError(400, 'Preencha placa, tipo e quantidade de eixos.');
  if (!TIPOS.includes(tipo)) throw new ApiError(400, `Tipo invalido. Use um de: ${TIPOS.join(', ')}`);
  validarCarretaPadrao(tipo, carreta_padrao_id, req.empresaId);

  const veiculo = withTransaction(db, () => {
    const info = db.prepare(`
      INSERT INTO veiculos (empresa_id, placa, tipo, qtd_eixos, marca, modelo, ano_fabricacao, carreta_padrao_id, hodometro_atual, tipo_tracao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.empresaId, placa.toUpperCase(), tipo, qtd_eixos, marca ? marca.toUpperCase() : null, modelo ? modelo.toUpperCase() : null, ano_fabricacao || null, carreta_padrao_id || null, hodometro_atual || 0, tipo === 'Cavalo' ? tipo_tracao || null : null);
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

  const campos = { placa: 'placa', tipo: 'tipo', qtd_eixos: 'qtd_eixos', marca: 'marca', modelo: 'modelo', ano_fabricacao: 'ano_fabricacao', carreta_padrao_id: 'carreta_padrao_id', ativo: 'ativo', tipo_tracao: 'tipo_tracao' };
  const sets = [];
  const valores = [];
  const camposTexto = ['placa', 'marca', 'modelo'];
  for (const [campo, coluna] of Object.entries(campos)) {
    if (req.body[campo] !== undefined) {
      sets.push(`${coluna} = ?`);
      valores.push(camposTexto.includes(campo) && req.body[campo] ? String(req.body[campo]).toUpperCase() : req.body[campo]);
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

// Propaga a carreta padrao (recem-salva no cadastro do Cavalo) pras
// composicoes existentes que usam esse Cavalo - so quando o usuario confirma
// explicitamente (o frontend pergunta depois de salvar o cadastro, ver
// veiculos.js). So troca em composicoes com EXATAMENTE uma Carreta: com zero
// ou mais de uma, nao ha como adivinhar qual trocar, entao a composicao e
// pulada (contada em "ignoradas").
router.post('/:id/sincronizar-carreta-composicoes', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const cavalo = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!cavalo) throw new ApiError(404, 'Veiculo nao encontrado.');
  if (cavalo.tipo !== 'Cavalo' || !cavalo.carreta_padrao_id) {
    throw new ApiError(400, 'Este veiculo nao tem uma carreta padrao definida.');
  }

  const conjuntosDoCavalo = db.prepare(`
    SELECT DISTINCT ci.conjunto_id FROM conjunto_itens ci
    JOIN conjuntos c ON c.id = ci.conjunto_id
    WHERE ci.veiculo_id = ? AND c.empresa_id = ?
  `).all(req.params.id, req.empresaId).map((r) => r.conjunto_id);

  let atualizados = 0;
  let ignorados = 0;
  withTransaction(db, () => {
    for (const conjuntoId of conjuntosDoCavalo) {
      const carretasDoConjunto = db.prepare(`
        SELECT ci.id AS item_id, v.id AS veiculo_id FROM conjunto_itens ci
        JOIN veiculos v ON v.id = ci.veiculo_id
        WHERE ci.conjunto_id = ? AND v.tipo = 'Carreta'
      `).all(conjuntoId);
      if (carretasDoConjunto.length !== 1) { ignorados++; continue; }
      if (carretasDoConjunto[0].veiculo_id === cavalo.carreta_padrao_id) continue; // ja esta igual, nada a fazer
      db.prepare('UPDATE conjunto_itens SET veiculo_id = ? WHERE id = ?').run(cavalo.carreta_padrao_id, carretasDoConjunto[0].item_id);
      atualizados++;
    }
  });

  res.json({ atualizados, ignorados });
}));

// Todo veiculo ganha um centro_custo automatico no POST (ver acima) - o DELETE
// precisa desfazer isso na mesma ordem inversa, senao a FK de centros_custo
// bloqueia ate a exclusao de um veiculo novo, nunca usado (bug encontrado ao
// escrever o teste do batch-delete abaixo). Um veiculo com despesas/OS/
// financiamentos de verdade continua protegido: nesse caso e o proprio
// DELETE FROM centros_custo que falha (FK de quem referencia o centro de
// custo), entao a exclusao ainda e bloqueada onde deveria.
router.delete('/:id', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const antes = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!antes) throw new ApiError(404, 'Veiculo nao encontrado.');
  withTransaction(db, () => {
    db.prepare('DELETE FROM centros_custo WHERE veiculo_id = ?').run(req.params.id);
    db.prepare('DELETE FROM veiculos WHERE id = ?').run(req.params.id);
  });
  registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: antes.id, acao: 'DELETE', antes });
  res.status(204).send();
}));

// Rota ja era chamada pelo frontend (tela de veiculos tem selecao em lote) mas
// nunca existiu no backend - toda exclusao em lote de veiculo dava 404 silencioso.
router.post('/batch-delete', requerAcessoModulo('veiculos', 'Gerenciar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'Informe a lista de ids a excluir.');
  withTransaction(db, () => {
    for (const id of ids) {
      const antes = db.prepare('SELECT * FROM veiculos WHERE id = ? AND empresa_id = ?').get(id, req.empresaId);
      if (!antes) continue;
      db.prepare('DELETE FROM centros_custo WHERE veiculo_id = ?').run(id);
      db.prepare('DELETE FROM veiculos WHERE id = ?').run(id);
      registrarAuditoria({ usuarioId: req.usuario.id, empresaId: req.empresaId, tabela: 'veiculos', registroId: id, acao: 'DELETE', antes });
    }
  });
  res.status(204).send();
}));

// Motorista vinculado a este veiculo NUMA data especifica (regra do dominio:
// so um motorista por placa a cada periodo, via a viagem cujo periodo cobre
// aquela data) - usado como sugestao inteligente em "Indicar condutor" da
// multa, nunca como filtro rigido (o operador sempre pode escolher outro).
router.get('/:id/motorista-do-periodo', requerAcessoModulo('veiculos', 'Visualizar'), exigirEmpresaEspecifica, asyncHandler(async (req, res) => {
  const { data } = req.query;
  if (!data) throw new ApiError(400, 'Informe a data.');
  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ? AND empresa_id = ?').get(req.params.id, req.empresaId);
  if (!veiculo) throw new ApiError(404, 'Veiculo nao encontrado.');
  const viagem = db.prepare(`
    SELECT vg.motorista_id, m.nome AS motorista_nome
    FROM viagens vg
    JOIN conjunto_itens ci ON ci.conjunto_id = vg.conjunto_id
    JOIN motoristas m ON m.id = vg.motorista_id
    WHERE ci.veiculo_id = ? AND vg.data_inicio <= ? AND (vg.data_fim IS NULL OR vg.data_fim >= ?)
    ORDER BY vg.data_inicio DESC LIMIT 1
  `).get(req.params.id, data, data);
  res.json(viagem ? { motorista_id: viagem.motorista_id, motorista_nome: viagem.motorista_nome } : null);
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
    `).run(req.empresaId, veiculo.id, cidade.toUpperCase(), uf.toUpperCase(), req.usuario.id, observacao ? observacao.toUpperCase() : null);
    // Lancamento manual so tem cidade/UF (nao tem como o usuario digitar
    // coordenadas exatas) - zera lat/lng pra nao deixar um par de coordenadas
    // antigo (de uma sincronizacao Onixsat anterior) associado a uma cidade
    // diferente da que acabou de ser informada.
    db.prepare(`
      UPDATE veiculos SET localizacao_cidade = ?, localizacao_uf = ?, localizacao_lat = NULL, localizacao_lng = NULL, localizacao_atualizado_em = datetime('now', '-3 hours') WHERE id = ?
    `).run(cidade.toUpperCase(), uf.toUpperCase(), veiculo.id);
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
