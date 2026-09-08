import { authHeaders } from '../../api.js';

// Fila offline dos abastecimentos lancados sem conexao - guardada em
// IndexedDB (sobrevive fechar o app/celular reiniciar, ao contrario de uma
// variavel em memoria). Cada item guarda seu proprio localId (UUID), que
// tambem e a idempotency_key enviada ao servidor: reenviar o mesmo item
// depois de uma resposta perdida nunca duplica o lancamento (ver
// backend/src/routes/motorista.routes.js). Nao guarda viagem_id de proposito
// - o servidor sempre resolve a viagem em andamento no momento do envio.
const DB_NAME = 'frottex-motorista-db';
const STORE = 'abastecimentos_pendentes';

function abrirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'localId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function pegarTodos(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function adicionarPendente({ payload, fotoBlob }) {
  const registro = {
    localId: crypto.randomUUID(),
    payload,
    fotoBlob,
    criadoEm: new Date().toISOString(),
    status: 'pendente',
    tentativas: 0,
    ultimoErro: null,
  };
  const db = await abrirDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(registro);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return registro;
}

export async function listarPendentes() {
  const db = await abrirDb();
  const tx = db.transaction(STORE, 'readonly');
  const todos = await pegarTodos(tx.objectStore(STORE));
  return todos
    .map((r) => ({ ...r, fotoUrl: URL.createObjectURL(r.fotoBlob) }))
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

async function atualizar(localId, campos) {
  const db = await abrirDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      if (getReq.result) store.put({ ...getReq.result, ...campos });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function remover(localId) {
  const db = await abrirDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function enviarUm(pendente) {
  const formData = new FormData();
  formData.append('foto', pendente.fotoBlob, 'foto.jpg');
  formData.append('idempotency_key', pendente.localId);
  for (const [chave, valor] of Object.entries(pendente.payload)) {
    if (valor !== null && valor !== undefined) formData.append(chave, valor);
  }
  const res = await fetch('/api/motorista/abastecimentos', { method: 'POST', headers: authHeaders(), body: formData });
  const dados = await res.json().catch(() => null);
  if (!res.ok) throw new Error((dados && dados.erro) || `Erro ${res.status}`);
  return dados;
}

// Tenta enviar cada item pendente (menos os que ja estao "enviando" numa
// chamada concorrente). Item que falha fica marcado com o erro, pronto pra
// nova tentativa (proximo evento 'online', abrir o painel, ou botao manual) -
// nunca falha silenciosamente.
export async function tentarSincronizarTodos() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const db = await abrirDb();
  const tx = db.transaction(STORE, 'readonly');
  const todos = await pegarTodos(tx.objectStore(STORE));
  const pendentes = todos.filter((p) => p.status !== 'enviando');
  for (const pendente of pendentes) {
    await atualizar(pendente.localId, { status: 'enviando' });
    try {
      await enviarUm(pendente);
      await remover(pendente.localId);
    } catch (err) {
      await atualizar(pendente.localId, { status: 'erro', tentativas: (pendente.tentativas || 0) + 1, ultimoErro: err.message });
    }
  }
}

// Icone de nuvem + badge - mesmo bloco HTML usado no cabecalho de toda tela
// do motorista (ver montarCabecalhoMotorista em cada pagina), pra fila
// offline parar de ser invisivel fora do Painel (que ja tinha um card
// detalhado, mas so aparecia ali).
export function iconeFilaHtml() {
  return `
    <button type="button" data-fila-offline class="relative rounded-lg p-1.5 hover:bg-white/10" title="Fila de sincronizacao">
      <svg data-fila-icone class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18a4 4 0 01-1-7.9A5 5 0 0114.9 8H15a4.5 4.5 0 010 9H6z"/></svg>
      <span data-fila-badge class="absolute -right-1 -top-1 hidden h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">0</span>
    </button>
  `;
}

// Atualiza o badge com a contagem atual da fila. `sincronizando` gira o
// icone (feedback de "trabalhando nisso agora"), usado ao redor de
// tentarSincronizarTodos() - nao fica girando parado so por ter pendencia.
export async function atualizarIndicadorFila(root, { sincronizando = false } = {}) {
  const btn = root.querySelector('[data-fila-offline]');
  if (!btn) return;
  const icone = btn.querySelector('[data-fila-icone]');
  const badge = btn.querySelector('[data-fila-badge]');
  icone.classList.toggle('animate-spin', sincronizando);
  const pendentes = await listarPendentes();
  if (pendentes.length) {
    badge.textContent = String(pendentes.length);
    badge.classList.remove('hidden');
    badge.classList.add('flex');
  } else {
    badge.classList.add('hidden');
    badge.classList.remove('flex');
  }
}

// Background Sync (Android/Chrome): o service worker acorda e chama isso
// mesmo com o app fechado. iOS Safari nao suporta - por isso o app tambem
// tenta sincronizar no evento 'online' e ao abrir/focar o painel.
export async function registrarSyncBackground() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('sync-abastecimentos');
  } catch {
    // sem suporte ou falha ao registrar - os outros gatilhos de sincronizacao cobrem o caso
  }
}
