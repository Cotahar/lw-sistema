// Escapa texto para montar HTML por template string. Todo dado que veio do banco (nome, descricao,
// observacao, cidade...) e texto, nunca HTML: interpolado cru num innerHTML, um cadastro com
// "<img onerror=...>" rodaria script na tela de quem abrisse a lista (com acesso ao token da sessao).
// Era repetido em 8 arquivos; agora todos usam este.
export function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
