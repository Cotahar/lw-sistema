# Contexto do Projeto — Frottex (lw-sistema)

> Este arquivo existe para situar uma sessão nova do Claude Code (ou qualquer
> desenvolvedor) rapidamente, com o "porquê" por trás das decisões — não só
> o "o quê" (isso o código já mostra). Leia isto depois do `README.md`.

## O que é

Sistema de Gestão de Frota e Transporte Rodoviário (modelo frotista), construído
a partir do PRD em `instrucoes_sistema.txt.txt`. Os 3 passos do PRD estão
**completos e testados**: Passo 1 (modelagem SQLite), Passo 2 (backend
Node/Express) e Passo 3 (frontend HTML/CSS/JS + TailwindCSS).

## Stack e por que essas escolhas

- **`node:sqlite`** (módulo nativo do Node 22+) em vez de `better-sqlite3`:
  zero dependências nativas pra compilar — importante porque esta máquina
  não tinha toolchain de build pronta. `DatabaseSync` **não tem** um método
  `.transaction()` como o `better-sqlite3`; usamos `backend/src/utils/transaction.js`
  (BEGIN/COMMIT/ROLLBACK manual) sempre que uma operação precisa ser atômica.
- **Valores monetários em centavos** (INTEGER), nunca float, em todo o
  sistema (banco, API, cálculos). O frontend converte pra Real só na
  exibição/entrada (`frontend/js/masks.js`).
- **Backend e frontend no mesmo servidor/porta**: Express serve os arquivos
  estáticos do frontend (`server.js`) — simplifica rodar localmente
  (`npm start` sobe tudo).
- **Frontend sem framework/bundler**: JS puro com ES modules nativos do
  navegador, roteamento por hash (`#/modulo`). TailwindCSS compilado via CLI
  (`frontend/dist/output.css` já vem pronto no repo, não precisa buildar
  pra rodar).
- **CRUD genérico** dos dois lados (`backend/src/utils/crud.js` e
  `frontend/js/pages/crudGenerico.js`) para os cadastros simples
  (fornecedores, motoristas, categorias...). Telas com regra própria
  (veículos, conjuntos, estoque, pneus, viagens) têm rota/página dedicada.

## Regras de negócio não-óbvias (a parte que mais importa)

1. **Composições (conjuntos) livres**: o "papel" de cada veículo (Cavalo,
   Carreta 1, Dolly...) é **inferido** de `veiculos.tipo` + `ordem`, nunca
   armazenado — evita inconsistência entre o tipo cadastrado e o papel na
   composição.

2. **Conta corrente do motorista**: `motoristas.saldo_conta_corrente` é só
   uma *cache* de leitura. A fonte de verdade é o razão
   `motorista_conta_corrente_lancamentos` (saldo_anterior → saldo_posterior
   por lançamento), auditável.

3. **Centros de custo** são uma tabela própria (`tipo` Veiculo/Base), não um
   `veiculo_id` opcional + flag. Toda despesa/financiamento aponta pra lá —
   simplifica as queries de DRE (agregação por `centro_custo_id`).

4. **Regra caixa vs. DRE (estoque e pneus)**: a compra gera Conta a Pagar
   na hora (fluxo de caixa), mas o custo só entra no DRE do veículo quando
   o item **sai do estoque e é instalado**.
   - **Pneus com recapagem** (o fluxo mais delicado do sistema): o campo
     `pneus.custo_pendente_dre` guarda o custo ainda não lançado em nenhum
     DRE. Nasce igual ao `custo_unitario` na 1ª aquisição. Uma instalação
     **consome** esse valor (vira o custo do evento `Instalacao`, e o DRE
     só soma esse campo) e zera o campo. Um `RetornoRecapagem` **soma** o
     valor da recapagem de volta no campo. Resultado: reinstalar o mesmo
     pneu sem recapar no meio não gera custo duplicado, e uma recapagem só
     carrega o valor da própria recapagem (o custo de aquisição original já
     foi reconhecido na 1ª instalação). Testei isso especificamente
     (aquisição R$2.500 → 1ª instalação carrega R$2.500 → recapagem R$300 →
     2ª instalação carrega só R$300).
   - Saída de estoque com `os_id` preenchido (veio de uma Ordem de Serviço)
     **não** conta separadamente no DRE — o custo já está em
     `ordens_servico.valor_pecas`. O DRE filtra `os_id IS NULL` pra não
     contar duas vezes.

5. **Financiamentos**: por decisão explícita do usuário, o valor **cheio**
   da parcela entra no DRE — não separamos juros de principal (o PRD
   original pedia a separação, mas foi alterado nesta conversa).

6. **Recebíveis de frete** (o segundo fluxo mais delicado): `contas_receber`
   nasce pelo **valor bruto** do frete e é reduzido por N baixas
   (`contas_receber_baixas`, tipos: Adiantamento/Pedagio/Saldo/Desconto/
   Outro). `Desconto` **nunca** movimenta caixa (tem CHECK no banco pra
   isso). As outras baixas decidem individualmente, na hora do lançamento,
   se informam uma conta bancária (gera `movimentacoes_caixa` de verdade)
   ou não (é só abatimento contábil). O status vira `Recebido` quando
   `valor_recebido + valor_descontado >= valor`.
   - **Importante**: o "Adiantamento" dessa baixa (dinheiro que o cliente
     já adiantou sobre o frete) é **independente** da tabela
     `viagem_adiantamentos` (dinheiro que o motorista pegou durante a
     viagem, lançado a qualquer momento e usado no Acerto). Decisão
     explícita do usuário — não ligar os dois. `viagem_adiantamentos`
     substituiu os antigos campos `fretes.adiantamento_percentual`/
     `adiantamento_valor` (o adiantamento não nascia necessariamente
     junto com o cadastro do frete, por isso virou lançamento avulso por
     viagem, com conta bancária opcional — mesmo padrão de
     `contas_receber_baixas`).

7. **Comissão do motorista**: por faixa de KM/L (`comissao_faixas`,
   cadastro Admin-only), incide sobre o **frete bruto** total da viagem. A
   API sugere o percentual pela média calculada, mas o operador pode
   sobrescrever no fechamento.

8. **Acerto de viagem — "fechamento livre"**: o sistema calcula e mostra o
   resultado, mas nunca trava o fechamento. Fórmula: `comissão +
   reembolsos - adiantamentos - descontos - saldo_conta_corrente_anterior
   = saldo_final`. Se positivo, vira Conta a Pagar **Pendente** (a baixa
   real, escolhendo o banco, é feita depois na tela de Contas a Pagar — não
   force o operador a escolher banco no ato do fechamento). Se negativo,
   não movimenta caixa nenhum — só atualiza a conta corrente do motorista
   pra descontar na próxima viagem.

9. **Permissões**: cada usuário tem um **perfil base** (Admin/Comum/
   Visualizacao) que já dá um nível padrão em todo módulo (Admin sempre
   Gerenciar, Comum sempre Gerenciar, Visualizacao sempre Visualizar). Um
   Admin pode abrir **exceções por módulo** por usuário
   (`usuario_permissoes`) — só grava linha quando o nível diverge do
   padrão do perfil (mantém a tabela enxuta). Admin nunca passa pela
   matriz, sempre acesso total. Ver `backend/src/middleware/auth.js`
   (`nivelEfetivoNoModulo`) e `frontend/js/api.js` (`nivelNoModulo`).

10. **Configurações de sistema** (tipos de fornecedor, categorias de
    despesa, faixas de comissão, catálogo de checklist) são Admin-only
    "fora" da matriz de permissões granular — não modelar como módulo
    comum.

## Como validar mudanças (não pule isso)

- **Backend**: sempre que alterar lógica financeira/regra de negócio, teste
  fim a fim via HTTP (não só leitura de código) — durante o desenvolvimento
  usei um script Node com `fetch` simulando o fluxo completo (login →
  cadastros → estoque → pneu com recapagem → viagem → acerto → DRE) e
  comparando valores exatos esperados. Vale recriar esse tipo de script
  pontualmente ao mexer em cálculo financeiro.
- **Frontend**: **sempre** teste no navegador de verdade antes de dizer que
  terminou. Bugs reais que só apareceram rodando (não apareciam lendo o
  código):
  - `acoesExtras` da tabela genérica (`dataTable.js`) precisa ser uma
    **função** `(linha) => [...]`, não um array estático — passar array
    quebra a tabela inteira silenciosamente.
  - Aspas sobrando em atributos `data-*` nos templates (ex.:
    `data-finalizar">` em vez de `data-finalizar>`) — o atributo vira
    `data-finalizar"` (com aspas no nome) e o `querySelector` não acha
    mais o elemento, quebrando o botão sem erro nenhum no console. Se
    parecer que um botão "não faz nada", rode
    `grep -rn 'data-[a-z-]+">' frontend/js` primeiro.
  - Depois de editar um arquivo `.js` do frontend com o navegador já
    aberto, é preciso `location.reload()` de verdade — mudar só o hash
    (`#/rota`) não rebusca os módulos ES (ficam em cache do navegador).
    Às vezes nem isso basta numa aba que já viveu muitas navegações nesta
    sessão de browser automatizado — se algo parecer duplicado/bugado sem
    explicação, teste numa aba nova antes de assumir que é bug de verdade.
  - **`node:sqlite` sempre reporta `err.code === 'ERR_SQLITE_ERROR'`**,
    nunca `'SQLITE_CONSTRAINT_UNIQUE'`/`'SQLITE_CONSTRAINT_FOREIGNKEY'` como
    seria de esperar (isso é do `better-sqlite3`). O código real do SQLite
    vem em `err.errcode` (número) e a mensagem original em `err.message`
    (ex.: `"FOREIGN KEY constraint failed"`). `backend/src/middleware/errorHandler.js`
    já trata isso certo — mas qualquer `try/catch` novo que inspecione erro
    de banco direto precisa checar `err.message`, não `err.code`.
  - Toda classe nova de utilitário/utility class do Tailwind (ex.:
    `lg:sticky`, `lg:h-screen`) só aparece depois de rodar
    `npm run build` dentro de `frontend/` — o CSS é compilado estaticamente
    em `frontend/dist/output.css`, não gerado on-the-fly.

## Como o usuário gosta de trabalhar

- Dá **exemplos numéricos concretos e reais** (não pede "algo genérico") e
  espera que o sistema reproduza esses números exatamente — vale montar um
  teste que replique o exemplo literal dado antes de considerar pronto.
- Prefere que eu **pergunte** quando há ambiguidade de regra de negócio em
  vez de presumir (isso está inclusive no PRD original). Perguntas diretas
  com 2-3 opções concretas (uma delas recomendada) funcionam bem.
- Aprova a direção geral e deixa avançar; não precisa de confirmação a cada
  arquivo, mas aprecia um resumo do que foi decidido e por quê ao final de
  cada etapa grande.
- Espera testes reais, não "deveria funcionar" — a sessão que fez o Passo 3
  encontrou e corrigiu vários bugs reais só por testar no navegador em vez
  de confiar na leitura do código.

## Estado atual / possíveis próximos passos (não pedidos ainda)

**IMPORTANTE**: o projeto cresceu muito além do PRD original (Passos 1-3).
Hoje já tem multi-empresa, integração real com Onixsat, módulo de Multas e
está em produção no Railway. Ver `PROMPT_NOVA_SESSAO.md` para o estado mais
recente sessão-a-sessão — este arquivo (`CONTEXTO_PROJETO.md`) documenta o
"porquê" arquitetural que não muda com frequência.

- **Multi-empresa (multi-tenant)**: `empresa_id` em toda tabela operacional,
  seletor de empresa no cabeçalho (header `X-Empresa-Id`, não JWT), modo
  "Todas as empresas" para quem tem permissão em todas. Ver
  `backend/src/middleware/empresa.js`.
- **Onixsat/TrucksControl**: integração real via webservice legado (XML puro
  sobre HTTP, não SOAP) em `backend/src/utils/onixsatClient.js`. Sincroniza
  posição/hodômetro automaticamente a cada 5 minutos (agendador em
  `onixsatScheduler.js`) — o mapeamento veículo↔placa (limite de 5 min entre
  chamadas) fica cacheado em memória por 30 min pra não conflitar com a
  consulta de mensagens (limite de 30s), permitindo essa cadência. Botão
  manual "Atualizar posições" (componente `onixsatSync.js`) em toda tela que
  mostra localização/hodômetro.
- **Multas de Trânsito**: lançamento manual (sem integração com órgãos),
  prazo de indicação do condutor automático (30 dias, Art. 257 §8º CTB),
  valor dobra automaticamente se o condutor não for indicado a tempo.
- **Checklist de Bordo**: vistorias periódicas por **conjunto** (histórico no
  tempo em `checklist_vistorias`/`checklist_vistoria_itens`, não mais um
  estado único mutável), mas os itens são registrados por **placa**
  (`veiculo_checklist` guarda o último valor conhecido, usado como ponto de
  partida da próxima vistoria) — importante porque carretas trocam de
  conjunto. Alerta de divergência quando a composição do conjunto mudou
  desde a última vistoria.
- **Deploy**: produção no Railway (serviço `frotista`, projeto `frotista`),
  auto-deploy no push pra `main` do GitHub. **Cuidado**: o banco de produção
  já existe (SQLite em volume), então `schema.sql` só roda automaticamente
  em banco **novo** — qualquer tabela/coluna nova precisa de um script em
  `database/migrations/` rodado manualmente contra produção (via
  `railway ssh`, chave SSH já configurada nesta máquina) **antes** ou logo
  depois do push, senão a rota que usa a coluna/tabela nova quebra em
  produção até a migração rodar.
- Sem paginação nas tabelas do frontend (ok pro volume de dados atual; se
  crescer muito, `dataTable.js` precisaria de paginação server-side).
- `estoque_itens` não tem exclusão em lote no frontend (a rota é
  customizada e não implementa `/batch-delete` como o CRUD genérico).
- `JWT_SECRET` e `ADMIN_SENHA` no `.env.example` são placeholders óbvios —
  trocar antes de expor o sistema fora da rede local.
- `backend/data/frotista.db` não é versionado (propositalmente, está no
  `.gitignore`) — cada máquina onde o projeto rodar terá seu próprio banco,
  vazio na primeira execução (só com o usuário Admin).

## Onde encontrar as coisas

- `database/schema.sql` — DDL completo e comentado; é a fonte de verdade do
  modelo de dados e do porquê de cada tabela.
- `backend/src/routes/*.routes.js` — uma rota por domínio de negócio.
- `backend/src/utils/crud.js` — fábrica de CRUD genérico (cadastros
  simples); aceita `modulo` (matriz de permissões) ou `writeMinRole`
  (Admin-only fixo, pra configurações de sistema).
- `frontend/js/pages/*.js` — uma tela por módulo;
  `frontend/js/pages/crudGenerico.js` é a fábrica usada pelos cadastros
  simples no frontend, espelhando o padrão do backend.
- `frontend/js/main.js` + `frontend/js/modulosConfig.js` — shell, router e
  menu lateral montado dinamicamente pelas permissões do usuário logado.
