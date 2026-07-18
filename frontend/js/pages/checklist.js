import { get, put, del, authHeaders, podeGerenciar } from '../api.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';

async function buscarVeiculos(termo) {
  return (await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((v) => ({ value: v.id, label: v.placa }));
}

async function carregarChecklist(veiculoId, container, gerenciar) {
  try {
    const itens = await get(`/checklist/veiculo/${veiculoId}`);
    container.innerHTML = itens.length
      ? `
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th class="table-th">Presente</th><th class="table-th">Item</th><th class="table-th">Observacao</th>
          </tr></thead>
          <tbody>
            ${itens.map((item) => `
              <tr class="border-b border-slate-100" data-item-id="${item.item_id}">
                <td class="table-td"><input type="checkbox" data-presente ${item.presente ? 'checked' : ''} ${gerenciar ? '' : 'disabled'} /></td>
                <td class="table-td">${item.nome}</td>
                <td class="table-td"><input type="text" class="input" data-observacao value="${item.observacao || ''}" ${gerenciar ? '' : 'disabled'} /></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : '<p class="text-slate-400">Nenhum item cadastrado no catalogo de checklist (peca ao Admin cadastrar em Configuracoes).</p>';

    if (!gerenciar) return;
    container.querySelectorAll('tr[data-item-id]').forEach((tr) => {
      const itemId = tr.dataset.itemId;
      const salvar = async () => {
        try {
          await put(`/checklist/veiculo/${veiculoId}/${itemId}`, {
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

async function carregarFotos(veiculoId, container, gerenciar) {
  try {
    const fotos = await get(`/checklist/veiculo/${veiculoId}/fotos`);
    const recebimento = fotos.filter((f) => f.momento === 'Recebimento');
    const entrega = fotos.filter((f) => f.momento === 'Entrega');
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-6 sm:grid-cols-2';
    container.appendChild(grid);
    const recarregar = () => carregarFotos(veiculoId, container, gerenciar);
    grid.appendChild(montarColunaFotos('Recebimento', recebimento, veiculoId, gerenciar, recarregar));
    grid.appendChild(montarColunaFotos('Entrega', entrega, veiculoId, gerenciar, recarregar));
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  container.innerHTML = `
    <h1 class="mb-4 text-xl font-bold text-slate-900">Checklist de Bordo</h1>
    <div class="card mb-4 p-4">
      <label class="label">Selecione o veiculo</label>
      <div data-veiculo-select class="max-w-sm"></div>
    </div>
    <div class="card mb-4 p-4" data-checklist>
      <p class="text-slate-400">Selecione um veiculo para ver o checklist.</p>
    </div>
    <div class="card p-4" data-fotos></div>
  `;
  const gerenciar = podeGerenciar('checklist');
  const checklistEl = container.querySelector('[data-checklist]');
  const fotosEl = container.querySelector('[data-fotos]');
  const veiculoSelect = criarSearchableSelect({
    buscar: buscarVeiculos,
    placeholder: 'Pesquisar placa...',
    onChange: (veiculoId) => {
      if (veiculoId) {
        carregarChecklist(veiculoId, checklistEl, gerenciar);
        carregarFotos(veiculoId, fotosEl, gerenciar);
      } else {
        fotosEl.innerHTML = '';
      }
    },
  });
  container.querySelector('[data-veiculo-select]').appendChild(veiculoSelect.el);
}
