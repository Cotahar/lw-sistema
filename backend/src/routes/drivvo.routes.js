const express = require('express');
const multer = require('multer');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerAcessoModulo } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { registrarAuditoria } = require('../utils/audit');
const { withTransaction } = require('../utils/transaction');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { parseDrivvoCsv, paraCentavos, paraDataIso, chaveExterna } = require('../utils/drivvoParser');

const router = express.Router();
router.use(exigirEmpresaEspecifica);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function normalizarPlaca(txt) {
  return String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Tenta reconhecer uma placa dentro do "Nome do veiculo" do Drivvo (ex.:
// "TPN-8E74 - Edvaldo") quando a secao Veiculo do arquivo nao trouxer a
// coluna Placa explicita para aquele veiculo.
function extrairPlacaDoNome(nome) {
  const m = String(nome || '').match(/[A-Z]{3}[-\s]?\d[A-Z0-9]\d{2}/i);
  return m ? normalizarPlaca(m[0]) : null;
}

function buscarVeiculoPorNome(nomeVeiculo, mapaPlacasPorNome, empresaId) {
  const placaBruta = mapaPlacasPorNome[nomeVeiculo] || extrairPlacaDoNome(nomeVeiculo);
  if (!placaBruta) return null;
  const placaAlvo = normalizarPlaca(placaBruta);
  const todos = db.prepare('SELECT * FROM veiculos WHERE empresa_id = ?').all(empresaId);
  return todos.find((v) => normalizarPlaca(v.placa) === placaAlvo) || null;
}

// Viagens nao finalizadas daquele veiculo cujo periodo cobre a data do lancamento.
function buscarViagensCandidatas(veiculoId, dataIso, empresaId) {
  return db.prepare(`
    SELECT v.* FROM viagens v
    JOIN conjunto_itens ci ON ci.conjunto_id = v.conjunto_id
    WHERE ci.veiculo_id = ? AND v.status != 'Finalizada' AND v.empresa_id = ?
      AND v.data_inicio <= ?
      AND (v.data_fim IS NULL OR v.data_fim >= ?)
    ORDER BY v.data_inicio DESC
  `).all(veiculoId, empresaId, dataIso, dataIso);
}

function buscarOuCriarCategoria(nome) {
  const nomeLimpo = (nome || '').trim() || 'Outros (Drivvo)';
  const existente = db.prepare('SELECT * FROM categorias_despesa WHERE LOWER(nome) = LOWER(?)').get(nomeLimpo);
  if (existente) return existente;
  const info = db.prepare('INSERT INTO categorias_despesa (nome) VALUES (?)').run(nomeLimpo);
  return db.prepare('SELECT * FROM categorias_despesa WHERE id = ?').get(info.lastInsertRowid);
}

// Espelha o que POST /viagens/:id/despesas faz (centro de custo da tratora +
// Conta a Pagar quando pago_por='Empresa') - o import do Drivvo so lanca
// despesas pagas pela empresa, entao sempre gera a conta a pagar.
function lancarDespesaViagem(viagem, categoria, valorCentavos, dataIso, extras = {}, usuarioId = null, empresaId) {
  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) throw new ApiError(400, `Nao foi possivel resolver o centro de custo da viagem #${viagem.id}.`);

  const info = db.prepare(`
    INSERT INTO despesas_viagem (empresa_id, viagem_id, centro_custo_id, categoria_id, valor, data, pago_por, posto_fornecedor_id, litragem, preco_litro, descricao, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, 'Empresa', ?, ?, ?, ?, ?)
  `).run(empresaId, viagem.id, centroCusto.id, categoria.id, valorCentavos, dataIso, extras.postoFornecedorId || null, extras.litragem || null, extras.precoLitro || null, extras.descricao || null, usuarioId);
  const despesa = db.prepare('SELECT * FROM despesas_viagem WHERE id = ?').get(info.lastInsertRowid);

  db.prepare(`
    INSERT INTO contas_pagar (empresa_id, fornecedor_id, descricao, valor, data_vencimento, status, origem_tipo, origem_id)
    VALUES (?, ?, ?, ?, ?, 'Pendente', 'DespesaViagem', ?)
  `).run(empresaId, extras.postoFornecedorId || null, `${categoria.nome} - viagem #${viagem.id} (Drivvo)`, valorCentavos, dataIso, despesa.id);

  return despesa;
}

function jaImportado(chave, empresaId) {
  return Boolean(db.prepare('SELECT 1 FROM importacoes_drivvo WHERE chave_externa = ? AND empresa_id = ?').get(chave, empresaId));
}

function registrarPendencia({ chave, secao, dadosBrutos, motivo, empresaId }) {
  db.prepare(`
    INSERT INTO importacoes_drivvo (empresa_id, chave_externa, secao, status, dados_brutos, motivo_pendencia)
    VALUES (?, ?, ?, 'PendenteRevisao', ?, ?)
  `).run(empresaId, chave, secao, JSON.stringify(dadosBrutos), motivo);
}

function registrarImportado({ chave, secao, entidadeTipo, entidadeId, dadosBrutos, usuarioId, empresaId }) {
  db.prepare(`
    INSERT INTO importacoes_drivvo (empresa_id, chave_externa, secao, status, entidade_tipo, entidade_id, dados_brutos, resolvido_em, resolvido_por)
    VALUES (?, ?, ?, 'Importado', ?, ?, ?, datetime('now', '-3 hours'), ?)
  `).run(empresaId, chave, secao, entidadeTipo, entidadeId, JSON.stringify(dadosBrutos), usuarioId);
}

router.post('/importar', requerAcessoModulo('viagens', 'Gerenciar'), upload.single('arquivo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Envie o arquivo exportado do Drivvo (.csv).');
  const dados = parseDrivvoCsv(req.file.buffer);
  const empresaId = req.empresaId;

  const mapaPlacasPorNome = {};
  for (const v of dados.veiculos) {
    const nome = v['nome do veiculo'];
    if (nome && v.placa) mapaPlacasPorNome[nome] = v.placa;
  }

  const resumo = {
    abastecimento: { importados: 0, jaExistiam: 0, pendentes: 0 },
    despesa: { importados: 0, jaExistiam: 0, pendentes: 0 },
    receita: { importados: 0, jaExistiam: 0, pendentes: 0 },
  };

  withTransaction(db, () => {
    // ---- Abastecimento: auto-importa quando veiculo + viagem unica e aberta forem encontrados ----
    for (const linha of dados.abastecimentos) {
      const dataIso = paraDataIso(linha.data);
      const chave = chaveExterna('Abastecimento', linha.nome_veiculo, linha.data, linha.valor_total_1, linha.system_date);
      if (jaImportado(chave, empresaId)) { resumo.abastecimento.jaExistiam++; continue; }
      if (!dataIso) { registrarPendencia({ chave, secao: 'Abastecimento', dadosBrutos: linha, motivo: 'Data invalida no arquivo.', empresaId }); resumo.abastecimento.pendentes++; continue; }

      const veiculo = buscarVeiculoPorNome(linha.nome_veiculo, mapaPlacasPorNome, empresaId);
      if (!veiculo) { registrarPendencia({ chave, secao: 'Abastecimento', dadosBrutos: linha, motivo: `Veiculo "${linha.nome_veiculo}" nao encontrado no Frottex.`, empresaId }); resumo.abastecimento.pendentes++; continue; }

      const candidatas = buscarViagensCandidatas(veiculo.id, dataIso, empresaId);
      if (candidatas.length !== 1) {
        registrarPendencia({
          chave, secao: 'Abastecimento', dadosBrutos: { ...linha, veiculo_id: veiculo.id },
          motivo: candidatas.length === 0 ? 'Nenhuma viagem aberta do Frottex cobre esta data para este veiculo.' : 'Mais de uma viagem aberta cobre esta data - escolha manualmente.',
          empresaId,
        });
        resumo.abastecimento.pendentes++;
        continue;
      }

      const viagem = candidatas[0];
      const categoria = buscarOuCriarCategoria('Abastecimento');
      const despesa = lancarDespesaViagem(viagem, categoria, paraCentavos(linha.valor_total_1), dataIso, {
        litragem: parseFloat(linha.volume_1) || null,
        precoLitro: paraCentavos(linha.preco_litro_1) || null,
        descricao: linha.posto || null,
      }, req.usuario.id, empresaId);
      registrarAuditoria({ usuarioId: req.usuario.id, empresaId, tabela: 'despesas_viagem', registroId: despesa.id, acao: 'INSERT', depois: despesa });
      registrarImportado({ chave, secao: 'Abastecimento', entidadeTipo: 'DespesaViagem', entidadeId: despesa.id, dadosBrutos: linha, usuarioId: req.usuario.id, empresaId });
      resumo.abastecimento.importados++;

      // Arla (segundo combustivel) vira uma despesa separada, mesma viagem.
      if (linha.combustivel_2 && paraCentavos(linha.valor_total_2) > 0) {
        const chaveArla = chaveExterna('Abastecimento', linha.nome_veiculo, linha.data, linha.valor_total_2, linha.system_date, 'arla');
        if (!jaImportado(chaveArla, empresaId)) {
          const categoriaArla = buscarOuCriarCategoria(linha.combustivel_2);
          const despesaArla = lancarDespesaViagem(viagem, categoriaArla, paraCentavos(linha.valor_total_2), dataIso, {
            litragem: parseFloat(linha.volume_2) || null,
            descricao: linha.posto || null,
          }, req.usuario.id, empresaId);
          registrarImportado({ chave: chaveArla, secao: 'Abastecimento', entidadeTipo: 'DespesaViagem', entidadeId: despesaArla.id, dadosBrutos: linha, usuarioId: req.usuario.id, empresaId });
        }
      }
    }

    // ---- Despesa: "Adiantamento Salarial" auto-importa; o resto vira pendencia ----
    for (const linha of dados.despesas) {
      const dataIso = paraDataIso(linha.data);
      const chave = chaveExterna('Despesa', linha['nome do veiculo'], linha.data, linha['valor total'], linha['(system date)']);
      if (jaImportado(chave, empresaId)) { resumo.despesa.jaExistiam++; continue; }
      if (!dataIso) { registrarPendencia({ chave, secao: 'Despesa', dadosBrutos: linha, motivo: 'Data invalida no arquivo.', empresaId }); resumo.despesa.pendentes++; continue; }

      const ehAdiantamento = /adiantamento/i.test(linha['tipo de despesa'] || '');
      const veiculo = buscarVeiculoPorNome(linha['nome do veiculo'], mapaPlacasPorNome, empresaId);

      if (!ehAdiantamento) {
        registrarPendencia({
          chave, secao: 'Despesa', dadosBrutos: { ...linha, veiculo_id: veiculo?.id },
          motivo: 'Categoria e forma de pagamento (Empresa/Motorista) precisam de confirmacao manual.',
          empresaId,
        });
        resumo.despesa.pendentes++;
        continue;
      }

      if (!veiculo) { registrarPendencia({ chave, secao: 'Despesa', dadosBrutos: linha, motivo: `Veiculo "${linha['nome do veiculo']}" nao encontrado no Frottex.`, empresaId }); resumo.despesa.pendentes++; continue; }
      const candidatas = buscarViagensCandidatas(veiculo.id, dataIso, empresaId);
      if (candidatas.length !== 1) {
        registrarPendencia({
          chave, secao: 'Despesa', dadosBrutos: { ...linha, veiculo_id: veiculo.id },
          motivo: candidatas.length === 0 ? 'Nenhuma viagem aberta do Frottex cobre esta data para este veiculo.' : 'Mais de uma viagem aberta cobre esta data - escolha manualmente.',
          empresaId,
        });
        resumo.despesa.pendentes++;
        continue;
      }

      const viagem = candidatas[0];
      const info = db.prepare(`
        INSERT INTO viagem_adiantamentos (empresa_id, viagem_id, valor, data, descricao, criado_por)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(empresaId, viagem.id, paraCentavos(linha['valor total']), dataIso, linha.observacao || 'Importado do Drivvo', req.usuario.id);
      registrarAuditoria({ usuarioId: req.usuario.id, empresaId, tabela: 'viagem_adiantamentos', registroId: info.lastInsertRowid, acao: 'INSERT', depois: { viagem_id: viagem.id } });
      registrarImportado({ chave, secao: 'Despesa', entidadeTipo: 'ViagemAdiantamento', entidadeId: info.lastInsertRowid, dadosBrutos: linha, usuarioId: req.usuario.id, empresaId });
      resumo.despesa.importados++;
    }

    // ---- Receita (fretes): sempre fica pendente - falta origem/destino/transportadora estruturados ----
    for (const linha of dados.receitas) {
      const chave = chaveExterna('Receita', linha['nome do veiculo'], linha.data, linha.valor, linha['(system date)']);
      if (jaImportado(chave, empresaId)) { resumo.receita.jaExistiam++; continue; }
      const veiculo = buscarVeiculoPorNome(linha['nome do veiculo'], mapaPlacasPorNome, empresaId);
      registrarPendencia({
        chave, secao: 'Receita', dadosBrutos: { ...linha, veiculo_id: veiculo?.id },
        motivo: 'Frete precisa de origem, destino e transportadora - preencha manualmente.',
        empresaId,
      });
      resumo.receita.pendentes++;
    }
  });

  res.status(201).json(resumo);
}));

router.get('/pendencias', requerAcessoModulo('viagens', 'Visualizar'), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const linhas = db.prepare('SELECT * FROM importacoes_drivvo WHERE status = ? AND empresa_id = ? ORDER BY id DESC').all(status || 'PendenteRevisao', req.empresaId);
  res.json(linhas.map((l) => ({ ...l, dados_brutos: JSON.parse(l.dados_brutos) })));
}));

router.post('/pendencias/:id/resolver', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const { entidade_tipo, entidade_id } = req.body;
  if (!entidade_tipo || !entidade_id) throw new ApiError(400, 'Informe entidade_tipo e entidade_id do registro ja lancado.');
  const pendencia = db.prepare("SELECT * FROM importacoes_drivvo WHERE id = ? AND status = 'PendenteRevisao' AND empresa_id = ?").get(req.params.id, req.empresaId);
  if (!pendencia) throw new ApiError(404, 'Pendencia nao encontrada (ou ja resolvida).');
  db.prepare(`
    UPDATE importacoes_drivvo SET status = 'Importado', entidade_tipo = ?, entidade_id = ?, resolvido_em = datetime('now', '-3 hours'), resolvido_por = ?
    WHERE id = ?
  `).run(entidade_tipo, entidade_id, req.usuario.id, pendencia.id);
  res.json({ ok: true });
}));

router.post('/pendencias/:id/ignorar', requerAcessoModulo('viagens', 'Gerenciar'), asyncHandler(async (req, res) => {
  const pendencia = db.prepare("SELECT * FROM importacoes_drivvo WHERE id = ? AND status = 'PendenteRevisao' AND empresa_id = ?").get(req.params.id, req.empresaId);
  if (!pendencia) throw new ApiError(404, 'Pendencia nao encontrada (ou ja resolvida).');
  db.prepare(`UPDATE importacoes_drivvo SET status = 'Ignorado', resolvido_em = datetime('now', '-3 hours'), resolvido_por = ? WHERE id = ?`).run(req.usuario.id, pendencia.id);
  res.json({ ok: true });
}));

module.exports = router;
