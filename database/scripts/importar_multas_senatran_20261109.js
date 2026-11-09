// Importa as multas NAO PAGAS dos caminhoes/carretas da Lowell consultadas no Portal de Servicos do Senatran
// (09/11/2026), com o PDF da Notificacao de Autuacao de cada uma anexado a multa.
//   node database/scripts/importar_multas_senatran_20261109.js                (so simula)
//   node database/scripts/importar_multas_senatran_20261109.js --aplicar
//   (em producao: --backend=/app/backend)
// Dados em database/dados/multas-senatran-20261109/ : manifesto.json (um item por PDF, extraido do proprio PDF) + pdfs/.
// Idempotente: a multa e identificada por veiculo + AIT. Se ja existir, nao duplica: so completa os campos do auto
// que estiverem vazios e anexa o PDF se ainda nao estiver anexado.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const aplicar = process.argv.includes('--aplicar');
const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const BACKEND = arg('backend') || path.resolve(__dirname, '../../backend');
const PASTA = arg('pasta') || path.resolve(__dirname, '../dados/multas-senatran-20261109');
const EMPRESA_ID = 1;
// Nome no Frottex x placa correta (o cadastro tem TWP4H96 para o cavalo cuja placa real e TWO4H96).
const ALIAS_PLACA = { TWO4H96: 'TWP4H96' };

const db = require(path.join(BACKEND, 'src/config/db'));
const { withTransaction } = require(path.join(BACKEND, 'src/utils/transaction'));
const { registrarAuditoria } = require(path.join(BACKEND, 'src/utils/audit'));
const { somarDiasIso } = require(path.join(BACKEND, 'src/utils/dataHora'));
const PASTA_ANEXOS = path.resolve(process.env.UPLOAD_DIR || path.resolve(BACKEND, 'uploads'), 'anexos');

const manifesto = JSON.parse(fs.readFileSync(path.join(PASTA, 'manifesto.json'), 'utf8'));
const usuario = db.prepare("SELECT id FROM usuarios WHERE perfil = 'Admin' ORDER BY (username = 'ruan.figueiredo21') DESC, id LIMIT 1").get();
if (!usuario) { console.error('Nenhum usuario Admin encontrado.'); process.exit(1); }

const norm = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const veiculos = db.prepare('SELECT id, placa FROM veiculos WHERE empresa_id = ?').all(EMPRESA_ID);
const veiculoPorPlaca = new Map(veiculos.map((v) => [norm(v.placa), v]));
const achar = (placa) => veiculoPorPlaca.get(norm(placa)) || (ALIAS_PLACA[placa] && veiculoPorPlaca.get(norm(ALIAS_PLACA[placa]))) || null;
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const NAO_IDENTIFICACAO = '5002-0'; // "multa por nao identificacao do condutor infrator, imposta a pessoa juridica"

console.log(`${aplicar ? 'APLICANDO' : 'SIMULACAO'} - ${manifesto.length} PDFs no manifesto (usuario #${usuario.id}, empresa #${EMPRESA_ID})\n`);

const problemas = [];
const plano = [];
const vistos = new Set();
for (const r of manifesto) {
  const tag = `${r.placa_pdf || r.placa_arquivo} ${r.ait || r.chave}`;
  const faltando = ['codigo_orgao', 'ait', 'data_notificacao', 'data_infracao', 'codigo_infracao', 'valor_centavos', 'descricao', 'placa_pdf'].filter((k) => !r[k]);
  if (faltando.length) { problemas.push(`${tag}: PDF sem ${faltando.join(', ')} - nao importada`); continue; }
  if (r.proprietario_cnpj && r.proprietario_cnpj.replace(/\D/g, '') !== '33622819000140') { problemas.push(`${tag}: proprietario ${r.proprietario_cnpj} nao e a Lowell - nao importada`); continue; }
  const chaveUnica = `${r.codigo_orgao}|${r.ait}|${r.codigo_infracao}`;
  if (vistos.has(chaveUnica)) continue; // mesmo PDF baixado duas vezes
  vistos.add(chaveUnica);
  const veiculo = achar(r.placa_pdf);
  if (!veiculo) { problemas.push(`${tag}: placa ${r.placa_pdf} NAO esta cadastrada no Frottex - nao importada`); continue; }
  if (!fs.existsSync(path.join(PASTA, 'pdfs', r.arquivo))) { problemas.push(`${tag}: arquivo ${r.arquivo} ausente`); continue; }
  const existente = db.prepare('SELECT * FROM multas WHERE empresa_id = ? AND veiculo_id = ? AND upper(numero_ait) = upper(?)').get(EMPRESA_ID, veiculo.id, r.ait);
  plano.push({ r, veiculo, existente, tag });
}

const porPlaca = {};
for (const p of plano) {
  const k = p.r.placa_pdf;
  porPlaca[k] = porPlaca[k] || { novas: 0, existentes: 0, valor: 0 };
  if (p.existente) porPlaca[k].existentes += 1; else { porPlaca[k].novas += 1; porPlaca[k].valor += p.r.valor_centavos; }
}
for (const [placa, x] of Object.entries(porPlaca)) console.log(`${placa}: ${x.novas} nova(s) (R$ ${reais(x.valor)}), ${x.existentes} ja existente(s)`);
const novas = plano.filter((p) => !p.existente);
console.log(`\nTotal: ${novas.length} a criar (R$ ${reais(novas.reduce((s, p) => s + p.r.valor_centavos, 0))}), ${plano.length - novas.length} ja existentes, ${problemas.length} com problema.`);
if (problemas.length) { console.log('\nPROBLEMAS:'); problemas.forEach((p) => console.log(`  - ${p}`)); }
if (!aplicar) { console.log('\n(simulacao - nada foi gravado; use --aplicar)'); process.exit(0); }

fs.mkdirSync(PASTA_ANEXOS, { recursive: true });
const copiados = [];
let criadas = 0; let completadas = 0; let anexados = 0;
try {
  withTransaction(db, () => {
    for (const { r, veiculo, existente } of plano) {
      let multaId;
      if (existente) {
        multaId = existente.id;
        const sets = []; const vals = [];
        for (const [coluna, valor] of [['codigo_orgao', r.codigo_orgao], ['codigo_infracao', r.codigo_infracao], ['renainf', r.renainf], ['local_infracao', localCompleto(r)]]) {
          if (!existente[coluna] && valor) { sets.push(`${coluna} = ?`); vals.push(valor); }
        }
        if (sets.length) { db.prepare(`UPDATE multas SET ${sets.join(', ')}, atualizado_em = datetime('now', '-3 hours') WHERE id = ?`).run(...vals, multaId); completadas += 1; }
      } else {
        const ehNic = r.codigo_infracao === NAO_IDENTIFICACAO;
        const prazo = r.prazo_condutor || r.prazo_defesa || somarDiasIso(r.data_notificacao, 30);
        const obs = [
          'IMPORTADA DO PORTAL SENATRAN EM 09/11/2026 (NAO PAGA NA CONSULTA).',
          ehNic ? 'PENALIDADE POR NAO IDENTIFICACAO DO CONDUTOR - JA APLICADA A EMPRESA.' : null,
          !ehNic && !r.prazo_condutor ? 'A NOTIFICACAO NAO TRAZ PRAZO DE INDICACAO DO CONDUTOR: USADO O PRAZO DE DEFESA PREVIA.' : null,
          r.observacoes_pdf && !/n[aã]o dispon/i.test(r.observacoes_pdf) ? `OBS. DO AUTO: ${r.observacoes_pdf.toUpperCase()}` : null,
        ].filter(Boolean).join(' ');
        const info = db.prepare(`
          INSERT INTO multas (empresa_id, veiculo_id, orgao_autuador, numero_ait, descricao, valor_original, data_infracao,
            data_notificacao, prazo_indicacao, status, observacoes, criado_por, codigo_orgao, codigo_infracao, renainf, local_infracao)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(EMPRESA_ID, veiculo.id, (r.orgao_autuador || '').toUpperCase(), r.ait.toUpperCase(), r.descricao.toUpperCase(), r.valor_centavos, r.data_infracao,
          r.data_notificacao, prazo, ehNic ? 'NaoIndicado' : 'AguardandoIndicacao', obs, usuario.id, r.codigo_orgao, r.codigo_infracao, r.renainf, localCompleto(r));
        multaId = Number(info.lastInsertRowid);
        registrarAuditoria({ usuarioId: usuario.id, empresaId: EMPRESA_ID, tabela: 'multas', registroId: multaId, acao: 'INSERT', depois: db.prepare('SELECT * FROM multas WHERE id = ?').get(multaId) });
        criadas += 1;
      }
      const nomeOriginal = `NOTIFICACAO DE AUTUACAO - AIT ${r.ait}.PDF`.toUpperCase();
      const jaAnexado = db.prepare("SELECT 1 FROM anexos WHERE entidade_tipo = 'Multa' AND entidade_id = ? AND nome_original = ?").get(multaId, nomeOriginal);
      if (!jaAnexado) {
        const nomeArquivo = `${Date.now()}-${crypto.randomUUID()}.pdf`;
        const destino = path.join(PASTA_ANEXOS, nomeArquivo);
        fs.copyFileSync(path.join(PASTA, 'pdfs', r.arquivo), destino);
        copiados.push(destino);
        db.prepare(`INSERT INTO anexos (empresa_id, entidade_tipo, entidade_id, nome_arquivo, nome_original, tipo_mime, tamanho_bytes, criado_por)
          VALUES (?, 'Multa', ?, ?, ?, 'application/pdf', ?, ?)`).run(EMPRESA_ID, multaId, nomeArquivo, nomeOriginal, fs.statSync(destino).size, usuario.id);
        anexados += 1;
      }
    }
  });
} catch (err) {
  for (const f of copiados) { try { fs.unlinkSync(f); } catch { /* ja removido */ } }
  console.error(`\nFALHOU e foi desfeito (nada gravado): ${err.message}`);
  process.exit(1);
}
console.log(`\nFEITO: ${criadas} multa(s) criada(s), ${completadas} existente(s) completada(s), ${anexados} PDF(s) anexado(s).`);

function localCompleto(r) {
  return [r.local, [r.municipio, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' - ').toUpperCase() || null;
}
