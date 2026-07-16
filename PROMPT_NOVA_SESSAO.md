# Prompt para iniciar uma nova sessão do Claude Code neste projeto

Copie e cole o texto abaixo como a primeira mensagem, já dentro da pasta do
projeto clonado (`cd lw-sistema && claude`).

---

Você está assumindo o desenvolvimento do sistema Frotista (gestão de frota
e transporte rodoviário). O PRD original está em `instrucoes_sistema.txt.txt`.
Os Passos 1 (banco de dados), 2 (backend) e 3 (frontend) já estão completos
e testados — isto não é um projeto novo, é uma continuação.

Antes de fazer qualquer coisa, leia nesta ordem:
1. `README.md` — como instalar e rodar o projeto localmente
2. `CONTEXTO_PROJETO.md` — decisões de arquitetura, regras de negócio não
   óbvias (especialmente o fluxo de recapagem de pneus e as baixas do
   recebível de frete), como validar mudanças, e como eu gosto de
   trabalhar
3. `database/schema.sql` — os comentários explicam o porquê de cada tabela

Depois de ler os três, me dê um resumo curto (5-6 linhas) confirmando que
você entendeu, cobrindo especificamente: (a) como o custo de um pneu
recapado entra no DRE sem duplicar o valor de aquisição, (b) como funciona
o razão de baixas do recebível de frete e a diferença entre "Desconto" e as
outras baixas, (c) como a matriz de permissões por módulo se relaciona com
o perfil base do usuário.

Não presuma nada sobre regra de negócio ambígua — pergunte antes.

Depois disso, vou te dizer o que quero fazer a seguir.
