const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { requerMotorista } = require('../middleware/auth');
const { exigirEmpresaEspecifica } = require('../middleware/empresa');
const { buscarUnidadeTratora, buscarCentroCustoDoVeiculo } = require('../utils/conjuntoHelper');
const { criarDespesaViagem } = require('../utils/despesaViagemHelper');

const router = express.Router();
router.use(requerMotorista, exigirEmpresaEspecifica);

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'), 'abastecimentos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // o frontend ja comprime antes de enviar; isto e so um limite de seguranca
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

function buscarViagemAtualDoMotorista(motoristaId, empresaId) {
  return db.prepare(`
    SELECT * FROM viagens WHERE motorista_id = ? AND empresa_id = ? AND status = 'EmAndamento'
    ORDER BY data_inicio DESC LIMIT 1
  `).get(motoristaId, empresaId);
}

// Painel do motorista: dados basicos da viagem em andamento dele - so o
// necessario pro app mobile (placa/localizacao/hodometro), sem os numeros
// financeiros completos que a tela de Viagem do escritorio mostra.
router.get('/viagem-atual', asyncHandler(async (req, res) => {
  const viagem = buscarViagemAtualDoMotorista(req.usuario.motorista_id, req.empresaId);
  if (!viagem) return res.json({ viagem: null });

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const conjunto = db.prepare(`
    SELECT v.placa FROM conjunto_itens ci JOIN veiculos v ON v.id = ci.veiculo_id
    WHERE ci.conjunto_id = ? ORDER BY ci.ordem
  `).all(viagem.conjunto_id);

  res.json({
    viagem: {
      id: viagem.id,
      data_inicio: viagem.data_inicio,
      status: viagem.status,
      placas: conjunto.map((c) => c.placa),
      hodometro_atual: tratora ? tratora.hodometro_atual : null,
      localizacao_cidade: tratora ? tratora.localizacao_cidade : null,
      localizacao_uf: tratora ? tratora.localizacao_uf : null,
      localizacao_atualizado_em: tratora ? tratora.localizacao_atualizado_em : null,
    },
  });
}));

// Lancamento de abastecimento pelo app do motorista - sempre pago_por
// 'Empresa', categoria fixa 'Abastecimento', viagem sempre resolvida aqui
// (nunca recebida do cliente: importante pro fluxo offline, ver
// frontend/js/pages/motorista/offlineQueue.js - um item da fila nao fica
// "preso" a uma viagem que ja fechou enquanto o motorista estava sem sinal).
router.post('/abastecimentos', upload.single('foto'), asyncHandler(async (req, res) => {
  const { valor, data, preco_litro, litragem, km_abastecimento, posto_fornecedor_id, idempotency_key } = req.body;
  if (!idempotency_key) throw new ApiError(400, 'idempotency_key obrigatoria.');
  if (valor === undefined || Number(valor) <= 0) throw new ApiError(400, 'Informe o valor do abastecimento.');

  // Reenvio de sincronizacao offline (mesma chave): devolve o que ja foi
  // lancado em vez de duplicar - essencial pra retry apos resposta perdida.
  const existente = db.prepare('SELECT * FROM despesas_viagem WHERE idempotency_key = ?').get(idempotency_key);
  if (existente) return res.status(200).json(existente);

  const viagem = buscarViagemAtualDoMotorista(req.usuario.motorista_id, req.empresaId);
  if (!viagem) throw new ApiError(400, 'Nenhuma viagem em andamento no momento - fale com o escritorio.');

  const tratora = buscarUnidadeTratora(viagem.conjunto_id);
  const centroCusto = tratora ? buscarCentroCustoDoVeiculo(tratora.id) : null;
  if (!centroCusto) throw new ApiError(400, 'Nao foi possivel resolver o centro de custo da viagem.');

  const categoriaAbastecimento = db.prepare("SELECT id FROM categorias_despesa WHERE lower(trim(nome)) = 'abastecimento'").get();
  if (!categoriaAbastecimento) throw new ApiError(400, 'Categoria "Abastecimento" nao encontrada no cadastro.');

  const ultimoFrete = db.prepare('SELECT id FROM fretes WHERE viagem_id = ? ORDER BY id DESC LIMIT 1').get(viagem.id);
  const freteId = ultimoFrete ? ultimoFrete.id : null;

  const despesa = criarDespesaViagem({
    empresaId: req.empresaId, viagem, freteId, centroCustoId: centroCusto.id, categoriaId: categoriaAbastecimento.id,
    valor: Number(valor), data: data || null, pagoPor: 'Empresa', postoFornecedorId: posto_fornecedor_id || null,
    precoLitro: preco_litro ? Number(preco_litro) : null, litragem: litragem ? Number(litragem) : null,
    kmAbastecimento: km_abastecimento ? Number(km_abastecimento) : null, usuarioId: req.usuario.id,
    fotoRecibo: req.file ? req.file.filename : null, idempotencyKey: idempotency_key,
  });
  res.status(201).json(despesa);
}));

module.exports = router;
