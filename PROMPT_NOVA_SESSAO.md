# Prompt para iniciar uma nova sessão do Claude Code neste projeto

Copie e cole o texto abaixo como a primeira mensagem, já dentro da pasta do
projeto clonado (`cd lw-sistema && claude`). Atualizado em 22/07/2026 (fim
da sessão que fez multi-empresa + Onixsat real + Multas + melhorias do dia).

---

Você está assumindo o desenvolvimento do sistema Frotista (gestão de frota
e transporte rodoviário). Não é um projeto novo — já está em produção no
Railway (`frotista-production.up.railway.app`) e sendo usado de verdade.

Antes de fazer qualquer coisa, leia nesta ordem:
1. `README.md` — como instalar e rodar o projeto localmente
2. `CONTEXTO_PROJETO.md` — decisões de arquitetura, regras de negócio não
   óbvias, seção "Estado atual" (multi-empresa, Onixsat, Multas, deploy) e
   os gotchas de "Como validar mudanças" (especialmente o do `node:sqlite`
   e o de rebuild do Tailwind)
3. `database/schema.sql` — os comentários explicam o porquê de cada tabela

## O que foi feito na última sessão (22/07/2026)

Depois de colocar multi-empresa + Onixsat + Multas em produção, o usuário
pediu uma rodada de ajustes/correções, revisando o sistema tela por tela.
Todos os itens abaixo foram implementados, testados ao vivo no navegador
(dados reais, não só leitura de código) e já estão **em produção**:

1. **Bug sistêmico corrigido**: `errorHandler.js` checava
   `err.code === 'SQLITE_CONSTRAINT_*'`, que nunca bate no `node:sqlite`
   (sempre `'ERR_SQLITE_ERROR'`) — toda violação de FK/UNIQUE/NOT NULL caía
   no 500 genérico. Corrigido checando `err.message`. Foi isso que causava
   o erro ao excluir um Fornecedor referenciado em outro lugar.
2. **Onixsat a cada 5 minutos**: antes era 10 min por segurança. Agora o
   mapeamento veículo↔placa (limite real de 5 min) fica cacheado 30 min em
   memória, e só a consulta de mensagens (limite de 30s) roda a cada ciclo
   — permite os 5 min sem estourar limite. Ver `onixsatSync.js`.
3. Botão "Atualizar posições (Onixsat)" adicionado no Painel e na tela de
   Viagem (componente reusável `frontend/js/components/onixsatSync.js`).
4. **Painel**: cards por veículo em viagem (km rodado, média de consumo —
   calculada por litros abastecidos, não há dado de consumo via telemetria
   na integração atual —, faturamento, despesas, localização), linkando
   pra tela da viagem.
5. **Ordenação clicável** no cabeçalho de toda tabela (`dataTable.js`,
   padronizado — clicar em "Valor" ordena por valor, etc.).
6. **Contas a Pagar**: filtros por categoria/veículo (join por
   `origem_tipo='DespesaViagem'` → `despesas_viagem.viagem_id` → conjunto →
   veículo "Cavalo"), link pra viagem de origem, badge de prazo de
   vencimento, baixa com campo de desconto e confirmação (409 → usuário
   confirma → `ajustarValorConta: true`) quando o valor baixado é maior que
   o restante da conta.
7. **Checklist de Bordo redesenhado**: antes era um estado único mutável
   por veículo. Agora são vistorias periódicas por **conjunto**
   (`checklist_vistorias`/`checklist_vistoria_itens`, histórico no tempo,
   cada vistoria nova herda o último valor conhecido de cada item pra só
   precisar atualizar o que mudou), mas os itens continuam por **placa**
   (carretas trocam de conjunto). Alerta de divergência quando o conjunto
   de hoje é diferente do registrado na vistoria.
8. Menu lateral corrigido: com muitos grupos abertos ele esticava a página
   inteira. Agora tem `lg:sticky` + `lg:h-screen` + scroll próprio.
9. **Tela de Viagem**: removida a edição manual de hodômetro/localização
   (só Onixsat + botão manual agora). No formulário de nova despesa: o
   campo "Posto" saiu do bloco de abastecimento e virou "Fornecedor" no
   bloco principal (filtrado só a Postos quando categoria = Abastecimento;
   os campos específicos de abastecimento ficam desabilitados nas outras
   categorias); novo campo "Observação" que, se preenchido, vira a primeira
   ocorrência da despesa.
10. Todas as migrações novas (`005_contas_pagar_desconto.js`,
    `006_checklist_vistorias.js`) já rodaram tanto no banco de dev quanto em
    **produção** (via `railway ssh`) — o deploy foi verificado ao vivo em
    `frotista-production.up.railway.app` sem erros de console em nenhuma
    tela mexida.

## Onde a revisão parou

O usuário estava passando pelo sistema módulo a módulo pedindo ajustes.
**Parou em "Viagens e Fretes"** — ou seja, os itens acima (que incluem
mudanças na própria tela de Viagem) foram o último lote. Pergunte ao
usuário qual é a próxima tela/módulo a revisar.

## Pendências explicitamente adiadas pelo usuário

- **TWT4B11 / TWG9J05** (carreta): dados de financiamento/seguro — o
  usuário disse que vai levantar com mais precisão e passar depois. **Não
  lance nada aí até ele mandar os dados.**

## Coisas para ficar de olho

- O catálogo de checklist (`checklist_itens_catalogo`) só tinha 4 itens de
  teste (Estepe, Macaco, Triângulo, Extintor) cadastrados nesta sessão pra
  poder testar o fluxo de vistoria — confirme com o usuário se é isso
  mesmo que ele quer no catálogo real ou se vai cadastrar a lista completa
  (Defletores, Geladeira, Rádio PX, Rastreador etc., como já estava
  comentado no schema).
- Não presuma nada sobre regra de negócio ambígua — pergunte antes.

Depois de ler tudo isso, me dê um resumo curto confirmando que entendeu o
estado atual, e pergunte ao usuário o que ele quer fazer a seguir.
