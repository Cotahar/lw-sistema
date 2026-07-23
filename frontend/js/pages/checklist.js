import { get, post, put, del, authHeaders, podeGerenciar } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarDataBr, hojeIsoLocal } from '../masks.js';

async function buscarConjuntos(termo) {
  const conjuntos = await get('/conjuntos');
  const opcoes = conjuntos.map((c) => ({ value: c.id, label: c.nome || c.itens.map((i) => i.placa).join(' + '), conjunto: c }));
  if (!termo) return opcoes;
  const termoBusca = termo.toLowerCase();
  return opcoes.filter((o) => o.label.toLowerCase().includes(termoBusca));
}

function diasDesde(dataIso) {
  const hoje = new Date(`${hojeIsoLocal()}T00:00:00Z`);
  const data = new Date(`${dataIso}T00:00:00Z`);
  return Math.round((hoje - data) / 86400000);
}

async function carregarItensVistoria(vistoriaId, container, gerenciar, recarregar) {
  try {
    const { vistoria, itens, conjuntoDivergente, placasNaVistoria, placasAtuais } = await get(`/checklist/vistorias/${vistoriaId}`);
    const porVeiculo = new Map();
    for (const item of itens) {
      if (!porVeiculo.has(item.veiculo_id)) porVeiculo.set(item.veiculo_id, { placa: item.placa, tipo: item.veiculo_tipo, itens: [] });
      porVeiculo.get(item.veiculo_id).itens.push(item);
    }

    container.innerHTML = `
      <div class="mb-3 flex items-center justify-between">
        <p class="text-sm text-slate-500">Vistoria de ${formatarDataBr(vistoria.data_vistoria)}</p>
        ${conjuntoDivergente ? `<span class="badge bg-amber-100 text-amber-700">Conjunto era ${placasNaVistoria.join('+')}, hoje e ${placasAtuais.join('+')}</span>` : ''}
      </div>
      <div class="space-y-6" data-grupos></div>
    `;
    const gruposEl = container.querySelector('[data-grupos]');
    for (const [veiculoId, grupo] of porVeiculo) {
      const bloco = document.createElement('div');
      bloco.innerHTML = `
        <h3 class="mb-2 text-sm font-semibold text-slate-900">${grupo.placa} <span class="font-normal text-slate-400">(${grupo.tipo})</span></h3>
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th class="table-th">Presente</th><th class="table-th">Item</th><th class="table-th">Observacao</th>
          </tr></thead>
          <tbody>
            ${grupo.itens.map((item) => `
              <tr class="border-b border-slate-100" data-item-id="${item.item_id}">
                <td class="table-td"><input type="checkbox" data-presente ${item.presente ? 'checked' : ''} ${gerenciar ? '' : 'disabled'} /></td>
                <td class="table-td">${item.item_nome}</td>
                <td class="table-td"><input type="text" class="input" data-observacao value="${item.observacao || ''}" ${gerenciar ? '' : 'disabled'} /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      if (gerenciar) {
        bloco.querySelectorAll('tr[data-item-id]').forEach((tr) => {
          const itemId = tr.dataset.itemId;
          const salvar = async () => {
            try {
              await put(`/checklist/vistorias/${vistoriaId}/veiculo/${veiculoId}/item/${itemId}`, {
                presente: tr.querySelector('[data-presente]').checked,
                observacao: tr.querySelector('[data-observacao]').value || null,
              });
              mostrarToast('Checklist atualizado.');
            } catch (err) {
              mostrarErro(err);
            }
          };
          tr.querySelector('[data-presente]').addEventListener('change', salvar);
          tr.querySelector('[data-observacao]').addEventListener('blur', salvar);
        });
      }
      gruposEl.appendChild(bloco);
    }
  } catch (err) {
    mostrarErro(err);
  }
}

async function carregarVistorias(conjunto, container, gerenciar) {
  container.innerHTML = '<p class="text-slate-400">Carregando vistorias...</p>';
  try {
    const vistorias = await get(`/checklist/conjunto/${conjunto.id}/vistorias`);
    const ultima = vistorias[0];
    const aviso = !ultima
      ? 'Nenhuma vistoria registrada ainda para este conjunto.'
      : diasDesde(ultima.data_vistoria) >= 30
        ? `Ultima vistoria ha ${diasDesde(ultima.data_vistoria)} dias (recomendado a cada ~30 dias) - considere fazer uma nova.`
        : `Ultima vistoria ha ${diasDesde(ultima.data_vistoria)} dia(s).`;

    container.innerHTML = `
      <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm ${!ultima || diasDesde(ultima.data_vistoria) >= 30 ? 'text-amber-700' : 'text-slate-500'}">${aviso}</p>
        <div class="flex items-center gap-2">
          <select class="input" data-select-vistoria>
            ${vistorias.map((v) => `<option value="${v.id}">${formatarDataBr(v.data_vistoria)}</option>`).join('')}
          </select>
          ${gerenciar ? '<button type="button" class="btn-primary btn-sm" data-nova-vistoria>+ Nova vistoria</button>' : ''}
        </div>
      </div>
      <div data-itens-vistoria></div>
    `;

    const itensEl = container.querySelector('[data-itens-vistoria]');
    const selectVistoria = container.querySelector('[data-select-vistoria]');
    if (ultima) {
      carregarItensVistoria(ultima.id, itensEl, gerenciar);
      selectVistoria.addEventListener('change', () => carregarItensVistoria(selectVistoria.value, itensEl, gerenciar));
    } else {
      itensEl.innerHTML = '<p class="text-slate-400">Crie a primeira vistoria para comecar.</p>';
    }

    const btnNova = container.querySelector('[data-nova-vistoria]');
    if (btnNova) {
      btnNova.addEventListener('click', async () => {
        try {
          await post(`/checklist/conjunto/${conjunto.id}/vistorias`, {});
          mostrarToast('Vistoria criada.');
          carregarVistorias(conjunto, container, gerenciar);
        } catch (err) {
          mostrarErro(err);
        }
      });
    }
  } catch (err) {
    mostrarErro(err);
  }
}

// Reduz a foto (tipicamente varios MB direto do celular) para um tamanho
// razoavel antes de enviar - lado maximo 1600px e JPEG 80%, o suficiente
// para comparar o estado do veiculo sem pesar no armazenamento.
async function comprimirImagem(arquivo, ladoMaximo = 1600, qualidade = 0.8) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, largura, altura);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
}

async function enviarFoto(veiculoId, momento, blob) {
  const formData = new FormData();
  formData.append('foto', blob, 'foto.jpg');
  formData.append('momento', momento);
  const res = await fetch(`/api/checklist/veiculo/${veiculoId}/fotos`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  const dados = await res.json().catch(() => null);
  if (!res.ok) throw new Error((dados && dados.erro) || `Erro ${res.status}`);
  return dados;
}

function abrirFotoAmpliada(foto) {
  const img = document.createElement('img');
  img.src = `/uploads/checklist/${foto.arquivo}`;
  img.className = 'w-full rounded-lg';
  abrirModal({ titulo: `Foto - ${foto.momento}`, conteudo: img, largura: 'max-w-2xl' });
}

function montarColunaFotos(momento, fotos, veiculoId, gerenciar, recarregar) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="mb-2 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-slate-900">${momento}</h3>
      ${gerenciar ? `<label class="btn-secondary btn-sm cursor-pointer">+ Foto<input type="file" accept="image/*" class="hidden" data-input-foto /></label>` : ''}
    </div>
    <div class="grid grid-cols-3 gap-2" data-galeria>
      ${fotos.map((f) => `
        <div class="group relative" data-foto-id="${f.id}">
          <img src="/uploads/checklist/${f.arquivo}" class="h-20 w-full cursor-pointer rounded-lg object-cover" data-ver-foto />
          ${gerenciar ? '<button type="button" class="absolute right-1 top-1 hidden h-5 w-5 rounded-full bg-red-600 text-xs text-white group-hover:block" data-remover-foto>&times;</button>' : ''}
        </div>
      `).join('') || '<p class="col-span-3 text-xs text-slate-400">Nenhuma foto.</p>'}
    </div>
  `;

  wrapper.querySelectorAll('[data-foto-id]').forEach((el) => {
    const foto = fotos.find((f) => String(f.id) === el.dataset.fotoId);
    el.querySelector('[data-ver-foto]').addEventListener('click', () => abrirFotoAmpliada(foto));
    const btnRemover = el.querySelector('[data-remover-foto]');
    if (btnRemover) {
      btnRemover.addEventListener('click', async () => {
        const ok = await confirmarAcao({ titulo: 'Remover foto', mensagem: 'Remover este registro fotografico?', textoConfirmar: 'Remover' });
        if (!ok) return;
        try {
          await del(`/checklist/fotos/${foto.id}`);
          recarregar();
        } catch (err) {
          mostrarErro(err);
        }
      });
    }
  });

  const input = wrapper.querySelector('[data-input-foto]');
  if (input) {
    input.addEventListener('change', async () => {
      const arquivo = input.files[0];
      if (!arquivo) return;
      try {
        const blob = await comprimirImagem(arquivo);
        await enviarFoto(veiculoId, momento, blob);
        mostrarToast('Foto adicionada.');
        recarregar();
      } catch (err) {
        mostrarErro(err);
      }
    });
  }

  return wrapper;
}

async function carregarFotosVeiculo(veiculo, container, gerenciar) {
  try {
    const fotos = await get(`/checklist/veiculo/${veiculo.veiculo_id}/fotos`);
    const recebimento = fotos.filter((f) => f.momento === 'Recebimento');
    const entrega = fotos.filter((f) => f.momento === 'Entrega');
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-6 sm:grid-cols-2';
    container.appendChild(grid);
    const recarregar = () => carregarFotosVeiculo(veiculo, container, gerenciar);
    grid.appendChild(montarColunaFotos('Recebimento', recebimento, veiculo.veiculo_id, gerenciar, recarregar));
    grid.appendChild(montarColunaFotos('Entrega', entrega, veiculo.veiculo_id, gerenciar, recarregar));
  } catch (err) {
    mostrarErro(err);
  }
}

function carregarFotosConjunto(conjunto, container, gerenciar) {
  container.innerHTML = '';
  for (const veiculo of conjunto.itens) {
    const bloco = document.createElement('div');
    bloco.className = 'mb-6 last:mb-0';
    bloco.innerHTML = `<h3 class="mb-2 text-sm font-semibold text-slate-900">${veiculo.placa}</h3><div data-fotos-veiculo></div>`;
    container.appendChild(bloco);
    carregarFotosVeiculo(veiculo, bloco.querySelector('[data-fotos-veiculo]'), gerenciar);
  }
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Checklist de Bordo</h1>
    <div class="card mb-4 p-4">
      <label class="label">Selecione o conjunto (composicao)</label>
      <div data-conjunto-select class="max-w-sm"></div>
    </div>
    <div class="card mb-4 p-4" data-checklist>
      <p class="text-slate-400">Selecione um conjunto para ver as vistorias.</p>
    </div>
    <div class="card p-4" data-fotos></div>
  `;
  const gerenciar = podeGerenciar('checklist');
  const checklistEl = container.querySelector('[data-checklist]');
  const fotosEl = container.querySelector('[data-fotos]');
  const conjuntoSelect = criarSearchableSelect({
    buscar: buscarConjuntos,
    placeholder: 'Pesquisar conjunto...',
    onChange: (conjuntoId, opcao) => {
      if (conjuntoId) {
        carregarVistorias(opcao.conjunto, checklistEl, gerenciar);
        carregarFotosConjunto(opcao.conjunto, fotosEl, gerenciar);
      } else {
        checklistEl.innerHTML = '<p class="text-slate-400">Selecione um conjunto para ver as vistorias.</p>';
        fotosEl.innerHTML = '';
      }
    },
  });
  container.querySelector('[data-conjunto-select]').appendChild(conjuntoSelect.el);
}
