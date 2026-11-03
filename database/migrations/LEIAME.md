# Migrações

## A partir da 037: automáticas

Rodam sozinhas quando o servidor sobe (`backend/src/utils/migracoes.js`), antes de qualquer rota usar o banco.
Não precisa mais de `railway ssh` depois do deploy.

Para criar uma:

1. Arquivo `NNN_descricao.js` com o próximo número, exportando `up(db)`:

   ```js
   module.exports.up = function up(db) {
     const colunas = db.prepare('PRAGMA table_info(minha_tabela)').all().map((c) => c.name);
     if (!colunas.includes('nova_coluna')) db.exec('ALTER TABLE minha_tabela ADD COLUMN nova_coluna TEXT');
   };
   ```

2. Aplique a mesma mudança no `database/schema.sql`. Banco **novo** nasce do schema e só marca as migrações como
   aplicadas, sem rodar nenhuma.
3. Para recriar tabela (mudar CHECK, tirar NOT NULL...), exporte também `desligarChavesEstrangeiras: true`. O
   executor desliga as chaves estrangeiras fora da transação e confere a integridade (`foreign_key_check`) no fim.

O que o executor garante:
- cada migração roda **uma vez** (tabela `schema_migracoes`), em ordem de número;
- roda numa transação: se der erro, nada dela fica gravado e o servidor **não sobe**, com a mensagem no log do
  Railway — melhor fora do ar do que código novo rodando num banco velho;
- antes de aplicar qualquer pendente, copia o banco para a pasta de backups
  (`frotista-antes-da-migracao-<nome>-<data>.db`).

Escreva a migração para ser idempotente mesmo assim (checar se a coluna já existe), porque um banco restaurado de
backup pode já ter parte da mudança.

## 000 a 036: scripts manuais (histórico)

São os scripts antigos, que rodavam ao serem executados com `node database/migrations/NNN_...js`. Todos já foram
aplicados em produção, e o executor automático **nunca** os roda. Alguns, como o `004_copiar_dados_producao`,
seriam destrutivos se rodassem de novo.
