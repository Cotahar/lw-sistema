// Erro de negocio conhecido (ex.: estoque insuficiente, status invalido para a acao).
// Rotas lancam "throw new ApiError(400, 'mensagem')" e o errorHandler central formata a resposta.
class ApiError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

module.exports = ApiError;
