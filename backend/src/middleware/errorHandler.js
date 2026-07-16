const ApiError = require('../utils/ApiError');

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ erro: err.message });
  }

  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ erro: 'Ja existe um registro com esse valor unico (verifique CPF/CNPJ/placa/etc.).' });
  }
  if (err && String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ erro: 'Operacao violaria uma regra de integridade do banco (chave estrangeira ou obrigatoriedade).' });
  }

  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
};
