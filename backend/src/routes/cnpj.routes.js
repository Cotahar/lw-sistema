const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// Consulta publica de CNPJ (BrasilAPI, gratuita, sem chave) para preencher
// automaticamente os cadastros que tem campo de CNPJ (empresas, fornecedores).
// Proxied pelo backend para nao expor a chamada direto do navegador e para
// poder trocar de provedor no futuro sem mexer no frontend.
router.get('/:cnpj', asyncHandler(async (req, res) => {
  const digitos = String(req.params.cnpj).replace(/\D/g, '');
  if (digitos.length !== 14) throw new ApiError(400, 'CNPJ invalido - informe os 14 digitos.');

  let resposta;
  try {
    // BrasilAPI (Cloudflare) devolve 403 para requisicoes sem User-Agent.
    resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`, {
      headers: { 'User-Agent': 'Frotista/1.0 (sistema interno de gestao de frota)' },
    });
  } catch {
    throw new ApiError(502, 'Falha ao consultar a BrasilAPI. Preencha manualmente.');
  }
  if (resposta.status === 404) throw new ApiError(404, 'CNPJ nao encontrado na Receita Federal.');
  if (!resposta.ok) throw new ApiError(502, 'BrasilAPI indisponivel no momento. Preencha manualmente.');

  const dados = await resposta.json();
  res.json({
    razao_social: dados.razao_social || '',
    nome_fantasia: dados.nome_fantasia || '',
    endereco_logradouro: [dados.descricao_tipo_de_logradouro, dados.logradouro].filter(Boolean).join(' ').trim(),
    endereco_numero: dados.numero || '',
    endereco_complemento: dados.complemento || '',
    endereco_bairro: dados.bairro || '',
    endereco_cidade: dados.municipio || '',
    endereco_uf: dados.uf || '',
    endereco_cep: dados.cep || '',
    telefone: dados.ddd_telefone_1 || '',
    email: dados.email || '',
  });
}));

module.exports = router;
