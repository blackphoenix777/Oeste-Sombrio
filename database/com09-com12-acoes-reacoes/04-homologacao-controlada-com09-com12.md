# Oeste Sombrio 2.0 — Pacote 9.2 / 9.2-R: Homologação Controlada COM-09 a COM-12

**Classificação Final:** **`APROVADO COM RESSALVAS`**

> [!IMPORTANT]
> **Gate Final de Produção Respeitado:** Nenhuma alteração foi realizada em Produção (`jxxhdqoyblykqiiyptsp`), `main`, `origin/main`, tags, releases, versão pública `1.4.6`, manifestos do updater ou Notion. A aprovação com ressalvas em Homologação **não** implica autorização automática para Produção.

---

## 1. Identificação do Ambiente, Código e Artefato Migrado

| Campo | Valor Comprovado |
| --- | --- |
| **Data e horário UTC da conclusão** | `2026-11-19T14:25:02Z` (janela da homologação: `2026-11-19T12:07:00Z` a `2026-11-19T14:25:02Z`) |
| **Branch local** | `feature/com09-com12-reactions` |
| **Commit base (`HEAD` / `main` / `origin/main`)** | `f743bbdb694e5400c127551fb546969535e180a9` (versão pública `1.4.6` preservada intacta) |
| **Projeto Supabase utilizado (Homologação)** | `igyupxczhczidfgtjiws` (`PostgreSQL 17.12 on aarch64-unknown-linux-gnu`) |
| **Projeto Supabase Produção (INTOCADO)** | `jxxhdqoyblykqiiyptsp` (`19` migrações preservadas, `0` escritas, `0` requisições no Tauri Dev) |
| **Migração candidata aplicada** | [`supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`](../../supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql) |
| **SHA-256 da migração (verificado antes e depois)** | `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7` |
| **Versão registrada em Homologação** | `20261119121535` (`com09_com12_reactions_and_opportunities`) |
| **Estado final de Homologação** | Consistente (`5` migrações oficiais, `0` combates ativos residuais, `2` mesas / `4` fichas / `9` tokens pré-existentes intactos; `2` contas não-confirmadas órfãs documentadas na Seção 15) |

---

## 2. Recuperação de Sessão Interrompida (Pacote 9.2-R — Fase R0)

- **Motivo da interrupção:** reinício inesperado do processo do agente durante a execução da Fase H (`task-450`) e subsequente pausa de `task-463` durante a transição de sessão `signOut()` + `Page.reload()` no mesmo processo WebView2 (após já ter concluído com sucesso `H0` a `H9`).
- **Estado recuperado da tarefa `task-450`:** log preservado em `.system_generated/tasks/task-450.log` comprovando `PASS` sequencial de **`H0` até `H9`** (`mesa=1b8a1f6f-f5d2-4c4f-9570-44362619d411`, encerrada antes de executar `H10` e `H11`). A mesma sequência `H0`–`H9` também obteve `PASS` em `task-463` (`mesa=f946a26b-6b0d-4434-8d84-23b84a2a8418`). Ambas as mesas temporárias foram posteriormente removidas de forma cirúrgica por ID exato.
- **Scripts auxiliares localizados e preservados:**
  - Repositório: [`tests/live-com09-com12-homolog.cjs`](../../tests/live-com09-com12-homolog.cjs), [`database/com09-com12-acoes-reacoes/02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql), [`database/com09-com12-acoes-reacoes/03-validacao-postgresql17-e-preparacao-homologacao.md`](03-validacao-postgresql17-e-preparacao-homologacao.md).
  - Diretório scratch da conversa: `phase-b-backup.ps1`, `phase-b-verify.ps1`, `extract-prefuncs.cjs`, `provision-homolog-users.cjs`, `phase-h-tauri-homolog.cjs`, `phase-h-continue-h10-h11.cjs`.

### Matriz de Recuperação (Fase R0)

| Fase / Escopo | Última Execução Conhecida | Resultado Observado | Evidência | Estado R0 | Reexecutado em 9.2-R? |
| --- | --- | --- | --- | --- | --- |
| **Fase A (Auditoria pré-implantação)** | `2026-11-19T12:07:00Z` | Dependências, SHA-256 e divergência histórica validados | Inventário `execute_sql` + `list_migrations` | `PASS_COMPROVADO` | Não (revalidado somente leitura em R1) |
| **Fase B (Backup lógico + ensaio PG17)** | `2026-11-19T12:13:14Z` (`task-322`, `task-336`) | `6` artefatos SQL + `SHA256SUMS.txt` + restauração/reaplicação/rollback `EXIT=0` | Diretório privado fora do Git + `task-336.log` | `PASS_COMPROVADO` | Não (integridade conferida em R1) |
| **Fase C (Aplicação exclusiva da migração)** | `2026-11-19T12:15:34Z` | `apply_migration` (`{"success":true}`) + `NOTIFY pgrst` | `schema_migrations` (`5` versões) | `PASS_COMPROVADO` | **Não** (proibido reaplicar) |
| **Fase D (Segurança/RLS/SECURITY DEFINER)** | `2026-11-19T12:18:52Z` + `12:26:39Z` (`task-411`) | `pg_proc` OK, `get_advisors` OK, `3/3` SQL probes (`42501`), `12/12` ataques HTTP (`401`/`403`/`0` linhas) + `0` efeitos colaterais | `execute_sql` + `task-411.log` | `PASS_COMPROVADO` | Não (catálogo reconfirmado em R1) |
| **Fases E, F e G (Live HTTP/PT409/Realtime)** | `2026-11-19T12:26:25Z..12:26:39Z` (`task-411`) | **`44/44 PASS`, `0 FAIL`** (`EXIT=0`), limpeza cirúrgica das 2 mesas | `tests/live-com09-com12-homolog.cjs` + `task-411.log` | `PASS_COMPROVADO` | Não (evidência integral preservada) |
| **Fase H — `H0` a `H9` (Tauri Dev / Xerife)** | `2026-11-19T12:32Z` (`task-450`) e `13:33Z` (`task-463`) | `10/10 PASS` (boot Homolog, login GM, barra COM-12, Realtime, aprovação UI, HTTP 409/PT409, pós-turno + COM-11, virada R2, reconexão) | `task-450.log` e `task-463.log` | `PASS_COMPROVADO` | Não repetidos sem necessidade |
| **Fase H — `H10` e `H11` (Tauri Dev / Jogador + Rede)** | `2026-11-19T14:22:54Z` (`task-510`) | Interrompidos em `task-450`/`463`; **executados e aprovados em `task-510` (`2/2 PASS`, `EXIT=0`)** | `task-510.log` | `INTERROMPIDO` → **`PASS_COMPROVADO`** | **Sim** (somente cenários pendentes com setup mínimo) |
| **Fase I / R5 (Limpeza controlada)** | `2026-11-19T14:24:19Z` | Mesas/fichas/tokens de teste removidos; senhas QA rotacionadas; arquivo efêmero local removido; `Cargo.toml` revertido | `execute_sql` + `TEMP_CFG_EXISTS=false` | `NAO_EXECUTADO` → **`PASS_COMPROVADO` (com 1 ressalva)** | **Sim** |
| **Fase R6 (Regressões direcionadas)** | `2026-11-19T14:25:02Z` (`task-515`, `task-521`) | **`7/7` suítes `EXIT=0`** | `task-515.log` + `task-521.log` | `NAO_EXECUTADO` → **`PASS_COMPROVADO`** | **Sim** |

---

## 3. Fase A — Comparação de Esquemas, Dependências e Migrações (Gate A: APROVADO)

- **Divergência histórica verificada sem manipulação artificial:** Homologação (`igyupxczhczidfgtjiws`) possuía exatamente `4` versões registradas em `supabase_migrations.schema_migrations` (`20261116214200_homologacao_144_mapas_notas`, `20261117151310_xerife_6b_foundation`, `20261118101800_xerife_6b_instance_combat`, `20261118153000_xerife_6b_instance_conflict_pt409`) frente a `20` arquivos locais. A inspeção estrutural direta comprovou que os objetos das 16 migrações anteriores já existiam integralmente em Homologação. Nenhum contador foi alterado manualmente e `supabase db push` não foi utilizado.
- **Dependências verificadas presentes antes da implantação:**
  - Tabelas (todas com `RLS = true`): `public.mesas`, `public.membros_mesa`, `public.mesa_tokens`, `public.mesa_combate_sinais`, `public.fichas`, `public.usuarios`, `public.mesa_6b_aberto`, `public.mesa_6b_instancia`, `xerife_6b.conjuntos`, `xerife_6b.presencas`, `xerife_6b.instancia_operacoes`.
  - Colunas obrigatórias confirmadas (`mesas.combate_ativo`, `mesas.cena_ativa`, `mesas.mapa_ativo_jogadores_id`, `mesa_tokens.grid_x/grid_y/iniciativa/owner_user_id/visible_to_players/mapa_id`, `mesa_combate_sinais.revisao`).
  - Funções COM-05..COM-08 (`is_mestre_da_mesa`, `mapa_visivel_ao_usuario`, `atualizar_resumo_combate`, `criar_action_state_combate`, `custo_canonico_acao_combate`, `gerenciar_acao_combate`, `gerenciar_combate`, `obter_combate_publico`) e XER-01..XER-06 (`*_6b_xerife`, `*_6b_instancia`, `xerife_6b.*`) presentes e compatíveis.
  - Triggers (`combate_estado_sinal`, `combate_token_sinal`, `trg_mesa_tokens_sync_6b_instancia`) e publicação `supabase_realtime` (`10` tabelas) íntegros.
  - Zero conflito de nomes: `gerenciar_reacao_combate` e `calcular_fase_turno_combate` ainda não existiam.

---

## 4. Fase B — Backup Lógico, Checksums e Ensaio de Recuperação (Gate B: APROVADO)

- **Ambiente de origem:** `igyupxczhczidfgtjiws` (Homologação, PostgreSQL `17.12`).
- **Horário UTC do backup:** `2026-11-19T12:08:58Z` (início) a `2026-11-19T12:13:14Z` (conclusão da verificação).
- **Localização (fora do Git, ACL NTFS restrita via `icacls` apenas ao usuário local e `SYSTEM`):**
  `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\homolog-igyupxczhczidfgtjiws-com0912-20261119-120858Z`
- **Artefatos e checksums SHA-256 (sem dados sensíveis expostos neste relatório):**

| Arquivo | Tamanho (bytes) | SHA-256 |
| --- | ---: | --- |
| `roles.sql` | `297` | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `schema.sql` | `202.073` | `4c1a628d555cd3015e57b3207b02f8674b0e8253203c3d6b592a4888e2eb9031` |
| `app_schema.sql` | `200.768` | `63e8d07d4a57a5c00945604e6cf9faba43cf9b624f8f9e305d0e5ef8bb6dc921` |
| `app_data.sql` | `19.594` | `46bd3df5a0f0e5b9ddb4f3249265f9213984da9745ce8ef679744a08953c3717` |
| `migrations_data.sql` | `94.880` | `b3352b646781c394c867a5cb0bb8e2fb3ba58681f774497336a88f3986b4b069` |
| `affected_functions_pre.sql` | `30.625` | `357bb04bfd4196d6574aeb75d16c3c019845d767746efbfa952806a42ef31f0b` |

- **Ensaio de restauração e reversão em PostgreSQL 17 descartável (`postgres:17`, `--network none`, `task-336`):**
  - `VERIFY_APP_SCHEMA_EXIT=0`, `VERIFY_APP_DATA_EXIT=0`, `VERIFY_MIG_DATA_EXIT=0`.
  - Contagens restauradas validadas: `RESTORED_COUNTS=11|2|4|4|9|2|4|20261118153000` (`usuarios|mesas|membros_mesa|fichas|mesa_tokens|mesa_combate_sinais|schema_migrations|max_version`).
  - Aplicação da migração COM-09/12 sobre o backup restaurado: `REHEARSAL_APPLY_COM0912_EXIT=0`.
  - Rollback controlado (`02-rollback-com09-com12.sql` + restauração de `affected_functions_pre.sql`): `REHEARSAL_ROLLBACK_DROP_EXIT=0`, `REHEARSAL_RESTORE_PREFUNCS_EXIT=0`.
- **Riscos de rollback documentados:** a migração COM-09/12 altera apenas funções (`CREATE OR REPLACE FUNCTION`, `REVOKE`, `GRANT`) e não altera DDL de tabelas/colunas; contudo, um rollback durante um combate ativo descartaria o suporte às chaves JSON `oportunidades_reacao`/`solicitacoes_reacao` em `mesas.combate_ativo` e exigiria restauração simultânea de `obter_combate_publico` e `gerenciar_combate` a partir de `affected_functions_pre.sql`.

---

## 5. Fase C — Procedimento e Resultado da Aplicação Exclusiva da Migração

- **Pré-checagem de sessões concorrentes (`2026-11-19T12:13:28Z`):** `active_other_sessions = 0`, `table_locks = 0` em `mesas`, `mesa_tokens`, `mesa_combate_sinais`.
- **Método executado:** chamada única e exclusiva `supabase_mcp.apply_migration(project_id="igyupxczhczidfgtjiws", name="com09_com12_reactions_and_opportunities", query=<conteúdo exato SHA-256 dfa14675...>)`, seguida de `NOTIFY pgrst, 'reload schema';`.
- **Janela de execução:** `2026-11-19T12:15:24Z` a `2026-11-19T12:15:34Z` (~10 s).
- **Resultado:** `{"success":true}`, zero erros, zero outras migrações aplicadas.
- **Histórico remoto resultante (`5` versões):**
  1. `20261116214200` (`homologacao_144_mapas_notas`)
  2. `20261117151310` (`xerife_6b_foundation`)
  3. `20261118101800` (`xerife_6b_instance_combat`)
  4. `20261118153000` (`xerife_6b_instance_conflict_pt409`)
  5. `20261119121535` (`com09_com12_reactions_and_opportunities`)

---

## 6. Fase D — Auditoria Real de Segurança (`SECURITY DEFINER`, `EXECUTE`, `RLS` e `get_advisors`)

### 6.1 Catálogo `pg_proc` em Homologação (`igyupxczhczidfgtjiws`)

| Função | Owner | `SECURITY DEFINER` | `search_path` | `PUBLIC` | `anon` | `authenticated` | `EXECUTE` dinâmico | `PT409` |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `public.gerenciar_reacao_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `true` |
| `public.calcular_fase_turno_combate` | `postgres` | `false` | `""` | `false` | `false` | `false` | `false` | `false` |
| `public.gerenciar_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |
| `public.obter_combate_publico` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |
| `public.gerenciar_acao_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |

- **`get_advisors(type="security")` pós-aplicação:** `0` erros novos; `anon_security_definer_function_executable` inalterado (`4` funções legadas — nem `gerenciar_reacao_combate` nem `calcular_fase_turno_combate` aparecem para `anon`); `authenticated_security_definer_function_executable` passou de `18` para `19` apenas pela entrada intencional de `public.gerenciar_reacao_combate` (o helper interno `calcular_fase_turno_combate` não está exposto).

### 6.2 Testes Negativos Reais de Autorização (`15/15 PASS`, Zero Efeitos Colaterais)

1. **Probes SQL-side em Homologação (`2026-11-19T12:18:52Z`, `3/3 PASS`):**
   - Sessão `authenticated` com `auth.uid() = NULL` (`request.jwt.claims = '{}'`) → `SQLSTATE 42501`.
   - Papel `anon` em `gerenciar_reacao_combate` → `SQLSTATE 42501`.
   - Papel `authenticated` em `calcular_fase_turno_combate` → `SQLSTATE 42501`.
2. **Probes HTTP/PostgREST com identidades independentes (`tests/live-com09-com12-homolog.cjs`, `task-411`, `12/12 PASS` + verificação de fingerprint):**
   - `D-ANON-BLOCKED` (`sb_publishable_*` sem JWT): **`HTTP 401`** (`42501`, `113 ms`).
   - `D-HELPER-BLOCKED` (`calcular_fase_turno_combate` autenticado): **`HTTP 403`** (`42501`, `122 ms`).
   - `D-OUTSIDER-READ-BLOCKED` (`obter_combate_publico` por usuário externo): **`HTTP 403`** (`42501`, `122 ms`).
   - `D-OUTSIDER-WRITE-BLOCKED` (`gerenciar_reacao_combate` por usuário externo): **`HTTP 403`** (`42501`, `124 ms`).
   - `D-CROSS-GM2-APPROVE-BLOCKED` (Xerife da Mesa 2 aprovando na Mesa 1): **`HTTP 403`** (`42501`, `122 ms`).
   - `D-CROSS-GM2-OPP-BLOCKED` (Xerife da Mesa 2 abrindo oportunidade na Mesa 1): **`HTTP 403`** (`42501`, `117 ms`).
   - `D-SELF-APPROVE-BLOCKED` (Jogador B aprovando própria solicitação): **`HTTP 403`** (`42501`, `114 ms`).
   - `D-CANCEL-OTHER-BLOCKED` (Jogador A cancelando solicitação de Jogador B): **`HTTP 403`** (`42501`, `122 ms`).
   - `D-PLAYER-OPEN-OPP-BLOCKED` (Jogador B abrindo oportunidade COM-11): **`HTTP 403`** (`42501`, `118 ms`).
   - `D-PLAYER-NPC-BLOCKED` (Jogador A operando NPC Criatura sem controle): **`HTTP 403`** (`42501`, `116 ms`).
   - `D-DIRECT-UPDATE-MESAS-BLOCKED` (`PATCH /rest/v1/mesas` alterando `combate_ativo` como Jogador B): **`HTTP 200`, `0` linhas atualizadas** (bloqueado por RLS, `120 ms`).
   - `D-TAMPER-COST-BLOCKED` (custo adulterado `p_cost = 0`): **`HTTP 400`** (`22023`, `122 ms`).
   - `D-ZERO-SIDE-EFFECTS`: fingerprint completo do estado do combate (`versao`, `round`, `turno_atual_idx`, oportunidades, solicitações e saldos) permaneceu **100% idêntico** antes e depois das 12 tentativas.

---

## 7. Fase E — Resultados Funcionais COM-09 a COM-12 (Live Homologação)

Todos os cenários funcionais executados contra Homologação em `tests/live-com09-com12-homolog.cjs` (`task-411`) passaram integralmente:

- **COM-09 (Ações pós-turno):**
  - `E09-END-TURN-PRESERVES-BUDGET`: encerramento do turno de `Pistoleiro A` preservou `4` ações com `turnEnded = true` (`HTTP 200`, `121 ms`).
  - `E09-ORDINARY-ACTION-BLOCKED-POST-TURN`: ação ordinária (`ataque`, `is_reaction=false`) rejeitada pós-turno (`HTTP 400`, `22023`, `123 ms`).
  - `E09-RECONNECT-HYDRATES-TURN-ENDED`: nova sessão limpa `playerA2` recuperou `turnEnded = true` e `availableActions = 4` (`202 ms`).
  - `E09-POST-TURN-REACTION-CONSUMES-ONE`: oportunidade válida pós-turno consumiu `1` ação (`4 → 3`, `turnPhase = post_turn`, `HTTP 200`, `126 ms`).
  - `E09-ROLLOVER-EXPIRES-AND-NO-CARRYOVER`: virada para Rodada 2 resetou saldo para `4/4` (sem transferência de R1), `spent = 0`, `oportunidades = []`, `solicitacoes = []`.
- **COM-10 (Reação antecipada):**
  - `E10-REQUEST`: solicitação em `pre_turn` registrada como `pending`, `0` ações gastas (`HTTP 200`, `130 ms`).
  - `E10-PRIVACY-PROJECTION`: `playerA` não recebeu `solicitacoes_reacao` nem `action_state` de `playerB`, nem `tokHidden`, nem `reaction_op_results`.
  - `E10-DENY-ZERO-COST`: negação pelo Xerife alterou para `denied` com `0` consumo (`HTTP 200`, `123 ms`).
  - `E10-CANCEL-ZERO-COST`: cancelamento pelo jogador alterou para `cancelled` com `0` consumo (`HTTP 200`, `135 ms`).
  - `E10-APPROVE-ONE-ACTION-KEEP-ORDER`: aprovação pelo Xerife consumiu exatamente `1` ação (`2 → 1`), mantendo `turno_atual_idx = 0` e ordem de iniciativa inalterada (`HTTP 200`, `120 ms`).
- **COM-11 (Oportunidades contextuais):**
  - `E11-GRID-OUT-OF-RANGE`: alvo a `12.00m` (`(2,2)` vs `(10,10)`, grade `1.5m/quadrado`) bloqueado para alcance `1.5m` sem confirmação (`HTTP 400`, `22023`, `155 ms`).
  - `E11-NO-INVENTED-RANGE`: ausência de alvo e de confirmação do Xerife rejeitada sem inventar distância (`HTTP 400`, `22023`, `130 ms`).
  - `E11-VALID-GRID`: alvo adjacente (`(2,2)` vs `(3,2)` = `1.5m`) aprovado com `rangeStatus = in_range`, `gridDistanceMeters = 1.5`, `passiveSkillRequired = true`, `passiveSkillKey = combate-corpo-a-corpo` (`HTTP 200`, `121 ms`).
  - `E11-CLOSE` + `E11-CLOSE-ALREADY-CLOSED-PT409`: encerramento `HTTP 200` (`133 ms`); repetição rejeitada imediatamente com **`HTTP 409` (`PT409`, `124 ms`)**.
- **COM-12 (Barra contextual `#mesa-tracker-action-bar`):** validada ponta a ponta no WebView2 (Seção 10) e na suíte UI (`31/31 PASS`), confirmando contadores somente leitura (`0` inputs editáveis de saldo), estado sincronizado com o servidor e comandos filtrados por papel e fase.

---

## 8. Fase F — Integração Auth, PostgREST HTTP, Concorrência e Idempotência (`PT409`)

Executado com 6 sessões JWT reais emitidas pelo GoTrue de Homologação e requisições simultâneas (`Promise.all`) contra `/rest/v1/rpc/gerenciar_reacao_combate`, `/rest/v1/rpc/gerenciar_acao_combate` e `/rest/v1/rpc/gerenciar_combate`:

| Cenário Crítico | Comportamento Observado em Homologação | Latência | Integridade Final | Status |
| --- | --- | --- | --- | :---: |
| **F1 · Duas aprovações simultâneas** | 1 vencedor `HTTP 200` + 1 conflito **`HTTP 409` (`code="PT409"`)** | `124 ms` / `148 ms` | `spent=1`, `avail=1` (zero duplo débito, sem stall/retry) | **PASS** |
| **F2 · Aprovação vs Negação simultâneas** | 1 vencedor `approve` `HTTP 200` + 1 conflito **`HTTP 409` (`code="PT409"`)** | `120 ms` / `120 ms` | Estado único e consistente com o vencedor | **PASS** |
| **F3 · Replay simultâneo do mesmo `p_op_id`** | `2x HTTP 200` com `idempotentReplay: true` (mesmo com versão obsoleta) | `119 ms` / `125 ms` | `spent` permanece `1` (zero duplicação) | **PASS** |
| **F4 · Disputa pela última ação (`avail=1`)** | `reserve` `HTTP 200` + `approve` **`HTTP 409` (`code="PT409"`)** | `< 200 ms` | `finalAvail = 0` (nunca negativo) | **PASS** |
| **F5 · Avanço de turno vs Aprovação** | `proximo` `HTTP 200` + `approve` **`HTTP 409` (`code="PT409"`)** | `119 ms` / `120 ms` | Solicitação `expired`, `spent = 0` | **PASS** |
| **F6 · Virada de rodada com oportunidade aberta** | R4 limpa (`opps=0`); execução tardia (R3 e R4) retorna **`HTTP 409` (`PT409`)** | `128 ms` / `122 ms` | Zero vazamento da rodada anterior | **PASS** |
| **F7 · Reconexão + replay de `p_op_id`** | Nova sessão fresca `obter_combate_publico` + replay `HTTP 200` (`idempotentReplay=true`) | `128 ms` | `spent` permanece `1` | **PASS** |
| **F8 · Operações concorrentes cross-table** | `playerB` (Mesa 1) `HTTP 200`; `gm2` (Mesa 2) **`HTTP 403` (`42501`)**; `outsider` **`HTTP 403` (`42501`)** | `< 200 ms` | Isolamento absoluto sob corrida | **PASS** |

- **Confirmação crítica do contrato `PT409`:** em todas as corridas e estados obsoletos, o PostgREST de Homologação retornou **`HTTP 409 Conflict` em `120–148 ms`** (ausência completa do retry loop de ~120 s / `HTTP 504` que ocorreria com `40001`).

---

## 9. Fase G — Realtime WebSocket e Privacidade

- **Assinantes simultâneos (`4` canais `SUBSCRIBED`):** `gm1` (Mesa 1), `playerB` (Mesa 1), `gm2` (Mesa 2, escutando `mesa_combate_sinais`, `mesas` e `mesa_tokens` **sem filtro de mesa**) e `outsider` (sem mesa, escutando as mesmas 3 tabelas **sem filtro**).
- **`G-REALTIME-DELIVERY-AND-NO-DUPLICATES` (PASS):** `gm1` e `playerB` receberam exatamente `33` sinais únicos de `mesa_combate_sinais` ao longo das mutações (solicitação, aprovação, negação, cancelamento, oportunidade, avanço de turno e virada de rodada), sem revisões duplicadas.
- **`G-REALTIME-ZERO-CROSS-TABLE-LEAKS` (PASS):** `gm2` recebeu **`0`** eventos da Mesa 1 e `outsider` recebeu **`0`** eventos da Mesa 1 nas 3 tabelas monitoradas.
- **`G-REALTIME-REHYDRATION-PRIVACY` (PASS):** na reidratação via `obter_combate_publico`, `playerB` visualizou exclusivamente seu próprio `action_state`, suas próprias solicitações e oportunidades, sem receber `action_state` de `playerA`, sem receber `tokHidden` (`visible_to_players = false`) e sem receber `reaction_op_results`.
- **`G-REALTIME-RECONNECT` (PASS):** após remover e recriar o canal WebSocket de `playerB`, nova mutação gerou exatamente `1` evento entregue (`rev = 36`), sem duplicação.

---

## 10. Fase H — Tauri Dev / WebView2 (`H0`–`H11`: `12/12 PASS`)

- **Isolamento de ambiente comprovado:** `dist/js/supabaseConfig.js` permaneceu **100% intocado em disco** (`git diff` vazio). O WebView2 utilizou perfil `WEBVIEW2_USER_DATA_FOLDER` descartável, interceptação em memória via CDP `Fetch.fulfillRequest` apontando exclusivamente para `https://igyupxczhczidfgtjiws.supabase.co`, e bloqueio físico de rede via CDP `Network.setBlockedURLs` para `*jxxhdqoyblykqiiyptsp.supabase.co*`.
- **Análise do contrato do controller (Etapa 5.1 do Pacote 9.2-R):** confirmado em [`dist/js/turnTracker.js`](../../dist/js/turnTracker.js#L1518-L1529) que `executeReactionControllerMutation` desembrulha `rpcRes.data.result` e retorna `out` diretamente no nível raiz (`out.opportunityId`, `out.persistedOnServer = true`). O ajuste em `phase-h-tauri-homolog.cjs` corrigiu apenas a leitura no driver de teste, preservando integralmente o contrato do produto.

| Caso | Descrição Real Executada | Evidência / Log | Resultado |
| --- | --- | --- | :---: |
| **`H0`** | Setup da mesa sintética + combate ativo R1 em Homologação | `task-450.log`, `task-463.log` | **PASS** |
| **`H1`** | Boot do Tauri Dev em memória apontado apenas a `igyupxczhczidfgtjiws` (`tauri=true`, `prodRequests=0`) | `task-450.log`, `task-463.log` | **PASS** |
| **`H2`** | Login real do Xerife (`gm1`) via formulário `#login-username` / `#login-password` | `task-450.log`, `task-463.log` | **PASS** |
| **`H3`** | Abertura da mesa, `#mesa-turn-tracker` e `#mesa-tracker-action-bar` (`phase=active_turn`, `avail=4`, `spent=0`, `reserved=0`, `editableInputs=0`, `#mesa-action-gm-opp-panel=true`) | `task-450.log`, `task-463.log` | **PASS** |
| **`H4`** | Solicitação de `playerB` sincronizada em tempo real via Realtime no WebView2 do Xerife (`[data-cmd="approve-request"]`) | `task-450.log`, `task-463.log` | **PASS** |
| **`H5`** | Clique real em "Aprovar" no WebView2 debitando `1` ação no servidor (`spent=1`, `avail=1`) com ordem preservada | `task-450.log`, `task-463.log` | **PASS** |
| **`H6`** | Conflito real `HTTP 409 / PT409` no WebView2 (`controller` retornou `conflict=true`, `HTTP 409` capturado na rede, ressincronização sem retry cego nem duplo débito) | `task-450.log`, `task-463.log` | **PASS** |
| **`H7`** | Pós-turno (`tokA` `phase=post_turn`, `4 → 3`) após abertura COM-11 no WebView2 e execução pós-turno por `playerA`, sincronizado em tempo real | `task-450.log`, `task-463.log` | **PASS** |
| **`H8`** | Virada de rodada (`R1 → R2`): badge `"R2 · Turno ativo"`, `avail=4`, `spent=0`, `opps=0`, `reqs=0` | `task-450.log`, `task-463.log` | **PASS** |
| **`H9`** | Reconexão (`reconnectMesaRealtimeNow`) com entrega de nova solicitação R2 via Realtime | `task-450.log`, `task-463.log` | **PASS** |
| **`H10`** | Sessão real de **Jogador (`playerB`)** no WebView2: `pre_turn`, `avail=2`, `editableBalanceInputs=0`, cancelar + solicitar reação pelos botões reais da UI, outro jogador estritamente `"Somente leitura"`, ausência total de controles do Xerife (`approve`, `deny`, `#mesa-action-gm-opp-panel`), e integridade COM-05/08 + XER-04/06 | `task-510.log` | **PASS** |
| **`H11`** | Auditoria de rede e console: **`prodRequests = 0`**, **`homologRequests = 52`**, **`uncaughtExceptions = 0`**, **`criticalConsoleErrors = 0`** (`2` mensagens pré-existentes não críticas de preload `[equipCatalog]` em `127.0.0.1:1430`) | `task-510.log` | **PASS** |

---

## 11. Revisão de Falhas Históricas da Execução (Pacote 9.2-R — Fase R4)

Todas as execuções com código de saída `1` durante a homologação foram auditadas e classificadas; **nenhuma correspondeu a defeito do produto COM-09..12** e nenhuma assertion funcional ou de segurança foi relaxada:

| Incidente Histórico | Causa Raiz Comprovada | Classificação | Resolução Aplicada |
| --- | --- | --- | --- |
| `phase-b-verify.ps1` (`created_by` / `rollback`) | Tabela sintética `supabase_migrations.schema_migrations` do contêiner descartável omitia 3 colunas do Supabase 17.12 | Infraestrutura do ensaio | Adicionadas colunas reais no bootstrap local (`EXIT=0`) |
| `provision-homolog-users.cjs` (`email rate limit exceeded`) | Rate-limit de envio de e-mail do GoTrue em `signUp` após 2 contas consecutivas | Infraestrutura Auth | Reutilizadas as 5 contas sintéticas QA pré-existentes sem vínculo com mesas reais |
| `live-com09-com12-homolog.cjs` (ajustes iniciais de setup) | Check `owner_type='creature'`, formato array de `cena_ativa` (`instanceId` / `creature_mode`), orçamento oficial de iniciativa (`10 → 3` vs `8 → 2`, `creature_mode → 1`) e comparação de lista com/sem token oculto | Driver de teste | Ajustado setup para o contrato real do sistema; mantidas todas as 44 assertions |
| `phase-h-tauri-homolog.cjs` (`openOpportunity` / `getCurrentUserId` / `about:blank`) | Driver lia `OS.currentUser` (API real é `await OS.getCurrentUserId()`) e `res.result.opportunityId` (API real desembrulha `res.opportunityId`) | Driver de teste | Alinhado o driver às APIs reais do app sem alterar o produto |
| `phase-h-continue-h10-h11.cjs` (`task-482`, `task-503`) | Jogador B sem ficha preenchida acionava corretamente o assistente `OS.createNewCharacter` em `OS.openMesa` (`isBlankPlayerMesaSheet` exige chave `combate-*`/`pericia-*` ou `inventoryItems`) | Setup de teste | Criada ficha sintética preenchida para `playerB` no setup de H10 e removida no `finally` (`task-510` `EXIT=0`) |

---

## 12. Regressões Finais (Fase R6) e Não-Regressão XER-05/06

- **Smoke live em Homologação (`task-411`):** `NONREG-XER05-XER06-SMOKE` **PASS** (`inicializar_6b_instancia=200`, `rolar_6b_instancia=200`, `consumir_6b_instancia=200`, `versao=2`).
- **Suítes automatizadas pós-Fase H (`7/7 EXIT=0`, `0` regressões):**
  1. [`tests/com09-com12-reactions-ui.cjs`](../../tests/com09-com12-reactions-ui.cjs) — **`PASS` (`31/31`)**
  2. [`tests/com03-com04-creature-mode.cjs`](../../tests/com03-com04-creature-mode.cjs) — **`PASS`**
  3. [`tests/com05-com06-initiative-budget.cjs`](../../tests/com05-com06-initiative-budget.cjs) — **`PASS`**
  4. [`tests/com07-com08-controller-events.cjs`](../../tests/com07-com08-controller-events.cjs) — **`PASS`**
  5. [`tests/turn-tracker-ui.cjs`](../../tests/turn-tracker-ui.cjs) — **`PASS`**
  6. [`tests/xerife-6b-xer04-own-editor.cjs`](../../tests/xerife-6b-xer04-own-editor.cjs) — **`PASS`**
  7. [`tests/xerife-6b-xer06-instance-combat.cjs`](../../tests/xerife-6b-xer06-instance-combat.cjs) — **`PASS`**

---

## 13. Contagem Consolidada de Testes Executados no Pacote 9.2 / 9.2-R

| Bloco | PASS | FAIL | SKIP | Sem Evidência |
| --- | ---: | ---: | ---: | ---: |
| Fase D (SQL-side `auth.uid()=NULL` / `anon` / helper) | `3` | `0` | `0` | `0` |
| Fases D/E/F/G + Smoke XER-05/06 (`live-com09-com12-homolog.cjs`) | `44` | `0` | `0` | `0` |
| Fase H — Tauri Dev / WebView2 (`H0`–`H11`) | `12` | `0` | `0` | `0` |
| Fase R6 — Suítes direcionadas de regressão | `7` | `0` | `0` | `0` |
| **Total consolidado** | **`66`** | **`0`** | **`0`** | **`0`** |

---

## 14. Fase I / R5 — Limpeza Controlada e Estado Final dos Bancos

1. **Mesas, fichas, tokens, combates, oportunidades e solicitações temporárias:** **100% removidos** de forma cirúrgica por ID exato (nenhuma limpeza genérica de tabelas).
2. **Credenciais efêmeras:** senhas das 5 contas QA pré-existentes rotacionadas via `gen_random_uuid()` descartado; arquivo temporário local `%TEMP%\os-com0912-homolog-cfg.json` excluído (`TEMP_CFG_EXISTS=false`).
3. **Processos e working tree:** `0` processos residuais de Tauri/WebView2; `src-tauri/Cargo.toml` revertido (apenas CRLF/LF); backups e logs preservados intactos.
4. **Comparativo de Estado Final de Homologação (`igyupxczhczidfgtjiws`, `2026-11-19T14:23:36Z`):**

| Entidade | Pré-Implantação (Fase A) | Pós-Limpeza (Fase R5) | Situação |
| --- | ---: | ---: | --- |
| `supabase_migrations.schema_migrations` | `4` | `5` | Esperado (`+1` COM-09/12) |
| `public.mesas` | `2` | `2` | **Idêntico** (`bbbbbbbb-0001..0002`) |
| `public.membros_mesa` | `4` | `4` | **Idêntico** |
| `public.fichas` | `4` | `4` | **Idêntico** |
| `public.mesa_tokens` | `9` | `9` | **Idêntico** (`ffffffff-0001..0009`) |
| `public.mesa_combate_sinais` | `2` | `2` | **Idêntico** |
| `public.mesa_6b_instancia` | `0` | `0` | **Idêntico** |
| Combates ativos (`combate_ativo IS NOT NULL`) | `0` | `0` | **Limpo** |
| `auth.users` / `public.usuarios` | `11` | `13` | **`+2` órfãos não-confirmados (Ressalva #1)** |

5. **Produção (`jxxhdqoyblykqiiyptsp`):** confirmada com exatamente **`19`** migrações (`20261106000343` a `20261118153000`), **`0`** escritas realizadas, **`0`** requisições enviadas durante o Tauri Dev.

---

## 15. Defeitos, Ressalvas e Riscos Residuais

- **Defeitos encontrados no produto COM-09..12:** **nenhum** (`0` defeitos corrigidos ou pendentes no código da aplicação ou na migração SQL).
- **Ressalva #1 (motivo de `APROVADO COM RESSALVAS`):** durante a tentativa inicial de provisionamento via `auth.signUp()` (que atingiu rate-limit de e-mail do GoTrue), permaneceram em Homologação `2` registros não confirmados, sem sessão e sem vínculo com mesas, fichas ou tokens:
  - `bea796c2-d439-4fce-8740-64fa6464f439` (`qa.com0912.gm1.p92f8739b6a@gmail.com`, `confirmed=false`)
  - `6d4316dc-19cd-4999-b0a2-97e6b006fa7f` (`qa.com0912.playera.p92f8739b6a@gmail.com`, `confirmed=false`)
  - Não foram excluídos automaticamente porque o cliente MCP cancela `DELETE` via `execute_sql` sem confirmação interativa (mesmo comportamento documentado no Pacote 5). Não afetam segurança nem integridade. Podem ser removidos manualmente pelo proprietário no Dashboard de Homologação (Authentication → Users) pelos 2 UUIDs exatos acima.
- **Risco residual #1 (pré-existente, fora do escopo COM-09..12):** em `tauri dev` (`127.0.0.1:1430`), o preload opcional de `[equipCatalog]` registra 2 mensagens `SyntaxError: Unexpected token '<'` no console quando um arquivo auxiliar opcional não existe no servidor dev; não causa exceção não tratada nem afeta o combate.
- **Risco residual #2 (para futura Produção):** a Produção (`jxxhdqoyblykqiiyptsp`) possui `19` migrações oficiais registradas (sem divergência de histórico, ao contrário de Homologação), mas exigirá planejamento separado com backup lógico próprio de Produção, ensaio sobre o backup de Produção, janela de aplicação controlada e validação pós-deploy.

---

## 16. Estado Final do Git e Arquivos Modificados / Criados

- **Branch:** `feature/com09-com12-reactions` (`HEAD` = `main` = `origin/main` = `f743bbdb694e5400c127551fb546969535e180a9`, zero commits adicionais, zero `git push`, zero tags/releases).
- **Arquivos rastreados modificados (exclusivamente do Pacote 9 — zero alterações adicionais no Pacote 9.2):** `dist/index.html`, `dist/js/mesaScreen.js`, `dist/js/rules/index.js`, `dist/js/turnTracker.js`, `dist/style.css`.
- **Arquivos preservados intactos (`git diff` vazio):** `dist/js/supabaseConfig.js`, `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (`1.4.6`).
- **Novos arquivos adicionados neste pacote:**
  - [`tests/live-com09-com12-homolog.cjs`](../../tests/live-com09-com12-homolog.cjs)
  - [`database/com09-com12-acoes-reacoes/04-homologacao-controlada-com09-com12.md`](04-homologacao-controlada-com09-com12.md)

---

## 17. Recomendação para o Gate Seguinte

Com todas as validações de segurança, RLS, concorrência `PT409` (`HTTP 409` imediato), idempotência, Realtime com privacidade, Tauri Dev (`H0`–`H11`) e regressões aprovadas em Homologação:

1. **(Opcional em Homologação):** remover manualmente os 2 usuários não confirmados órfãos (`bea796c2-d439-4fce-8740-64fa6464f439` e `6d4316dc-19cd-4999-b0a2-97e6b006fa7f`) no painel Authentication de `igyupxczhczidfgtjiws`.
2. **Próximo Gate (aguardando autorização explícita do proprietário):** iniciar um **Pacote 10 — Preparação de Produção e Release 1.4.7**, com backup lógico exclusivo de Produção (`jxxhdqoyblykqiiyptsp`), ensaio em PG 17 sobre o dump de Produção, aplicação controlada da migração `20261119120000_com09_com12_reactions_and_opportunities.sql` e validação pós-deploy antes de qualquer merge em `main` ou publicação de nova versão.
