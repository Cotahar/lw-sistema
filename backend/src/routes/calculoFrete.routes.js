const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Preferencias da calculadora de frete: por usuario (nao por empresa - e uma
// ferramenta de apoio pessoal, sem persistencia de dados de negocio), sem
// historico, so o ultimo calculo feito.
router.get('/', asyncHandler(async (req, res) => {
  const prefs = db.prepare('SELECT * FROM calculo_frete_preferencias WHERE usuario_id = ?').get(req.usuario.id);
  res.json(prefs || null);
}));

router.put('/', asyncHandler(async (req, res) => {
  const { peso, valor_tonelada, frete_total, valor_diesel, media, km, pedagio, descarga, comissao_pct } = req.body;
  db.prepare(`
    INSERT INTO calculo_frete_preferencias (usuario_id, peso, valor_tonelada, frete_total, valor_diesel, media, km, pedagio, descarga, comissao_pct, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 hours'))
    ON CONFLICT (usuario_id) DO UPDATE SET
      peso = excluded.peso, valor_tonelada = excluded.valor_tonelada, frete_total = excluded.frete_total,
      valor_diesel = excluded.valor_diesel, media = excluded.media, km = excluded.km,
      pedagio = excluded.pedagio, descarga = excluded.descarga, comissao_pct = excluded.comissao_pct,
      atualizado_em = excluded.atualizado_em
  `).run(
    req.usuario.id, peso ?? null, valor_tonelada ?? null, frete_total ?? null, valor_diesel ?? null,
    media ?? null, km ?? null, pedagio ?? null, descarga ?? null, comissao_pct ?? null,
  );
  res.status(204).send();
}));

module.exports = router;
