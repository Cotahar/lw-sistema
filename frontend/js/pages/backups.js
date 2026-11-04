import { get, post, ehAdmin, authHeaders } from '../api.js';
import { mostrarToast, mostrarErro } from '../components/toast.js';
import { formatarDataBr, formatarDataHoraBr } from '../masks.js';
import { renderizarAcessoNegado } from '../components/acessoNegado.js';
import { esqueletoLinhasTabela } from '../components/skeleton.js';
import { esc } from '../html.js';

// Backups do banco (Admin): o que esta no volume do Railway, a situacao da copia externa (fora do
// Railway - ver backend/src/utils/backupExterno.js) e o botao de baixar um backup pro computador.

function tamanho(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function linhaStatus(titulo, resultado, descreverOk) {
  if (!resultado) return `<p class="text-sm text-slate-500"><span class="font-medium text-slate-700">${titulo}:</span> nada registrado desde que o servidor iniciou.</p>`;
  if (resultado.erro) return `<p class="text-sm text-danger"><span class="font-medium">${titulo}:</span> FALHOU em ${formatarDataHoraBr(resultado.em)} - ${esc(resultado.erro)}</p>`;
  return `<p class="text-sm text-slate-600"><span class="font-medium text-slate-700">${titulo}:</span> ok em ${formatarDataHoraBr(resultado.em)} - ${descreverOk(resultado)}</p>`;
}

// O download precisa do token (Authorization), entao nao da pra ser um <a href> simples.
async function baixar(arquivo, botao) {
  botao.disabled = true;
  try {
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(arquivo)}/download`, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.erro || `Erro ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = arquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    mostrarErro(err);
  } finally {
    botao.disabled = false;
  }
}

export async function render(container) {
  if (!ehAdmin()) return renderizarAcessoNegado(container);

  container.innerHTML = `
    <h1 class="mb-1 text-xl font-bold text-slate-900">Backups</h1>
    <p class="mb-4 text-sm text-slate-500">Copia diaria do banco de dados. Os backups abaixo ficam no mesmo servidor do sistema; a copia externa (fora do Railway) protege contra perder o servidor inteiro.</p>
    <div class="card mb-4 space-y-1.5 border-gray-300 p-4" data-status></div>
    <div class="card overflow-x-auto border-gray-300 p-0">
      <table class="w-full min-w-max border-collapse">
        <thead class="bg-elevated"><tr>
          <th class="table-th">Data</th><th class="table-th">Arquivo</th><th class="table-th">Tamanho</th><th class="table-th"></th>
        </tr></thead>
        <tbody data-linhas></tbody>
      </table>
    </div>
  `;

  const statusEl = container.querySelector('[data-status]');
  const tbody = container.querySelector('[data-linhas]');

  async function carregar() {
    tbody.innerHTML = esqueletoLinhasTabela(4);
    try {
      const info = await get('/admin/backups');
      const externo = info.externo.configurado
        ? `<span class="font-medium text-green-700">ligada</span> (bucket ${esc(info.externo.bucket)})`
        : '<span class="font-medium text-warning">desligada</span> - configure as variaveis BACKUP_S3_* no Railway (passo a passo no README do projeto). Enquanto isso, baixe um backup por semana pelo botao abaixo.';
      statusEl.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1.5">
            <p class="text-sm text-slate-600"><span class="font-medium text-slate-700">Backup diario:</span> ${info.ativo ? `todo dia apos as ${String(info.hora).padStart(2, '0')}h, guardando ${info.manter} diario(s) + ${info.manterMensal} mensal(is)` : '<span class="text-danger">DESATIVADO (BACKUP_DIARIO=0)</span>'}</p>
            <p class="text-sm text-slate-600"><span class="font-medium text-slate-700">Copia externa:</span> ${externo}</p>
            ${linhaStatus('Ultimo backup gerado', info.ultimoBackupLocal, (r) => `${esc(r.arquivo)} (${tamanho(r.bytes)})`)}
            ${info.externo.configurado ? linhaStatus('Ultimo envio externo', info.ultimoEnvioExterno, (r) => `${r.enviados.length} arquivo(s) do banco (${tamanho(r.bytesBanco)}) + ${r.uploads.quantidade} anexo(s) novo(s)`) : ''}
          </div>
          <button type="button" class="btn-secondary btn-sm" data-executar>Executar agora</button>
        </div>
      `;
      statusEl.querySelector('[data-executar]').addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        ev.target.textContent = 'Executando...';
        try {
          const r = await post('/admin/backups/executar', {});
          const falha = (r.ultimoBackupLocal && r.ultimoBackupLocal.erro) || (r.ultimoEnvioExterno && r.ultimoEnvioExterno.erro);
          if (falha) mostrarErro(new Error(falha));
          else mostrarToast('Backup conferido.');
        } catch (err) {
          mostrarErro(err);
        }
        await carregar();
      });

      tbody.innerHTML = info.backups.length ? info.backups.map((b) => `
        <tr class="border-b border-slate-100">
          <td class="table-td">${formatarDataBr(b.data)}</td>
          <td class="table-td font-mono text-xs">${esc(b.arquivo)}</td>
          <td class="table-td">${tamanho(b.bytes)}</td>
          <td class="table-td text-right"><button type="button" class="btn-secondary btn-sm" data-baixar="${esc(b.arquivo)}">Baixar</button></td>
        </tr>
      `).join('') : '<tr><td colspan="4" class="table-td py-6 text-center text-slate-400">Nenhum backup ainda.</td></tr>';
      tbody.querySelectorAll('[data-baixar]').forEach((btn) => btn.addEventListener('click', () => baixar(btn.dataset.baixar, btn)));
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-td py-6 text-center text-danger">Erro ao carregar.</td></tr>';
      mostrarErro(err);
    }
  }

  await carregar();
}
