import { get, authHeaders } from '../../api.js';
import { navegar } from '../../router.js';
import { criarSearchableSelect } from '../../components/searchableSelect.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { attachMoedaMask, getMoedaValue, attachDataMask, parseDataBrParaIso, hojeIsoLocal } from '../../masks.js';
import { comprimirImagem } from '../../imageCompress.js';
import { adicionarPendente, registrarSyncBackground } from './offlineQueue.js';

let postoTipoIdCache = null;
async function obterPostoTipoId() {
  if (postoTipoIdCache !== null) return postoTipoIdCache;
  const tipos = await get('/fornecedor-tipos');
  const posto = tipos.find((t) => t.nome.trim().toLowerCase() === 'posto');
  postoTipoIdCache = posto ? posto.id : null;
  return postoTipoIdCache;
}
async function buscarPostos(termo) {
  const todos = await get(`/fornecedores${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
  const tipoId = await obterPostoTipoId();
  return todos.filter((f) => f.tipo_id === tipoId).map((f) => ({ value: f.id, label: f.nome }));
}

// Mesmo auto-calculo do formulario de despesa do escritorio (viagemDetalhe.js):
// com 2 dos 3 campos preenchidos, calcula o terceiro. Nunca sobrescreve um
// campo que ja tenha valor digitado.
function recalcularTrio(formPreco, formLitragem, formValor) {
  const valor = getMoedaValue(formValor);
  const preco = getMoedaValue(formPreco);
  const litragem = formLitragem.value ? Number(formLitragem.value) : 0;
  if (valor > 0 && litragem > 0 && preco === 0) formPreco.value = (valor / litragem / 100).toFixed(3);
  else if (valor > 0 && preco > 0 && litragem === 0) formLitragem.value = (valor / (preco * 100)).toFixed(2);
  else if (preco > 0 && litragem > 0 && valor === 0) {
    const centavos = Math.round(preco * 100 * litragem);
    formValor.value = (centavos / 100).toFixed(2).replace('.', ',');
  }
}

export async function render(appEl) {
  appEl.innerHTML = `
    <div class="min-h-screen bg-brand-light">
      <header class="flex items-center gap-3 bg-brand-black px-4 py-3 text-white">
        <button type="button" class="rounded-lg p-1 hover:bg-gray-800" data-voltar>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p class="text-lg font-bold">Novo abastecimento</p>
      </header>
      <main class="p-4">
        <form class="card space-y-4 p-4" data-form>
          <div><label class="label">Valor total *</label><input type="text" name="valor" class="input" required inputmode="decimal" /></div>
          <div><label class="label">Data</label><input type="text" name="data" class="input" placeholder="DD/MM/AAAA" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Preco/Litro</label><input type="text" name="preco_litro" class="input" inputmode="decimal" /></div>
            <div><label class="label">Litragem</label><input type="number" step="0.01" name="litragem" class="input" /></div>
          </div>
          <div><label class="label">KM no abastecimento</label><input type="number" name="km_abastecimento" class="input" /></div>
          <div><label class="label">Posto</label><div data-posto-select></div></div>
          <div>
            <label class="label">Foto da nota/cupom *</label>
            <input type="file" accept="image/*" capture="environment" class="hidden" data-input-foto />
            <button type="button" class="btn-secondary w-full" data-tirar-foto>Tirar foto</button>
            <img class="mt-2 hidden w-full rounded-lg border border-slate-200" data-preview-foto />
          </div>
          <p class="hidden text-sm text-red-600" data-erro></p>
          <button type="submit" class="btn-primary w-full">Lancar abastecimento</button>
        </form>
      </main>
    </div>
  `;

  appEl.querySelector('[data-voltar]').addEventListener('click', () => navegar('/motorista'));

  const form = appEl.querySelector('[data-form]');
  attachMoedaMask(form.valor, 0);
  attachMoedaMask(form.preco_litro, 0);
  attachDataMask(form.data);
  form.data.value = new Date(hojeIsoLocal()).toLocaleDateString('pt-BR');

  const postoSelect = criarSearchableSelect({ buscar: buscarPostos, placeholder: 'Pesquisar posto...' });
  form.querySelector('[data-posto-select]').appendChild(postoSelect.el);

  form.valor.addEventListener('input', () => recalcularTrio(form.preco_litro, form.litragem, form.valor));
  form.preco_litro.addEventListener('input', () => recalcularTrio(form.preco_litro, form.litragem, form.valor));
  form.litragem.addEventListener('input', () => recalcularTrio(form.preco_litro, form.litragem, form.valor));

  let fotoBlob = null;
  const inputFoto = form.querySelector('[data-input-foto]');
  const previewFoto = form.querySelector('[data-preview-foto]');
  form.querySelector('[data-tirar-foto]').addEventListener('click', () => inputFoto.click());
  inputFoto.addEventListener('change', async () => {
    const arquivo = inputFoto.files[0];
    if (!arquivo) return;
    fotoBlob = await comprimirImagem(arquivo);
    previewFoto.src = URL.createObjectURL(fotoBlob);
    previewFoto.classList.remove('hidden');
  });

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (!fotoBlob) {
      erro.textContent = 'Tire uma foto da nota/cupom antes de lancar.';
      erro.classList.remove('hidden');
      return;
    }
    const valor = getMoedaValue(form.valor);
    if (!valor) {
      erro.textContent = 'Informe o valor do abastecimento.';
      erro.classList.remove('hidden');
      return;
    }

    const payload = {
      valor,
      data: form.data.value ? parseDataBrParaIso(form.data.value) : null,
      preco_litro: form.preco_litro.value ? getMoedaValue(form.preco_litro) : null,
      litragem: form.litragem.value ? Number(form.litragem.value) : null,
      km_abastecimento: form.km_abastecimento.value ? Number(form.km_abastecimento.value) : null,
      posto_fornecedor_id: postoSelect.getValue(),
    };

    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await lancarAbastecimento(payload, fotoBlob);
      navegar('/motorista');
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    } finally {
      botao.disabled = false;
    }
  });
}

// Tenta lancar direto; se a rede falhar (celular sem sinal na hora do envio),
// guarda na fila offline pra sincronizar sozinho depois - nunca perde o
// lancamento por falta de conexao.
async function lancarAbastecimento(payload, fotoBlob) {
  if (navigator.onLine === false) {
    await adicionarPendente({ payload, fotoBlob });
    await registrarSyncBackground();
    mostrarToast('Sem conexao - abastecimento salvo no celular, sera enviado automaticamente.', 'info');
    return;
  }
  try {
    const formData = new FormData();
    formData.append('foto', fotoBlob, 'foto.jpg');
    formData.append('idempotency_key', crypto.randomUUID());
    for (const [chave, valor] of Object.entries(payload)) {
      if (valor !== null && valor !== undefined) formData.append(chave, valor);
    }
    const res = await fetch('/api/motorista/abastecimentos', { method: 'POST', headers: authHeaders(), body: formData });
    const dados = await res.json().catch(() => null);
    if (!res.ok) throw new Error((dados && dados.erro) || `Erro ${res.status}`);
    mostrarToast('Abastecimento lancado.');
  } catch (err) {
    // Falha de rede (fetch nem chegou a completar) - trata como offline em
    // vez de mostrar erro pro motorista, que nao pode fazer nada a respeito.
    if (err instanceof TypeError) {
      await adicionarPendente({ payload, fotoBlob });
      await registrarSyncBackground();
      mostrarToast('Sem conexao - abastecimento salvo no celular, sera enviado automaticamente.', 'info');
      return;
    }
    throw err;
  }
}
