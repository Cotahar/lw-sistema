// Ponte entre uma tela de relatorio (Saldos em Aberto, Relatorio de
// Despesas, etc.) e a pagina generica de impressao (pages/relatorios/
// imprimir.js): a tela monta o payload (titulo, filtros ativos em texto,
// cards de resumo, tabela(s) ja formatadas como texto) e abre a pagina de
// impressao numa aba nova. sessionStorage (nao localStorage) porque e um
// dado de uso unico desta sessao de impressao, nao algo que deva persistir
// entre sessoes do navegador; abas abertas via window.open a partir da
// mesma origem recebem uma copia do sessionStorage do momento da abertura,
// e a pagina de impressao le e nao depende de mais nada do servidor.
const CHAVE = 'frottex-relatorio-impressao';

export function abrirRelatorioImpressao(payload) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(payload));
  } catch {
    // Payload grande demais pro sessionStorage (bem raro) - sem isso a
    // pagina de impressao abriria em branco sem nenhuma pista do porque.
    window.alert('Nao foi possivel preparar a impressao (relatorio grande demais). Tente filtrar mais.');
    return;
  }
  window.open(`${window.location.pathname}#/relatorios/imprimir`, '_blank');
}

export function lerRelatorioImpressao() {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}
