# Oeste Sombrio 2.0 — Pacote 9.1: Validação PostgreSQL 17 e Preparação da Homologação (COM-09 a COM-12)

**Data:** 19/11/2026  
**Classificação Final:** **`APROVADO PARA HOMOLOGAÇÃO`**  
**Branch Local:** `feature/com09-com12-reactions` (base `main` / `origin/main` = `f743bbdb694e5400c127551fb546969535e180a9`, release pública `1.4.6` preservada intacta)  
**Migração Validada:** [`supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`](../../supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql)  
**SHA-256 da Migração Final:** `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7`  
**Bancos Remotos:** Produção (`jxxhdqoyblykqiiyptsp`) e Homologação (`igyupxczhczidfgtjiws`) **não modificados** (somente leitura de metadados para planejamento da Fase G).

---

## 1. Situação do Docker e Comandos Efetivamente Executados

- **Docker Desktop:** originalmente parado no host (`npipe:////./pipe/dockerDesktopLinuxEngine` indisponível). Iniciado normalmente sem alterar configurações globais via `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` dentro da sessão de teste (`Docker Engine 29.1.3`).
- **Observação operacional:** a imagem `supabase/postgres:17.11.0.011` disparou erro do event trigger interno `graphql.increment_schema_version()` ao rodar DDL sob o papel não-superuser `postgres`; o ensaio foi executado na imagem oficial **`postgres:17`** (já em cache local), rodando exatamente **`PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit`** — mesma versão minor (`17.12`) da Homologação Supabase (`igyupxczhczidfgtjiws`).
- **Isolamento do contêiner:** `docker run -d --rm --network none --name os-com09-12-pg17-<pid> -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:17`, removido automaticamente em `finally` ao término do script.
- **Comando principal executado:**
  ```powershell
  node tests/com09-com12-pg17-validation.cjs
  ```
  *(Executado na mesma sessão em que o Docker Desktop foi iniciado; código de saída `0`.)*

### Sequência SQL Aplicada no Contêiner Descartável

1. Bootstrap de papéis/schemas estilo Supabase (`anon`, `authenticated`, `service_role`, `auth.users`, `auth.uid()`, `storage.buckets`, `storage.objects`, `storage.foldername()`, `supabase_realtime`).
2. [`database/homologacao-com05-com08/00-schema-base-homologacao.sql`](../homologacao-com05-com08/00-schema-base-homologacao.sql) + grants de tabela equivalentes ao padrão Supabase para `authenticated` (mantendo `anon` sem privilégios em tabelas sensíveis).
3. `supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql`
4. `supabase/migrations/20261117151310_xerife_6b_foundation.sql`
5. `supabase/migrations/20261118101800_xerife_6b_instance_combat.sql`
6. `supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql`
7. `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`

---

## 2. Resultados por Teste (Fases B, C, D e Rollback)

### 2.1 Suítes Transacionais SQL/RLS (Fase B)

| Suíte Executada | Resultado | Detalhamento |
| --- | --- | --- |
| [`tests/rls-com05-com08-combat-actions.sql`](../../tests/rls-com05-com08-combat-actions.sql) | **`PASS` (`12/12`)** | Iniciativa congelada/promovida, sigilo de `action_state` e ocultos, bloqueios `42501`, idempotência, custo adulterado, bloqueio de virada com reserva pendente, compatibilidade retroativa, isolamento entre mesas/mapas, ações fixas dos 4 monstros oficiais (`2, 2, 3, 3`) e privilégios `EXECUTE`. |
| [`tests/rls-com09-com12-reactions.sql`](../../tests/rls-com09-com12-reactions.sql) | **`PASS` (`6/6`)** | Oportunidade fora de alcance (`12m > 1.5m`) bloqueada; solicitação antecipada, idempotência, sigilo entre jogadores e bloqueio de autoaprovação (`42501`); negação (`0` débito), cancelamento, aprovação (`-1` ação sem alterar ordem) e `PT409` em dupla aprovação; bloqueio de ordinária pós-turno + oportunidade `1.5m` + consumo pós-turno (`4 -> 3`) + `PT409` em reuso; expiração ao iniciar turno e na virada para Round 2 (`PT409` em rodada antiga); privilégios `EXECUTE` + bloqueio de `anon`, `public` e usuário externo (`42501`). |

### 2.2 Auditoria de Catálogo (`pg_proc`) e Matriz de Autorização (Fase C)

| Função | `SECURITY DEFINER` | `search_path` | `PUBLIC` | `anon` | `authenticated` | Status |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `public.gerenciar_reacao_combate` | `true` | `""` | `false` | `false` | `true` | **`PASS`** |
| `public.calcular_fase_turno_combate` | `false` | `""` | `false` | `false` | `false` | **`PASS`** |
| `public.obter_combate_publico` | `true` | `""` | `false` | `false` | `true` | **`PASS`** |
| `public.gerenciar_combate` | `true` | `""` | `false` | `false` | `true` | **`PASS`** |

#### Matriz de Tentativas Negativas (`10/10 PASS` · **Zero Efeitos Colaterais Comprovado**)

Antes e depois das 10 tentativas abaixo, o fingerprint completo do estado (`versao`, `round`, `req_count`, `opp_count`, `b_spent`, `b_avail`, `cr_spent`) permaneceu **100% idêntico**:

| Caso Negativo | Papel / Identidade | SQLSTATE / Resultado | Efeito Colateral |
| --- | --- | --- | :---: |
| `unauthenticated_null_uid` | `authenticated` com `auth.uid() = NULL` | `42501` | Nenhum |
| `anon_role_blocked` | `anon` | `42501` | Nenhum |
| `outsider_blocked` | Usuário autenticado fora de `membros_mesa` | `42501` | Nenhum |
| `cross_table_gm2_approve_in_room1` | Mestre da Mesa 2 tentando aprovar na Mesa 1 | `42501` | Nenhum |
| `player_b_self_approve` | Jogador B tentando aprovar a própria solicitação | `42501` | Nenhum |
| `player_a_cancel_player_b_request` | Jogador A tentando cancelar solicitação de Jogador B | `42501` | Nenhum |
| `player_a_request_for_npc_creature` | Jogador A tentando solicitar reação para NPC Criatura | `42501` | Nenhum |
| `player_b_open_opportunity` | Jogador B tentando abrir oportunidade COM-11 | `42501` | Nenhum |
| `tampered_cost_zero` | Mestre tentando custo `0` adulterado | `22023` | Nenhum |
| `direct_update_mesas_by_player_blocked` | Jogador B tentando `UPDATE public.mesas SET combate_ativo = NULL` | `0_ROWS_RLS` | Nenhum |

### 2.3 Evidências de Concorrência Real Multi-Conexão (Fase D)

Todos os cenários concorrentes executaram processos `psql` independentes sincronizados via barreira `pg_advisory_lock` / `pg_advisory_lock_shared` (colidindo simultaneamente no lock `FOR UPDATE` de `public.mesas`):

| Cenário | Conexões Simultâneas | Resultado Observado | Integridade Final |
| --- | --- | --- | --- |
| **D1 · Duas aprovações simultâneas** | 2 sessões GM (`op-d1-a` vs `op-d1-b`, mesma `REQ1_ID`) | **1 vencedor**, **1 `PT409`** | `b_spent = 1`, `b_avail = 1` (sem duplo débito) |
| **D2 · Aprovação vs Negação simultâneas** | 2 sessões GM (`approve` vs `deny`, mesma `REQ2_ID`) | **1 vencedor (`approve`)**, **1 `PT409`** | `b_spent = 2`, `b_avail = 0` |
| **D3 · Repetição simultânea do mesmo `p_op_id`** | 2 sessões GM com `winnerOpId` idêntico | **2 replays idempotentes (`ok`)** | `b_spent = 1` mantido (zero duplo consumo) |
| **D4a · Duas solicitações concorrentes (mesmo combatente)** | 2 sessões (`op-d4-req1` vs `op-d4-req2` em `TOK_CR`, saldo `1`) | **1 vencedor (`pending`)**, **1 `22023`** | Apenas 1 solicitação pendente |
| **D4b · Corrida pela última ação (`avail = 1`)** | `approve_early_reaction` vs `gerenciar_acao_combate('reserve')` | **1 vencedor (`approve`)**, **1 `22023`** | `cr_avail = 0` (nunca negativo) |
| **D5 · Avanço de turno durante reação pendente** | `gerenciar_combate('proximo')` vs `approve_early_reaction` | **1 vencedor (`proximo`)**, **1 `PT409`** | Solicitação expirada ao iniciar turno |
| **D5b · Virada de rodada com oportunidade aberta** | Rollover R2 → R3 + execução tardia da oportunidade de R2 | Execução rejeitada com **`PT409`** | R3 limpa, sem vazamento de R2 |
| **D6 · Reconexão e repetição de evento** | Nova sessão `obter_combate_publico` + replay `op-d6-exec` | Estado `spentActions = 1` consistente; replay `idempotentReplay = true` | Zero deriva de estado |
| **D7 · Acesso concorrente de outro usuário e outra mesa** | GM1 (legítimo) + GM2 (Mesa 2) + Outsider | **GM1 ok**, **GM2 `42501`**, **Outsider `42501`** | Isolamento preservado sob corrida |

### 2.4 Validação de Rollback e Reaplicação

- Execução de [`02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql) + restauração das definições de `20261116210603_com05_com08_combat_state_and_actions.sql` → `tests/rls-com05-com08-combat-actions.sql` passou **`12/12`**.
- Reaplicação limpa de `20261119120000_com09_com12_reactions_and_opportunities.sql` → `tests/rls-com09-com12-reactions.sql` passou **`6/6`**.

---

## 3. Modificações Realizadas Neste Pacote (Fases E e F)

- **Nenhum defeito encontrado** na migração SQL `20261119120000_com09_com12_reactions_and_opportunities.sql` nem nos arquivos de frontend de COM-09..COM-12; portanto, **nenhuma alteração foi necessária em `dist/` ou na migração SQL** e o SHA-256 da migração permanece inalterado (`dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7`).
- Adicionada a suíte automatizada reutilizável de validação PostgreSQL 17 em [`tests/com09-com12-pg17-validation.cjs`](../../tests/com09-com12-pg17-validation.cjs) (Fase B/C/D + rollback).
- Por não haver modificação em arquivos de frontend ou em funções compartilhadas com XER-05/06, a bateria completa de frontend já aprovada no Pacote 9 (`11/11` suítes + Tauri Dev `0` exceções) permanece válida sem reexecução desnecessária.

---

## 4. Plano Preparado para Homologação Remota — `igyupxczhczidfgtjiws` (Fase G)

> [!IMPORTANT]
> **Nenhuma operação de escrita remota foi executada neste pacote.** Este plano aguarda autorização explícita do proprietário.

### 4.1 Estado Atual de Homologação (`igyupxczhczidfgtjiws`) e Divergência de Histórico

Leitura somente-leitura realizada em 19/11/2026:
- **PostgreSQL:** `17.12` (`aarch64-unknown-linux-gnu`).
- **Dados sintéticos atuais:** `11` usuários, `2` mesas, `4` fichas, `9` tokens.
- **Publicação Realtime (`supabase_realtime`):** `10` tabelas (`eventos_mesa`, `fichas`, `itens_entregues_pendentes`, `mesa_6b_aberto`, `mesa_6b_instancia`, `mesa_combate_sinais`, `mesa_mapa_sinais`, `mesa_token_status`, `mesa_tokens`, `mesas`). **Nenhuma alteração na publicação Realtime é necessária para COM-09..12.**
- **Dependências SQL já presentes em Homologação:** todas as 6 funções COM-05..COM-08 (`atualizar_resumo_combate`, `criar_action_state_combate`, `custo_canonico_acao_combate`, `gerenciar_acao_combate`, `gerenciar_combate`, `obter_combate_publico`) já existem e operam com `search_path=""`.
- **Histórico `schema_migrations` em Homologação (`4` versões) vs Repositório (`20` arquivos):**
  - Homologação possui apenas: `20261116214200_homologacao_144_mapas_notas`, `20261117151310_xerife_6b_foundation`, `20261118101800_xerife_6b_instance_combat`, `20261118153000_xerife_6b_instance_conflict_pt409`.
  - As 16 migrações históricas anteriores (`20261106000343`..`20261116210603`) foram aplicadas estruturalmente no bootstrap de Homologação sem constar em `schema_migrations`.
  - **Restrição obrigatória:** **NÃO executar `supabase db push` indiscriminadamente em Homologação**, pois tentaria reaplicar 16 migrações históricas sobre tabelas já existentes. **NÃO inserir registros manuais em `schema_migrations` sem autorização específica.**

### 4.2 Procedimento Seguro de Implantação em Homologação (Após Autorização)

1. **Backup lógico pré-aplicação de Homologação (fora do Git):**
   - Exportar schema e definições atuais das funções (`obter_combate_publico`, `gerenciar_combate`, `gerenciar_acao_combate`) e dump lógico de `igyupxczhczidfgtjiws` para diretório privado local (`%LOCALAPPDATA%\OesteSombrio\backups\homolog-com0912-<timestamp>`), registrando SHA-256.
2. **Aplicação exclusiva da migração autorizada:**
   - Conferir SHA-256 local de `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql` = `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7`.
   - Aplicar **exclusivamente** essa migração via `apply_migration` no projeto `igyupxczhczidfgtjiws` (nome `com09_com12_reactions_and_opportunities`), preservando intactas as 4 migrações existentes.
   - Conferir imediatamente `pg_proc` (`SECURITY DEFINER`, `search_path=""`, `anon_exec = false`, `public_exec = false`, `auth_exec = true`) e `get_advisors (security)`.
3. **Bateria Live de Homologação (Auth, RLS, RPC, HTTP 409 e Realtime):**
   - Probe anônimo (`sb_publishable_*` de Homologação): `POST /rest/v1/rpc/gerenciar_reacao_combate` → **HTTP `401` (`42501`)**.
   - Script live multi-sessão autenticado (`GM1`, `Player A`, `Player B`, `GM2` de outra mesa):
     - **COM-09:** encerrar turno com ações, bloquear ordinária, abrir oportunidade `1.5m`, executar pós-turno, confirmar expiração na virada.
     - **COM-10:** solicitar pré-turno, bloquear autoaprovação (`403`/`42501`), bloquear `GM2` de outra mesa (`42501`), negar (`0` débito), aprovar (`-1` ação sem mudar iniciativa), cancelar pendente (`0` débito).
     - **Corridas HTTP reais (`Promise.all` via PostgREST):**
       - Duas aprovações simultâneas → **1 HTTP `200` + 1 HTTP `409` (`PT409`) imediato** (confirmando ausência de retry/stall de 120 s no PostgREST!).
       - Aprovação vs negação simultâneas → **1 HTTP `200` + 1 HTTP `409` (`PT409`)**.
       - Aprovação vs consumo concorrente da última ação → **1 HTTP `200` + 1 erro sem saldo negativo**.
       - Replay do mesmo `p_op_id` → **HTTP `200` com `idempotentReplay: true`**.
     - **Realtime WebSocket real:** confirmar entrega de `mesa_combate_sinais` para `GM` e `Player B` ao solicitar/aprovar/executar reação, sem vazamento de dados privados para `Player A`.
4. **Validação Tauri Dev conectada à Homologação:**
   - Exercitar visualmente a barra contextual COM-12 (`#mesa-tracker-action-bar`) em perfil WebView2 descartável apontando temporariamente em memória/teste para Homologação (sem alterar `dist/js/supabaseConfig.js` versionado!), confirmando `0` exceções.
5. **Plano de Recuperação (Rollback em Homologação):**
   - Em caso de falha na Homologação: executar [`02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql) seguido da restauração das duas funções (`obter_combate_publico` e `gerenciar_combate`) a partir do backup pré-aplicação (idênticas à `20261116210603`), validando `tests/rls-com05-com08-combat-actions.sql` (`12/12 PASS`).

### 4.3 Riscos Conhecidos e Pendências Restantes

1. **Mapeamento PostgREST `PT409` → HTTP `409`:** validado como SQLSTATE `PT409` no PostgreSQL 17.12 local; a confirmação do status HTTP `409 Conflict` e latência imediata (< 1 s) depende da etapa de Homologação via PostgREST/Supabase.
2. **Realtime WebSocket real e Tauri Dev multi-cliente:** validados localmente com mock de transporte e CDP; serão validados ponta a ponta na Homologação (`igyupxczhczidfgtjiws`).
3. **Produção (`jxxhdqoyblykqiiyptsp`) e versão `1.4.6`:** permanecem congelados e protegidos até aprovação integral da Homologação e autorização formal de um futuro pacote de implantação/release.
