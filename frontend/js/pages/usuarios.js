import { get, post, put, del, ehAdmin } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';

const PERFIS = ['Admin', 'Comum', 'Visualizacao'];
const NIVEIS = ['Nenhum', 'Visualizar', 'Gerenciar'];

function montarFormularioUsuario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Nome *</label><input type="text" name="nome" class="input" required /></div>
    <div><label class="label">E-mail *</label><input type="email" name="email" class="input" required /></div>
    <div><label class="label">Senha ${registro ? '(deixe vazio para manter)' : '*'}</label><input type="password" name="senha" class="input" ${registro ? '' : 'required'} /></div>
    <div><label class="label">Perfil *</label><select name="perfil" class="input" required>${PERFIS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
    ${registro ? '<div class="flex items-center gap-2"><input type="checkbox" name="ativo" id="ativo-usuario" class="h-4 w-4" /><label for="ativo-usuario" class="text-sm">Ativo</label></div>' : ''}
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  form.nome.value = registro?.nome || '';
  form.email.value = registro?.email || '';
  form.perfil.value = registro?.perfil || 'Comum';
  if (registro) form.ativo.checked = Boolean(registro.ativo);
  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const valores = { nome: form.nome.value, email: form.email.value, perfil: form.perfil.value };
    if (form.senha.value) valores.senha = form.senha.value;
    if (registro) valores.ativo = form.ativo.checked ? 1 : 0;
    try {
      await aoSalvar(valores);
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });
  return form;
}

async function abrirFormularioUsuario(registro, recarregar) {
  const form = montarFormularioUsuario(registro, async (valores) => {
    if (registro) await put(`/usuarios/${registro.id}`, valores);
    else await post('/usuarios', valores);
    fecharModal();
    mostrarToast(registro ? 'Usuario atualizado.' : 'Usuario cadastrado.');
    recarregar();
  });
  abrirModal({ titulo: registro ? `Editar ${registro.nome}` : 'Novo usuario', conteudo: form });
}

async function abrirPermissoes(usuarioRow) {
  try {
    const { usuario, permissoes } = await get(`/usuarios/${usuarioRow.id}/permissoes`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="mb-3 text-sm text-slate-500">Perfil base: <span class="font-medium">${usuario.perfil}</span>. Mude o nivel abaixo so onde o acesso deve ser diferente do padrao.</p>
      <div class="max-h-96 space-y-1 overflow-y-auto">
        ${permissoes.map((p) => `
          <div class="flex items-center justify-between rounded-lg px-2 py-1.5 ${p.excecao ? 'bg-amber-50' : ''}">
            <span class="text-sm text-slate-700">${p.nome}</span>
            <select class="input w-40" data-modulo="${p.modulo}">
              ${NIVEIS.map((n) => `<option value="${n}" ${n === p.nivel ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
      <p class="hidden mt-3 text-sm text-red-600" data-erro></p>
      <div class="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" class="btn-primary" data-salvar>Salvar permissoes</button>
      </div>
    `;
    const overlay = abrirModal({ titulo: `Permissoes - ${usuario.nome}`, conteudo: corpo, largura: 'max-w-lg' });
    overlay.querySelector('[data-salvar]').addEventListener('click', async () => {
      const selects = overlay.querySelectorAll('[data-modulo]');
      const payload = [...selects].map((s) => ({ modulo: s.dataset.modulo, nivel: s.value }));
      try {
        await put(`/usuarios/${usuarioRow.id}/permissoes`, { permissoes: payload });
        fecharModal();
        mostrarToast('Permissoes atualizadas.');
      } catch (err) {
        const erroEl = overlay.querySelector('[data-erro]');
        erroEl.textContent = err.message;
        erroEl.classList.remove('hidden');
      }
    });
  } catch (err) {
    mostrarErro(err);
  }
}

export async function render(container) {
  if (!ehAdmin()) return renderizarAcessoNegado(container);
  container.innerHTML = '<h1 class="mb-4 text-xl font-bold text-slate-900">Usuarios e Permissoes</h1><div data-tabela></div>';

  const tabela = criarDataTable({
    colunas: [
      { chave: 'nome', titulo: 'Nome' },
      { chave: 'email', titulo: 'E-mail' },
      { chave: 'perfil', titulo: 'Perfil' },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
    ],
    buscarDados: () => get('/usuarios'),
    onNovo: () => abrirFormularioUsuario(null, tabela.recarregar),
    onEditar: (r) => abrirFormularioUsuario(r, tabela.recarregar),
    onExcluir: (r) => del(`/usuarios/${r.id}`),
    acoesExtras: (r) => (r.perfil === 'Admin' ? [] : [{ label: 'Permissoes', onClick: abrirPermissoes }]),
    tituloNovo: 'Usuario',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
