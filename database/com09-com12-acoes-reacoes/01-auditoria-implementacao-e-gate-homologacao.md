# Oeste Sombrio 2.0 — Pacote 9: Auditoria, Implementação Local e Gate de Homologação (COM-09 a COM-12)

**Data:** 19/11/2026  
**Branch Dedicada:** `feature/com09-com12-reactions` (base `main` / `origin/main` = `f743bbdb694e5400c127551fb546969535e180a9`, release pública `1.4.6` preservada intacta)  
**Bancos Remotos:** Produção (`jxxhdqoyblykqiiyptsp`) e Homologação (`igyupxczhczidfgtjiws`) **100% intocados**  
**Publicação / Git Remoto:** Sem commit em `main`, sem merge, sem tag, sem release e sem `git push`

---

## Classificação Individual (Gate Fase I)

| Entrega | Classificação | Síntese Objetiva |
| --- | --- | --- |
| **COM-09 · Preservar ações pós-turno** | **`IMPLEMENTADO COM RESSALVAS`** | Semântica de fases (`pre_turn`, `active_turn`, `post_turn`, `round_ended`), preservação pós-turno, bloqueio de ordinárias, expiração na virada e fix de hidratação `turnEnded` em reconexão validados em regras puras, Chrome headless e Tauri Dev. Pendente execução da migração SQL em PostgreSQL 17 descartável (Docker Desktop parado no host). |
| **COM-10 · Autorizar reação antecipada** | **`IMPLEMENTADO COM RESSALVAS`** | Fluxo completo (`request_early_reaction`, `approve_early_reaction`, `deny_early_reaction`, `cancel_early_reaction`), autorização exclusiva do Xerife (`42501`), idempotência (`p_op_id`), conflitos `PT409`, expiração ao iniciar turno/virar rodada e preservação intacta da iniciativa validados em regras puras, Chrome headless e Tauri Dev. Pendente execução transacional real e teste concorrente `Promise.all` em PG 17 / Homologação. |
| **COM-11 · Disparar oportunidade contextual (V1)** | **`IMPLEMENTADO COM RESSALVAS`** | Indicação manual pelo Xerife (`open_opportunity`, `close_opportunity`, `execute_opportunity_reaction`), cálculo tático exclusivamente pela grade (`grid_x, grid_y` × `1,5 m`, nunca pixels), inspeção automática de perícia passiva (`maior 6B + dado`) sem inventar dados ausentes e distinção clara entre checagem automática e confirmação do Xerife validados em regras puras, Chrome e Tauri Dev. Pendente validação SQL real em PG 17. |
| **COM-12 · Barra contextual de ações** | **`IMPLEMENTADO LOCALMENTE`** | Integrada diretamente em `#mesa-turn-tracker` (`#mesa-tracker-action-bar`) sem painel paralelo; contadores estritamente somente leitura; comandos filtrados por papel e fase; fila de solicitações pendentes visível ao Xerife; validada em Chrome headless (`31/31` + `10/10` suítes de regressão) e Tauri Dev WebView2 (`0` exceções). Depende da aplicação da migração SQL no ambiente remoto para operar com persistência na homologação. |

---

## 1. Auditoria da Arquitetura COM-08 (Fase A)

### Mapa de Contratos Reais Encontrados no Repositório

| Responsabilidade | Arquivos | Funções / Símbolos | RPCs / Tabelas / Eventos |
| --- | --- | --- | --- |
| Controle do combatente ativo, avanço de turno e virada de rodada | `dist/js/turnTracker.js`, `supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql` | `OS.runMesaCombatAction`, `reconcileCombatRoundState`, `OS.acceptMesaCombatSnapshot`, `OS.renderMesaCombat` | `public.mesas.combate_ativo` (JSONB), RPC `public.gerenciar_combate(p_mesa_id, p_acao, ...)` sob `FOR UPDATE` |
| Cálculo do orçamento inicial por modalidade | `dist/js/rules/initiativeRules.js`, `dist/js/mesaScreen.js`, `supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql` | `computeTurnActionBudget`, `calculateActionsFromInitiative`, `extractMonsterFixedActions`, `OS.computeCombatantTurnBudget` | `public.calcular_orcamento_inicial_combate`, `public.criar_action_state_combate` (Jogador/`full_sheet`: `1 + floor(init/5) - sobrecarga - Atordoado`; NPC Criatura: `1` fixa; Monstros oficiais: `acoes_por_turno` fixa 2/2/3/3; NPC legado: `budgetDefined = false`) |
| Ações gastas, reservadas e saldo derivado | `dist/js/rules/initiativeRules.js`, `dist/js/turnTracker.js`, `supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql` | `computeAvailableActionsFromState`, `hasPendingActionReservations`, `applyActionControllerOperation`, `OS.combatActionController` | `combate_ativo->'ordem'[i]->'action_state'` (`initialBudget`, `spentActions`, `reservedActions`, `turnEnded`, `version`, `ledger`, `auditLog`, `opResults`), RPC `public.gerenciar_acao_combate` |
| Identificação de combatente, mapa e rodada | `dist/js/turnTracker.js`, `dist/js/mesaMaps.js` | `findActiveCombatItemAndEntry`, `OS.selectMesaMapToken` | `public.mesa_tokens` (`id`, `mesa_id`, `mapa_id`, `owner_type`, `owner_ref`, `owner_user_id`, `grid_x`, `grid_y`, `iniciativa`, `visible_to_players`) + `combate_ativo.id` / `mapa_id` / `round` |
| Autenticação, autorização e privacidade | `dist/js/authSession.js`, `dist/js/turnTracker.js`, `supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql` | `OS.verifyAuthSession`, `isActorAuthorizedForCombatant`, `sanitizeCanonicalCacheForStorage` | `public.is_mestre_da_mesa`, `public.membros_mesa`, `public.obter_combate_publico` (remove `action_state` e `next_round_initiative` de terceiros e oculta tokens `visible_to_players = false`) |
| Sincronização Realtime | `dist/js/mesaScreen.js`, `database/turn-tracker.sql` | `OS.subscribeMesaRealtimeChannel` (canal `mesa-<mesaId>`) | Trigger `combate_estado_sinal` (`AFTER UPDATE OF combate_ativo ON public.mesas`) → incrementa `public.mesa_combate_sinais.revisao` → clientes recarregam via `obter_combate_publico` (sem payload privado no WebSocket) |
| Distância tática e teste passivo | `dist/data/regras/regras_combate.json`, `dist/data/regras/sistema_de_testes.json`, `dist/js/cylinder.js` | `OS.performPassiveSkillTest` (maior dado disponível do 6B + dado da perícia ou `1d4-2`) | `mesa_tokens.grid_x`, `mesa_tokens.grid_y` (`tamanho_do_quadrado_metros = 1.5`) |

### Avaliação de Compatibilidade de COM-08 e Defeito Encontrado na Auditoria

- **Compatibilidade geral:** COM-08 **é compatível** com COM-09..COM-12 sem alterar nenhum contrato aprovado de COM-01..COM-08. `gerenciar_acao_combate` continua protegendo `p_is_reaction = true` para não-Mestres (`42501`), e o novo fluxo de reações/oportunidades opera diretamente sobre o **mesmo** `combate_ativo` e o **mesmo** `action_state.ledger` sob o **mesmo** lock `FOR UPDATE` em `public.mesas` (sem saldo paralelo nem risco de deadlock).
- **Bug real detectado em `dist/js/turnTracker.js` (corrigido neste pacote):** na reconciliação (`reconcileCombatRoundState`, linhas antigas 473/584/594), um cliente que reconectava no meio da rodada inicializava `entry.turnEnded = false` e sobrescrevia `entry.actionState.turnEnded` em vez de hidratar `item.action_state.turnEnded` do servidor. Corrigido para sempre priorizar `item.action_state.turnEnded` quando presente no snapshot autoritativo.
- **Justificativa formal para nova migração SQL (Fase F.2):**
  1. `gerenciar_acao_combate` não possui máquina de estados para solicitações pendentes de reação antecipada (`pending -> approved | denied | cancelled | expired`) nem para oportunidades contextuais abertas pelo Xerife (`open -> consumed | closed`), e bloqueia qualquer chamada de reação de jogador com `42501`.
  2. `obter_combate_publico` precisava projetar `oportunidades_reacao` e `solicitacoes_reacao` com filtragem estrita de privacidade (jogador recebe apenas os registros do próprio combatente e nunca identidades de alvos ocultos).
  3. `gerenciar_combate('proximo')` precisava expirar solicitações antecipadas pendentes quando o turno do combatente inicia e limpar oportunidades/solicitações/cache de idempotência na virada da rodada (`round -> round + 1`).

---

## 2. Arquivos Criados e Modificados

| Arquivo | Ação | Finalidade |
| --- | --- | --- |
| [`dist/js/rules/reactionRules.js`](../../dist/js/rules/reactionRules.js) | Criado | Motor puro (zero DOM) para COM-09 (`deriveCombatantTurnPhase`, `summarizeCombatantActionEconomy`), COM-11 (`computeGridDistanceBetweenTokens`, `inspectPassiveSkillForReaction`, `evaluateContextualOpportunity`) e COM-12 (`CONTEXTUAL_ACTION_CATALOG`, `evaluateContextualBarCommands`). |
| [`dist/js/rules/index.js`](../../dist/js/rules/index.js) | Modificado | Reexporta `./reactionRules.js`. |
| [`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js) | Modificado | Expõe helpers de `reactionRules.js` em `OS.*` (com guardas `typeof`) e sincroniza seleção de token do mapa (`OS.selectMesaMapToken`) com a barra contextual. |
| [`dist/js/turnTracker.js`](../../dist/js/turnTracker.js) | Modificado | Corrige hidratação de `turnEnded`; reconcilia `oportunidades_reacao` e `solicitacoes_reacao` com sanitização por usuário; adiciona `executeReactionControllerMutation` e métodos COM-09/10/11 em `OS.combatActionController`; renderiza a barra contextual COM-12 (`#mesa-tracker-action-bar`) integrada a `#mesa-turn-tracker`. |
| [`dist/index.html`](../../dist/index.html) | Modificado | Adiciona `<section id="mesa-tracker-action-bar" ... hidden>` dentro de `#mesa-turn-tracker`. |
| [`dist/style.css`](../../dist/style.css) | Modificado | Estilos compactos e responsivos para `.mesa-tracker-action-bar` na paleta existente do Turn Tracker. |
| [`supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`](../../supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql) | Criado | Migração incremental local: `calcular_fase_turno_combate`, evolução retrocompatível de `obter_combate_publico` e `gerenciar_combate`, e nova RPC transacional `gerenciar_reacao_combate` com `SECURITY DEFINER`, `SET search_path = ''`, `FOR UPDATE`, idempotência por `p_op_id` e `SQLSTATE PT409`. |
| [`tests/com09-com12-reactions-ui.cjs`](../../tests/com09-com12-reactions-ui.cjs) | Criado | Suíte automatizada (regras puras zero-DOM + auditoria estática SQL + 31 verificações em Chrome headless via `browser-harness.cjs`). |
| [`tests/rls-com09-com12-reactions.sql`](../../tests/rls-com09-com12-reactions.sql) | Criado | Suíte transacional PostgreSQL 17 / RLS (`BEGIN ... ROLLBACK`) cobrindo COM-09, COM-10, COM-11, `PT409`, idempotência e privilégios `EXECUTE`. |
| [`database/com09-com12-acoes-reacoes/02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql) | Criado | Plano SQL documentado de reversão segura para as definições COM-05..COM-08 caso necessário após homologação. |

---

## 3. Regras Implementadas e Políticas de Concorrência

- **COM-09 (Pós-turno):** encerrar turno grava `action_state.turnEnded = true` mantendo o saldo restante disponível somente para reações válidas (`execute_opportunity_reaction`); ações ordinárias pós-turno permanecem bloqueadas (`22023`); na virada de rodada, `gerenciar_combate('proximo')` bloqueia caso exista reserva pendente em `ledger` e, estando livre, renova o orçamento da nova rodada expirando saldo anterior, oportunidades e solicitações. NPCs Criatura mantêm orçamento fixo `1` e monstros do bestiário mantêm `acoes_por_turno`.
- **COM-10 (Reação antecipada):** em `pre_turn`, jogador não pode executar reação diretamente (`42501`); envia `request_early_reaction` (sem debitar saldo); apenas o Xerife (`is_mestre_da_mesa`) pode `approve_early_reaction` ou `deny_early_reaction` (`42501` para qualquer jogador, inclusive autoaprovação ou outra mesa). Aprovação revalida sob `FOR UPDATE`: rodada, fase `pre_turn`, oportunidade vinculada aberta e saldo ao vivo (`PT409` em caso de corrida/saldo esgotado, nunca saldo negativo), debita `1` ação atomicamente no `action_state.ledger` e **não altera iniciativa nem ordem do turno**. Negação e cancelamento consomem `0` ações.
- **COM-11 (Oportunidade contextual V1):** abertura/fechamento exclusivos do Xerife (`42501`). Distância calculada exclusivamente sobre `mesa_tokens.grid_x, grid_y` no mesmo mapa (`Chebyshev × 1,5 m`, nunca pixels). Dados ausentes de distância ou perícia passiva retornam `needs_gm_confirmation` sem inventar elegibilidade.
- **COM-12 (Barra contextual):** embutida em `#mesa-turn-tracker`, exibe combatente selecionado, rodada/fase, 4 contadores somente leitura (`Disponíveis`, `Reservadas`, `Gastas`, `Reações`), seletor canônico com custo e recursos, explicação de bloqueios, reservas pendentes, oportunidades abertas, solicitações aguardando Xerife e seção recolhível do Xerife para indicar oportunidade.
- **Idempotência e desconexão:** toda mutação exige `p_op_id`. Replay com mesmo `p_op_id` e payload equivalente retorna `idempotentReplay: true` sem duplo débito (inclusive após queda de rede pós-commit na aprovação do Xerife); mesmo `p_op_id` com payload divergente retorna `22023`. Conflitos `PT409`/`P0409`/`40001` disparam `OS.loadMesaCombat()` sem retry automático inseguro.

---

## 4. Testes Executados, Falhas Encontradas e Evidências

### Verificações Aprovadas Localmente

| Suíte / Verificação | Resultado | Observações |
| --- | --- | --- |
| Sintaxe ESM (`reactionRules.js`, `index.js`, `mesaScreen.js`, `turnTracker.js`) | **PASS (`4/4`)** | Validado via `node --input-type=module --check` (stdin) |
| `tests/com09-com12-reactions-ui.cjs` | **PASS (`pure + 31/31`)** | Regras puras COM-09..12 + auditoria SQL + 31 fluxos UI/RPC/Realtime/PT409/idempotência em Chrome headless |
| `tests/turn-tracker-ui.cjs` | **PASS (`28/28`)** | Zero regressões no Turn Tracker existente |
| `tests/com05-com06-initiative-budget.cjs` | **PASS (`pure + 28/28`)** | Zero regressões em iniciativa e orçamento por modalidade |
| `tests/com07-com08-controller-events.cjs` | **PASS (`pure + 23/23`)** | Zero regressões em COM-07/COM-08 e idempotência 64+ |
| `tests/com03-com04-creature-mode.cjs` | **PASS (`25/25`)** | Zero regressões em Criatura / NPC legado |
| `tests/mesa-p0-interactions.cjs` | **PASS (`33/33`)** | Zero regressões em MESA-01/02/03 |
| `tests/multiple-maps-ui.cjs` | **PASS (`27/27`)** | Zero regressões em múltiplos mapas |
| `tests/xerife-6b-ui.cjs` | **PASS (`39/39`)** | Zero regressões no 6B compartilhado do Xerife |
| `tests/xerife-6b-xer04-own-editor.cjs` | **PASS (`31/31`)** | Zero regressões em XER-04 |
| `tests/xerife-6b-xer05-instance-persistence.cjs` | **PASS (`10/10`)** | Zero regressões em XER-05 |
| `tests/xerife-6b-xer06-instance-combat.cjs` | **PASS (`32/32`)** | Zero regressões em XER-06 e PT409 |
| **Tauri Dev (`npm run tauri dev`, WebView2 isolado + CDP `9348`)** | **PASS (`0` exceções)** | `version: "1.4.6"`, `origin: "http://127.0.0.1:1430"`, `hasControllerMethods: true`, `barVisible: true`, `noEditableNumberInput: true`, `phaseT1: "post_turn"`, `phaseT2: "active_turn"`, `oppEligible: true`, `oppDistanceMeters: 1.5`, `oppAuthMode: "post_turn_gm_opportunity"`, `uncaught: []` |

### Falhas Encontradas Durante Desenvolvimento e Corrigidas

1. **Bug pré-existente de hidratação `turnEnded` em `dist/js/turnTracker.js`:** corrigido para preservar `item.action_state.turnEnded` do servidor ao reconectar no meio da rodada.
2. **Import de `diceRules.js` na suíte pura Node (`tests/com09-com12-reactions-ui.cjs`):** ajustado para importar `reactionRules.js` diretamente (mesmo padrão de `com07-com08-controller-events.cjs`).
3. **Execução síncrona/timeout do harness de teste em `tests/com09-com12-reactions-ui.cjs`:** migrado para `tests/browser-harness.cjs` (CDP assíncrono), passando `31/31` em segundos.

### Cenários Ainda Não Testados (Ressalvas Explícitas)

1. **Execução em PostgreSQL 17 descartável (`tests/rls-com09-com12-reactions.sql` e `tests/rls-com05-com08-combat-actions.sql`):** não executada neste host porque o daemon Docker Desktop está desligado (`npipe:////./pipe/dockerDesktopLinuxEngine` indisponível) e não há `psql` local instalado.
2. **Concorrência HTTP real multi-cliente (`Promise.all` contra PostgREST/Supabase) e WebSocket Realtime real de COM-09..COM-12:** reservada para a etapa autorizada de Homologação (`igyupxczhczidfgtjiws`), pois alterações remotas estão proibidas no Pacote 9.

---

## 5. Riscos e Pontos de Ambiguidade Documentados

1. **Compatibilidade de migração antes do cliente:** se o frontend COM-09..12 for usado contra um banco sem `20261119120000_com09_com12_reactions_and_opportunities.sql`, as operações de reação falham de forma segura (*fail-closed* `REACTION_CONTROLLER_RPC_UNAVAILABLE` / `PGRST202`) sem mutação local, enquanto o Turn Tracker e COM-08 seguem operacionais.
2. **Escala tática com tokens sobrepostos ou sem posicionamento:** se o Xerife abrir oportunidade sem mover os tokens na grade (ambos em `(0,0)`), a distância calculada será `0 m` (`in_range`); a barra exibe explicitamente as coordenadas `(grid_x, grid_y)` de cada alvo e mantém o controle final com o Xerife.
3. **Resolução de rolagem/dano da reação (escopo futuro COM-16..COM-22):** conforme Fase G, COM-09..COM-12 controla economia de ações, elegibilidade, solicitação/aprovação e registro autoritativo sem implementar antecipadamente aplicação automática de dano (COM-16), Mira progressiva (COM-13/14) ou Esforço (COM-15).

---

## 6. Plano de Homologação Remota (Aguardando Autorização)

**INTERROMPIDO ANTES DE QUALQUER ALTERAÇÃO EM HOMOLOGAÇÃO OU PRODUÇÃO.**

Sequência recomendada após autorização explícita do proprietário:

1. **Ensaio local em PostgreSQL 17 descartável (`--network none`):**
   - Iniciar Docker Desktop e restaurar schema base + 19 migrações atuais em `supabase/postgres:17.11.0.011`.
   - Aplicar `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`.
   - Executar `tests/rls-com05-com08-combat-actions.sql` (`14/14 PASS`) e `tests/rls-com09-com12-reactions.sql` (`6/6 grupos PASS`) em transação `ROLLBACK`.
2. **Aplicação controlada em Homologação (`igyupxczhczidfgtjiws`):**
   - Conferir histórico de migrações de Homologação antes de aplicar `20261119120000_com09_com12_reactions_and_opportunities.sql`.
   - Auditar `pg_proc` (`SECURITY DEFINER`, `search_path = ''`, ACL `anon = false`, `authenticated = true`) e `get_advisors (security)`.
3. **Testes Live Multi-Sessão em Homologação:**
   - Dois clientes simultâneos (`Xerife` + `Jogador A` + `Jogador B`):
     - COM-09: encerrar turno com saldo, bloquear ordinária, abrir oportunidade, consumir pós-turno, expirar na virada.
     - COM-10: solicitar pré-turno, bloquear autoaprovação (`42501`), negar (`0` débito), aprovar (`-1` ação sem alterar ordem), corrida `Promise.all` (consumo concorrente vs aprovação → HTTP `409` / `PT409` imediato sem stall de 120s e sem saldo negativo), replay pós-queda com mesmo `p_op_id`.
     - COM-11: oportunidade dentro/fora do alcance (`1,5 m`), perícia passiva, troca de mapa e reconexão.
     - COM-12: validação visual no Tauri Dev conectado à Homologação, verificando atualização via `mesa_combate_sinais` Realtime e ausência de vazamentos privados.
4. **Plano de Reversão:** caso a homologação detecte incompatibilidade, executar o script documentado em [`02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql) (que remove `gerenciar_reacao_combate` e `calcular_fase_turno_combate` e restaura `obter_combate_publico` e `gerenciar_combate` para a definição exata da migração `20261116210603`, sem tocar em dados de mesas, fichas ou tokens).
5. **Gate para Produção e Release futura (`1.4.7`):** somente após aprovação integral da Homologação, em pacote e autorização separados.
