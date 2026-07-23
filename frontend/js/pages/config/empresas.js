import { get, post, put, del, ehAdmin } from '../../api.js';
import { criarDataTable } from '../../components/dataTable.js';
import { abrirModal, fecharModal } from '../../components/modal.js';
import { mostrarToast, mostrarErro } from '../../components/toast.js';
import { renderizarAcessoNegado } from '../../components/acessoNegado.js';
import { attachCpfCnpjMask, apenasDigitos, formatarCpfCnpj, validarCnpj } from '../../masks.js';

function abrirFormEmpresa(registro, recarregar) {
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.innerHTML = `
    <div>
      <label class="label">CNPJ *</label>
      <div class="flex gap-2">
        <input type="text" name="cnpj" class="input flex-1" required />
        <button type="button" class="btn-secondary shrink-0" data-buscar-cnpj>Buscar CNPJ</button>
      </div>
      <p class="mt-1 hidden text-xs text-red-600" data-erro-cnpj></p>
    </div>
    <div><label class="label">Razão Social *</label><input type="text" name="razao_social" class="input" required /></div>
    <div><label class="label">Nome Fantasia</label><input type="text" name="nome_fantasia" class="input" /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Inscrição Estadual</label><input type="text" name="inscricao_estadual" class="input" /></div>
      <div><label class="label">Telefone</label><input type="text" name="telefone" class="input" /></div>
    </div>
    <div><label class="label">E-mail</label><input type="email" name="email" class="input" /></div>
    <div class="grid grid-cols-3 gap-3">
      <div class="col-span-2"><label class="label">Logradouro</label><input type="text" name="endereco_logradouro" class="input" /></div>
      <div><label class="label">Número</label><input type="text" name="endereco_numero" class="input" /></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">Complemento</label><input type="text" name="endereco_complemento" class="input" /></div>
      <div><label class="label">Bairro</label><input type="text" name="endereco_bairro" class="input" /></div>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <div><label class="label">CEP</label><input type="text" name="endereco_cep" class="input" /></div>
      <div><label class="label">Cidade</label><input type="text" name="endereco_cidade" class="input" /></div>
      <div><label class="label">UF</label><input type="text" name="endereco_uf" class="input" maxlength="2" /></div>
    </div>
    <div class="border-t border-slate-200 pt-3">
      <h3 class="mb-1 text-sm font-semibold text-slate-900">Integração Onixsat</h3>
      <p class="mb-2 text-xs text-slate-500">Credenciais de rastreamento deste CNPJ (por empresa, para suportar múltiplos contratos no futuro).</p>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Usuário Onixsat</label><input type="text" name="onixsat_usuario" class="input" autocomplete="off" /></div>
        <div><label class="label">Senha Onixsat</label><input type="password" name="onixsat_senha" class="input" autocomplete="new-password" /></div>
      </div>
    </div>
    <div class="border-t border-slate-200 pt-3">
      <h3 class="mb-1 text-sm font-semibold text-slate-900">Imposto sobre o frete</h3>
      <p class="mb-2 text-xs text-slate-500">% a descontar do frete bruto no fechamento do Acerto (deixe em branco se esta empresa nao desconta imposto). Aparece la como "Imposto (nome da empresa)".</p>
      <div><label class="label">% desconto geral (imposto)</label><input type="number" step="0.01" min="0" max="100" name="percentual_desconto_geral" class="input max-w-[10rem]" placeholder="Ex: 10" /></div>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="empresa-ativo" class="h-4 w-4 rounded border-slate-300" ${registro && !registro.ativo ? '' : 'checked'} />
      <label for="empresa-ativo" class="text-sm text-slate-700">Ativa</label>
    </div>
    <p class="hidden text-sm text-red-600" data-erro></p>
    <div class="flex justify-end gap-2 pt-2">
      <button type="submit" class="btn-primary">${registro ? 'Salvar alterações' : 'Cadastrar'}</button>
    </div>
  `;

  const campos = [
    'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual',
    'endereco_logradouro', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep',
    'telefone', 'email', 'onixsat_usuario', 'onixsat_senha', 'percentual_desconto_geral',
  ];
  for (const nome of campos) {
    if (registro && registro[nome] != null) form.elements[nome].value = registro[nome];
  }
  attachCpfCnpjMask(form.cnpj, registro ? registro.cnpj : '');

  const erro = form.querySelector('[data-erro]');
  const erroCnpj = form.querySelector('[data-erro-cnpj]');

  form.querySelector('[data-buscar-cnpj]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    erroCnpj.classList.add('hidden');
    const digitos = apenasDigitos(form.cnpj.value);
    if (digitos.length !== 14) {
      erroCnpj.textContent = 'Digite os 14 números do CNPJ antes de buscar.';
      erroCnpj.classList.remove('hidden');
      return;
    }
    if (!validarCnpj(digitos)) {
      erroCnpj.textContent = 'CNPJ com dígitos verificadores inválidos - confira o número digitado.';
      erroCnpj.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Buscando...';
    try {
      const dados = await get(`/cnpj/${digitos}`);
      for (const campo of ['razao_social', 'nome_fantasia', 'endereco_logradouro', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_uf', 'endereco_cep', 'telefone', 'email']) {
        if (dados[campo]) form.elements[campo].value = dados[campo];
      }
      mostrarToast('Dados preenchidos - confira antes de salvar.');
    } catch (err) {
      erroCnpj.textContent = err.message;
      erroCnpj.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar CNPJ';
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const cnpjDigitos = apenasDigitos(form.cnpj.value);
    if (!validarCnpj(cnpjDigitos)) {
      erro.textContent = 'CNPJ inválido - confira os dígitos verificadores.';
      erro.classList.remove('hidden');
      return;
    }
    const valores = { ativo: form.querySelector('#empresa-ativo').checked ? 1 : 0 };
    for (const nome of campos) valores[nome] = form.elements[nome].value || null;
    valores.cnpj = cnpjDigitos;
    valores.percentual_desconto_geral = form.percentual_desconto_geral.value ? Number(form.percentual_desconto_geral.value) : null;
    try {
      if (registro) await put(`/empresas/${registro.id}`, valores);
      else await post('/empresas', valores);
      fecharModal();
      mostrarToast(registro ? 'Empresa atualizada.' : 'Empresa cadastrada.');
      recarregar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
    }
  });

  abrirModal({ titulo: registro ? 'Editar Empresa' : 'Nova Empresa', conteudo: form, largura: 'max-w-xl' });
}

export async function render(container) {
  if (!ehAdmin()) return renderizarAcessoNegado(container);

  container.innerHTML = `<h1 class="mb-4 text-xl font-bold text-slate-900">Empresas</h1><div data-tabela></div>`;

  const tabela = criarDataTable({
    colunas: [
      { chave: 'razao_social', titulo: 'Razão Social' },
      { chave: 'cnpj', titulo: 'CNPJ', render: (r) => formatarCpfCnpj(r.cnpj) },
      { chave: 'endereco_cidade', titulo: 'Cidade/UF', render: (r) => [r.endereco_cidade, r.endereco_uf].filter(Boolean).join('/') || '-' },
      { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativa</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativa</span>') },
    ],
    buscarDados: (termo) => get(termo ? `/empresas?search=${encodeURIComponent(termo)}` : '/empresas'),
    onNovo: () => abrirFormEmpresa(null, tabela.recarregar),
    onEditar: (r) => abrirFormEmpresa(r, tabela.recarregar),
    onExcluir: (r) => del(`/empresas/${r.id}`),
    tituloNovo: 'Empresa',
    vazio: 'Nenhuma empresa cadastrada ainda.',
  });
  container.querySelector('[data-tabela]').appendChild(tabela.el);
}
