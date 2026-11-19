# OESTE SOMBRIO 2.0 — PACOTE 6: IMPLANTAÇÃO DO BANCO EM PRODUÇÃO

**Data:** 18/11/2026  
**Projeto Alvo:** `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio` — Produção, PostgreSQL `17.11`)  
**Branch Local:** `feature/xerife-6b-npc-boss` (base `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, versão pública `1.4.5` preservada)  
**Resultado da Implantação:** **`SUCESSO — 19 MIGRAÇÕES ATIVAS EM PRODUÇÃO`**

---

## 1. Verificações e Pré-condições Executadas Antes do Deploy

1. **Encerramento limpo do ensaio e processos:**
   - Ensaio PG `17.11` (`task-2151`) concluído com `PHASE_E_NODE_EXIT=0`.
   - Zero tarefas de teste pendentes; contêiner residual `pg17-prod-rehearsal-p6` removido antes do backup.
2. **Revalidação do destino e arquivos locais:**
   - `jxxhdqoyblykqiiyptsp` confirmado com `17` migrações (`20261106000343` a `20261117151310`), dados pré-deploy `11` usuários (`auth.users`/`public.usuarios`), `6` `mesas`, `9` `membros_mesa`, `12` `fichas`, `0` `mesa_tokens`, `0` `mesa_token_status`, `0` `mesa_6b_aberto`.
   - `19` arquivos em `supabase/migrations/`, com SHA-256 confirmados para as 2 pendentes:
     - `20261118101800_xerife_6b_instance_combat.sql`: `7A8D54C0E28A2F9D40FEAD1B1C9063070904FC59D2A64DC5C6913AC2F8CB3A0B`
     - `20261118153000_xerife_6b_instance_conflict_pt409.sql`: `CE5453EEA576D0D466FFCA3AAB38714FAE1806681300CE41C18B26D142671F03`
3. **Novo backup lógico pré-deploy de Produção (fora do Git):**
   - Diretório: `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\prod-jxxhdqoyblykqiiyptsp-20261118-2218`
   - ACL NTFS restrita via `icacls /inheritance:r /grant:r` (`USERNAME:(OI)(CI)F` e `NT AUTHORITY\SYSTEM:(OI)(CI)F`).
   - Artefatos gerados:
     - `roles.sql` (`297` bytes, `ROLES_EXIT=0`, SHA-256 `25873CEC56A2CC6514E204F420231777F85C03DA818CAA7090CDCDFA89776ECD`)
     - `schema.sql` (`146.034` bytes, `SCHEMA_EXIT=0`, SHA-256 `79E68EEED8065E95401AA618DE449ECDF47162909518AEABB4EC292E9DAFDF57`)
     - `data.sql` (`164.676` bytes, `DATA_EXIT=0`, SHA-256 `D770FCBC367F525FCBCE5D34E8827078FB41F2CAAE61FF4707AC024D7AE20749`)
     - `migrations_data.sql` (`140.585` bytes, `MIG_DATA_EXIT=0`, SHA-256 `7483705A4F486785A830B41F4246AAA9A76CFF607712949DF6318B9649DA77CD`)
     - `app_schema.sql` (`145.440` bytes, `APP_SCHEMA_EXIT=0`, SHA-256 `705C4F075446EEE29D2D45913D51486CF705ACDD3AD5DB543C364C4E9A285893`)
     - `app_data.sql` (`271.664` bytes, `APP_DATA_EXIT=0`, SHA-256 `BF1C14B1D595E1A4B513EA3C02084869BF5F1E56DE898498FDB38BA13DDA67CD`)
4. **Prova de restauração isolada em `supabase/postgres:17.11.0.011` (`--network none`):**
   - `ROLES_RESTORE_EXIT=0`, `APP_SCHEMA_RESTORE_EXIT=0`, `APP_DATA_RESTORE_EXIT=0`, `VERIFY_BKP_EXIT=0`.
   - `RESTORED_COUNTS=11|6|9|12|0|0|0|17|20261117151310` (`usuarios|mesas|membros_mesa|fichas|mesa_tokens|mesa_token_status|mesa_6b_aberto|schema_migrations|max_version`).

---

## 2. Aplicação Controlada em Produção (`jxxhdqoyblykqiiyptsp`)

- `migration list --remote=jxxhdqoyblykqiiyptsp`: `MIG_LIST_EXIT=0`, listando exatamente `20261118101800` e `20261118153000` pendentes após `20261117151310`.
- Comando executado na raiz do repositório:
  ```powershell
  & $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault --yes
  ```
- Resultado: **`PROD_DB_PUSH_EXIT=0`**, aplicando exatamente:
  1. `20261118101800_xerife_6b_instance_combat.sql`
  2. `20261118153000_xerife_6b_instance_conflict_pt409.sql`

---

## 3. Verificações Pós-Aplicação em Produção (`jxxhdqoyblykqiiyptsp`)

1. **Histórico (`supabase_migrations.schema_migrations`):** exatamente **`19`** versões (`20261106000343` a `20261118153000_xerife_6b_instance_conflict_pt409`).
2. **Tabelas, RLS e Grants:**
   - `public.mesa_6b_instancia`: `rls_enabled = true`, `1` policy (`mesa_6b_instancia_leitura`), grants `authenticated:SELECT`, `postgres` e `service_role` (zero grants para `anon` ou `PUBLIC`).
   - `xerife_6b.instancia_operacoes`: `rls_enabled = true`, `0` policies, acesso restrito exclusivamente a `postgres`.
3. **Trigger:** `trg_mesa_tokens_sync_6b_instancia` criada em `public.mesa_tokens` (`AFTER INSERT OR UPDATE OF mapa_id, owner_ref, owner_type`).
4. **Funções e Wrappers (`pg_proc`):**
   - **6 funções mutáveis `PT409` (`xerife_6b.*_instancia`):** `rolar_instancia`, `consumir_instancia`, `aplicar_dano_instancia`, `curar_dano_instancia`, `ajustar_fadiga_instancia`, `renovar_instancia` — todas `SECURITY DEFINER`, `search_path=""`, `acl = {postgres=X/postgres,authenticated=X/postgres}` (`auth_exec=true`, `anon_exec=false`), `has_pt409 = true` e `has_40001 = false`.
   - **Demais funções/helpers em `xerife_6b`:** `ler_instancia`, `inicializar_instancia`, `remover_instancia` (`SECURITY DEFINER`, `search_path=""`, `auth_exec=true`, `anon_exec=false`) e auxiliares internos (`autorizar_instancia`, `aplicar_fadiga_cascata`, `recalcular_derivados_instancia`, `registrar_operacao_instancia`, `serializar_instancia`, `sincronizar_token_status_instancia`, `sincronizar_vinculo_token_instancia`) com `search_path=""` e `auth_exec=false`, `anon_exec=false`.
   - **9 wrappers `public.*_6b_instancia`:** todos `SECURITY INVOKER` (`sec_def=false`), `search_path=""`, `auth_exec=true`, `anon_exec=false`.
   - **Fundação P0-2 (`*_6b_xerife`):** integralmente preservada sem alterações.
5. **Publicação Realtime (`supabase_realtime`):** exatamente **`10`** tabelas (`eventos_mesa`, `fichas`, `itens_entregues_pendentes`, `mesa_6b_aberto`, `mesa_6b_instancia`, `mesa_combate_sinais`, `mesa_mapa_sinais`, `mesa_token_status`, `mesa_tokens`, `mesas`). Tabela privada `xerife_6b.instancia_operacoes` ausente da publicação.
6. **Preservação de Dados e Integridade:** `11` `auth.users`, `11` `public.usuarios`, `6` `mesas`, `9` `membros_mesa`, `12` `fichas`, `0` `mesa_tokens`, `0` `mesa_token_status`, `0` `mesa_6b_aberto`, `0` `mesa_6b_instancia`, `0` `xerife_6b.instancia_operacoes`, `4` `storage.objects`, `invalid_fk_cnt = 0`.
7. **Segurança e Compatibilidade 1.4.5 (HTTP PostgREST + `get_advisors`):**
   - Probe anônimo com `sb_publishable_*`: `GET /rest/v1/mesa_6b_instancia` → `401` (`42501`); `POST /rest/v1/rpc/ler_6b_instancia` → `401` (`42501`); `POST /rest/v1/rpc/consumir_6b_instancia` → `401` (`42501`); `POST /rest/v1/rpc/ler_6b_xerife` → `401` (`42501`); `GET /rest/v1/mesas?select=id&limit=1` → `200 []`.
   - `get_advisors (security)`: `0` erros críticos; os 3 novos apontamentos `INFO` (`rls_enabled_no_policy`) referem-se às tabelas internas privadas `xerife_6b.conjuntos`, `xerife_6b.presencas` e `xerife_6b.instancia_operacoes` (intencional).

---

## 4. Pendências Fora do Escopo desta Autorização

1. **Cliente Tauri (`v1.4.5`):** publicação de nova versão do aplicativo, merge em `main`, commit, tag, build e `git push` permanecem pendentes de pacote e autorização específicos (Produção `1.4.5` segue compatível e operacional).
2. **Dados QA em Homologação (`igyupxczhczidfgtjiws`):** Homologação não foi tocada nesta etapa conforme restrição.
