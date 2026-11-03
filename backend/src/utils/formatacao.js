// Utilitarios pequenos de numero/texto usados em varias rotas - antes cada arquivo tinha a propria copia
// (somar em 5 arquivos, formatarMoeda em 5).

// Soma ignorando null/undefined (campo opcional vazio conta como zero).
function somar(lista) {
  return lista.reduce((total, valor) => total + (valor || 0), 0);
}

// Centavos -> "R$ 1.234,56" (mensagens de erro, textos de WhatsApp, descricoes).
function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "2026-11-03" ou "2026-11-03 14:20:00" -> "03/11/2026"; vazio -> `vazio`.
function formatarDataBr(iso, vazio = '') {
  if (!iso) return vazio;
  return String(iso).split(' ')[0].split('-').reverse().join('/');
}

module.exports = { somar, formatarMoeda, formatarDataBr };
