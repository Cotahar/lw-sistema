import { get, getUsuario, getEmpresaAtiva } from '../../api.js';

// Modo sem internet do app do motorista: cada tela guarda a ULTIMA resposta que o servidor deu (com data e hora) no
// proprio aparelho. Sem sinal, a tela abre com esses dados e uma faixa "Sem internet - dados de dd/mm as hh:mm"; quando o
// sinal volta, a tela busca de novo e grava como a mais recente. Guarda DADOS (nao a pagina pronta): a tela e redesenhada
// com o mesmo codigo de sempre, entao botoes e navegacao continuam funcionando.
//
// Escopo: so GET do perfil Motorista, separado por usuario e empresa (celular emprestado nao mistura dados) e apagado em
// limparSessao() (api.js - "Sair" ou sessao expirada). Lancar abastecimento sem sinal e outra coisa: fila em
// offlineQueue.js (IndexedDB), nao mexida aqui.
const PREFIXO = 'frottex-motorista-cache:';
const INTERVALO_PRECARGA_MS = 10 * 60 * 1000;
let ultimaPrecarga = 0;

function chaveDe(path) {
  const usuario = getUsuario();
  return `${PREFIXO}${usuario ? usuario.id : 0}:${getEmpresaAtiva() || ''}:${path}`;
}

export function lerDoCache(path) {
  try {
    const bruto = localStorage.getItem(chaveDe(path));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

export function guardarNoCache(path, dados) {
  try {
    localStorage.setItem(chaveDe(path), JSON.stringify({ dados, salvoEm: Date.now() }));
  } catch {
    // Sem espaco/localStorage bloqueado (modo privado): o cache e uma conveniencia, nunca pode quebrar a tela.
  }
}

// Falha de REDE (sem sinal, timeout, servidor reiniciando) - diferente de uma resposta de erro do servidor (4xx/500),
// que continua aparecendo como erro. TypeError de fetch tem mensagens diferentes por navegador.
export function falhaDeRede(err) {
  if (err && typeof err.status === 'number') return [502, 503, 504].includes(err.status);
  return err instanceof TypeError && /fetch|network|load failed|conex|tempo esgotado/i.test(String(err.message));
}

// Busca no servidor; se a rede falhar (ou nao houver sinal), devolve o ultimo valor guardado. Sem nada guardado, repassa o erro.
export async function getComCache(path, { timeoutMs = 10000 } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const guardado = lerDoCache(path);
    if (guardado) return { dados: guardado.dados, offline: true, salvoEm: guardado.salvoEm };
  }
  try {
    const dados = await Promise.race([
      get(path),
      new Promise((_, rejeitar) => { setTimeout(() => rejeitar(new TypeError('Failed to fetch (tempo esgotado)')), timeoutMs); }),
    ]);
    guardarNoCache(path, dados);
    return { dados, offline: false, salvoEm: null };
  } catch (err) {
    if (!falhaDeRede(err)) throw err;
    const guardado = lerDoCache(path);
    if (!guardado) throw err;
    return { dados: guardado.dados, offline: true, salvoEm: guardado.salvoEm };
  }
}

function dataHoraCurta(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

export function faixaOfflineHtml(salvoEm) {
  return `<div class="aviso-atencao mb-3 px-3 py-2.5 text-sm" role="status"><b class="font-semibold">Sem internet.</b> Mostrando os dados de ${dataHoraCurta(salvoEm)}. Eles atualizam sozinhos quando o sinal voltar.</div>`;
}

// Quando o sinal voltar, roda `fn` uma vez - a menos que o motorista ja tenha trocado de tela.
export function aoVoltarOnline(fn) {
  const hash = window.location.hash;
  window.addEventListener('online', () => { if (window.location.hash === hash) fn(); }, { once: true });
}

// Com sinal, deixa guardado o que as outras telas precisam (viagem, fretes, acertos + os 10 acertos mais recentes em detalhe,
// postos), em segundo plano: assim, ate a tela que o motorista NUNCA abriu funciona na proxima vez que ficar sem sinal.
export async function precarregarTudo({ forcar = false } = {}) {
  if (!forcar && Date.now() - ultimaPrecarga < INTERVALO_PRECARGA_MS) return;
  ultimaPrecarga = Date.now();
  const buscar = async (path) => {
    try { guardarNoCache(path, await get(path)); return lerDoCache(path)?.dados; } catch { return null; }
  };
  await buscar('/motorista/viagem-atual/fretes');
  await buscar('/motorista/postos-favoritos');
  await buscar('/motorista/postos');
  const acertos = await buscar('/motorista/acertos');
  for (const a of (Array.isArray(acertos) ? acertos : []).slice(0, 10)) await buscar(`/motorista/acertos/${a.id}`);
}

// Dica so para iPhone/iPad no navegador (fora da tela de inicio): o Safari pode apagar os dados de sites que ficam ~7 dias
// sem abrir, mas nao os de apps adicionados a Tela de Inicio.
const CHAVE_DICA_IOS = 'frottex-dica-ios-dispensada';
export function dicaIosHtml() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  let dispensada = false;
  try { dispensada = localStorage.getItem(CHAVE_DICA_IOS) === '1'; } catch { /* sem storage */ }
  if (!ios || instalado || dispensada) return '';
  return `<div class="card p-4 text-sm text-slate-500" data-dica-ios>
    <p class="font-semibold text-slate-900">Use o Frottex como app</p>
    <p class="mt-1">Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Assim o celular guarda seus dados para abrir sem internet.</p>
    <button type="button" class="btn-secondary btn-sm mt-3" data-dica-ios-fechar>Entendi</button>
  </div>`;
}

export function ativarDicaIos(raiz) {
  const botao = raiz.querySelector('[data-dica-ios-fechar]');
  if (!botao) return;
  botao.addEventListener('click', () => {
    try { localStorage.setItem(CHAVE_DICA_IOS, '1'); } catch { /* sem storage */ }
    raiz.querySelector('[data-dica-ios]').remove();
  });
}
