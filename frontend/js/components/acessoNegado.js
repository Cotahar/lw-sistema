export function renderizarAcessoNegado(container, mensagem = 'Esta tela e restrita ao perfil Admin.') {
  container.innerHTML = `<div class="card p-8 text-center text-slate-400">${mensagem}</div>`;
}
