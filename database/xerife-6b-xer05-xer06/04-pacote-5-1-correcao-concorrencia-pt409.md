# OESTE SOMBRIO 2.0 — PACOTE 5.1: CORREÇÃO DE CONCORRÊNCIA XER-06 (`PT409`)

**Data:** 18/11/2026  
**Branch:** `feature/xerife-6b-npc-boss` (base `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, versão pública `1.4.5` preservada)  
**Homologação:** `igyupxczhczidfgtjiws` (`Oeste Sombrio Homologação`, PostgreSQL `17.12.0.000`)  
**Produção (`jxxhdqoyblykqiiyptsp`):** **INTOCADA** (nenhuma migração, restauração ou escrita executada)  
**Classificação Final:** **`XER-06 APROVADO PARA PRODUÇÃO`**

---

## 1. Alterações Implementadas no Pacote 5.1

1. **Nova migração incremental:** [`20261118153000_xerife_6b_instance_conflict_pt409.sql`](../../supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql)
   - `SHA-256`: `CE5453EEA576D0D466FFCA3AAB38714FAE1806681300CE41C18B26D142671F03`
   - Migração anterior [`20261118101800_xerife_6b_instance_combat.sql`](../../supabase/migrations/20261118101800_xerife_6b_instance_combat.sql) preservada intacta (`SHA-256`: `7A8D54C0E28A2F9D40FEAD1B1C9063070904FC59D2A64DC5C6913AC2F8CB3A0B`).
   - Substituiu `USING ERRCODE = '40001'` por `USING ERRCODE = 'PT409'` via `CREATE OR REPLACE FUNCTION` exclusivamente nas 6 funções mutáveis de instância (`rolar_instancia`, `consumir_instancia`, `aplicar_dano_instancia`, `curar_dano_instancia`, `ajustar_fadiga_instancia`, `renovar_instancia`), além de `NOTIFY pgrst, 'reload schema';`.
   - Zero alterações de tabelas, políticas RLS, triggers, grants ou publicação Realtime.
2. **Frontend ([`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js)):**
   - `isInstance6BConflictError`: trata `PT409`, HTTP `409` (com ou sem `code`), códigos históricos (`40001`, `P0409`) e `VERSION_CONFLICT`.
   - `isInstance6BGatewayTimeoutError`: distingue explicitamente HTTP `504` / `upstream request timeout` de conflito de versão.
   - `executeInstanceOwn6BCommand`: extrai `rpcRes.status`, ressincroniza estado via `OS.refreshInstanceOwn6B(instanceId)` em conflito ou timeout `504`, libera trava no `finally` e não executa retry automático com novo `opId`.

---

## 2. Pré-condições e Backup Lógico Pré-Migração

1. **Backup anterior preservado:** `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\homolog-igyupxczhczidfgtjiws-20261118-112808` (intacto).
2. **Novo backup lógico de Homologação (`igyupxczhczidfgtjiws`):** `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\homolog-igyupxczhczidfgtjiws-20261118-1759`
   - `roles.sql`: `297` bytes (`ROLES_EXIT=0`, SHA-256 `25873CEC56A2CC6514E204F420231777F85C03DA818CAA7090CDCDFA89776ECD`)
   - `schema.sql`: `202.073` bytes (`SCHEMA_EXIT=0`, SHA-256 `BABC8D77E42B0E007B8B3C5B084A1AE7C1A666E9A3B443D079EA17A63A9B8433`)
   - `data.sql`: `57.787` bytes (`DATA_EXIT=0`, SHA-256 `EBA6971C04CCCC0DF379597016D91B27FFEB2786E95961191F2F5F7BEF6B8DC1`)
   - `migrations_data.sql`: `73.694` bytes (`MIG_DATA_EXIT=0`, SHA-256 `09BEE2AAFB4A479B4EB302A20D9B9348393D3D386933D94633A3A995DE45CB84`)
   - `app_schema.sql`: `APP_SCHEMA_EXIT=0` (`896F7EB390ED9263212AE4AF622F43015C9DB03BF778964E2536D2BE945A91C5`)
   - `app_data.sql`: `APP_DATA_EXIT=0` (`ACBA6CADA835FA4E57311A4F4DC7A17115418F07358341EC0BC3611C96EA8488`)
3. **Validação de restauração e ensaio pré-deploy:**
   - Em `public.ecr.aws/supabase/postgres:17.12.0.000`: `ROLES_RESTORE_EXIT=0`, `SCHEMA_RESTORE_EXIT=0` e ensaio de `20261118153000_xerife_6b_instance_conflict_pt409.sql` com `REHEARSAL_MIG_EXIT=0`.
   - Em `postgres:17-alpine`: `APP_DATA_RESTORE_EXIT=0`, `RESTORED_COUNTS=11|2|4|4|9|9|3` (`usuarios|mesas|membros_mesa|fichas|mesa_tokens|mesa_token_status|schema_migrations`).
4. **Workdir isolado e plano (`--dry-run`):**
   - `$homologWork = C:\Users\Stéfano\AppData\Local\Temp\homolog-deploy-work-pt409` contendo exclusivamente `20261116214200`, `20261117151310`, `20261118101800` e `20261118153000`.
   - `--dry-run`: `"migrations":["20261118153000_xerife_6b_instance_conflict_pt409.sql"]`, `DRY_RUN_EXIT=0`.

---

## 3. Aplicação e Validação Estrutural Pós-Migração (`igyupxczhczidfgtjiws`)

- **Comando executado:** `& $sb db push --workdir $homologWork --remote=igyupxczhczidfgtjiws --skip-vault --yes` (`HOMOLOG_DB_PUSH_EXIT=0`, aplicou somente `20261118153000_xerife_6b_instance_conflict_pt409.sql`).
- **Histórico final (`supabase_migrations.schema_migrations`) — exatamente 4 versões:**
  1. `20261116214200` (`homologacao_144_mapas_notas`)
  2. `20261117151310` (`xerife_6b_foundation`)
  3. `20261118101800` (`xerife_6b_instance_combat`)
  4. `20261118153000` (`xerife_6b_instance_conflict_pt409`)
- **Inspeção das 6 funções modificadas (`pg_proc`):**
  - `xerife_6b.rolar_instancia`, `xerife_6b.consumir_instancia`, `xerife_6b.aplicar_dano_instancia`, `xerife_6b.curar_dano_instancia`, `xerife_6b.ajustar_fadiga_instancia`, `xerife_6b.renovar_instancia`: todas com `prosecdef = true`, `proconfig = ["search_path=\"\""]`, `acl = "{postgres=X/postgres,authenticated=X/postgres}"` (`auth_exec = true`, `anon_exec = false`), `has_pt409 = true`, `has_40001 = false`.
  - Os 9 wrappers `public.*_6b_instancia` mantiveram assinaturas, `prosecdef = false`, `search_path = ""`, `auth_exec = true`, `anon_exec = false`.
- **Preservação de dados e estrutura:** `11` usuários (`auth.users`), `2` mesas, `4` `membros_mesa`, `4` `fichas`, `9` `mesa_tokens`, `9` `mesa_token_status`, `0` registros residuais em `mesa_6b_instancia` / `xerife_6b.instancia_operacoes`, `10` tabelas na publicação `supabase_realtime`.

---

## 4. Testes Direcionados Executados

### 4.1 Concorrência Real HTTP/PostgREST em Homologação ([`tests/live-xerife-6b-pt409-homolog.cjs`](../../tests/live-xerife-6b-pt409-homolog.cjs), `PT409_LIVE_EXIT=0`)
- **`C2-3b` (Consumo concorrente via HTTP `/rest/v1/rpc/consumir_6b_instancia`):** **PASS** — `1` vencedor (`HTTP 200`, `159 ms`, `versao=2`, `1` dado consumido) e perdedor com **`HTTP 409`**, **`code: "PT409"`**, latência **`332 ms`** (`< 1 s`), zero `HTTP 504`, zero consumo duplicado.
- **`C2-10b` (Renovação concorrente via HTTP `/rest/v1/rpc/renovar_6b_instancia`):** **PASS** — `1` vencedor (`HTTP 200`, `138 ms`, `fadiga=1`, `bloqueados=[1,4]`) e perdedor com **`HTTP 409`**, **`code: "PT409"`**, latência **`142 ms`** (`< 1 s`), zero `HTTP 504`, zero fadiga duplicada ou corrupção de estado.
- **`SMOKE-IDEMP`:** **PASS** — Replay do `opId` vencedor (`pt409-conc-ren-b`) com versão obsoleta retornou `HTTP 200`, `idempotentReplay=true`, `versao=5`, `fadiga=1` sem reaplicar fadiga.
- **`SMOKE-RLS`:** **PASS** — `playerA`, `defenderA` (em `renovar`), `gmB` (outra mesa) e `UPDATE` direto em `mesa_6b_instancia` bloqueados com `42501`.
- **`SMOKE-RECONN`:** **PASS** — Canal Realtime autenticado `SUBSCRIBED` + `ler_6b_instancia` recuperaram estado autoritativo (`versao=5`, `fadiga=1`, `bloqueados=[1,4]`).

### 4.2 Validação Local Direcionada (Pré-aplicação após edição final)
- Sintaxe ES module ([`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js)): `NODE_SYNTAX_EXIT=0`.
- PostgreSQL 17 descartável ([`tests/xerife-6b-pg17-conflict-pt409.cjs`](../../tests/xerife-6b-pg17-conflict-pt409.cjs)): `EXIT=0` (corrida paralela real `psql`, `PT409` nas 6 RPCs, idempotência e RLS `42501`).
- Frontend XER-06 ([`tests/xerife-6b-xer06-instance-combat.cjs`](../../tests/xerife-6b-xer06-instance-combat.cjs)): **PASS: 32 verificações** (`EXIT=0`, incluindo `XER06-8a..8e` para `PT409`, `HTTP 409`, `40001`, `P0409` e `HTTP 504`).
