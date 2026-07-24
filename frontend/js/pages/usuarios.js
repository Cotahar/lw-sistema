import { get, post, put, del, ehAdmin } from '../api.js';
import { criarDataTable } from '../components/dataTable.js';
import { criarSearchableSelect } from '../components/searchableSelect.js';
import { abrirModal, fecharModal } from '../components/modal.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';

const PERFIS = ['Admin', 'Comum', 'Visualizacao', 'Motorista'];
const NIVEIS = ['Nenhum', 'Visualizar', 'Gerenciar'];

async function buscarMotoristas(termo) {
  return (await get(`/motoristas${termo ? `?search=${encodeURIComponent(termo)}` : ''}`)).map((m) => ({ value: m.id, label: m.nome }));
}

function montarFormularioUsuario(registro, aoSalvar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div><label class="label">Nome *</label><input type="text" name="nome" class="input" required /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">E-mail *</label><input type="email" name="email" class="input" required /></div>
      <div><label class="label">Usuario (login) *</label><input type="text" name="username" class="input" required autocapitalize="off" /></div>
    </div>
    <div><label class="label">Senha ${registro ? '(deixe vazio para manter)' : '*'}</label><input type="password" name="senha" class="input" ${registro ? '' : 'required'} /></div>
    <div><label class="label">Perfil *</label><select name="perfil" class="input" required>${PERFIS.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></div>
    <div class="hidden" data-bloco-motorista><label class="label">Motorista vinculado *</label><div data-motorista-select></div></div>
    ${registro ? '<div class="flex items-center gap-2"><input type="checkbox" name="ativo" id="ativo-usuario" class="h-4 w-4" /><label for="ativo-usuario" class="text-sm">Ativo</label></div>' : ''}
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2"><button type="submit" class="btn-primary">${registro ? 'Salvar alteracoes' : 'Cadastrar'}</button></div>
  `;
  form.nome.value = registro?.nome || '';
  form.email.value = registro?.email || '';
  form.username.value = registro?.username || '';
  form.perfil.value = registro?.perfil || 'Comum';
  if (registro) form.ativo.checked = Boolean(registro.ativo);

  const motoristaSelect = criarSearchableSelect({
    buscar: buscarMotoristas,
    valorInicial: registro?.motorista_id ?? null,
    labelInicial: registro?.motorista_nome || '',
    placeholder: 'Pesquisar motorista...',
  });
  form.querySelector('[data-motorista-select]').appendChild(motoristaSelect.el);

  function atualizarBlocoMotorista() {
    form.querySelector('[data-bloco-motorista]').classList.toggle('hidden', form.perfil.value !== 'Motorista');
  }
  form.perfil.addEventListener('change', atualizarBlocoMotorista);
  atualizarBlocoMotorista();

  const erro = form.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    if (form.perfil.value === 'Motorista' && !motoristaSelect.getValue()) {
      erro.textContent = 'Selecione o motorista vinculado a este usuario.';
      erro.classList.remove('hidden');
      return;
    }
    const valores = {
      nome: form.nome.value, email: form.email.value, username: form.username.value, perfil: form.perfil.value,
      motorista_id: form.perfil.value === 'Motorista' ? motoristaSelect.getValue() : null,
    };
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

async function abrirEmpresas(usuarioRow) {
  try {
    const { usuario, empresas } = await get(`/usuarios/${usuarioRow.id}/empresas`);
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="mb-3 text-sm text-slate-500">Marque as empresas que <span class="font-medium">${usuario.nome}</span> pode acessar.</p>
      <div class="max-h-96 space-y-1 overflow-y-auto">
        ${empresas.map((e) => `
          <div class="flex items-center justify-between rounded-lg px-2 py-1.5">
            <span class="text-sm text-slate-700">${e.razao_social}</span>
            <input type="checkbox" class="h-4 w-4" data-empresa="${e.id}" ${e.concedida ? 'checked' : ''} />
          </div>
        `).join('')}
      </div>
      ${!empresas.length ? '<p class="text-sm text-slate-500">Nenhuma empresa ativa cadastrada.</p>' : ''}
      <p class="hidden mt-3 text-sm text-red-600" data-erro></p>
      <div class="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" class="btn-primary" data-salvar>Salvar empresas</button>
      </div>
    `;
    const overlay = abrirModal({ titulo: `Empresas - ${usuario.nome}`, conteudo: corpo, largura: 'max-w-lg' });
    overlay.querySelector('[data-salvar]').addEventListener('click', async () => {
      const checkboxes = overlay.querySelectorAll('[data-empresa]');
      const empresaIds = [...checkboxes].filter((c) => c.checked).map((c) => Number(c.dataset.empresa));
      try {
        await put(`/usuarios/${usuarioRow.id}/empresas`, { empresaIds });
        fecharModal();
        mostrarToast('Empresas atualizadas.');
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
    acoesExtras: (r) => (['Admin', 'Motorista'].includes(r.perfil) ? [] : [{ label: 'Permissoes', onClick: abrirPermissoes }, { label: 'Empresas', onClick: abrirEmpresas }]),
    tituloNovo: 'Usuario',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
