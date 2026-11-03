# Prompt para iniciar uma nova sessão do Claude Code neste projeto

Copie e cole o texto abaixo como primeira mensagem, já dentro da pasta do
projeto (`cd lw-sistema && claude`). Atualizado em 03/11/2026.

---

Você está assumindo o desenvolvimento do Frottex (gestão de frota e
transporte rodoviário). Não é um projeto novo: está em produção no Railway
(domínio `frottex.com.br`), em uso diário pela empresa, com dados reais.

Antes de fazer qualquer coisa, leia nesta ordem:
1. `README.md` — como rodar, variáveis de ambiente, produção, backups e restauração.
2. `CONTEXTO_PROJETO.md` — regras de negócio não óbvias (DRE, baixas,
   acerto, multi-empresa) e os cuidados de "Como validar mudanças".
3. `database/schema.sql` — os comentários explicam o porquê de cada tabela.
4. `docs/REVISAO_TECNICA_2026-11-03.md` — achados da última revisão técnica
   e as melhorias sugeridas que ainda não foram feitas.

## Regras de trabalho com este usuário

- Mudança feita em outra sessão/máquina é para ser **mantida**: corrija só
  o erro, nunca reverta funcionalidade.
- Regra de negócio ambígua: **pergunte** (2-3 opções concretas, uma
  recomendada). O usuário dá exemplos numéricos reais e espera que o
  sistema reproduza exatamente aqueles números.
- Teste de verdade antes de dizer que terminou: `npm test` no backend e o
  navegador para qualquer tela mexida.
- Push na `main` = deploy em produção. Só faça commit/push quando o
  usuário pedir. Coluna/tabela nova = migração automática nova em
  `database/migrations/` + o mesmo no `schema.sql` (ver `LEIAME.md` lá).
- Nada de alterar variáveis do Railway nem dados de produção sem
  confirmação explícita.

## Linha do tempo resumida

- **Jul/2026** — Sistema base (PRD em 3 passos), multi-empresa, Onixsat
  real, Multas, app do motorista, domínio próprio.
- **Set/2026** — Limpeza dos dados de teste e importação retroativa das
  viagens reais; lotes de ajustes tela a tela; anexos; reversão de
  auditoria com cascata; postos favoritos; relatórios salvos,
  multi-seleção e comparativo de período; status de pagamento do acerto.
- **Out/2026** — Acerto com reembolsos/descontos em lista e pedágio
  informativo; DRE por conjunto (com histórico de composição); previsão de
  recebimento; transferência entre contas; rateio de despesas fixas por
  centro de custo; baixa "sem pagamento"; comissão do motorista no DRE;
  recibos; importação da fatura do Sem Parar rateada por placa (pedágio no
  DRE pelo líquido); desconto de frete como despesa da placa; menu
  colorido por grupo; alertas de KM.
- **03/11/2026** — Auditoria completa dos dados (histórico × produção):
  27 achados, a maioria já corrigida, relatório em
  `C:\LW-DIA-DIA\AUDITORIA FROTTEX - 03-11-2026.xlsx` (fora do repositório).
  Depois, **revisão técnica do código**:
  - backup diário com retenção maior, cópia externa (S3/R2), tela de
    Backups e restauração;
  - aviso automático de versão nova (fim do "dá F5 depois do deploy");
  - correção de vazamento de dados entre empresas no Painel/DRE geral;
  - anexos seguros, escape de HTML no frontend, limite de tentativas de login;
  - valores em centavos validados na API e travas de viagem finalizada;
  - segunda etapa: migrações automáticas na subida, escape de HTML em
    todas as telas, conferência de saldo bancário × extrato,
    monitoramento (`/api/health`, `/api/health/backup`, workflow
    agendado no GitHub) e limpeza de funções duplicadas.

  Detalhes em `docs/REVISAO_TECNICA_2026-11-03.md`.

## Pendências conhecidas (confirme com o usuário antes de mexer)

- **Ligar a cópia externa dos backups** (Cloudflare R2): o código está
  pronto, falta criar o bucket e as 4 variáveis `BACKUP_S3_*` no Railway
  (passo a passo no README). Até lá os backups ficam só no volume.
- **Rotação de segredos** após o incidente de segurança da Railway
  (out/2026): `JWT_SECRET` e a senha do admin. O usuário já autorizou;
  confirme se foi feita.
- **Auditoria de 03/11**, itens que dependem de decisão do usuário:
  - F06: data real de pagamento dos acertos 1 a 3;
  - F07: prazo dos financiamentos (conferir contratos);
  - F20: seguros e despesas recorrentes que não existem no sistema.

  Ver a planilha da auditoria.
- **Virada para transportadora** (CT-e, MDF-e, CIOT, vale-pedágio,
  averbação): pesquisa feita, decisão em aberto. Documento em `C:\LW-DIA-DIA`.
- **Monitor de 5 em 5 minutos** (UptimeRobot, gratuito): o usuário precisa
  criar a conta; passo a passo no README ("Monitoramento"). O monitor de
  hora em hora do GitHub já funciona sozinho depois do push.
- Sugestões técnicas que continuam abertas (CSP, backups nativos do volume,
  validação sistemática de entrada): seção 7 do documento da revisão.

Depois de ler tudo isso, me dê um resumo curto confirmando que entendeu o
estado atual e pergunte o que eu quero fazer a seguir.
