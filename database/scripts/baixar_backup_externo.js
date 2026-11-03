// Traz um backup da COPIA EXTERNA (bucket S3/R2 - ver backend/src/utils/backupExterno.js) para a pasta
// de backups do servidor, pronto para RESTAURAR_BACKUP (ver README, "Restaurar um backup").
// Usado quando o backup local nao serve (volume perdido/trocado, ou precisa de uma data mais antiga
// que a retencao local). So escreve na pasta de backups; nao mexe no banco.
//
// Rodar (no container, via `railway ssh`, com as mesmas variaveis BACKUP_S3_* do servico):
//   node database/scripts/baixar_backup_externo.js 2026-11-02     -> backup diario desse dia
//   node database/scripts/baixar_backup_externo.js 2026-09        -> backup mensal de setembro
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { configDoAmbiente, baixarObjeto } = require('../../backend/src/utils/backupExterno');

async function main() {
  const alvo = process.argv[2] || '';
  const diario = /^\d{4}-\d{2}-\d{2}$/.test(alvo);
  if (!diario && !/^\d{4}-\d{2}$/.test(alvo)) throw new Error('Informe a data (AAAA-MM-DD) ou o mes (AAAA-MM) do backup.');
  const cfg = configDoAmbiente();
  if (!cfg) throw new Error('Copia externa nao configurada (variaveis BACKUP_S3_*).');

  const chave = diario ? `${cfg.prefixo}banco/diario/frottex-${alvo}.db.gz` : `${cfg.prefixo}banco/mensal/frottex-${alvo}.db.gz`;
  console.log(`Baixando ${chave}...`);
  const banco = zlib.gunzipSync(await baixarObjeto(cfg, chave));

  const dbPath = path.resolve(__dirname, '../../backend', process.env.DB_PATH || './data/frotista.db');
  const dir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const nome = `frottex-externo-${alvo}.db`;
  const destino = path.join(dir, nome);
  fs.writeFileSync(destino, banco);

  const conferencia = new DatabaseSync(destino, { readOnly: true });
  const { quick_check: ok } = conferencia.prepare('PRAGMA quick_check').get();
  conferencia.close();
  if (ok !== 'ok') throw new Error(`Arquivo baixado esta corrompido (quick_check = ${ok}).`);

  console.log(`Pronto: ${destino} (${Math.round(banco.length / 1024)} KB, conferido).`);
  console.log(`Para restaurar: variavel RESTAURAR_BACKUP=${nome} no servico + reiniciar; depois apague a variavel.`);
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exitCode = 1;
});
