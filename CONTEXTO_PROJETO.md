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

11. **DRE (regras que valem em toda tela de resultado)** — tudo em
    `backend/src/utils/dreHelper.js`, reaproveitado por DRE, rankings e
    multi-período (nunca recalcular "do seu jeito" em outra rota):
    - Receita do frete entra pela **data de carregamento** (sem ela, início
      da viagem); despesas pela data da despesa.
    - Período sem data final = **até hoje** (com "fim dos tempos" a DRE
      somava as 60 parcelas futuras de cada financiamento).
    - A linha de resultado é o **conjunto** (cavalo + carreta). Uma placa que
      trocou de conjunto tem o custo dividido no tempo: em cada data, vai para
      o conjunto da última viagem dela iniciada até ali. A soma dos conjuntos
      continua igual ao total da frota.
    - **Comissão do motorista** (acerto fechado) é custo do centro do
      **cavalo**, na data de fim da viagem. Reembolsos/descontos do acerto
      não entram (repassam despesas já lançadas).
    - **Pedágio**: o valor informado no acerto é só informativo. O custo
      entra pela **fatura do Sem Parar** (Administração → Importar Fatura),
      que vira uma conta a pagar rateada por placa pelo valor **líquido**
      (passagens + mensalidade + serviços − créditos de vale-pedágio).
    - Baixa **Desconto** do frete vira automaticamente despesa da placa
      (categoria "DESCONTO NO FRETE"). Baixa Pedágio/Outro só vira custo se
      alguém lançar "como custo" na baixa (`custoVinculadoHelper.js`; o
      dinheiro nunca saiu, então não gera conta a pagar).
    - OS entra por `valor_pecas + valor_mao_obra`; uma baixa "lançada como
      custo" também entra. **Nunca** usar os dois para a mesma compra
      (aconteceu: pneus contados 2x — auditoria de 03/11/2026).

12. **Contas a pagar — formas de quitar** (`contaPagarBaixaHelper.js`):
    - Baixa normal: sai do caixa (movimentação + saldo da conta bancária).
      Valor acima do restante só com confirmação (`ajustarValorConta`).
    - **Sem pagamento**: quita sem caixa nem banco (pago por fora,
      compensado). Vai em `valor_descontado` e deixa uma Ocorrência.
    - Conta de valor zero: baixar só marca Paga.
    - **Fatura consolidada**: várias contas pendentes do mesmo fornecedor
      viram uma só (as despesas passam a apontar para ela). Parcelas e
      acertos não entram, porque sincronizam o próprio status pela conta
      original.
    - Conta paga ou consolidada **não** acompanha a edição da despesa de
      origem (o custo muda, o que foi pago fica).
    - Conta gerada por outro módulo só é excluída pela origem, nunca avulsa.

13. **Acerto** (além do item 8): reembolsos e descontos são uma **lista de
    itens** (`acerto_itens`), não um número digitado. O imposto da empresa
    (`empresas.percentual_desconto_geral`) reduz a base da comissão, mas é
    só informativo (não vira conta a pagar). Fechar exige todas as despesas
    da viagem validadas. Viagem Finalizada = valores congelados: não aceita
    lançar, editar **nem excluir** frete, despesa ou adiantamento. Para
    mexer, reabra a viagem (Admin; recusa se a conta do acerto já teve
    qualquer baixa).

## Como validar mudanças (não pule isso)

- **Backend**: sempre que alterar lógica financeira/regra de negócio, teste
  fim a fim via HTTP (não só leitura de código) — durante o desenvolvimento
  usei um script Node com `fetch` simulando o fluxo completo (login →
  cadastros → estoque → pneu com recapagem → viagem → acerto → DRE) e
  comparando valores exatos esperados. Vale recriar esse tipo de script
  pontualmente ao mexer em cálculo financeiro. Hoje isso virou a suíte
  `backend/test` (`npm test`, ~275 testes, um banco temporário por arquivo):
  toda correção de regra ganha um teste que reproduz o caso real.
- **Frontend sem bundler**: um módulo com erro de sintaxe só quebra quando
  alguém abre a tela dele. O CI confere a sintaxe de todos; localmente:
  `node --input-type=module --check < arquivo.js`.
- **Texto do banco em HTML**: sempre `esc()` (`frontend/js/html.js`) ao
  interpolar dado do banco num template que vai para `innerHTML`. A tabela
  genérica já escapa o valor padrão da célula e o modal escapa o título;
  quem usa `render()` ou `mensagem:` de `confirmarAcao` (que aceita HTML,
  `<strong>`/`<br />`) escapa o que interpola. Em 03/11 todas as telas
  foram varridas pela árvore sintática.
- **Dinheiro na API**: validar com `exigirCentavos` (`utils/validacao.js`)
  toda rota nova que receba valor e mexa em saldo.
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
    Em produção isso é automático desde 03/11/2026: o servidor manda a
    versão do frontend (hash dos arquivos, `utils/versaoApp.js`) no
    cabeçalho `X-App-Versao`. Quando muda, `frontend/js/versao.js` mostra
    o aviso e o router recarrega a aba na próxima troca de tela. Localmente,
    com `npm run dev`, a versão só é recalculada quando o servidor reinicia
    (mudança só no frontend não reinicia) — então continue dando F5.
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

## Estado atual (03/11/2026)

O projeto foi muito além do PRD original (Passos 1-3) e está **em produção
no Railway, em uso diário**. O `PROMPT_NOVA_SESSAO.md` tem o histórico
recente e as pendências; aqui fica o "porquê" que muda pouco.

- **Multi-empresa**: `empresa_id` em toda tabela operacional. A empresa
  ativa vai no cabeçalho `X-Empresa-Id` (não no JWT). `todas` = modo
  consolidado, só para quem tem acesso a todas
  (`backend/src/middleware/empresa.js`). Rota que aceita o consolidado usa
  `exigirEmpresaOuTodas`; as demais usam `exigirEmpresaEspecifica`. **Nunca**
  trate `req.empresaId` nulo como "todas" sem esse middleware: antes de
  03/11 o Painel e o DRE geral devolviam dados de todas as empresas para
  quem chamasse sem o cabeçalho.
- **Onixsat/TrucksControl**: webservice legado (XML sobre HTTP, não SOAP)
  em `utils/onixsatClient.js`. O agendador (`onixsatScheduler.js`) roda um
  tick por minuto e sincroniza cada empresa no intervalo dela
  (`empresas.onixsat_poll_minutos`, padrão 3 min). O mapeamento
  veículo↔placa fica 30 min em memória por causa do limite de taxa.
- **App do motorista** (`#/motorista`, perfil Motorista): PWA com service
  worker (`frontend/sw.js`, só registrado para motorista), fila offline de
  abastecimentos com chave de idempotência. Toda rota resolve a viagem por
  `req.usuario.motorista_id` e nunca por id vindo do cliente. Lançamentos
  do motorista nascem pendentes de validação pelo escritório.
- **Auditoria e reversão**: toda escrita grava `logs_auditoria` com a foto
  antes/depois. A reversão genérica restaura a linha; tabelas com efeito em
  cascata (caixa, parcelas, acerto, pneus...) têm handler próprio em
  `routes/admin.routes.js` (`HANDLERS_ESPECIFICOS`). Entidade nova que crie
  parcelas/contas numa transação **precisa** de handler próprio.
- **Backup** (desde 03/11): diário automático no volume (7 diários + 3
  mensais), cópia externa opcional para S3/R2 (`utils/backupExterno.js`,
  assinatura AWS v4 feita à mão, sem SDK), tela Administração → Backups
  (baixar, executar agora) e restauração na subida por `RESTAURAR_BACKUP`
  (`utils/restauracaoBackup.js`). Passo a passo no README.
- **Segurança** (revisão de 03/11): só os arquivos do app são públicos
  (`app.js`; antes a pasta `frontend/` inteira era servida); anexos são
  salvos com extensão derivada do tipo e nome aleatório (`crypto`); cabeçalhos
  `nosniff`/`X-Frame-Options`/HSTS; limite de 10 erros de login por
  usuário+IP a cada 15 min; o servidor não sobe sem `JWT_SECRET`; o
  último Admin ativo não pode se rebaixar.
- **Deploy**: auto-deploy no push para `main`; o Railway espera
  `/api/health` (que testa o banco) antes de dar o deploy como pronto.
  **Migrações automáticas** desde 03/11 (`utils/migracoes.js`): da 037 em
  diante, `database/migrations/NNN_*.js` exporta `up(db)` e roda sozinho na
  subida (uma vez, em transação, com cópia do banco antes; se falhar, o
  servidor não sobe). Toda migração nova também vai para o `schema.sql`:
  banco novo só as marca como aplicadas. As 000–036 são scripts manuais
  antigos e nunca rodam de novo. Ver `database/migrations/LEIAME.md`.
- **Conferência de saldo** (desde 03/11): `contas_bancarias.saldo_inicial`
  é o ponto de partida; `saldo_atual` tem que ser igual a saldo inicial +
  entradas − saídas de `movimentacoes_caixa` (`GET
  /contas-bancarias/conferencia`). Todo código que mexer em `saldo_atual`
  precisa gravar a movimentação junto, senão a tela acusa divergência.
- **Monitoramento**: `/api/health` (banco), `/api/health/backup` (backup em
  dia) e o workflow `.github/workflows/monitor.yml` (de hora em hora; o
  GitHub manda e-mail quando falha).
- Tabelas do frontend paginam **no cliente** (25 por página,
  `dataTable.js`); as rotas devolvem a lista inteira. Ok para o volume
  atual; se crescer muito, paginar no servidor.
- `backend/data/frotista.db` não é versionado: cada máquina tem o próprio
  banco, criado vazio na primeira execução.

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
