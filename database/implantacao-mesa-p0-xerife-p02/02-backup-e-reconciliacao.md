# Etapa A–E — Validação do Backup de Produção e Preparação de Reconciliação (v1.4.5 / MESA P0 + P0-2)

**Data / Hora da validação:** 17/11/2026 (22:55–22:57 BRT)  
**Branch / HEAD verificado:** `main` em `0c996fa`  
**Ambientes remotos (somente leitura; zero alterações):**
- **Produção:** `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio`, PostgreSQL `17.11.0.011`, `us-east-1`, plano `free`)
- **Homologação:** `igyupxczhczidfgtjiws` (`Oeste Sombrio Homologação`, PostgreSQL `17.12.0.000`, `us-east-1`, plano `free`)

---

## 1. Classificação Final

| Critério | Classificação | Resumo objetivo |
|---|---|---|
| **BACKUP** | **VALIDADO** | Novo backup lógico `oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump` verificado localmente (`621.973` bytes, `17/11/2026 22:50:21`, cabeçalho `PGDMP` CUSTOM, `TOC_EXIT=0` com `869` entradas úteis / `876` no arquivo, SHA-256 conferido e permissão NTFS restrita a `DESKTOP-4EFQ4QH\Stéfano:(F)`). Backup anterior (`16/11`) preservado. |
| **RESTAURAÇÃO** | **COMPLETA** | Restauração integral executada sem `--no-owner`/`--no-acl` em contêiner descartável `supabase/postgres:17.11.0.011` (`--network none`, transação única `--exit-on-error --single-transaction`): **`PG_RESTORE_EXIT=0`**, com **100% de paridade** nas contagens de Produção (`6` mesas, `9` membros, `12` fichas, `11` usuários Auth, `16` migrações, `40` funções `public`, `35` políticas RLS, `8` tabelas Realtime, `4` metadados Storage, `0` FKs inválidas). Limitação esperada do escopo lógico: os `4` arquivos físicos em Storage (`2.539.448` bytes) e segredos externos não integram dump PostgreSQL. |
| **MIGRAÇÃO ISOLADA** | **PASS** | `supabase/migrations/20261117151310_xerife_6b_foundation.sql` aplicada sobre o banco restaurado de Produção (`MIG_APPLY_EXIT=0`): criou `xerife_6b.presencas`, `xerife_6b.conjuntos`, `public.mesa_6b_aberto`, `7` funções `SECURITY DEFINER` e `5` wrappers `SECURITY INVOKER` (todos com `search_path=""`), RLS, política `mesa_6b_aberto_leitura`, Realtime exclusivo para `mesa_6b_aberto`, preservando dados e todas as `16` migrações anteriores. |
| **HISTÓRICO** | **RECONCILIÁVEL** | Todas as `16` migrações de Produção preservam `statements[1]` em `supabase_migrations.schema_migrations` (inclusive hash idêntico para `20261116210603`), permitindo recuperação exata sem invenção de SQL. Em Homologação, `20261117151310` já possui 100% dos objetos aplicados no schema e pode ser reconciliada por `migration repair --status applied 20261117151310`. |
| **PRONTIDÃO PARA PRODUÇÃO** | **PENDÊNCIAS** | Backup e ensaio da migração estão aprovados. Restam apenas ações pré-deploy ainda não executadas por restrição desta etapa: (1) disponibilizar canal oficial de execução (`supabase` CLI ou executor autorizado, visto que `apply_migration` via MCP no Antigravity cancela em 0,2 s); (2) espelhar as `16` migrações históricas locais e reconciliar Homologação; (3) autorização explícita para aplicar `20261117151310` em Produção; (4) após validar Produção, atualizar versão para `1.4.5`, gerar/assinar o cliente Tauri e publicar. |

---

## 2. Etapa A — Verificação do Backup Novo (`oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump`)

- **Caminho completo:** `%LOCALAPPDATA%\OesteSombrio\backups\oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump` (`C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump`)
- **Ambiente de origem:** Produção `jxxhdqoyblykqiiyptsp` (`pg_dump` `17.12` contra PostgreSQL `17.11`, via Session Pooler com TLS)
- **Criação / Modificação local:** `17/11/2026 22:49:39` / `17/11/2026 22:50:21 BRT` (`2026-11-18 01:49:39 UTC` no cabeçalho do arquivo)
- **Tamanho confirmado:** `621.973` bytes (corresponde exatamente ao informado)
- **Formato confirmado:** `MAGIC_ASCII=PGDMP` (`Format: CUSTOM`, `Compression: gzip`, `Dump Version: 1.16-0`)
- **SHA-256 verificado:** `5BEB570B6F18C0BB4B4A5F6C989E45177DF4022FEE4593EC434859A749A4A9D7`
- **Leitura de catálogo (`pg_restore --list`):** **`TOC_EXIT=0`**, **876 TOC Entries** (`869` entradas não comentadas), contendo `auth`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `realtime`, `storage`, `supabase_migrations`, `vault`, 10 tabelas `TABLE DATA` em `public`, `supabase_migrations.schema_migrations`, e as publicações `supabase_realtime` / `supabase_realtime_messages_publication`.
- **Permissões NTFS (`icacls`):** `DESKTOP-4EFQ4QH\Stéfano:(F)` exclusivamente (sem herança de `CodexSandboxUsers` nem outros grupos não autorizados).
- **Backup anterior preservado:** `oeste-jxxhdqoyblykqiiyptsp-20261116-174814.dump` (`573.889` bytes, `16/11/2026`) mantido intacto.

---

## 3. Etapa B — Restauração Completa em Contêiner Isolado

Executada em contêiner descartável `supabase/postgres:17.11.0.011` (`PostgreSQL 17.11`), `--network none`, `--tmpfs /var/lib/postgresql/data:rw`, montando somente leitura apenas o arquivo `.dump`, `oeste-jxxhdqoyblykqiiyptsp-20261116-174814.dump.roles-local.sql` (sem senhas) e a migração P0-2.

- **Preparação de ambiente no contêiner:** aplicação de `roles-local.sql` via `supabase_admin` + `ALTER ROLE postgres SUPERUSER;` (necessário porque o event trigger `ensure_rls` executa `public.rls_auto_enable`, de propriedade de `postgres`, e o dump contém objetos de `pgbouncer`, `auth`, `storage` e `realtime`).
- **Comando de restauração:** `pg_restore -U postgres -d restore_test --exit-on-error --single-transaction /tmp/prod.dump` (sem `--no-owner` e sem `--no-acl`).
- **Código de saída do `pg_restore`:** **`PG_RESTORE_EXIT=0`** (sem erros ou avisos bloqueantes).

### Comparação integral com a referência de Produção

| Recurso | Referência Produção | Restaurado do dump (`22:49:38`) | Situação |
|---|---:|---:|---|
| Mesas (`public.mesas`) | `6` | `6` | **MATCH** |
| Membros (`public.membros_mesa`) | `9` | `9` | **MATCH** |
| Fichas (`public.fichas`) | `12` | `12` | **MATCH** |
| Usuários Auth (`auth.users` / `identities`) | `11` | `11` / `11` | **MATCH** |
| Migrações históricas (`schema_migrations`) | `16` | `16` (última `20261116210603:com05_com08_combat_state_and_actions`) | **MATCH** |
| Funções `public` | `40` | `40` | **MATCH** |
| Políticas RLS (`public` + `storage`) | `35` | `35` (`10` tabelas `public` com `relrowsecurity = true`) | **MATCH** |
| Tabelas publicadas em `supabase_realtime` | `8` | `8` | **MATCH** |
| Objetos Storage (metadados) | `4` (`2` buckets) | `4` (`2` buckets) | **MATCH** |
| Triggers não internos (`public` + `auth`) | `16` | `16` | **MATCH** |
| Extensões instaladas | `6` | `pg_net@0.20.4`, `pg_stat_statements@1.11`, `pgcrypto@1.3`, `plpgsql@1.0`, `supabase_vault@0.3.1`, `uuid-ossp@1.1` | **MATCH** |
| Schemas não sistema | `10` | `auth`, `extensions`, `graphql`, `graphql_public`, `net`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault` | **MATCH** |
| Integridade referencial (`convalidated=false` / órfãos) | `0` | `fk_invalid_count=0`, `orphan_membros=0`, `orphan_fichas_user=0` | **MATCH** |

### Cobertura efetiva e limitações documentadas
- **Coberto e restaurável integralmente:** esquemas, tabelas, dados, funções, triggers, RLS, ACLs, owners, extensões, publicações Realtime, usuários/identidades Auth, metadados de Storage e `supabase_migrations.schema_migrations`.
- **Limitações fora do dump PostgreSQL:**
  - Os **4 arquivos binários físicos** nos buckets (`character-portraits`: `1` objeto / `50.016` bytes; `mesa-maps`: `3` objetos / `2.489.432` bytes) não estão contidos no `pg_dump -Fc`.
  - Configurações externas de Auth/SMTP/Dashboard e chaves externas não integram o dump lógico.
  - Em servidor PostgreSQL isolado fora do Supabase Cloud, exige preparação prévia de papéis (`roles-local.sql` + `ALTER ROLE postgres SUPERUSER`).

---

## 4. Etapa C — Ensaio da Migração P0-2 sobre Produção Restaurada

### Verificação pré-migração (em `restore_test`)
- `pre_xerife_schema = null`
- `pre_mesa_6b_aberto = null`
- `pre_wrappers_6b = 0`
- `pre_mig_20261117151310 = 0`

### Aplicação isolada (`psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261117151310_xerife_6b_foundation.sql`)
- **Resultado:** **`MIG_APPLY_EXIT=0`** (`BEGIN` ... `COMMIT` sem erros).
- **Verificações pós-migração em `restore_test`:**
  1. Estruturas criadas: `xerife_6b` (`xerife_6b.presencas`, `xerife_6b.conjuntos`) e `public.mesa_6b_aberto`.
  2. RLS e ACLs:
     - `xerife_6b.conjuntos` e `xerife_6b.presencas`: `rls = true`, `acl = {postgres=arwdDxtm/postgres}` (nenhum acesso direto a `anon`/`authenticated`).
     - `public.mesa_6b_aberto`: `rls = true`, `acl = {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`, policy `mesa_6b_aberto_leitura` (`SELECT` para `authenticated`).
  3. Funções e wrappers:
     - `7` funções em `xerife_6b` (`autorizar`, `composicao`, `consumir`, `ler`, `presenca`, `renovar`, `rolar`): todas `SECURITY DEFINER` (`secdef = true`), `search_path = ""` (`proconfig = ["search_path=\"\""]`); `autorizar`/`composicao` restritas a `{postgres=X/postgres}` e as 5 operações a `{postgres=X/postgres,authenticated=X/postgres}`.
     - `5` wrappers em `public` (`presenca_6b_xerife`, `ler_6b_xerife`, `rolar_6b_xerife`, `consumir_6b_xerife`, `renovar_6b_xerife`): todos `SECURITY INVOKER` (`secdef = false`), `search_path = ""`, `EXECUTE` para `postgres`, `service_role`, `authenticated`.
  4. Realtime: `supabase_realtime` passou a `9` tabelas, incluindo `public.mesa_6b_aberto` e mantendo `xerife_6b.conjuntos` / `xerife_6b.presencas` fora da publicação.
  5. Dados e histórico preservados: `migrations_preserved = 16`, `mesas = 6`, `membros = 9`, `fichas = 12`, `users = 11`, `storage_objects = 4`.

---

## 5. Etapa D — Auditoria de Hashes e Plano de Reconciliação das Migrações

### Comparação de SQLs e SHA-256 em Produção (`schema_migrations.statements[1]`) vs Repositório

Todos os **16 registros** em `supabase_migrations.schema_migrations` da Produção (`jxxhdqoyblykqiiyptsp`) possuem `statements[1]` armazenado integralmente:

| Versão | Nome em Produção | Bytes / SHA-256 em Produção (`schema_migrations`) | Situação local em `supabase/migrations/` | Comparação com `database/*.sql` |
|---|---|---|---|---|
| `20261106000343` | `create_character_portraits_bucket_and_policies` | `1244` / `8c6129d4...e94ba86` | Ausente | Sem arquivo avulso em `database/` |
| `20261108013940` | `create_mesa_maps_bucket_and_mesas_columns` | `2117` / `5143c247...bb8441` | Ausente | Sem arquivo avulso em `database/` |
| `20261108022143` | `create_mesa_tokens_table_and_policies` | `1889` / `cb1fb289...26eae` | Ausente | Sem arquivo avulso em `database/` |
| `20261108025202` | `add_mesa_tables_to_supabase_realtime` | `192` / `c1d4bc5e...e371f83` | Ausente | Sem arquivo avulso em `database/` |
| `20261109160047` | `require_auth_for_event_reads` | `77` / `848c185a...1dfcf47` | Ausente | Sem arquivo avulso em `database/` |
| `20261109171323` | `restrict_membership_events_and_sheet_reads` | `2017` / `a5247073...312c29a` | Ausente | Sem arquivo avulso em `database/` |
| `20261109223117` | `public_scene_visibility_and_event_membership` | `5104` / `41d1a0b4...2ca6036` | Ausente | `scene-visibility.sql` (`5105` bytes, hash diferente `aabd1946...`) |
| `20261110010238` | `token_instance_initiative` | `5555` / `07938c68...0e5c78` | Ausente | `token-initiative.sql` (`5553` bytes, hash diferente `f5e51bb8...`) |
| `20261110105257` | `shared_turn_tracker` | `10628` / `bbfefc51...90d35d` | Ausente | `turn-tracker.sql` (`10661` bytes, hash diferente `ab7d3877...`) |
| `20261110110417` | `turn_tracker_late_fixed_order` | `5043` / `77861506...8386c` | Ausente | `turn-tracker-late-order.sql` (`5041` bytes, hash diferente `56d0b2c9...`) |
| `20261110184126` | `multiple_maps_private_storage` | `17801` / `836b000c...dd3d4a0` | Ausente | `multiple-maps.sql` (`17799` bytes, hash diferente `b944c168...`) |
| `20261111103530` | `multiple_maps_combat_guard` | `645` / `64749474...49279166` | Ausente | `multiple-maps-combat-guard.sql` (`643` bytes, hash diferente `b42d7090...`) |
| `20261111151557` | `gm_tools_inbox_notes_token_status` | `15635` / `35b7820b...d9e76297` | Ausente | `gm-tools.sql` (`15967` bytes, hash diferente `2de2eb74...`) |
| `20261111163758` | `gm_tools_status_metadata_sync` | `1927` / `49a34ee6...d9fe2c1` | Ausente | `gm-tools-status-followup.sql` (`1925` bytes, hash diferente `07241bb1...`) |
| `20261111164149` | `gm_tools_preserve_legacy_inventory` | `1335` / `9ac3f95f...16e2d` | Ausente | `gm-tools-inventory-compat.sql` (`1336` bytes, hash diferente `a6cbe5dc...`) |
| `20261116210603` | `com05_com08_combat_state_and_actions` | `46473` / `3aae98fc...730280ce` | Ausente | `com05-com08-combat-state-and-actions.sql` (**SHA-256 idêntico**) |
| `20261116214200` | *(ausente em Produção; exclusiva Homologação)* | — | Ausente (`database/implantacao-com05-com08/`) | `20261116214200_homologacao_144_mapas_notas.sql` (apenas em `igyupxczhczidfgtjiws`) |
| `20261117151310` | *(pendente em Produção)* | — | **Presente** (`17777` bytes, SHA-256 `BEF172A6...`) | Homologação tem objetos aplicados sem registro em `schema_migrations` |

**Conclusão sobre os hashes históricos:** como os scripts antigos de `database/*.sql` divergem em bytes/whitespace (exceto `20261116210603`), **nunca se deve reconstituir `supabase/migrations/` a partir de `database/*.sql` nem inventar SQLs**. A recuperação deve extrair os 16 arquivos exatamente de `supabase_migrations.schema_migrations.statements` da Produção (via `supabase migration fetch`).

### Plano exato de reconciliação e aplicação futura (NÃO executado)

1. **Recuperar as 16 migrações históricas no repositório local (sem sobrescrever P0-2):**
   - Pré-condição: Supabase CLI instalada (`supabase` ou `npx supabase`) e autenticada; preservar `supabase/migrations/20261117151310_xerife_6b_foundation.sql`.
   - Comandos:
     ```powershell
     Copy-Item supabase/migrations/20261117151310_xerife_6b_foundation.sql $env:TEMP\20261117151310_xerife_6b_foundation.sql
     supabase link --project-ref jxxhdqoyblykqiiyptsp
     supabase migration fetch
     # Verificar que os 16 arquivos 20261106..20261116 conferem com os SHA-256 de Produção e restaurar/conferir 20261117151310_xerife_6b_foundation.sql
     supabase migration list
     ```
2. **Reconciliar histórico da Homologação (`igyupxczhczidfgtjiws`) sem reaplicar DDL:**
   - Pré-condição: objetos `xerife_6b` e `public.mesa_6b_aberto` já confirmados 1:1; aprovação do responsável.
   - Comandos:
     ```powershell
     supabase link --project-ref igyupxczhczidfgtjiws
     supabase migration repair --status applied 20261117151310
     supabase migration list
     ```
   - Observação: manter `20261116214200` documentada como exclusiva de Homologação (não incluir em `supabase/migrations/` para não enviá-la à Produção).
3. **Aplicação oficial da P0-2 em Produção (`jxxhdqoyblykqiiyptsp`) após autorização da Fase B:**
   - Garantir que `supabase migration list` ligado a `jxxhdqoyblykqiiyptsp` mostre as `16` migrações históricas alinhadas (`Local = Remote`) e apenas `20261117151310` pendente (`Local` only).
   - Executar com aprovação explícita:
     ```powershell
     supabase link --project-ref jxxhdqoyblykqiiyptsp
     supabase db push --dry-run
     supabase db push
     ```
   - Caso a aplicação seja feita por SQL autenticado oficial em vez da CLI (nunca via MCP quebrado nem `db reset`), registrar explicitamente a versão `20261117151310` e seu SQL em `supabase_migrations.schema_migrations` na mesma operação auditada.

---

## 6. Confirmação de Segurança e Pendências para 1.4.5

- **Zero alterações remotas:** Produção (`jxxhdqoyblykqiiyptsp`) e Homologação (`igyupxczhczidfgtjiws`) permaneceram estritamente em somente leitura.
- **Zero exposição:** nenhuma senha, string de conexão ou dado pessoal de usuário/ficha foi gravado no repositório ou exibido.
- **Zero publicação/commits:** `HEAD` permanece em `0c996fa`; nenhum build de release ou `git push` foi executado.
- **O que ainda precisa acontecer antes de publicar a versão `1.4.5`:**
  1. Instalar/disponibilizar o canal oficial de aplicação da migração (`supabase` CLI autenticada ou canal administrativo equivalente) e executar o plano de reconciliação (espelhar os 16 arquivos históricos + reparar `20261117151310` em Homologação).
  2. Obter aprovação explícita para a Fase B em Produção e aplicar exclusivamente `20261117151310_xerife_6b_foundation.sql` em `jxxhdqoyblykqiiyptsp`, validando schema, RLS, funções e Realtime + smoke test não destrutivo.
  3. Atualizar versão de `1.4.4` para `1.4.5` em `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` e `src-tauri/tauri.conf.json`, reexecutar os testes locais, compilar/assinar via Minisign (`scripts/build-release.ps1`) e publicar a distribuição oficial Tauri + `git push` autorizados (observando o eventual bloqueio de billing do GitHub Actions).
