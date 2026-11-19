# OESTE SOMBRIO 2.0 — PACOTE 6: PREPARAÇÃO DE IMPLANTAÇÃO XER-04/05/06 EM PRODUÇÃO

**Data:** 18/11/2026  
**Ambiente Alvo:** Produção (`jxxhdqoyblykqiiyptsp` — `Oeste Sombrio`, PostgreSQL `17.11` / `17.11.0.011`, `us-east-1`)  
**Ambiente Homologado:** Homologação (`igyupxczhczidfgtjiws` — PostgreSQL `17.12.0.000`, `4` migrações aplicadas, `XER-06 APROVADO PARA PRODUÇÃO`)  
**Branch Local:** `feature/xerife-6b-npc-boss` (base `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, release pública `v1.4.5` / `1.4.5` preservada)  
**Classificação Final:** **`PRONTO PARA AUTORIZAÇÃO`**

> [!IMPORTANT]
> Nenhuma operação de escrita remota foi executada em **Produção (`jxxhdqoyblykqiiyptsp`)** nem em **Homologação (`igyupxczhczidfgtjiws`)** nesta etapa.

---

## 1. Fase A — Auditoria e Estado Local (Git, Frontend e Migrações)

### 1.1 Estado Git e Versionamento
- **Branch atual:** `feature/xerife-6b-npc-boss`
- **Commit `HEAD` / `main` / `v1.4.5^{commit}` / `merge-base`:** `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab` (`v1.4.5` tag object `0a2de19c3e03a02f532553336027bd8641e98d58`).
- **Versão pública declarada:** [`package.json`](../../package.json) = `1.4.5` e [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) = `1.4.5` (sem alteração de versão, sem commits, sem merge em `main`, sem tags e sem `git push`).
- **Arquivos modificados/novos no working tree (XER-04/05/06 + Pacote 5.1):**
  - Frontend (`M`): `dist/index.html`, `dist/style.css`, `dist/js/cylinder.js`, `dist/js/magiasUI.js`, `dist/js/mesaScreen.js`, `dist/js/mesaXerife6B.js`, `dist/js/modal.js`, `dist/js/storage.js`, `dist/js/rules/cylinderRules.js`, `dist/js/rules/index.js`; novo (`??`): `dist/js/rules/own6BRules.js`.
  - Migrações pendentes (`??`): `supabase/migrations/20261118101800_xerife_6b_instance_combat.sql`, `supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql`.
  - Testes disponíveis (`??`): `tests/xerife-6b-xer04-own-editor.cjs`, `tests/xerife-6b-xer05-instance-persistence.cjs`, `tests/xerife-6b-xer06-instance-combat.cjs`, `tests/xerife-6b-pg17-sql-rls.cjs`, `tests/xerife-6b-pg17-conflict-pt409.cjs`, `tests/live-xerife-6b-instances.cjs`, `tests/live-xerife-6b-pt409-homolog.cjs`.
  - Documentação técnica (`database/xerife-6b-xer04-contratos-xer05-xer06.md`, `database/xerife-6b-xer05-xer06/*`) e históricos de implantação anteriores.
  - Estado temporário do CLI: `supabase/.temp/linked-project.json` aponta para `jxxhdqoyblykqiiyptsp`, `cli-latest` = `v3.2.0` (não utilizado implicitamente).

### 1.2 Segurança e Integridade do Frontend
- [`dist/js/supabaseConfig.js`](../../dist/js/supabaseConfig.js) intocado: aponta exclusivamente para `https://jxxhdqoyblykqiiyptsp.supabase.co` com chave pública `sb_publishable_DfYQXnw7eoSg4RX5dYLw-g_9IUISoNu`.
- Varredura em `dist/js/*.js` e `dist/js/rules/*.js`: zero `service_role`, zero `postgres://`, zero senhas, zero referência à URL de Homologação (`igyupxczhczidfgtjiws`).
- Tratamento `PT409` / HTTP `409` / HTTP `504` em [`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js) validado com `NODE_SYNTAX_EXIT=0` e `32/32 PASS` em [`tests/xerife-6b-xer06-instance-combat.cjs`](../../tests/xerife-6b-xer06-instance-combat.cjs).

### 1.3 Integridade das 19 Migrações Locais (`supabase/migrations/`)

| # | Arquivo | Bytes | SHA-256 | Situação em Produção |
|---:|---|---:|---|---|
| 1 | `20261106000343_create_character_portraits_bucket_and_policies.sql` | `1.244` | `8C6129D42C9EC88BBDBFFC2C9F9FAA24105E2D1C62FEC01D33D0DBB85E94BA86` | Aplicada |
| 2 | `20261108013940_create_mesa_maps_bucket_and_mesas_columns.sql` | `2.117` | `5143C247912B4313985D6227A97C27ABDCB5ED294190EEBBBAD26C7B26BB8441` | Aplicada |
| 3 | `20261108022143_create_mesa_tokens_table_and_policies.sql` | `1.889` | `CB1FB28901AF395089DD32022DE6376F474BA8E1C88D1AB01C28E5D142E26EAE` | Aplicada |
| 4 | `20261108025202_add_mesa_tables_to_supabase_realtime.sql` | `192` | `C1D4BC5EA892A861DB6ADE8F8205A3425DC84F1FE5F8B7ADB9C04F52AE371F83` | Aplicada |
| 5 | `20261109160047_require_auth_for_event_reads.sql` | `77` | `848C185AC0431CE270A604FF546846E63773A3809353DB33B8BEC87501DFCF47` | Aplicada |
| 6 | `20261109171323_restrict_membership_events_and_sheet_reads.sql` | `2.017` | `A524707311ADE5AD4DF93E09AE16CD18716B2C29A3E485C3367C3EB1F56312C2` | Aplicada |
| 7 | `20261109223117_public_scene_visibility_and_event_membership.sql` | `5.104` | `41D1A0B4386CEE8D99D1C5D8C4FECE1299E185314D25869ECFB1F5BC72CA6036` | Aplicada |
| 8 | `20261110010238_token_instance_initiative.sql` | `5.555` | `07938C6873B009CA769DB2781E9CC3185CFD04D13BDBF9AA666B70A6580E5C78` | Aplicada |
| 9 | `20261110105257_shared_turn_tracker.sql` | `10.628` | `BBFEFC510633108D3C165623FA0A52CA5276CCBBEC3AF431191DD9C59A90D35D` | Aplicada |
| 10 | `20261110110417_turn_tracker_late_fixed_order.sql` | `5.043` | `778615066CBD161672B8ABB848FB09CAA640A933A175C467784547B38D38386C` | Aplicada |
| 11 | `20261110184126_multiple_maps_private_storage.sql` | `17.801` | `836B000CE5CA5D8B8B498B72DFDD176556F0D95EE512F38038A6AAB9BDD3D4A0` | Aplicada |
| 12 | `20261111103530_multiple_maps_combat_guard.sql` | `645` | `64749474A9D8C7139246172E45A8BF6B929B912428773085D7AE44FA49279166` | Aplicada |
| 13 | `20261111151557_gm_tools_inbox_notes_token_status.sql` | `15.635` | `35B7820BD11E02983CD857AEB8E184E05DB1DE9244FA3E04904DCDC9D9E76297` | Aplicada |
| 14 | `20261111163758_gm_tools_status_metadata_sync.sql` | `1.927` | `49A34EE6668335D210CCA1DCB6B176A1976287874D500582C1DC90E71D9FE2C1` | Aplicada |
| 15 | `20261111164149_gm_tools_preserve_legacy_inventory.sql` | `1.335` | `9AC3F95F358EEEAF576F9B1D5DBEF23FC5034BE3A4B3922BBCA1BCFDD0D16E2D` | Aplicada |
| 16 | `20261116210603_com05_com08_combat_state_and_actions.sql` | `46.473` | `3AAE98FC5DFE7CA466F55281D5FB7958FF3BEEC6B21A1CB688C389FC730280CE` | Aplicada |
| 17 | `20261117151310_xerife_6b_foundation.sql` | `17.777` | `BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09` | Aplicada (P0-2) |
| **18** | **`20261118101800_xerife_6b_instance_combat.sql`** | **`47.968`** | **`7A8D54C0E28A2F9D40FEAD1B1C9063070904FC59D2A64DC5C6913AC2F8CB3A0B`** | **Pendente (1ª)** |
| **19** | **`20261118153000_xerife_6b_instance_conflict_pt409.sql`** | **`21.387`** | **`CE5453EEA576D0D466FFCA3AAB38714FAE1806681300CE41C18B26D142671F03`** | **Pendente (2ª)** |

As 2 migrações candidatas coincidem byte-for-byte com os SQLs homologados em `igyupxczhczidfgtjiws` (comparação determinística de versões: `19` arquivos locais vs `17` versões registradas em Produção = exatamente `20261118101800` e `20261118153000` pendentes em ordem).

---

## 2. Fase B — Auditoria Read-Only de Produção (`jxxhdqoyblykqiiyptsp`) vs. Homologação

- **Identidade e Engine:** Projeto `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio`, `us-east-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.11` / `17.11.0.011`).
- **Histórico de migrações:** `17` versões exatas (`20261106000343` a `20261117151310_xerife_6b_foundation`), com ausência confirmada de `20261118101800` e `20261118153000`.
- **Objetos conflitantes:** `0` (`conflicting_tables = 0`, `conflicting_triggers = 0`, `conflicting_procs = 0`).
- **Extensões e integridade:** `pg_net@0.20.4`, `pg_stat_statements@1.11`, `pgcrypto@1.3`, `plpgsql@1.0`, `supabase_vault@0.3.1`, `uuid-ossp@1.1`; `invalid_constraints = 0` em `public` e `xerife_6b`.
- **Fundação P0-2 (`xerife_6b` e `public.mesa_6b_aberto`):** presente e intacta (`7` funções em `xerife_6b` com `prosecdef=true`, `search_path=""`; `5` wrappers `public.*_6b_xerife`; `mesa_6b_aberto` com RLS ativo, policy `mesa_6b_aberto_leitura`, apenas `SELECT` para `authenticated`; `xerife_6b.conjuntos`/`presencas` acessíveis somente a `postgres`).
- **`public.is_mestre_da_mesa(p_mesa_id uuid)`:** presente (`SECURITY DEFINER`, `search_path=""`).
- **Publicação `supabase_realtime` (`9` tabelas atualmente em Produção):** `eventos_mesa`, `fichas`, `itens_entregues_pendentes`, `mesa_6b_aberto`, `mesa_combate_sinais`, `mesa_mapa_sinais`, `mesa_token_status`, `mesa_tokens`, `mesas`.
- **Paridade Estrutural Produção × Homologação:** **100% idêntica** nas `6` tabelas dependentes (`fichas`, `membros_mesa`, `mesa_6b_aberto`, `mesa_token_status`, `mesa_tokens`, `mesas`) quanto a nomes/tipos/nullability de todas as colunas, PKs, FKs, constraints `CHECK`/`UNIQUE`, habilitação de RLS e contagem de policies (`4, 3, 1, 2, 4, 4`).
- **Triggers atuais verificadas em Produção (`15` triggers não internas nas tabelas-alvo):** `validar_mapa_token`, `proteger_campos_token`, `status_token_fonte`, `combate_token_sinal`, `mapa_token_sinal`, `inicializar_iniciativa_jogador_token` em `mesa_tokens`; triggers correspondentes em `fichas` e `mesas` (sem colisão com `trg_mesa_tokens_sync_6b_instancia`).
- **Contagem atual de dados preexistentes em Produção (`18/11/2026`):** `11` `auth.users`, `11` `public.usuarios`, `6` `public.mesas`, `9` `public.membros_mesa`, `12` `public.fichas`, `0` `public.mesa_tokens`, `0` `public.mesa_token_status`, `0` `public.mesa_6b_aberto`, `4` `storage.objects`.

---

## 3. Fase C — Auditoria de Backups e Estratégia Pré-Deploy

### 3.1 Backups Existentes Verificados
1. **PostgreSQL:** `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump`
   - Tamanho: `621.973` bytes (`17/11/2026 22:50:21`), cabeçalho `PGDMP` CUSTOM (`1.16-0`, gzip), `SHA-256`: `5BEB570B6F18C0BB4B4A5F6C989E45177DF4022FEE4593EC434859A749A4A9D7`, `876` entradas TOC (`LIST_EXIT=0`).
   - **Desatualização parcial esperada:** foi gerado antes da aplicação de `20261117151310_xerife_6b_foundation` (`16` migrações registradas vs `17` atuais em Produção).
   - **Observação de ACL:** o diretório pai `%LOCALAPPDATA%\OesteSombrio\backups` apresenta `(I)(OI)(CI)(RX)` herdado para `CodexSandboxUsers`; portanto, o novo diretório de backup pré-deploy deverá receber explicitamente `icacls ... /inheritance:r`.
   - Backups antigos preservados sem remoção.
2. **Storage (`%LOCALAPPDATA%\OesteSombrioBackups\storage-20261117-231655`):**
   - Contém [`manifest.json`](file:///C:/Users/St%C3%A9fano/AppData/Local/OesteSombrioBackups/storage-20261117-231655/manifest.json) + `4` objetos físicos (`character-portraits`: `50.016` bytes; `mesa-maps`: `134.378` + `49.298` + `2.305.756` bytes), com ACL restrita exclusivamente a `DESKTOP-4EFQ4QH\Stéfano:(OI)(CI)(F)`.
   - Comparado contra `storage.objects` ao vivo em `jxxhdqoyblykqiiyptsp`: **os 4 `id`, `bucket_id`, `name`, `size`, `eTag` e `updated_at` (`2026-11-08` e `2026-11-14`) estão 100% inalterados** desde `2026-11-17 23:16:55`. Não há necessidade de novo download de Storage antes do deploy do banco.

### 3.2 Exigência Pré-Deploy (Após Autorização)
Antes de aplicar as migrações em `jxxhdqoyblykqiiyptsp`:
1. Gerar novo backup lógico isolado em `%LOCALAPPDATA%\OesteSombrio\backups\prod-jxxhdqoyblykqiiyptsp-<timestamp>` (com `icacls /inheritance:r` restrito ao usuário e `SYSTEM`) usando `$sb db dump --remote=jxxhdqoyblykqiiyptsp` (`roles.sql`, `schema.sql`, `data.sql`, `migrations_data.sql`, `app_schema.sql`, `app_data.sql` e/ou `pg_dump -Fc` se `PGHOST`/pooler disponível).
2. Validar SHA-256, testar restauração em contêiner PostgreSQL `17.11` isolado (`--network none`), confirmar `17` migrações e contagens idênticas (`11|6|9|12|0|0`) antes de prosseguir para o `db push`.

---

## 4. Fase D — Auditoria de Segurança, Persistência, Concorrência e Compatibilidade

- **D1 — Persistência:** PK composta `(mesa_id, instance_id)` em `public.mesa_6b_instancia`; `token_id uuid NULL REFERENCES public.mesa_tokens(id) ON DELETE SET NULL`; índice de unicidade parcial/lookup preserva múltiplos Bosses independentes do mesmo molde (`#1`, `#2`); trigger `trg_mesa_tokens_sync_6b_instancia` acompanha troca de `mapa_id`; `remover_6b_instancia` remove apenas a instância alvo; `aplicar_dano_instancia` e `curar_dano_instancia` sincronizam `mesa_token_status` (`six_b_total`, `danos_bloqueados`).
- **D2 — Segurança:** RLS ativo em `public.mesa_6b_instancia` (apenas `SELECT` para `authenticated`, policy `mesa_6b_instancia_leitura` exigindo `is_mestre_da_mesa(mesa_id)` ou membro vinculado em `mesa_tokens.owner_user_id`) e em `xerife_6b.instancia_operacoes` (`0` grants para `PUBLIC`/`anon`/`authenticated`, fora do Realtime). Todas as funções em `xerife_6b` são `SECURITY DEFINER` com `SET search_path = ''`; wrappers `public.*_6b_instancia` são `SECURITY INVOKER` com `SET search_path = ''`, `EXECUTE` revogado de `PUBLIC`/`anon` e concedido apenas a `authenticated`/`postgres`/`service_role`.
- **D3 — Concorrência:** Transação atômica com `SELECT ... FOR UPDATE`, verificação otimista de `versao` emitindo **`SQLSTATE PT409`** (HTTP `409 Conflict` sem loop de retry no PostgREST), idempotência via `(mesa_id, instance_id, op_id)` em `xerife_6b.instancia_operacoes` com poda automática (`> 24h` ou limite de `64` registros recentes por instância). No frontend (`dist/js/mesaScreen.js`), conflito `PT409`/`409` e timeout `504` disparam `OS.refreshInstanceOwn6B` sem retry automático de mutação.
- **D4 — Compatibilidade:** Não altera nenhuma tabela/função da fundação P0-2 (`xerife_6b.conjuntos`, `xerife_6b.presencas`, `public.mesa_6b_aberto`, `*_6b_xerife`), não altera iniciativa nem orçamento de ações, não modifica linhas existentes de `fichas` ou `mesas`, e **não requer deploy simultâneo do frontend** (clientes públicos em `1.4.5` continuam operando normalmente enquanto não chamam as novas RPCs `*_6b_instancia`).

---

## 5. Fase E — Ensaio Isolado em PostgreSQL 17.11 sobre Backup de Produção

Executado em contêiner descartável `supabase/postgres:17.11.0.011` (`--network none`, `--tmpfs /var/lib/postgresql/data:rw`) restaurando `oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump` e aplicando em sequência `20261117151310` → `20261118101800` → `20261118153000`:

- `PG_RESTORE_EXIT=0` (`PRE_COUNTS=11|6|9|12|0|0|16`).
- `APPLY_P02_EXIT=0`, **`APPLY_M1_EXIT=0`**, **`APPLY_M2_EXIT=0`**.
- **Verificação pós-aplicação (`postVerify`):**
  - `post_counts = 11|6|9|12|0|0` (100% preservados).
  - `rls_inst = t`, `rls_ops = t`, `auth_sel_inst = t`, `auth_ins_inst = f`, `anon_sel_inst = f`.
  - `trg_cnt = 1` (`trg_mesa_tokens_sync_6b_instancia`), `rt_inst_cnt = 1`, `rt_priv_cnt = 0`.
  - `invalid_fk_cnt = 0`, `pt409_fn_cnt = 6` (`SECURITY DEFINER`, `search_path=""`, `PT409` presente e `40001` ausente), `pub_wrap_cnt = 9` (`SECURITY INVOKER`, `search_path=""`, `auth=true`, `anon=false`).
- **Smoke SQL transacional sobre dados reais restaurados (`REHEARSAL_SMOKE_EXIT=0`):** inicialização + rolagem como Mestre real da mesa, consumo com versão obsoleta retornando **`SQLSTATE PT409`**, e tentativa sem acesso bloqueada com **`SQLSTATE 42501`**.

---

## 6. Fase F — Plano Oficial de Implantação em Produção

1. **Comando exato autorizado (somente após aprovação do gate e do novo backup):**
   ```powershell
   $sb = 'C:\Users\Stéfano\AppData\Local\npm-cache\_npx\a0b0486f7f118473\node_modules\@supabase\cli-windows-x64\bin\supabase.exe'
   & $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes
   ```
   *(Observação do Pacote 6: em razão de `& $sb db push --dry-run` executar `"Initialising login role..."` com escrita administrativa de role temporária no remoto via `database_write`, o `--dry-run` **não foi executado** em Produção na Fase F; a lista exata foi auditada por comparação determinística de versões.)*
2. **Diretório de execução:** raiz do repositório (`c:\Users\Stéfano\Desktop\ficha dark westy`), onde `supabase/migrations/` contém as `17` migrações já registradas em Produção seguidas exatamente das `2` pendentes.
3. **Identidade do destino:** explicitamente `--remote=jxxhdqoyblykqiiyptsp` (sem depender de `supabase/.temp/linked-project.json`).
4. **Lista exata e ordem de aplicação:**
   1. `20261118101800_xerife_6b_instance_combat.sql` (`SHA-256` `7A8D54C0...CB3A0B`)
   2. `20261118153000_xerife_6b_instance_conflict_pt409.sql` (`SHA-256` `CE5453EE...42671F03`)
5. **Estratégia de backup:** criar novo backup lógico de Produção em diretório NTFS privado com `icacls /inheritance:r` e validá-lo em PG `17.11` antes de executar `db push`.
6. **Verificação antes e depois:**
   - **Antes:** `17` migrações (`20261106000343`..`20261117151310`), zero objetos `*_6b_instancia`, contagem `11|11|6|9|12|0|0|0`.
   - **Depois:** exatamente `19` migrações (`17` + `20261118101800` + `20261118153000`), tabelas `mesa_6b_instancia` e `xerife_6b.instancia_operacoes`, trigger `trg_mesa_tokens_sync_6b_instancia`, `6` funções `PT409` (`SECURITY DEFINER`, `search_path=""`), `9` wrappers `public.*_6b_instancia`, `10` tabelas em `supabase_realtime`, contagens `11|11|6|9|12|0|0|0` preservadas, além de smoke read-only/controle controlado sem deixar resíduos em dados de jogadores.
7. **Procedimento diante de falha parcial:** se `20261118101800` falhar (`BEGIN; ... COMMIT;`), o PostgreSQL faz rollback automático da transação; se `20261118101800` concluir e `20261118153000` falhar, interromper imediatamente (não rodar `migration repair` automaticamente), inspecionar `schema_migrations` e decidir entre corrigir e reaplicar apenas `20261118153000` ou executar o script reversível `02-rollback-migracao-xer05-xer06.sql` somente mediante autorização explícita.
8. **Riscos de compatibilidade:** baixos — clientes `1.4.5` em operação não consomem os novos objetos até o pacote futuro de release Tauri; `PT409` já foi validado ponta-a-ponta em Homologação.
9. **Critérios para interromper a implantação:** falha ou divergência na geração/restauração do novo backup; histórico em `jxxhdqoyblykqiiyptsp` diferente de `17` versões; alteração de hash nas migrações; qualquer tentativa do CLI de aplicar migração extra diferente de `20261118101800` e `20261118153000`; ou erro SQL / alteração inesperada em `P0-2` ou dados existentes.

---

## 7. Gate Obrigatório de Produção

**Estado:** **`PRONTO PARA AUTORIZAÇÃO`** — aguardando autorização específica identificando explicitamente `jxxhdqoyblykqiiyptsp` e as versões `20261118101800` e `20261118153000` para:
1. Gerar e validar o novo backup lógico pré-deploy de Produção (`jxxhdqoyblykqiiyptsp`).
2. Aplicar exclusivamente `20261118101800_xerife_6b_instance_combat.sql` e `20261118153000_xerife_6b_instance_conflict_pt409.sql` via `& $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes`.
3. Executar as validações estruturais e de segurança pós-deploy em Produção.
