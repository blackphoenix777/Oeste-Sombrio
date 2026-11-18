# Pacote 2C — Preparação Final para Implantação da Migração P0-2 em Produção

**Data:** 17/11/2026  
**Escopo do Pacote 2C (Fase A + Fase B):** `supabase/migrations/20261117151310_xerife_6b_foundation.sql`  
**Status atual:** **Fase B concluída com sucesso (`DB_PUSH_EXIT=0`) e validada em Produção (`jxxhdqoyblykqiiyptsp`)**

> [!NOTE]
> A Fase B foi executada após autorização explícita do responsável, aplicando exclusivamente `20261117151310_xerife_6b_foundation.sql` em Produção (`jxxhdqoyblykqiiyptsp`). Não houve alteração em Homologação (`igyupxczhczidfgtjiws`), nem bump para `1.4.5`, build/release Tauri, `git commit` ou `git push`.

---

## 1. Resumo Executivo

- **Artefato autorizável único para Fase B:** `supabase/migrations/20261117151310_xerife_6b_foundation.sql` (`17.777` bytes, SHA-256 `BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09`).
- **Base local verificada:** branch `main`, `HEAD` `0c996fab7e0c6003a564b09c1a26f80a0115aa04`, `17` migrações locais (`16` históricas com hash idêntico ao de Produção + `1` migração P0-2 pendente).
- **Base remota verificada (somente leitura):** Produção (`jxxhdqoyblykqiiyptsp`, PostgreSQL `17.11.0.011`) sem qualquer vestígio de `xerife_6b` ou `public.mesa_6b_aberto`, com `16` registros em `supabase_migrations.schema_migrations`, publicação Realtime sem `FOR ALL TABLES` (`8` tabelas publicadas) e contagens idênticas ao backup.
- **Backups preservados:** dump PostgreSQL `621.973` bytes (`oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump`) previamente validado com restauração e ensaio integral em PostgreSQL `17.11` isolado (`PG_RESTORE_EXIT=0`, `MIG_APPLY_EXIT=0`), e backup de Storage (`4` objetos, `2.539.448` bytes, manifesto `E1F0B47D...`).
- **Classificação no Gate de 10 pontos:** **`PRONTO COM RESSALVAS`** (detalhes na Seção 3 e Seção 4).

---

## 2. Evidências da Fase A (A1 a A5)

### A1 — Repositório Local e Supabase CLI 3.2.0

| Item verificado | Resultado observado | Status |
|---|---|---|
| Branch e `HEAD` | `main` / `0c996fab7e0c6003a564b09c1a26f80a0115aa04` | OK |
| Integridade de diff (`git diff --check`) | Código de saída `0` | OK |
| Alterações rastreadas não commitadas | Nenhuma (apenas arquivos não rastreados esperados: documentação em `database/implantacao-mesa-p0-xerife-p02/`, `supabase/.temp/` e os `16` SQLs históricos recuperados) | OK |
| Total de arquivos em `supabase/migrations/` | `17` arquivos `.sql` (`16` históricos `20261106000343`..`20261116210603` + `20261117151310_xerife_6b_foundation.sql`) | OK |
| Hash SHA-256 da `20261117151310_xerife_6b_foundation.sql` | `BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09` (`17.777` bytes) | OK |
| Binário Supabase CLI | `C:\Users\Stéfano\AppData\Local\npm-cache\_npx\a0b0486f7f118473\node_modules\@supabase\cli-windows-x64\bin\supabase.exe` — versão `3.2.0` | OK |
| Autenticação CLI (`projects list`) | Código de saída `0`; lista `jxxhdqoyblykqiiyptsp` (`ACTIVE_HEALTHY`, Postgres `17.11.0.011`) e `igyupxczhczidfgtjiws` (`ACTIVE_HEALTHY`, Postgres `17.12.0.000`), `linked: false` | OK |

### A2 — Estado Remoto Somente Leitura (Produção e Homologação)

Consultas `SELECT` em Produção (`jxxhdqoyblykqiiyptsp`):

- **Objetos P0-2:** `schema_xerife_6b = null`, `tbl_mesa_6b_aberto = null`, `wrappers_6b_count = 0`, `mig_20261117151310_recorded = 0`.
- **Histórico remoto:** `total_migrations = 16` (`20261106000343` a `20261116210603`). A comparação de SHA-256 entre `statements[1]` de `supabase_migrations.schema_migrations` e os `16` arquivos locais em `supabase/migrations/` apresentou correspondência **1:1 exata** em todos os `16` registros.
- **Realtime e helpers pré-existentes:** `any_puballtables = false`, `realtime_tables_count = 8`, `is_mestre_args = "p_mesa_id uuid"`.
- **Contagens de integridade vs backup `22:49:38`:** `mesas = 6`, `membros_mesa = 9`, `fichas = 12`, `auth.users = 11`, `storage.objects = 4`, `public_funcs = 40`, `policies = 35`. Nenhuma alteração incompatível ocorreu em Produção após a coleta do backup.

Estado de Homologação (`igyupxczhczidfgtjiws`):

- Migrações registradas via `list_migrations`: `20261116214200` (`homologacao_144_mapas_notas`) e `20261117151310` (`xerife_6b_foundation`).

### A3 — Backups PostgreSQL e Storage

- **Backup PostgreSQL (`pg_dump -Fc`):**
  - Caminho: `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump`
  - Existência e timestamps: `True` (`CreationTime 17/11/2026 22:49:39`, `LastWriteTime 17/11/2026 22:50:21`)
  - Tamanho: `621.973` bytes
  - SHA-256: `5BEB570B6F18C0BB4B4A5F6C989E45177DF4022FEE4593EC434859A749A4A9D7`
  - ACL NTFS: `DESKTOP-4EFQ4QH\Stéfano:(F)`
  - Validação prévia em PostgreSQL `17.11` isolado sobre este exato arquivo (inalterado pelo SHA-256): `PG_RESTORE_EXIT=0` e `MIG_APPLY_EXIT=0` para `20261117151310_xerife_6b_foundation.sql`. Backup anterior de `16/11` preservado.
- **Backup de Storage:**
  - Diretório: `C:\Users\Stéfano\AppData\Local\OesteSombrioBackups\storage-20261117-231655`
  - Objetos baixados: `4` arquivos, totalizando `2.539.448` bytes (caminhos privados de objetos omitidos intencionalmente).
  - Manifesto (`manifest.json`): SHA-256 `E1F0B47DED3761663FA5246B40DD2169CBA2DEC88DA7A4254615D001FA00D1AB`
  - ACL NTFS: `DESKTOP-4EFQ4QH\Stéfano:(OI)(CI)(F)`

### A4 — Inspeção Interna do CLI `3.2.0` (`--dry-run` e Executor de Migrações)

1. **Por que `supabase db push --remote=jxxhdqoyblykqiiyptsp --dry-run` NÃO foi executado na Fase A:**
   A inspeção direta do bundle de `supabase.exe` `3.2.0` (`DbPush.run` e `DbConfig.initLoginRole`) confirmou que, antes da ramificação `if (c)` (`dryRun`), `DbPush.run` executa `r.connect(l, {isLocal: t, dnsResolver: g})`. Quando utilizado com `--remote` sem `--password`, o conector chama `DbConfig.initLoginRole`, que dispara `i.v1.createLoginRole({ref: e, read_only: !1})` (`"Initialising login role..."`) e eventualmente `deleteNetworkBans` na API de gerenciamento remota. Isso produz alteração/bootstrap administrativo no projeto remoto e viola a regra inegociável da Fase A (*nenhuma operação persistente, incluindo bootstrap*).
2. **Como a equivalência do plano foi validada sem mutação remota:**
   - Comparação read-only direta das `16` versões/hashes remotas contra os `17` arquivos locais (`M.pending = [20261117151310_xerife_6b_foundation.sql]`);
   - Ensaio prévio de aplicação real em PostgreSQL `17.11` sobre o dump de Produção (`MIG_APPLY_EXIT=0`).
3. **Comportamento transacional confirmado de `gxe` no CLI `3.2.0`:**
   - `20261117151310_xerife_6b_foundation.sql` contém `BEGIN;` e `COMMIT;` explícitos, o que aciona `o.some(Bko) === true` (padrão `Mko = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|PREPARE\s+TRANSACTION)(?:\s|$)/u`).
   - Nesse modo, `gxe` executa os statements em sequência (`h("ROLLBACK")`) dentro da própria transação explícita da migração, aplica `ROLLBACK` automático em qualquer erro, e grava `(version, name, statements)` em `supabase_migrations.schema_migrations`.
   - Em modo não-TTY / agente, `DbPush.run` aciona `HostedConsent.require` (`xp(...)`), retornando `HostedMutationConsentRequiredError` se executado sem `--yes`.

### A5 — Revisão Técnica e de Segurança de `20261117151310_xerife_6b_foundation.sql`

Revisão completa das `271` linhas da migração:

- **Atomicidade e guarda de publicação:** bloco `BEGIN; ... COMMIT;` + bloco `DO $$` que aborta com `RAISE EXCEPTION` caso exista publicação `FOR ALL TABLES` (`pg_publication.puballtables`).
- **Isolamento do schema privado `xerife_6b`:** `REVOKE ALL ON SCHEMA xerife_6b FROM PUBLIC, anon, authenticated`; `GRANT USAGE` apenas a `authenticated`. Tabelas `xerife_6b.presencas` e `xerife_6b.conjuntos` com RLS habilitado, `REVOKE ALL ON ALL TABLES IN SCHEMA xerife_6b FROM PUBLIC, anon, authenticated` e **zero políticas permissivas**, impedindo acesso direto por clientes `anon`/`authenticated`.
- **Projeção aberta e Realtime (`public.mesa_6b_aberto`):** RLS habilitado, `REVOKE ALL`, `GRANT SELECT` apenas para `authenticated`, política `mesa_6b_aberto_leitura` (`FOR SELECT TO authenticated`) vinculada a `public.is_mestre_da_mesa(mesa_id)` ou participação em `public.membros_mesa` com `(SELECT auth.uid())`, e adição pontual à publicação via `ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_6b_aberto;`.
- **Funções e wrappers RPC:** `7` funções em `xerife_6b.*` (`autorizar`, `presenca`, `composicao`, `ler`, `rolar`, `consumir`, `renovar`), todas `SECURITY DEFINER SET search_path = ''`, com `REVOKE ALL` e `GRANT EXECUTE` exclusivo para `authenticated` nas `5` funções operacionais (`autorizar` e `composicao` permanecem inacessíveis externamente). Os `5` wrappers em `public.*_6b_xerife` usam `LANGUAGE sql SECURITY INVOKER SET search_path = ''` para `authenticated`.
- **Compatibilidade com cliente público `1.4.4`:** nenhuma tabela, função, trigger, policy ou publicação utilizada pela versão `1.4.4` é modificada ou removida. DDL sem `IF NOT EXISTS`, apropriado para aplicação única atômica.

---

## 3. Gate Obrigatório de 10 Pontos

| # | Critério do Gate | Evidência verificada | Status |
|---|---|---|---|
| 1 | Repositório em `main` no `HEAD` `0c996fa` | `0c996fab7e0c6003a564b09c1a26f80a0115aa04` em `main`; `git diff --check` OK | **OK** |
| 2 | `17` migrações locais íntegras e SHA-256 P0-2 exato | `16` históricas (hash 1:1 com Produção) + `20261117151310` (`BEF172A6...`, `17.777` bytes) | **OK** |
| 3 | Supabase CLI `3.2.0` disponível e autenticado | `supabase.exe` `3.2.0`; `projects list` exit `0` (`jxxhdqoyblykqiiyptsp` e `igyupxczhczidfgtjiws`) | **OK** |
| 4 | Produção sem objetos P0-2 e sem drift desde backup | `xerife_6b`/`mesa_6b_aberto` ausentes; `16` migrações; contagens idênticas ao dump `22:49:38` | **OK** |
| 5 | Publicação Realtime segura (sem `puballtables`) | `any_puballtables = false`; `8` tabelas publicadas atualmente | **OK** |
| 6 | Backup PostgreSQL válido e testado em PG `17.11` | `621.973` bytes (`5BEB570B...`); restauração + ensaio P0-2 aprovados previamente | **OK** |
| 7 | Backup de Storage válido e íntegro | `4` objetos (`2.539.448` bytes), `manifest.json` (`E1F0B47D...`), ACL local restrita | **OK** |
| 8 | Revisão de segurança/compatibilidade da P0-2 | `SECURITY DEFINER/INVOKER`, `search_path=''`, RLS restritivo, zero impacto em `1.4.4` | **OK** |
| 9 | Ensaio `--dry-run` oficial sem bootstrap remoto | **Não executado** em Produção porque CLI `3.2.0` invoca `createLoginRole({read_only:!1})` antes do `--dry-run`; suprido por diff read-only 1:1 + ensaio em PG `17.11` | **RESSALVA** |
| 10 | Autorização explícita do responsável para Fase B | Autorização recebida em 17/11/2026 às 23:36; Fase B aplicada e validada | **OK (FASE B CONCLUÍDA)** |

**Veredito pós-Fase B:** **`IMPLANTADO E VALIDADO EM PRODUÇÃO`**

**Ressalvas históricas da Fase A (resolvidas na execução autorizada):**
1. **`--dry-run` oficial do CLI não executado na Fase A:** por desenho interno do Supabase CLI `3.2.0` (`DbConfig.initLoginRole`), qualquer `supabase db push --remote=...` sem `--password` cria login role temporário não-readonly na API antes de checar `--dry-run`. O plano exato de migração foi comprovado sem mutação por inspeção SQL 1:1 + ensaio em PostgreSQL `17.11`.
2. **Consentimento CLI não-interativo na Fase B:** como o CLI `3.2.0` exige consentimento explícito em modo agente (`HostedMutationConsentRequiredError`), o comando autorizado incluiu `--yes` após autorização explícita do responsável.
3. **Execução única da DDL:** a migração executou uma única vez dentro de seu `BEGIN; ... COMMIT;` com sucesso (`DB_PUSH_EXIT=0`).

---

## 4. Execução e Validação da Fase B (Concluída em 17/11/2026)

### 4.1 Reconfirmação Pré-Execução (Pré-Voo)
- **Local:** branch `main`, `HEAD` `0c996fab7e0c6003a564b09c1a26f80a0115aa04`, `17` arquivos SQL locais, `20261117151310_xerife_6b_foundation.sql` com SHA-256 `BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09`.
- **Backups disponíveis:** dump PostgreSQL `621.973` bytes (`5BEB570B6F18C0BB4B4A5F6C989E45177DF4022FEE4593EC434859A749A4A9D7`) e Storage `manifest.json` (`E1F0B47DED3761663FA5246B40DD2169CBA2DEC88DA7A4254615D001FA00D1AB`).
- **Produção (`jxxhdqoyblykqiiyptsp`) antes do `db push`:** `16` migrações (`20261106000343`..`20261116210603`), `schema_xerife_6b = null`, `tbl_mesa_6b_aberto = null`, `wrappers_6b_count = 0`, `mig_20261117151310_recorded = 0`, `any_puballtables = false`, `realtime_tables_count = 8`, `mesas = 6`, `membros = 9`, `fichas = 12`, `users = 11`, `storage.objects = 4`.

### 4.2 Comando Executado
```powershell
& $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes
```
- **Resultado CLI:** `DB_PUSH_EXIT=0` (`Finished supabase db push.`, `target.project_ref = jxxhdqoyblykqiiyptsp`, `migrations = ["20261117151310_xerife_6b_foundation.sql"]`, `seeds = []`, `roles = []`).

### 4.3 Validação Pós-Aplicação em Produção (`jxxhdqoyblykqiiyptsp`)
- **Histórico de migrações (`supabase_migrations.schema_migrations`):** `17` registros (`20261106000343`..`20261116210603` + `20261117151310` com `name = xerife_6b_foundation`, `stmt_count = 34`).
- **Schema e ACL de `xerife_6b`:** `anon` `USAGE = false`, `authenticated` `USAGE = true`, `PUBLIC` `CREATE = false`.
- **Tabelas, RLS e privilégios:**
  - `xerife_6b.conjuntos`: `rls = true`, `0` políticas, `anon`/`authenticated` sem privilégios (`SELECT/INSERT/UPDATE/DELETE = false`), `0` linhas;
  - `xerife_6b.presencas`: `rls = true`, `0` políticas, `anon`/`authenticated` sem privilégios (`SELECT/INSERT/UPDATE/DELETE = false`), `0` linhas;
  - `public.mesa_6b_aberto`: `rls = true`, `1` política (`mesa_6b_aberto_leitura`, `FOR SELECT TO authenticated`), `anon` sem privilégios, `authenticated` apenas com `SELECT = true` (`INSERT/UPDATE/DELETE = false`), `0` linhas.
- **Funções e wrappers (`search_path=""` confirmado em todas):**
  - `xerife_6b.*` (`7` funções `SECURITY DEFINER`): `autorizar` e `composicao` com `EXECUTE = false` para `anon`, `authenticated` e `PUBLIC`; `consumir`, `ler`, `presenca`, `renovar` e `rolar` com `EXECUTE = true` apenas para `authenticated` (`anon`/`PUBLIC = false`).
  - `public.*_6b_xerife` (`5` wrappers `SECURITY INVOKER`): `consumir_6b_xerife`, `ler_6b_xerife`, `presenca_6b_xerife`, `renovar_6b_xerife` e `rolar_6b_xerife` com `EXECUTE = true` apenas para `authenticated` (`anon`/`PUBLIC = false`); total em `public` passou de `40` para `45`.
- **Publicação Realtime (`supabase_realtime`):** `any_puballtables = false`; `9` tabelas publicadas (`public.eventos_mesa`, `public.fichas`, `public.itens_entregues_pendentes`, `public.mesa_6b_aberto`, `public.mesa_combate_sinais`, `public.mesa_mapa_sinais`, `public.mesa_token_status`, `public.mesa_tokens`, `public.mesas`).
- **Preservação dos dados existentes:** `mesas = 6`, `membros_mesa = 9`, `fichas = 12`, `auth.users = 11`, `storage.objects = 4` (100% preservados).

---

## 5. Separação Rigorosa de Escopo e Rollback

### Executado no Pacote 2C (Fase A + Fase B)
- **Fase A:** auditoria local, conferência remota read-only, conferência de backups e inspeção forense do CLI `3.2.0`.
- **Fase B:** pré-voo completo, execução de `& $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes` (`DB_PUSH_EXIT=0`) e validação pós-aplicação de migração, tabelas, RLS, ACLs, funções, Realtime e preservação de dados, com registro atualizado neste arquivo.

### Estratégia de Rollback (referência caso necessário futuramente)
- **Reversão controlada pós-commit (prioritária, sem perda de dados):** como o cliente `1.4.4` não consome objetos P0-2, remover `public.mesa_6b_aberto` da publicação `supabase_realtime`, remover os `5` wrappers `public.*_6b_xerife`, `DROP TABLE public.mesa_6b_aberto`, `DROP SCHEMA xerife_6b CASCADE` e reconciliar `schema_migrations` (`20261117151310` como `reverted`).
- **Contingência severa (último recurso):** restauração física/lógica usando o backup `oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump` e o snapshot de Storage `storage-20261117-231655`.

### Fora de Escopo / Não Executado
- Não foi feito bump da versão Tauri para `1.4.5`, geração de instaladores nem criação de release;
- Não foram executados `git commit`, `git push`, `merge` ou `db reset`;
- Não foi implementado `XER-04`, `XER-05` ou `XER-06`.
