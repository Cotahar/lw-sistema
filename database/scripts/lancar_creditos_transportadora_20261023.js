// Faturas do Sem Parar JA importadas (ago/set/out-2026): lanca o custo dos creditos de TRANSPORTADORA, que fazem parte do pagamento
// do frete e por isso nao podem abater o custo do pedagio (decisao do usuario, 23/10/2026). Custo extra por placa, na categoria PEDAGIO,
// SEM conta a pagar (a conta a pagar da fatura continua sendo o total pago ao Sem Parar).
//   node database/scripts/lancar_creditos_transportadora_20261023.js --payloads=a.json,b.json,c.json            (so simula)
//   node database/scripts/lancar_creditos_transportadora_20261023.js --payloads=... --aplicar
//   (em producao: --backend=/app/backend). Cada payload tem as abas da fatura COM as colunas EMBARCADOR e CNPJ da aba CREDITOS.
// Idempotente (pula a fatura que ja teve os creditos lancados).
const fs = require('node:fs');
const path = require('node:path');

const aplicar = process.argv.includes('--aplicar');
const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const BACKEND = arg('backend') || path.resolve(__dirname, '../../backend');
const payloads = arg('payloads').split(',').filter(Boolean);
if (!payloads.length) { console.error('Informe --payloads=arquivo1.json,...'); process.exit(1); }

const db = require(path.join(BACKEND, 'src/config/db'));
const { analisarParaEmpresa, lancarCreditosDeTransportadora } = require(path.join(BACKEND, 'src/utils/importacaoSemParar'));
const EMPRESA_ID = 1;
const usuario = db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY (username = 'ruan.figueiredo21') DESC, id LIMIT 1").get();
const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE nome = 'PEDÁGIO'").get();
const reais = (c) => (c / 100).toFixed(2);

console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'}\n`);
for (const arquivo of payloads) {
  const abas = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const a = analisarParaEmpresa(EMPRESA_ID, abas);
  console.log(`Fatura ${a.fatura.numero} (venc. ${a.fatura.vencimento}) - importada: ${a.ja_importada ? 'sim' : 'NAO'} | creditos ja lancados: ${a.creditos_ja_lancados ? 'SIM' : 'nao'}`);
  a.creditos_origens.forEach((o) => console.log(`   ${o.sugestao_transportadora ? 'TRANSPORTADORA' : 'embarcador    '} ${o.nome.padEnd(36)} R$ ${reais(o.total)}  (${o.motivo_sugestao})`));
  if (!a.ja_importada || a.creditos_ja_lancados) continue;
  if (!aplicar) {
    const chaves = new Set(a.creditos_origens.filter((o) => o.sugestao_transportadora).map((o) => o.chave));
    const porPlaca = a.placas.map((p) => [p.placa, Object.entries(p.creditos_por_origem).filter(([k]) => chaves.has(k)).reduce((t, [, v]) => t + v, 0)]).filter(([, v]) => v > 0);
    console.log(`   -> custo extra: ${porPlaca.map(([pl, v]) => `${pl} R$ ${reais(v)}`).join(' | ')} (total R$ ${reais(porPlaca.reduce((t, [, v]) => t + v, 0))})`);
    continue;
  }
  const r = lancarCreditosDeTransportadora({ empresaId: EMPRESA_ID, usuarioId: usuario.id, abas, categoria_id: categoria.id });
  console.log(r ? `   -> lancado: ${r.por_placa.map((x) => `${x.placa} R$ ${reais(x.valor)}`).join(' | ')} (total R$ ${reais(r.valor_total)})` : '   -> nada a lancar');
}
if (!aplicar) console.log('\nNada foi alterado. Para aplicar: --aplicar');
