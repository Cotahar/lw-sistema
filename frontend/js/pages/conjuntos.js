import { get, post, put, del, podeGerenciar } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal, confirmarAcao } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { attachUppercaseInput } from '../masks.js';

async function buscarVeiculos(termo) {
  const veiculos = await get(`/veiculos${termo ? `?search=${encodeURIComponent(termo)}` : ''}`);
  return veiculos.map((v) => ({ value: v.id, label: `${v.placa} (${v.tipo})` }));
}

function montarFormulario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Nome (opcional)</label><input type="text" name="nome" class="input" placeholder="Ex.: Rodotrem 01" /></div>
    <div>
      <div class="mb-2 flex items-center justify-between">
        <label class="label mb-0">Composicao (da frente para tras)</label>
        <button type="button" class="btn-secondary btn-sm" data-add-item>+ Adicionar veiculo</button>
      </div>
      <div data-itens class="space-y-2"></div>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  form.nome.value = registro?.nome || '';
  attachUppercaseInput(form.nome);
  const itensContainer = form.querySelector('[data-itens]');
  const linhas = [];

  function renumerar() {
    linhas.forEach((linha, i) => { linha.numero.textContent = `${i + 1}.`; });
  }

  function adicionarLinha(valorInicial, labelInicial) {
    const linha = document.createElement('div');
    linha.className = 'flex items-center gap-2';
    const numero = document.createElement('span');
    numero.className = 'w-5 text-sm text-slate-400';
    const select = criarSearchableSelect({ buscar: buscarVeiculos, valorInicial, labelInicial, placeholder: 'Pesquisar veiculo (placa)...' });
    const remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'btn-secondary btn-sm';
    remover.textContent = 'Remover';
    remover.addEventListener('click', () => {
      linha.remove();
      const idx = linhas.findIndex((l) => l.select === select);
      if (idx >= 0) linhas.splice(idx, 1);
      renumerar();
    });
    linha.append(numero, select.el, remover);
    linha.querySelector('div').classList.add('flex-1');
    itensContainer.appendChild(linha);
    linhas.push({ select, numero });
    renumerar();
  }

  form.querySelector('[data-add-item]').addEventListener('click', () => adicionarLinha(null, ''));
  if (registro?.itens?.length) {
    for (const item of registro.itens) adicionarLinha(item.veiculo_id, `${item.placa} (${item.tipo})`);
  } else {
    adicionarLinha(null, '');
  }

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const itens = linhas.map((l, i) => ({ veiculo_id: l.select.getValue(), ordem: i + 1 })).filter((i) => i.veiculo_id);
    if (!itens.length) {
      erro.textContent = 'Adicione ao menos um veiculo na composicao.';
      erro.classList.remove('hidden');
      return;
    }
    try {
      await aoSalvar({ nome: form.nome.value || null, itens });
    } catch (err) {
      erro.textContent = err.message || 'Erro ao salvar.';
      erro.classList.remove('hidden');
    }
  });

  return form;
}

// So faz sentido perguntar em composicoes com exatamente 1 Cavalo e 1
// Carreta - com outras combinacoes (bitrem, dolly, mais de um cavalo etc.)
// nao ha uma unica troca obvia a sugerir.
async function sincronizarCarretaPadraoDoCavalo(itens) {
  const todosVeiculos = await get('/veiculos');
  const porId = Object.fromEntries(todosVeiculos.map((v) => [v.id, v]));
  const cavalos = itens.map((i) => porId[i.veiculo_id]).filter((v) => v && v.tipo === 'Cavalo');
  const carretas = itens.map((i) => porId[i.veiculo_id]).filter((v) => v && v.tipo === 'Carreta');
  if (cavalos.length !== 1 || carretas.length !== 1) return;
  const cavalo = cavalos[0];
  const carreta = carretas[0];
  if (cavalo.carreta_padrao_id === carreta.id) return;

  const propagar = await confirmarAcao({
    titulo: 'Atualizar carreta padrao do cavalo?',
    mensagem: `A carreta desta composicao (${carreta.placa}) e diferente da carreta padrao cadastrada no cavalo ${cavalo.placa}${cavalo.carreta_padrao_placa ? ` (atual: ${cavalo.carreta_padrao_placa})` : ' (nenhuma cadastrada ainda)'}. Deseja atualizar o cadastro do cavalo para usar ${carreta.placa} como padrao?`,
    textoConfirmar: 'Atualizar cadastro do cavalo',
    perigo: false,
  });
  if (!propagar) return;
  try {
    await put(`/veiculos/${cavalo.id}`, { carreta_padrao_id: carreta.id });
    mostrarToast('Carreta padrao do cavalo atualizada.');
  } catch (err) {
    mostrarErro(err);
  }
}

async function abrirFormulario(registro, recarregar) {
  const form = montarFormulario(registro, async (valores) => {
    if (registro) await put(`/conjuntos/${registro.id}`, valores);
    else await post('/conjuntos', valores);
    fecharModal();
    mostrarToast(registro ? 'Composicao atualizada.' : 'Composicao cadastrada.');
    recarregar();
    await sincronizarCarretaPadraoDoCavalo(valores.itens);
  });
  abrirModal({ titulo: registro ? 'Editar composicao' : 'Nova composicao', conteudo: form, largura: 'max-w-xl' });
}

export async function render(container) {
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Composicoes (Conjuntos)</h1><div data-tabela></div>';
  const gerenciar = podeGerenciar('conjuntos');

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Nome', render: (r) => r.nome || `Conjunto #${r.id}` },
      { chave: 'itens', titulo: 'Composicao', render: (r) => r.itens.map((i) => `${i.placa} (${i.tipo})`).join(' + ') },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge-sucesso">Ativo</span>' : '<span class="badge-neutro">Inativo</span>') },
    ],
    buscarDados: () => get('/conjuntos'),
    onNovo: gerenciar ? () => abrirFormulario(null, tabela.recarregar) : undefined,
    onEditar: gerenciar ? (r) => abrirFormulario(r, tabela.recarregar) : undefined,
    onExcluir: gerenciar ? (r) => del(`/conjuntos/${r.id}`) : undefined,
    onExcluirLote: gerenciar ? (ids) => post('/conjuntos/batch-delete', { ids }) : undefined,
    tituloNovo: 'Composicao',
    vazio: 'Nenhuma composicao cadastrada.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
