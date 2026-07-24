import { post, salvarSessao, salvarEmpresaAtiva, getEmpresaAtiva } from '../api.js';
import { navegar } from '../router.js';
import { ROTA_PAINEL } from '../modulosConfig.js';

export function renderLogin(root) {
  root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex min-h-screen items-center justify-center bg-slate-100 px-4';
  wrapper.innerHTML = `
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <img src="/img/logo-frottex.png" alt="Frottex" class="mx-auto h-24 w-auto" />
        <p class="mt-2 text-sm text-slate-500">Gestao de Frota e Transporte Rodoviario</p>
      </div>
      <form class="card space-y-4 border-t-4 border-brand-yellow p-6">
        <div>
          <label class="label">Usuario</label>
          <input type="text" name="username" class="input" required autofocus autocapitalize="off" />
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
        username: form.username.value.trim(),
        senha: form.senha.value,
      });
      salvarSessao(token, { ...usuario, permissoes, empresas, podeTodas });
      // Sem empresa ativa ainda (1o login): seleciona a unica/1a disponivel
      // automaticamente, senao toda tela ficaria bloqueada por "selecione uma empresa".
      if (!getEmpresaAtiva() && empresas && empresas.length) {
        salvarEmpresaAtiva(empresas[0].id);
      }
      window.location.hash = usuario.perfil === 'Motorista' ? '#/motorista' : `#${ROTA_PAINEL}`;
      window.location.reload();
    } catch (err) {
      erro.textContent = err.message || 'Nao foi possivel entrar.';
      erro.classList.remove('hidden');
    } finally {
      botao.disabled = false;
    }
  });
}
