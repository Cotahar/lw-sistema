import { get, post } from '../api.js';
import { abrirModal, fecharModal } from './modal.js';

// Quick-create de fornecedor a partir do "+ Cadastrar novo" do
// searchableSelect (so telas do escritorio - ver criarNovo em
// searchableSelect.js). Evita interromper o fluxo (lancar uma despesa,
// cadastrar um pneu etc.) so pra ir na tela de Fornecedores e voltar. Pede
// so o minimo (nome + tipo, unicos campos obrigatorios na rota); os demais
// campos (CNPJ, telefone, localizacao) continuam editaveis depois, na tela
// de Fornecedores completa - "caso o motorista cadastre errado, corrigimos
// manualmente" e o mesmo principio aqui, so que pro escritorio.
export function criarNovoFornecedor() {
  return new Promise((resolve) => {
    let resolvido = false;
    const form = document.createElement('form');
    form.className = 'space-y-4';
    form.innerHTML = `
      <div><label class="label">Nome *</label><input type="text" name="nome" class="input" required autofocus /></div>
      <div><label class="label">Tipo *</label><select name="tipo_id" class="input" required data-tipo></select></div>
      <p class="hidden text-sm text-red-600" data-erro></p>
      <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">Cadastrar</button></div>
    `;
    const selectTipo = form.querySelector('[data-tipo]');
    get('/fornecedor-tipos').then((tipos) => {
      selectTipo.innerHTML = tipos.map((t) => `<option value="${t.id}">${t.nome}</option>`).join('');
    }).catch(() => {
      selectTipo.innerHTML = '<option value="">Erro ao carregar tipos</option>';
    });
    const erro = form.querySelector('[data-erro]');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erro.classList.add('hidden');
      try {
        const criado = await post('/fornecedores', { nome: form.nome.value, tipo_id: Number(form.tipo_id.value) });
        resolvido = true;
        fecharModal();
        resolve({ value: criado.id, label: criado.nome });
      } catch (err) {
        erro.textContent = err.message;
        erro.classList.remove('hidden');
      }
    });
    abrirModal({ titulo: 'Novo fornecedor', conteudo: form });
    // Fechou sem salvar (X, clique fora) - devolve null pro select voltar o
    // foco pra busca. modal.js nao tem hook de "fechou"; observa o DOM.
    const observador = new MutationObserver(() => {
      if (!document.body.contains(form)) {
        observador.disconnect();
        if (!resolvido) resolve(null);
      }
    });
    observador.observe(document.body, { childList: true, subtree: true });
  });
}
