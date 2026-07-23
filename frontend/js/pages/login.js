import { post, salvarSessao, salvarEmpresaAtiva, getEmpresaAtiva } from '../api.js';
import { navegar } from '../router.js';

export function renderLogin(root) {
  root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex min-h-screen items-center justify-center bg-slate-100 px-4';
  wrapper.innerHTML = `
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-bold text-slate-900">Frottex</h1>
        <p class="mt-1 text-sm text-slate-500">Gestao de Frota e Transporte Rodoviario</p>
      </div>
      <form class="card space-y-4 p-6">
        <div>
          <label class="label">E-mail</label>
          <input type="email" name="email" class="input" required autofocus />
        </div>
        <div>
          <label class="label">Senha</label>
          <input type="password" name="senha" class="input" required />
        </div>
        <p class="hidden text-sm text-red-600" data-erro></p>
        <button type="submit" class="btn-primary w-full">Entrar</button>
      </form>
    </div>
  `;
  root.appendChild(wrapper);

  const form = wrapper.querySelector('form');
  const erro = wrapper.querySelector('[data-erro]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.classList.add('hidden');
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      const { token, usuario, permissoes, empresas, podeTodas } = await post('/auth/login', {
        email: form.email.value.trim(),
        senha: form.senha.value,
      });
      salvarSessao(token, { ...usuario, permissoes, empresas, podeTodas });
      // Sem empresa ativa ainda (1o login): seleciona a unica/1a disponivel
      // automaticamente, senao toda tela ficaria bloqueada por "selecione uma empresa".
      if (!getEmpresaAtiva() && empresas && empresas.length) {
        salvarEmpresaAtiva(empresas[0].id);
      }
      window.location.hash = '#/dashboard';
      window.location.reload();
    } catch (err) {
      erro.textContent = err.message || 'Nao foi possivel entrar.';
      erro.classList.remove('hidden');
    } finally {
      botao.disabled = false;
    }
  });
}
