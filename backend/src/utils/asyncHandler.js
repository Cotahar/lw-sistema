// Envolve handlers async para que erros lancados/rejeitados caiam no errorHandler central,
// evitando try/catch repetido em cada rota.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
