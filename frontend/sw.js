// Service worker do modulo do motorista - cache do "shell" estatico (pra abrir
// mesmo sem sinal) e Background Sync das pendencias offline (Android/Chrome;
// iOS Safari nao suporta, coberto pelo listener de 'online' + retry ao abrir
// o painel dentro de dashboard.js). So registrado para sessoes com perfil
// Motorista (ver frontend/js/main.js) - nao mexe em nada da parte
// administrativa, que muda o tempo todo e nao deve arriscar cache/staleness.
import { tentarSincronizarTodos } from './js/pages/motorista/offlineQueue.js';

const CACHE_VERSION = 'frottex-motorista-v4';
const ARQUIVOS_SHELL = [
  '/',
  '/index.html',
  '/dist/output.css',
  '/manifest.json',
  '/img/favicon.png',
  '/img/favicon.svg',
  '/js/api.js',
  '/js/components/barraEstrada.js',
  '/js/components/copiar.js',
  '/js/components/modal.js',
  '/js/components/placa.js',
  '/js/components/relatorioImpressao.js',
  '/js/components/searchableSelect.js',
  '/js/components/skeleton.js',
  '/js/components/syncAbas.js',
  '/js/components/toast.js',
  '/js/html.js',
  '/js/imageCompress.js',
  '/js/main.js',
  '/js/masks.js',
  '/js/modulosConfig.js',
  '/js/pages/acertoRelatorio.js',
  '/js/pages/dreRelatorio.js',
  '/js/pages/login.js',
  '/js/pages/motorista/abastecimento.js',
  '/js/pages/motorista/acertos.js',
  '/js/pages/motorista/cacheLocal.js',
  '/js/pages/motorista/dashboard.js',
  '/js/pages/motorista/fretes.js',
  '/js/pages/motorista/offlineQueue.js',
  '/js/pages/motorista/postosFavoritos.js',
  '/js/pages/recibos.js',
  '/js/pages/relatorios/imprimir.js',
  '/js/router.js',
  '/js/versao.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ARQUIVOS_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE_VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro, cache so como fallback pra quando estiver sem sinal. A
// versao anterior fazia o contrario (cache primeiro, rede so atualizava o
// cache em segundo plano pro PROXIMO carregamento) - isso significava que
// qualquer correcao/deploy novo so aparecia pro motorista depois de DOIS
// carregamentos, nunca no primeiro. Com o app sendo atualizado com
// frequencia, "funciona offline" nao pode significar "sempre atrasado
// quando online".
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API sempre vai pra rede - nunca serve resposta de API velha do cache.
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        // So guarda resposta boa: um 404/500 em cache seria servido depois como se fosse o arquivo.
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-abastecimentos') {
    event.waitUntil(tentarSincronizarTodos());
  }
});
