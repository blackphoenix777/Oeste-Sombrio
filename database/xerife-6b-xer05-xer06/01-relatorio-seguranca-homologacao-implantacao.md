# OESTE SOMBRIO 2.0 — IMPLEMENTAÇÃO XER-05 + XER-06
## Relatório Técnico, Auditoria de Segurança, Homologação e Plano de Implantação

**Classificação Final da Entrega:** **IMPLEMENTADA LOCALMENTE — HOMOLOGAÇÃO PENDENTE**  
**Branch:** `feature/xerife-6b-npc-boss`  
**Base Estável:** `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab` (`main` / `origin/main` / tag `v1.4.5`)  
**Versão Pública:** `1.4.5` (preservada sem alterações)  
**Produção (`jxxhdqoyblykqiiyptsp`):** **INTOCADA (0 operações remotas)**  
**Homologação (`igyupxczhczidfgtjiws`):** **INTOCADA (0 migrações remotas aplicadas nesta etapa)**

---

## 1. Alinhamento da Regra Oficial de Fadiga (Divergência Corrigida)

Durante a revisão do contrato preliminar de XER-04 (`validateAndProjectOwn6BInstanceCommand`), foi identificada e corrigida uma divergência na regra de aplicação da Fadiga:

- **Contrato preliminar anterior (incorreto):** subtraía `fadiga` uniformemente de cada dado rolado (`Math.max(0, roll - state.fadiga)`).
- **Regra oficial aprovada do sistema (`dist/js/rules/fatigueRules.js` -> `applyFatigueTo6BRoll`):**
  1. Cada ponto de Fadiga reduz em `-1` **apenas o maior resultado disponível entre os dados intactos** (em caso de empate no maior valor, desempata na ordem horária `0, 1, ..., N-1`).
  2. Se um dado intacto chega a `0` por Fadiga, ele fica inutilizado pela Fadiga (`zeradosPorFadiga` / `zerados_fadiga`) e o saldo restante de Fadiga transborda em cascata para o próximo maior dado intacto disponível.
  3. Dados bloqueados por dano físico (`bloqueados`) permanecem sempre em `0` e **nunca** são confundidos com dados zerados por Fadiga (`zeradosPorFadiga`).
- **Correção aplicada em paridade (JS + PostgreSQL 17):**
  - `dist/js/rules/own6BRules.js`: `applyFatigueCascadeToInstanceRoll(originalResults, blockedIndices, fatigueLevel)`.
  - `supabase/migrations/20261118101800_xerife_6b_instance_combat.sql`: `xerife_6b.aplicar_fadiga_cascata(p_originais, p_bloqueados, p_fadiga)`.

---

## 2. Arquitetura Implementada (XER-05 + XER-06)

### 2.1 XER-05 — Estado Persistente por Instância
1. **Separação Estrita Molde vs. Instância:**
   - Moldes em `public.fichas` (Meus NPCs / Bestiário Customizado) e `mesas.npcs_mesa` armazenam exclusivamente a definição estrutural de 6B (`hasOwn6B`, `own6B`, `config-6b`, `config6B`).
   - Ao instanciar em cena (`OS.addCreatureToScene` / `OS.addNpcMesaToScene`), qualquer resíduo de estado vivo (`own6BInstance`, `consumedChambers`, `fatigueZeroedChambers`) é limpo e a instância recebe identidade própria `(mesa_id, instance_id)` via `OS.ensureInstanceOwn6BState(instance, { resetRuntimeIfTemplate: true })`.
2. **Isolamento entre Múltiplos Bosses do Mesmo Molde (`#1`, `#2`, ...):**
   - Cada instância viva possui vetores independentes de `dados` (`1..15` dados em `{4,6,8,10,12}`), `resultadosOriginais`, `resultados`, `consumidos`, `bloqueados`, `zeradosPorFadiga`, `usados`, `fadiga`, `esgotado` e `versao`.
   - Editar o molde após criar instâncias em cena não sobrescreve o pool vivo das instâncias já em combate.
3. **Preservação em Troca de Mapa, Reconexão e Exclusão Individual:**
   - A chave primária de `public.mesa_6b_instancia` é `(mesa_id, instance_id)`, com `token_id uuid NULL REFERENCES public.mesa_tokens(id) ON DELETE SET NULL` e trigger `trg_mesa_tokens_sync_6b_instancia` que atualiza `mapa_id` e `token_id` automaticamente quando o token muda de mapa.
   - `OS.refreshInstanceOwn6B` ressincroniza o estado autoritativo na abertura da mesa e em reconexões (`SUBSCRIBED`).
   - `OS.removeCreatureFromScene` remove apenas a instância cujo último token foi excluído (`remover_6b_instancia`), mantendo outras instâncias do mesmo molde e o molde intactos.

### 2.2 XER-06 — Motor de Combate por Instância (Consumo, Dano, Fadiga e Renovação)
1. **Rolagem Inicial (`ROLL_INITIAL` / `rolar_6b_instancia`):**
   - Rola `1..15` dados conforme as faces de cada câmara (`d4..d12`), aplica a cascata de fadiga vigente e bloqueia segunda rolagem inicial (`SQLSTATE 0A000`), exigindo o fluxo de renovação após o esgotamento.
2. **Consumo (`CONSUME` / `consumir_6b_instancia`):**
   - Consome apenas dados disponíveis (`resultado > 0`, não consumidos, não bloqueados por dano e não zerados por fadiga).
   - Calcula e retorna `consumedIndices`, `consumedValues` e `consumedBonus`.
   - Bloqueia consumo duplicado ou de câmara indisponível com `SQLSTATE 22023`.
3. **Dano com Escolha pelo Defensor (`APPLY_DAMAGE` / `aplicar_dano_6b_instancia` + `#defender-damage-modal`):**
   - Modal dedicado `#defender-damage-modal` permite ao defensor autorizado (Mestre ou jogador designado em `mesa_tokens.owner_user_id`) escolher exatamente quais dados intactos perderá (`Math.min(dano, dadosIntactos)`).
   - Os dados escolhidos entram em `bloqueados`, têm `resultados` e `resultadosOriginais` zerados, sincronizam `mesa_token_status` (`six_b_total`, `danos_bloqueados`) e jamais podem ser bloqueados em duplicidade (`SQLSTATE 22023`).
4. **Fadiga Automática (`SET_FATIGUE` / `ajustar_fadiga_6b_instancia`):**
   - Recalcula imediatamente os resultados a partir de `resultadosOriginais` aplicando a redução em cascata nos maiores dados intactos e atualizando `zeradosPorFadiga` separadamente de `bloqueados`.
5. **Renovação (`RENEW` / `renovar_6b_instancia`):**
   - Exige que todos os dados intactos estejam esgotados (`SQLSTATE 55000 POOL_NOT_EXHAUSTED` se ainda houver dado disponível).
   - Preserva `bloqueados` (dano físico), limpa `consumidos`, incrementa `fadiga + 1` automaticamente e rola novos valores para os dados intactos já com o desconto de fadiga em cascata.

---

## 3. Auditoria de Segurança, Concorrência, Idempotência e Realtime

| Controle | Implementação Verificada | Status |
| :--- | :--- | :---: |
| **RLS em `public.mesa_6b_instancia`** | `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT SELECT TO authenticated`. Escrita direta bloqueada (somente via RPC). | **PASS** |
| **Política `mesa_6b_instancia_leitura`** | Permite leitura apenas ao Mestre da mesa (`public.is_mestre_da_mesa(mesa_id)`) ou ao membro da mesa explicitamente vinculado como `owner_user_id` do token da criatura. | **PASS** |
| **Proteção de Bosses / Instâncias Secretas** | Jogadores comuns da mesa recebem `0` linhas em `SELECT` direto, `[]` em `ler_6b_instancia(mesa, NULL)`, `SQLSTATE 42501` ao tentar ler/alterar instância não atribuída e `null` em `OS.getInstanceOwn6BState`. | **PASS** |
| **Isolamento entre Mesas** | Usuários e Mestres de outras mesas recebem `SQLSTATE 42501` em todas as RPCs e `0` linhas via RLS; `OS.handleRealtimeInstance6BChange` descarta eventos com `mesa_id` divergente. | **PASS** |
| **Funções `SECURITY DEFINER` e Wrappers** | Todas as 16 funções do schema privado `xerife_6b` e os 9 wrappers `SECURITY INVOKER` em `public` possuem `SET search_path = ''`. Funções auxiliares internas têm `EXECUTE` revogado de `PUBLIC, anon, authenticated`. | **PASS** |
| **Ledger de Idempotência Limitado** | Tabela privada `xerife_6b.instancia_operacoes` (RLS ativo, zero grants para `anon`/`authenticated`, fora do Realtime) poda automaticamente entradas com `> 24h` ou além das `64` mais recentes por instância. No cliente (`own6BRules.js`), `MAX_OP_LEDGER_ENTRIES = 64`. | **PASS** |
| **Concorrência Otimista (`40001`)** | Todas as RPCs mutáveis fazem `SELECT ... FOR UPDATE` e validam `v_estado.versao = p_versao`, lançando `SQLSTATE 40001` em conflito e disparando `OS.refreshInstanceOwn6B` no cliente. | **PASS** |
| **Segurança no Frontend** | Nenhuma chave `service_role` ou segredo no cliente; apenas chamadas RPC autenticadas e assinatura Realtime filtrada por `mesa_id=eq.<mesaId>`. | **PASS** |

---

## 4. Matriz de Testes Executados (Distinção entre Simulado, PostgreSQL 17 Real e Tauri Dev Real)

### 4.1 Testes em PostgreSQL 17 Real Descartável (`postgres:17-alpine` via Docker)
- **Suíte:** `tests/xerife-6b-pg17-sql-rls.cjs` — **PASS (11/11 blocos, `EXIT=0`)**
  - Aplicou `20261117151310_xerife_6b_foundation.sql` + `20261118101800_xerife_6b_instance_combat.sql` em banco PostgreSQL 17 real.
  - Validou metadados de catálogo (`relrowsecurity`, `role_table_grants`, `proconfig` `search_path=""`, `pg_publication_tables`).
  - Validou RPCs reais sob `SET LOCAL role = 'authenticated'` e `request.jwt.claim.sub` para Mestre (`GM_A`), Defensor Designado (`DEF_A`), Jogador Comum (`PL_A`) e Mestre de Outra Mesa (`GM_B`).
  - Validou retenção de 64 entradas em `xerife_6b.instancia_operacoes` após 75 operações.
  - Validou rollback completo (`database/xerife-6b-xer05-xer06/02-rollback-migracao-xer05-xer06.sql`) preservando `20261117151310_xerife_6b_foundation.sql`, seguido de reaplicação limpa da migração.

### 4.2 Testes Automatizados de UI / Regras (Chromium Headless + Protocolo RPC/Realtime Simulado)
- `tests/xerife-6b-xer04-own-editor.cjs`: **PASS (31/31 verificações)**
- `tests/xerife-6b-xer05-instance-persistence.cjs`: **PASS (10/10 verificações)**
- `tests/xerife-6b-xer06-instance-combat.cjs`: **PASS (27/27 verificações)**
- **13 Suítes de Regressão Existentes (`100% PASS`):**
  - `tests/com03-com04-creature-mode.cjs` (`25/25 PASS`)
  - `tests/com05-com06-initiative-budget.cjs` (`28/28 PASS`)
  - `tests/com07-com08-controller-events.cjs` (`23/23 PASS`)
  - `tests/xerife-6b-ui.cjs` (`39/39 PASS`)
  - `tests/mesa-6b.cjs` (`PASS`)
  - `tests/mesa-p0-interactions.cjs` (`33/33 PASS`)
  - `tests/gm-tools-ui.cjs` (`33/33 PASS`)
  - `tests/multiple-maps-ui.cjs` (`27/27 PASS`)
  - `tests/turn-tracker-ui.cjs` (`28/28 PASS`)
  - `tests/token-initiative.cjs` (`11/11 PASS`)
  - `tests/scene-read.cjs` (`PASS`)
  - `tests/map-camera.cjs` (`37/37 PASS`)
  - `tests/auth-session.cjs` (`PASS`)

### 4.3 Verificação Real no Tauri Dev (`npm run tauri dev` + WebView2 CDP)
- Executadas as suítes completas de XER-04 (`31/31`), XER-05 (`10/10`) e XER-06 (`27/27`) dentro da janela real WebView2 do Tauri 2 (`appVersion: "1.4.5"`, `uncaughtExceptions: 0`).

---

## 5. Checklist de Homologação Pendente (`igyupxczhczidfgtjiws`)

> [!IMPORTANT]
> Nenhuma migração foi aplicada remotamente em Homologação (`igyupxczhczidfgtjiws`) ou Produção (`jxxhdqoyblykqiiyptsp`) nesta etapa.

Antes de promover para Produção, executar em Homologação (`igyupxczhczidfgtjiws`) mediante autorização explícita:
1. [ ] Aplicar `supabase/migrations/20261118101800_xerife_6b_instance_combat.sql` em Homologação (`igyupxczhczidfgtjiws`).
2. [ ] Confirmar criação de `public.mesa_6b_instancia`, `xerife_6b.instancia_operacoes`, trigger `trg_mesa_tokens_sync_6b_instancia`, 16 funções em `xerife_6b` e 9 wrappers em `public`.
3. [ ] Validar em duas sessões reais conectadas à Homologação (Mestre + Jogador):
   - Criação de dois Bosses do mesmo molde com 15 dados (`#1` e `#2`).
   - Rolagem inicial, consumo de dados, abertura do modal `#defender-damage-modal` para escolha de dados bloqueados por dano, ajuste de fadiga em cascata e renovação após esgotamento.
   - Confirmação de que o jogador comum não recebe nem lê dados de Boss secreto.

---

## 6. Plano Futuro de Implantação em Produção (`jxxhdqoyblykqiiyptsp`) e Rollback

1. **Pré-requisitos Obrigatórios para Produção:**
   - Homologação (`igyupxczhczidfgtjiws`) 100% aprovada no checklist da Seção 5.
   - Novo backup lógico (`pg_dump -Fc`) de Produção (`jxxhdqoyblykqiiyptsp`) gerado e validado imediatamente antes da janela de deploy.
   - Autorização específica do responsável para `db push` da migração `20261118101800_xerife_6b_instance_combat.sql`.
2. **Procedimento de Aplicação Futura (quando autorizado):**
   - Verificar que `supabase/migrations/` contém apenas `20261118101800_xerife_6b_instance_combat.sql` pendente além das 17 migrações já registradas em Produção.
   - Aplicar via Supabase CLI autenticada:
     `& $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes`
3. **Procedimento de Rollback Reversível:**
   - Caso seja necessário reverter a migração sem afetar a fundação P0-2 (`20261117151310_xerife_6b_foundation.sql`) nem dados de mesas/fichas/tokens:
   - Executar `database/xerife-6b-xer05-xer06/02-rollback-migracao-xer05-xer06.sql` (testado e validado em PostgreSQL 17 real no Bloco `PG17-PASS-10`).
