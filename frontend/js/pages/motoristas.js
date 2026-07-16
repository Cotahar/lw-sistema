import { get } from '../api.js';
import { criarPaginaCrud } from './crudGenerico.js';
import { formatarCpfCnpj, formatarDataBr, formatarMoeda } from '../masks.js';
import { abrirModal } from '../components/modal.js';
import { mostrarErro } from '../components/toast.js';

async function verContaCorrente(motorista) {
  try {
    const lancamentos = await get(`/motoristas/${motorista.id}/conta-corrente`);
    const corpo = document.createElement('div');
    if (!lancamentos.length) {
      corpo.innerHTML = '<p class="text-sm text-slate-400">Nenhum lancamento ainda.</p>';
    } else {
      corpo.innerHTML = `
        <div class="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span class="font-medium">Saldo atual: </span>${formatarMoeda(motorista.saldo_conta_corrente)}
          <span class="text-xs text-slate-500">${motorista.saldo_conta_corrente > 0 ? '(motorista deve a empresa)' : ''}</span>
        </div>
        <table class="w-full text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th class="py-1">Data</th><th class="py-1">Tipo</th><th class="py-1 text-right">Valor</th><th class="py-1 text-right">Saldo apos</th>
          </tr></thead>
          <tbody>
            ${lancamentos.map((l) => `
              <tr class="border-b border-slate-100">
                <td class="py-1">${formatarDataBr(l.data)}</td>
                <td class="py-1">${l.tipo === 'DebitoResidual' ? 'Debito (a descontar)' : l.tipo === 'CreditoAbatido' ? 'Credito (quitado)' : 'Ajuste manual'}</td>
                <td class="py-1 text-right">${formatarMoeda(l.valor)}</td>
                <td class="py-1 text-right font-medium">${formatarMoeda(l.saldo_posterior)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    abrirModal({ titulo: `Conta corrente - ${motorista.nome}`, conteudo: corpo, largura: 'max-w-xl' });
  } catch (err) {
    mostrarErro(err);
  }
}

export const render = criarPaginaCrud({
  titulo: 'Motoristas',
  tituloItem: 'Motorista',
  endpoint: '/motoristas',
  modulo: 'motoristas',
  campos: [
    { nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
    { nome: 'cpf', label: 'CPF', tipo: 'cpf_cnpj', obrigatorio: true },
    { nome: 'cnh', label: 'CNH', tipo: 'texto', obrigatorio: true },
    { nome: 'cnh_validade', label: 'Validade da CNH', tipo: 'data', obrigatorio: true },
  ],
  colunas: [
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'cpf', titulo: 'CPF', render: (r) => formatarCpfCnpj(r.cpf) },
    { chave: 'cnh', titulo: 'CNH' },
    { chave: 'cnh_validade', titulo: 'Validade CNH', render: (r) => formatarDataBr(r.cnh_validade) },
    { chave: 'saldo_conta_corrente', titulo: 'Conta Corrente', render: (r) => formatarMoeda(r.saldo_conta_corrente) },
    { chave: 'ativo', titulo: 'Status', render: (r) => (r.ativo ? '<span class="badge bg-emerald-100 text-emerald-700">Ativo</span>' : '<span class="badge bg-slate-100 text-slate-500">Inativo</span>') },
  ],
  acoesExtras: (r) => [{ label: 'Conta corrente', onClick: verContaCorrente }],
});
