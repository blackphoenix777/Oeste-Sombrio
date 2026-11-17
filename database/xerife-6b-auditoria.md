# P0-2 — auditoria e contrato candidato do 6B do Xerife

17/11/2026 (atualizado após homologação real em `igyupxczhczidfgtjiws`). Escopo: XER-01/02/03 concluído e validado em Homologação (`igyupxczhczidfgtjiws`). Produção (`jxxhdqoyblykqiiyptsp`) não alterada.

## Fontes existentes e autoridade

| Área | Fonte | Autoridade / limites |
| --- | --- | --- |
| Sorteio | `dist/js/rules/diceRules.js` | `generateDiceResult`: inteiro uniforme entre 1 e o número de faces; a rolagem de 6B não usa explosão |
| Regras oficiais do Xerife | Livro `OESTE SOMBRIO 2.0`, Capítulo 12 | Aberto = 6 dados do menor tipo; Secreto = 1 dado por jogador ativo do maior tipo; gasto flexível (1, vários ou todos); renovação somente após gastar todos os dados, sem custos/fadiga |
| Progressão por nível | `dist/data/progressao/progressao_6b.json`, `magiasUI.js` | `calculate6BConfig(nivel)` — nível da ficha determina os dados 6B do jogador de forma determinística |
| Ficha vinculada | `loadPlayerSheetForMesa` em `mesaScreen.js`, `createNewCharacter` em `homeScreen.js` | `playerFichaId` identifica a ficha aberta; criação dentro da mesa dispara `OS.refreshXerife6B()` imediatamente |
| Participantes | `public.membros_mesa` | Associação/cargo; presença online e lease de 90 s ficam em `xerife_6b.presencas` |
| Seleção / ataque de NPC | `mesaScreen.js`, `modal.js`, `dice.js`, `inventoryUI.js` | `🎲 Rolar` em popups e ficha completa de NPCs (quando em mesa com 6B do Xerife ativo) abre `#chamber-modal` com os dados do 6B Aberto para escolha do Xerife |
| Turn Tracker | `turnTracker.js`, RPC `gerenciar_combate` | Ordem, iniciativa, orçamento e eventos COM continuam inalterados neste pacote |
| Interface | `mesaXerife6B.js`, `mesaScreen.js`, `index.html`, `style.css` | Painéis recolhíveis na lateral MESA-01; seleção direta nas pílulas e botões `Rolar conjunto`, `Consumir`, `Gastar todos` e `Renovar` |

## Regras confirmadas e implementadas

1. **Composição pelo nível da ficha (`xerife_6b.composicao`):**
   * Lê `dados->>'nivel'` (ou coluna `nivel` da tabela `public.fichas`) como fonte primária para jogadores, aplicando a tabela oficial (`1 → 6d6`, `2..6 → d6/d8`, `7 → 6d8`, `8..12 → d8/d10`, `13 → 6d10`, `14..18 → d10/d12`, `19+ → d12`).
   * Mantém fallback para `config6B` / `config-6b` apenas quando `nivel` não estiver presente (ex.: fixtures legados).
   * Fichas incompletas sem nível ou `config6B` válidos são ignoradas individualmente (contabilizadas em `fichas_invalidas` apenas para o Mestre), sem derrubar a leitura da mesa inteira.
2. **Consumo oficial (`consumir_6b_xerife`):**
   * Exclusivo do Mestre (`xerife_6b.autorizar(p_mesa, 'secreto')`), com `FOR UPDATE` e versionamento otimista (`40001`).
   * Aceita qualquer subconjunto não vazio de índices disponíveis (`1`, vários ou todos de uma vez) e rejeita índices duplicados, fora de faixa ou já gastos (`22023`).
   * Atualiza `public.mesa_6b_aberto` apenas quando `p_tipo = 'aberto'`, disparando Realtime apenas do conjunto aberto.
3. **Renovação oficial (`renovar_6b_xerife`):**
   * Exclusiva do Mestre, com `FOR UPDATE` e versionamento otimista (`40001`).
   * Bloqueada (`55000`) enquanto restar qualquer dado não gasto (`cardinality(usados) < cardinality(dados)`), permitindo renovar somente após zerar todos os resultados do conjunto.
   * Sem custo adicional nem fadiga (fadiga e dano no 6B permanecem exclusivos de jogadores e futuros NPCs importantes em XER-04/05/06).
   * Ao renovar, adota a composição atual dos jogadores ativos com ficha válida, rola novos valores no servidor e zera `usados`.

## Segurança e persistência

Migração candidata atualizada em `supabase/migrations/20261117151310_xerife_6b_foundation.sql`:
* `xerife_6b.presencas` e `xerife_6b.conjuntos`: schema privado com RLS habilitada, sem privilégios para `anon`/`authenticated` e fora da publicação Realtime.
* `public.mesa_6b_aberto`: projeção somente do conjunto aberto; única tabela nova publicada em `supabase_realtime`.
* RPCs públicas `SECURITY INVOKER` (`presenca_6b_xerife`, `ler_6b_xerife`, `rolar_6b_xerife`, `consumir_6b_xerife`, `renovar_6b_xerife`) delegando para funções `SECURITY DEFINER` com `search_path = ''`.
* Nenhuma mudança em produção (`jxxhdqoyblykqiiyptsp`).
