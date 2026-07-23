import { get, post, put, del, ehAdmin } from '../../api.js';
import { renderizarAcessoNegado } from '../../components/acessoNegado.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';

// Tela de linhas editaveis (nao o CRUD generico em modal) - o cadastro de
// faixas e feito em sequencia (uma faixa emenda na outra), entao editar uma
// por uma em um modal seria lento. Cada linha e independente: tem seu proprio
// "Salvar"/"Remover", sem um "salvar tudo" global.
async function buscarMarcasConhecidas() {
  try {
    const veiculos = await get('/veiculos');
    return [...new Set(veiculos.map((v) => v.marca).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function linhaHtml(faixa, idx) {
  const id = faixa.id ?? '';
  return `
    <tr class="border-b border-slate-100" data-linha data-id="${id}">
      <td class="table-td"><input type="text" class="input" data-campo="marca" list="lista-marcas" placeholder="Qualquer marca" value="${faixa.marca || ''}" /></td>
      <td class="table-td"><input type="number" step="0.01" min="0" class="input" data-campo="km_l_de" value="${faixa.km_l_de ?? ''}" /></td>
      <td class="table-td"><input type="number" step="0.01" min="0" class="input" data-campo="km_l_ate" value="${faixa.km_l_ate ?? ''}" /></td>
      <td class="table-td"><input type="number" step="0.01" min="0" class="input max-w-[7rem]" data-campo="percentual_comissao" value="${faixa.percentual_comissao ?? ''}" /></td>
      <td class="table-td"><input type="checkbox" data-campo="ativo" class="h-4 w-4" ${faixa.ativo === undefined || faixa.ativo ? 'checked' : ''} /></td>
      <td class="table-td text-right whitespace-nowrap">
        <button type="button" class="btn-secondary btn-sm" data-salvar>Salvar</button>
        <button type="button" class="btn-secondary btn-sm text-red-600" data-remover>Remover</button>
      </td>
    </tr>
    <tr data-linha-erro="${idx}"><td colspan="6" class="hidden px-3 pb-2 text-xs text-red-600" data-erro></td></tr>
  `;
}

export async function render(container) {
  if (!ehAdmin()) return renderizarAcessoNegado(container);
  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Faixas de Comissao por Media (KM/L)</h1>
    <p class="mb-4 text-sm text-slate-500">A comissao do motorista varia pela media de consumo do veiculo (km/l). Cadastre faixas gerais (marca em branco) ou especificas por marca - uma faixa especifica tem prioridade sobre a generica na mesma media.</p>
    <datalist id="lista-marcas"></datalist>
    <div class="card overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-brand-black"><tr>
          <th class="table-th">Marca</th><th class="table-th">KM/L de</th><th class="table-th">KM/L ate</th><th class="table-th">Comissao %</th><th class="table-th">Ativa</th><th class="table-th"></th>
        </tr></thead>
        <tbody data-linhas></tbody>
      </table>
    </div>
    <button type="button" class="btn-primary btn-sm mt-3" data-nova-faixa>+ Nova faixa</button>
  `;

  const marcas = await buscarMarcasConhecidas();
  container.querySelector('#lista-marcas').innerHTML = marcas.map((m) => `<option value="${m}"></option>`).join('');

  const corpo = container.querySelector('[data-linhas]');

  function lerLinha(tr) {
    const campo = (nome) => tr.querySelector(`[data-campo="${nome}"]`);
    return {
      id: tr.dataset.id || null,
      marca: campo('marca').value.trim() || null,
      km_l_de: campo('km_l_de').value === '' ? null : Number(campo('km_l_de').value),
      km_l_ate: campo('km_l_ate').value === '' ? null : Number(campo('km_l_ate').value),
      percentual_comissao: campo('percentual_comissao').value === '' ? null : Number(campo('percentual_comissao').value),
      ativo: campo('ativo').checked ? 1 : 0,
    };
  }

  function mostrarErroLinha(tr, mensagem) {
    const erroTr = tr.nextElementSibling;
    const erroEl = erroTr.querySelector('[data-erro]');
    erroEl.textContent = mensagem;
    erroEl.classList.remove('hidden');
  }
  function limparErroLinha(tr) {
    const erroTr = tr.nextElementSibling;
    erroTr.querySelector('[data-erro]').classList.add('hidden');
  }

  function ligarLinha(tr) {
    tr.querySelector('[data-salvar]').addEventListener('click', async () => {
      limparErroLinha(tr);
      const valores = lerLinha(tr);
      if (valores.km_l_de === null || valores.km_l_ate === null || valores.percentual_comissao === null) {
        mostrarErroLinha(tr, 'Preencha KM/L de, KM/L ate e Comissao.');
        return;
      }
      if (valores.km_l_de >= valores.km_l_ate) {
        mostrarErroLinha(tr, '"KM/L de" precisa ser menor que "KM/L ate".');
        return;
      }
      try {
        if (valores.id) {
          await put(`/comissao-faixas/${valores.id}`, valores);
        } else {
          const nova = await post('/comissao-faixas', valores);
          tr.dataset.id = nova.id;
        }
        mostrarToast('Faixa salva.');
      } catch (err) {
        mostrarErroLinha(tr, err.message);
      }
    });

    tr.querySelector('[data-remover]').addEventListener('click', async () => {
      if (!tr.dataset.id) {
        tr.nextElementSibling.remove();
        tr.remove();
        return;
      }
      try {
        await del(`/comissao-faixas/${tr.dataset.id}`);
        tr.nextElementSibling.remove();
        tr.remove();
        mostrarToast('Faixa removida.');
      } catch (err) {
        mostrarErroLinha(tr, err.message);
      }
    });
  }

  async function carregar() {
    try {
      const faixas = await get('/comissao-faixas');
      corpo.innerHTML = faixas.map((f, idx) => linhaHtml(f, idx)).join('');
      corpo.querySelectorAll('[data-linha]').forEach(ligarLinha);
    } catch (err) {
      mostrarErro(err);
    }
  }

  container.querySelector('[data-nova-faixa]').addEventListener('click', () => {
    // A nova linha "emenda" na ultima ja exibida: km_l_de comeca em
    // (km_l_ate da ultima linha) + 0.01, pra nao deixar buraco nem sobrepor.
    const linhasAtuais = corpo.querySelectorAll('[data-linha]');
    const ultima = linhasAtuais[linhasAtuais.length - 1];
    const tetoAnterior = ultima ? Number(ultima.querySelector('[data-campo="km_l_ate"]').value || 0) : 0;
    const novaDe = ultima ? Math.round((tetoAnterior + 0.01) * 100) / 100 : '';
    // insertAdjacentHTML direto no <tbody> - diferente de montar via uma
    // <div> solta, aqui o parser sabe que esta num contexto de tabela e nao
    // descarta as tags <tr> (isso aconteceria com div.innerHTML).
    corpo.insertAdjacentHTML('beforeend', linhaHtml({ km_l_de: novaDe, ativo: 1 }, linhasAtuais.length));
    const novaTr = corpo.lastElementChild.previousElementSibling;
    ligarLinha(novaTr);
    novaTr.querySelector('[data-campo="km_l_ate"]').focus();
  });

  await carregar();
}
