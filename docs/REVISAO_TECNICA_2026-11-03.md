# Revisão técnica — 03/11/2026

Revisão do código inteiro do Frottex: backend (rotas, regras financeiras, segurança), frontend
(renderização, carregamento de versão), infraestrutura (backup) e documentação. Este arquivo registra:
- o que foi encontrado e corrigido;
- o que muda no uso;
- o que ficou como sugestão.

## 1. Riscos estruturais resolvidos

### Banco num único volume, backup só com 2 cópias no mesmo lugar

| Antes | Agora |
|---|---|
| 2 backups diários, no mesmo volume do banco | 7 diários + o 1º de cada um dos 3 últimos meses no volume |
| Nenhuma cópia fora do Railway | Cópia externa automática para S3/R2 (banco comprimido + anexos novos), com nova tentativa a cada 10 min se falhar |
| Backup podia encher o disco | Só roda com folga de 2× o tamanho do banco |
| Sem tela; status só no log | Administração → **Backups**: lista, status, "Executar agora", **baixar** |
| Restauração = mexer no volume na mão | `RESTAURAR_BACKUP=<arquivo>` + reiniciar: confere, guarda o banco atual, restaura, nunca repete |
| — | `database/scripts/baixar_backup_externo.js` traz um backup do bucket para restaurar |

A assinatura S3 foi escrita sem SDK (`backend/src/utils/backupExterno.js`) e é conferida contra o exemplo
oficial da AWS num teste. **Falta só criar o bucket e as variáveis** (README → "Ligar a cópia externa").

### Aba aberta antes do deploy continuava com o código antigo (F5)

O servidor manda `X-App-Versao` (hash dos arquivos do frontend) em toda resposta da API. Quando muda,
aparece o aviso "Saiu uma versão nova" e a aba recarrega sozinha **na próxima troca de tela**, nunca no
meio de um formulário. O app do motorista (service worker) segue a mesma regra e deixou de guardar em
cache respostas de erro.

## 2. Bugs e falhas corrigidos

| # | Gravidade | Onde | Problema | Correção |
|---|---|---|---|---|
| 1 | **Alta** (segurança) | Painel, DRE geral, DRE comparativo | Chamada sem o cabeçalho de empresa devolvia os dados de **todas** as empresas, para qualquer usuário com acesso ao DRE | Exige empresa específica ou o modo "todas" validado (`exigirEmpresaOuTodas`) |
| 2 | **Alta** (segurança) | Anexos | A extensão salva vinha do nome enviado: um `.html` declarado como imagem era servido como página do próprio domínio (rodaria script com a sessão de quem abrisse o link) | Extensão derivada do tipo aceito (lista fechada), nome aleatório com `crypto`, cabeçalho `nosniff` |
| 3 | **Alta** (segurança) | Tabelas do frontend | Texto do banco ia cru para o HTML (XSS armazenado: um cadastro com HTML malicioso rodaria script em quem abrisse a lista; o token fica no `localStorage`) | Tabela genérica escapa o valor padrão das células; cabeçalho (nome do usuário/empresas) escapado; `esc()` único em `frontend/js/html.js` |
| 4 | Média (segurança) | Servidor | A pasta `frontend/` inteira era pública (`package.json`, testes, configurações) | Só `index.html`, `sw.js`, `manifest.json`, `js/`, `dist/`, `img/`, `data/` |
| 5 | Média (segurança) | Login | Sem limite de tentativas; tempo de resposta denunciava quais usuários existem | 10 erros por usuário+IP a cada 15 min; comparação de senha sempre paga o custo do bcrypt |
| 6 | Média | Servidor | Sem `JWT_SECRET` o servidor subia e o login quebrava com erro 500 | Não sobe sem a variável |
| 7 | Média | Usuários | O único Admin ativo podia se rebaixar ou se desativar e trancar todo mundo fora | Recusado |
| 8 | **Alta** (dinheiro) | Baixas de frete, adiantamentos, ajuste de caixa, contas a pagar | Valor vindo como texto era **concatenado** nos saldos (`500 + "100"` = `500100`); decimal e negativo passavam | `exigirCentavos` (`utils/validacao.js`) nas rotas que movimentam caixa |
| 9 | Média | Viagem finalizada | Excluir adiantamento ou despesa era permitido depois do acerto fechado (editar já era bloqueado) — o recibo/relatório divergia do que foi fechado | Bloqueado; reabra a viagem para corrigir |
| 10 | Média | Excluir despesa de viagem | Despesa numa fatura consolidada **já paga** podia ser apagada (custo sumia do DRE com o dinheiro já saído) | Bloqueado |
| 11 | Média | Reabrir viagem | Só olhava `valor_pago`: conta do acerto quitada "sem pagamento" era apagada | Qualquer baixa bloqueia |
| 12 | Média | Fatura consolidada | Parcela de financiamento/despesa fixa/OS ou acerto podia entrar: a conta original sumia e a parcela ficava "Pendente" para sempre | Recusado |
| 13 | Baixa | Excluir conta a pagar (API) | Conta gerada por outro módulo podia ser apagada sozinha, deixando a origem órfã (o frontend não tinha o botão) | Só contas avulsas |
| 14 | Baixa | Editar viagem | Aceitava conjunto/motorista de outra empresa | Validado como no cadastro |
| 15 | Baixa | Acerto | Percentual de comissão aceitava negativo, >100 ou texto | 0 a 100 |
| 16 | Baixa | App do motorista | Posto de outra empresa aceito; posto criado pelo app ficava em minúsculas | Validado; maiúsculas como no cadastro |
| 17 | Baixa | Consulta de CNPJ | Sem timeout: BrasilAPI fora do ar prendia a requisição | 10 s |
| 18 | Baixa | Service worker | Guardava respostas 404/500 no cache offline | Só guarda resposta boa |

Também entrou no CI uma **checagem de sintaxe de todos os módulos do frontend**. Sem bundler, um erro
de sintaxe só aparece quando alguém abre a tela; durante esta revisão um caso desses foi pego no navegador.

## 3. Testes

De 250 para **275 testes**. Os novos ficam em `backend/test/revisaoTecnica.test.js`, `backupExterno.test.js` e `operacao.test.js` (migrações, conferência de saldo, rotas de saúde), um por correção:
- isolamento entre empresas, anexo `.html`, centavos;
- travas de viagem finalizada, reabrir, consolidação;
- último Admin, limite de login, arquivos públicos, versão;
- retenção, assinatura S3, ciclo de envio, falha de envio, restauração, tela de Backups.

Tudo passa. O teste ponta a ponta (Playwright) roda no CI.

## 4. O que muda para quem usa

- Excluir **despesa ou adiantamento de viagem finalizada** agora é recusado (como já era editar). Reabra a viagem.
- Contas de **parcela ou acerto** não entram mais em fatura consolidada.
- Anexos aceitam JPG, PNG, WEBP, GIF, HEIC/HEIF, BMP, TIFF e PDF (antes, qualquer "imagem").
- 10 senhas erradas seguidas bloqueiam aquele usuário por 15 minutos.
- O volume guarda mais backups (10 em vez de 2). O banco local tem ~0,6 MB por cópia; o de produção deve ser da mesma ordem.

## 5. Excessos e duplicações

Feito:
- `esc()` estava copiado em 8 arquivos do frontend → um só (`frontend/js/html.js`).
- **Backend:**
  - `somar()` (5 cópias) e `formatarMoeda()` (5) → `utils/formatacao.js`;
  - `somarMeses()` (3) e `somarDias()` (1) → `utils/dataHora.js`;
  - busca das categorias Abastecimento/Arla (6) → `utils/categoriasHelper.js`;
  - faixa de comissão (2 cópias "idênticas de propósito") → `utils/comissaoHelper.js`.
- **Frontend:** a etiqueta de prazo de vencimento (3 cópias) → `badgePrazoVencimento` em `components/statusIcons.js`; `primeiroDiaMesAtualIso` (3) → `masks.js`.

Ficou de fora de propósito:
- **Funções com o mesmo nome mas comportamento diferente** (`textoDias`, `normalizar`, `deltaPercentual`, `badgePagamento`): juntar mudaria o que aparece na tela.
- `recalcularTrio` (cálculo de litros/preço, 2 cópias): está em arquivos que outra sessão estava editando no mesmo dia.
- **Arquivos que não são código duplicado:**
  - os 46 scripts de `database/scripts/` (vários são citados em notas e rodados por `railway ssh`; mover quebraria as referências);
  - `logo-frottex.png` de 4,8 MB na raiz;
  - `instrucoes_sistema.txt.txt`;
  - `app.use(cors())`.

## 6. Segunda etapa (mesmo dia): sugestões feitas

1. **Migrações automáticas** (`backend/src/utils/migracoes.js`, `database/migrations/LEIAME.md`): da 037 em diante
   rodam sozinhas na subida, uma vez cada, em transação e com cópia do banco antes. Se falham, o servidor não sobe.
   As 000–036 (scripts manuais antigos, alguns destrutivos se rodados de novo) nunca são executadas. Banco novo
   (schema.sql) só marca as migrações como aplicadas. Testado num banco antigo real: aplicou a 037 e guardou a cópia.
2. **Escape de HTML em todas as telas**: ~190 interpolações de texto do banco em templates HTML ganharam `esc()`.
   Elas foram localizadas pela árvore sintática, não por busca de texto. Inclui:
   - colunas `render()`;
   - mensagens de confirmação;
   - ternários e listas `.map().join()`;
   - título dos modais, escapado no próprio componente.

   Testado no navegador com um fornecedor e uma conta de nome malicioso: o texto aparece literal e nada executa.
3. **Conferência de saldo bancário**: migração 037 cria `contas_bancarias.saldo_inicial`; a tela de Contas Bancárias
   confere `saldo = saldo inicial + entradas − saídas` e avisa quando não bate. O Admin acerta por um de dois jeitos:
   recalcular o saldo, ou lançar a diferença no extrato.
   Observação: isso pega divergência entre o saldo e o extrato. Um saldo **negativo de verdade** (pagamentos sem
   as entradas correspondentes, como o apontado na auditoria) bate com o extrato e não aparece aqui.
4. **Monitoramento**:
   - `/api/health` passou a testar o banco;
   - `/api/health/backup` responde 503 com backup atrasado (mais de 30h) ou cópia externa falhando;
   - o Railway espera o health check antes de dar o deploy como pronto;
   - o workflow `monitor.yml` checa as duas rotas de hora em hora e o GitHub manda e-mail quando falha;
   - para aviso em até 5 minutos, o passo a passo do UptimeRobot está no README.
5. **Duplicações**: ver a seção 5.

## 7. Sugestões que continuam abertas

1. **Ligar a cópia externa** (10 minutos, passo a passo no README) e criar o monitor no UptimeRobot.
2. Com o escape feito em todas as telas, uma *Content-Security-Policy* seria a camada seguinte.
   Exige tirar os `onclick`/`style` inline, se houver, e listar o CDN do SheetJS e as fontes.
3. **Backups nativos do volume no Railway** como camada extra (cobrem também os anexos, num clique).
4. **Validação de entrada sistemática**: várias rotas de escrita ainda aceitam qualquer coisa nos campos de texto/data.
5. Médio prazo: sessão em cookie `HttpOnly` em vez de `localStorage`.
