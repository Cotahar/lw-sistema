// Pilha de modais abertos (do mais antigo ao mais recente) - permite abrir um
// modal por cima de outro (ex.: "+ Cadastrar novo fornecedor" a partir de um
// formulario de despesa ja aberto) sem destruir o de baixo. Cada item:
// { overlay, aoFechar }.
const pilha = [];

function topoAtual() {
  return pilha[pilha.length - 1] || null;
}

// Esc fecha so o modal do topo - padrao que todo usuario de teclado/mouse
// espera, e antes so dava pra fechar clicando no X ou no botao de
// cancelar/fora do modal. Um so listener global (nao um por abertura de
// modal, senao acumularia handler a cada abrirModal). searchableSelect.js
// para a propagacao do proprio Escape quando so quer fechar a lista de
// sugestoes (nao o formulario inteiro por cima) - ver comentario la.
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && topoAtual()) fecharModal();
});

// Duracao da saida (ms) - precisa bater com a animacao ".fechando" no CSS
// (input.css) pra nao cortar a transicao no meio nem deixar vao antes de
// remover o elemento.
const DURACAO_SAIDA = 120;

// Fecha SO o modal do topo da pilha (o mais recente) - se houver outro
// embaixo, ele continua aberto e intacto (nao recarrega, nao perde estado).
export function fecharModal() {
  const item = pilha.pop();
  if (!item) return;
  const { overlay, aoFechar } = item;
  overlay.classList.add('fechando');
  overlay.querySelector(':scope > div')?.classList.add('fechando');
  setTimeout(() => overlay.remove(), DURACAO_SAIDA);
  // Dispara DEPOIS de tirar da pilha, pra quem escuta poder abrir outro modal
  // na hora (ex.: um fluxo que encadeia modals) sem o fecharModal() do
  // proximo achar que este ainda esta na pilha.
  if (aoFechar) aoFechar();
}

// Usado pelas paginas com atualizacao automatica em segundo plano (Viagem,
// Veiculos, Painel) pra nunca recarregar com um formulario aberto por cima -
// perderia o que o usuario ja tinha preenchido no modal.
export function modalAberto() {
  return pilha.length > 0;
}

// Abre um modal generico por cima de qualquer outro ja aberto (empilha em vez
// de substituir). `conteudo` pode ser string HTML ou um Node. Retorna o
// elemento raiz do modal, para quem chamou poder buscar campos etc.
export function abrirModal({ titulo, conteudo, largura = 'max-w-lg', aoFechar }) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8 fade-in';
  overlay.innerHTML = `
    <div class="scale-in w-full ${largura} rounded-2xl bg-brand-surface shadow-xl">
      <div class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 class="text-base font-semibold text-gray-900">${titulo}</h3>
        <button type="button" data-fechar-modal class="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-gray-900">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </div>
      <div class="px-5 py-4" data-modal-corpo></div>
    </div>
  `;
  const corpo = overlay.querySelector('[data-modal-corpo]');
  if (typeof conteudo === 'string') corpo.innerHTML = conteudo;
  else corpo.appendChild(conteudo);

  // IMPORTANTE: nao fechar ao clicar fora (no overlay/background) - so pelo
  // X, algum outro botao de fechar/cancelar do proprio formulario, ou Esc.
  // Clique fora era facil demais de disparar sem querer (ex.: selecionando
  // texto e soltando o mouse fora) e derrubava formularios longos ja
  // preenchidos.
  overlay.querySelector('[data-fechar-modal]').addEventListener('click', fecharModal);

  document.body.appendChild(overlay);
  pilha.push({ overlay, aoFechar: aoFechar || null });
  return overlay;
}

// Modal de confirmacao (obrigatorio para exclusoes, por regra do PRD).
// Fechar de QUALQUER jeito sem confirmar (Cancelar, X, clicar fora, Esc)
// resolve false via aoFechar - antes so os botoes resolviam a Promise, entao
// fechar pelo X/fora/Esc deixava o await de quem chamou preso pra sempre
// (bug que so ficou visivel depois do Esc passar a fechar o modal).
export function confirmarAcao({ titulo = 'Confirmar', mensagem, textoConfirmar = 'Confirmar', perigo = true }) {
  return new Promise((resolve) => {
    const corpo = document.createElement('div');
    corpo.innerHTML = `
      <p class="text-sm text-slate-600">${mensagem}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" data-cancelar class="btn-secondary">Cancelar</button>
        <button type="button" data-confirmar class="${perigo ? 'btn-danger' : 'btn-primary'}">${textoConfirmar}</button>
      </div>
    `;
    const overlay = abrirModal({ titulo, conteudo: corpo, largura: 'max-w-md', aoFechar: () => resolve(false) });
    overlay.querySelector('[data-cancelar]').addEventListener('click', fecharModal);
    overlay.querySelector('[data-confirmar]').addEventListener('click', () => {
      resolve(true);
      fecharModal();
    });
  });
}
