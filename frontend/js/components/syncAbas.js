// Sincronia entre abas: quando uma aba salva/exclui algo, as outras abas
// abertas no mesmo navegador ficam sabendo (sem polling, sem websocket) via
// BroadcastChannel - so entre abas da mesma origem, nunca entre usuarios/
// maquinas diferentes. Cada aba decide o que fazer com o aviso (ver main.js,
// que mostra uma faixa discreta "Recarregar" em vez de forcar reload sozinho -
// um reload automatico atropelaria quem estiver com um formulario aberto
// numa outra aba). Sem suporte do navegador (raro hoje em dia), CANAL fica
// null e as funcoes abaixo viram no-op.
const CANAL = typeof BroadcastChannel === 'function' ? new BroadcastChannel('frottex-sync') : null;

export function notificarMudanca(recurso) {
  if (CANAL) CANAL.postMessage({ recurso, ts: Date.now() });
}

export function aoReceberMudanca(callback) {
  if (!CANAL) return;
  CANAL.addEventListener('message', (ev) => callback(ev.data));
}
