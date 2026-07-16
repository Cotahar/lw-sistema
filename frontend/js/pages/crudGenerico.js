import { get, post, put, del, podeGerenciar, ehAdmin } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarFormulario } from '../components/form.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast } from '../components/toast.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';

// Fabrica de tela CRUD generica (lista + form em modal + lote), reaproveitada
// pelos cadastros mais simples do sistema. Telas com regras proprias (veiculos,
// conjuntos, estoque...) tem paginas dedicadas em vez de usar isto.
// somenteAdmin: telas de configuracao do sistema (taxonomias, comissao) que
// nao fazem parte da matriz de permissoes por modulo - ficam restritas ao Admin.
export function criarPaginaCrud({ titulo, endpoint, colunas, campos, modulo, tituloItem, transformarListagem, acoesExtras, somenteAdmin = false }) {
  const nomeItem = tituloItem || titulo;

  return async function render(container) {
    if (somenteAdmin && !ehAdmin()) return renderizarAcessoNegado(container);
    container.innerHTML = `<h1 class="mb-4 text-xl font-bold text-slate-900">${titulo}</h1><div data-tabela></div>`;
    const gerenciar = somenteAdmin ? true : podeGerenciar(modulo);

    async function abrirForm(registro) {
      const camposResolvidos = typeof campos === 'function' ? await campos() : campos;
      const form = criarFormulario({
        campos: camposResolvidos,
        valoresIniciais: registro || {},
        textoSalvar: registro ? 'Salvar alteracoes' : 'Cadastrar',
        aoSalvar: async (valores) => {
          if (registro) await put(`${endpoint}/${registro.id}`, valores);
          else await post(endpoint, valores);
          fecharModal();
          mostrarToast(registro ? `${nomeItem} atualizado(a).` : `${nomeItem} cadastrado(a).`);
          tabela.recarregar();
        },
      });
      abrirModal({ titulo: registro ? `Editar ${nomeItem}` : `Novo(a) ${nomeItem}`, conteudo: form });
    }

    const tabela = criarDataTable({
      colunas,
      buscarDados: async (termo) => {
        let linhas = await get(termo ? `${endpoint}?search=${encodeURIComponent(termo)}` : endpoint);
        if (transformarListagem) linhas = await transformarListagem(linhas);
        return linhas;
      },
      onNovo: gerenciar ? () => abrirForm(null) : undefined,
      onEditar: gerenciar ? (r) => abrirForm(r) : undefined,
      onExcluir: gerenciar ? (r) => del(`${endpoint}/${r.id}`) : undefined,
      onExcluirLote: gerenciar ? (ids) => post(`${endpoint}/batch-delete`, { ids }) : undefined,
      tituloNovo: nomeItem,
      acoesExtras,
    });
    container.querySelector('[data-tabela]').appendChild(tabela.el);
  };
}
