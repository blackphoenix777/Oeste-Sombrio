# Oeste Sombrio 2.0 — Pacote 10A: Implantação Controlada COM-09 a COM-12 em Produção

**Classificação Final:** **`IMPLANTAÇÃO APROVADA`**

> [!IMPORTANT]
> **Gate Final — Checkpoint 10B Respeitado:** Somente o banco Supabase de Produção (`jxxhdqoyblykqiiyptsp`) recebeu a migração autorizada COM-09/12. Nenhuma alteração foi feita em arquivos do aplicativo, versão pública `1.4.6`, Git (commits, merge, `git push`, tags), GitHub Releases, `latest.json`, Homologação (`igyupxczhczidfgtjiws`) ou Notion.

---

## 1. Identificação da Execução

| Campo | Valor Comprovado |
| --- | --- |
| **Pacote / Checkpoint** | Pacote 10A — Implantação exclusivamente no banco de Produção |
| **Data e horário UTC** | `2026-11-19T14:53:12Z` (Gate 10A-1) a `2026-11-19T15:00:07Z` (conclusão pós-auditoria) |
| **Branch local** | `feature/com09-com12-reactions` |
| **Commit de referência (`HEAD` / `main` / `origin/main`)** | `f743bbdb694e5400c127551fb546969535e180a9` (versão pública `1.4.6` preservada) |
| **Projeto Supabase confirmado (Produção)** | `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio` — `PostgreSQL 17.11 on x86_64-pc-linux-gnu`) |
| **Arquivo de migração autorizado** | [`supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`](../../supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql) |
| **SHA-256 verificado antes da aplicação** | `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7` |
| **Identificador remoto registrado** | `20261119145851` (`com09_com12_reactions_and_opportunities`) |
| **Homologação (`igyupxczhczidfgtjiws`)** | Não modificada (referência preservada) |

---

## 2. Histórico Antes da Implantação (Gate 10A-1)

Confirmado em consulta somente leitura em `jxxhdqoyblykqiiyptsp` às `2026-11-19T14:53:12Z`:
- **PostgreSQL:** `17.11` (`x86_64-pc-linux-gnu`), operacional.
- **Migrações registradas:** exatamente **`19`** (`20261106000343_create_character_portraits_bucket_and_policies` a `20261118153000_xerife_6b_instance_conflict_pt409`).
- **Verificação de ausência prévia:** `com0912_already_exists = 0` (`gerenciar_reacao_combate` e `calcular_fase_turno_combate` ausentes).
- **Dependências presentes:** `com0508_funcs_count = 6`, `xer06_pt409_funcs_count = 6`, `realtime_tables_count = 10`, `policies_count = 27`.
- **Concorrência / atividade:** `active_other_sessions = 0`, `table_locks = 0`, `active_combats = 0`.
- **Contagens pré-implantação (sem PII):** `11` `auth.users`, `11` `public.usuarios`, `6` `mesas`, `9` `membros_mesa`, `12` `fichas`, `0` `mesa_tokens`, `1` `mesa_combate_sinais`, `0` `mesa_6b_instancia`, `4` `storage.objects`.
- **Nenhuma mudança estrutural ou de dados** desde a auditoria do Pacote 9.3.

---

## 3. Backup Atualizado Pré-Implantação (Gate 10A-2)

Foi produzido um novo backup lógico imediatamente anterior à aplicação em Produção, **preservando todos os backups anteriores** (inclusive `prod-jxxhdqoyblykqiiyptsp-com0912-20261119-144203Z` do Pacote 9.3).

- **Localização protegida (fora do Git, ACL NTFS restrita via `icacls` ao usuário local e `SYSTEM`):**  
  `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\prod-jxxhdqoyblykqiiyptsp-10a-predeploy-20261119-145352Z`
- **Timestamp UTC:** `2026-11-19T14:53:52Z`
- **Método:** `supabase db dump --remote=jxxhdqoyblykqiiyptsp` (somente leitura) + snapshot explícito `affected_functions_pre.sql`.
- **Checksums SHA-256 e verificação de integridade (`GATE_10A2_BACKUP_PASS=true`):**

| Arquivo | Tamanho (bytes) | SHA-256 |
| --- | ---: | --- |
| `roles.sql` | `297` | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `schema.sql` | `204.505` | `48f4833baa489a8b38371ce5096849d419dfd7c17e66f4b63acb292f269b5326` |
| `app_schema.sql` | `203.125` | `071ad56049dedc68ea5fd242918a66023f3778ee39f497be8aa4d9514c1b796e` |
| `app_data.sql` | `132.291` | `34fe997464b1a15023224c00a4a7be6c283daf823871d2f2cd6664c0fa225c71` |
| `migrations_data.sql` | `211.891` | `cc9866bed6b475f5a01313708d5692baf8c13410a8c39a924e16bb0ce0481edc` |
| `affected_functions_pre.sql` | `31.020` | `341098439d2211a212b4ef2d40c62a404885e7bf5f65fe95e2a80618bdeb32fb` |

- **Verificações de legibilidade (`8/8 True`):** confirmada presença de `obter_combate_publico`, `gerenciar_combate`, `gerenciar_acao_combate`, schema `xerife_6b`, `xerife_6b.consumir_instancia`, dados `public.mesas`, `public.fichas` e migração `20261118153000`.
- **Conformidade com o plano de recuperação do Pacote 9.3:** `schema.sql` e `app_schema.sql` possuem SHA-256 idênticos ao backup ensaiado no Pacote 9.3; o procedimento de reversão (`02-rollback-com09-com12.sql` + `affected_functions_pre.sql`) permanece 100% válido.
- **Limitações conhecidas:** o backup lógico não substitui backups físicos/PITR gerenciados pela plataforma Supabase para objetos internos de `auth` e binários de `storage`.

---

## 4. Resultado de Cada Gate do Pacote 10A

| Gate | Descrição | Resultado | Evidência Principal |
| --- | --- | :---: | --- |
| **Gate 10A-1** | Verificação imediatamente anterior | **APROVADO** | `jxxhdqoyblykqiiyptsp`, PG `17.11`, `19` migrações, `0` combates ativos, `0` locks, SHA-256 `dfa14675...` |
| **Gate 10A-2** | Backup lógico atualizado pré-deploy | **APROVADO** | `6` arquivos `.sql` + `SHA256SUMS.txt` + `8/8` checks de legibilidade em diretório NTFS restrito |
| **Gate 10A-3** | Plano de aplicação transacional | **APROVADO** | DDL 100% transacional (`CREATE OR REPLACE FUNCTION`, `REVOKE`, `GRANT`), compatível `1.4.6` |
| **Gate 10A-4** | Aplicação controlada em Produção | **APROVADO** | `apply_migration` → `{"success":true}` (`14:58:41Z..14:58:51Z`), versão `20261119145851` registrada |
| **Gate 10A-5** | Auditoria de segurança pós-deploy | **APROVADO** | `pg_proc` OK, `get_advisors` (`+1` `authenticated_secdef` esperado), `6/6` probes HTTP públicos OK |
| **Gate 10A-6** | Integridade e compatibilidade `1.4.6` | **APROVADO** | `20` migrações, `15` tabelas `RLS=true`, `27` policies, `10` Realtime, `0` alterações em dados reais |

---

## 5. Método Utilizado e Identificador Remoto da Migração (Gate 10A-4)

- **Método:** `supabase_mcp.apply_migration(project_id="jxxhdqoyblykqiiyptsp", name="com09_com12_reactions_and_opportunities", query=<conteúdo exato SHA-256 dfa14675...>)` em transação única oficial, seguido de `NOTIFY pgrst, 'reload schema';`.
- **Proibições cumpridas:** `supabase db push` não foi utilizado; nenhuma outra migração foi aplicada; nenhuma correção manual foi feita em `schema_migrations`.
- **Janela de execução:** `2026-11-19T14:58:41Z` a `2026-11-19T14:58:51Z` (~10 s, resultado `{"success":true}`, zero erros ou timeouts).
- **Identificador remoto efetivamente registrado pela ferramenta:** `20261119145851` (`name: "com09_com12_reactions_and_opportunities"`).  
  *(Observação operacional: o nome do arquivo local é `20261119120000_com09_com12_reactions_and_opportunities.sql`, enquanto o `apply_migration` utilizou o timestamp UTC efetivo da aplicação `20261119145851`; ver Seção 10.)*

---

## 6. Auditoria de Funções, `SECURITY DEFINER` e Privilégios `EXECUTE` (Gate 10A-5)

Inspeção direta do catálogo `pg_proc` em Produção (`2026-11-19T14:59:34Z`):

| Função | Owner | `SECURITY DEFINER` | `search_path` | `PUBLIC` | `anon` | `authenticated` | `EXECUTE` Dinâmico | `PT409` |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `public.gerenciar_reacao_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `true` |
| `public.calcular_fase_turno_combate` | `postgres` | `false` | `""` | `false` | `false` | `false` | `false` | `false` |
| `public.gerenciar_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |
| `public.obter_combate_publico` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |
| `public.gerenciar_acao_combate` | `postgres` | `true` | `""` | `false` | `false` | `true` | `false` | `false` |

- **Comparativo `get_advisors (security)` Antes × Depois em Produção:**
  - `rls_enabled_no_policy`: `3 → 3` (inalterado — `xerife_6b.*` internas)
  - `function_search_path_mutable`: `1 → 1` (inalterado — `handle_new_user` legado)
  - `extension_in_public`: `1 → 1` (inalterado — `pg_net` legado)
  - `anon_security_definer_function_executable`: `5 → 5` (**inalterado — nenhuma função COM-09/12 exposta a `anon`**)
  - `authenticated_security_definer_function_executable`: `19 → 20` (`+1` esperado exclusivamente por `public.gerenciar_reacao_combate`; `calcular_fase_turno_combate` **não** exposto)
  - `auth_leaked_password_protection`: `1 → 1` (inalterado)

---

## 7. Verificações RLS, Realtime e Sondagens Públicas Não Destrutivas

- **RLS:** todas as `15` tabelas em `public` e `xerife_6b` permanecem com `relrowsecurity = true`; exatamente `27` políticas RLS preservadas sem alterações.
- **Publicação `supabase_realtime`:** preservada integralmente com exatamente `10` tabelas (`eventos_mesa`, `fichas`, `itens_entregues_pendentes`, `mesa_6b_aberto`, `mesa_6b_instancia`, `mesa_combate_sinais`, `mesa_mapa_sinais`, `mesa_token_status`, `mesa_tokens`, `mesas`).
- **Sondagens HTTP públicas somente leitura em `https://jxxhdqoyblykqiiyptsp.supabase.co` (chave pública `sb_publishable_*`, zero mutações, `PROD_PUBLIC_PROBES_ALL_PASS=true`):**

| Sondagem | HTTP | SQLSTATE / Resposta | Latência |
| --- | ---: | --- | ---: |
| `GET /auth/v1/health` | `200` | `GoTrue v2.198.0` operacional | `1.236 ms` |
| `GET /rest/v1/mesas?select=id&limit=1` (anônimo) | `200` | `[]` (API ativa, zero vazamento) | `236 ms` |
| `POST /rest/v1/rpc/gerenciar_reacao_combate` (anônimo) | `401` | `42501` (`permission denied for function gerenciar_reacao_combate`) | `189 ms` |
| `POST /rest/v1/rpc/calcular_fase_turno_combate` (anônimo) | `401` | `42501` (`permission denied for function calcular_fase_turno_combate`) | `121 ms` |
| `POST /rest/v1/rpc/obter_combate_publico` (anônimo) | `401` | `42501` (`permission denied for function obter_combate_publico`) | `123 ms` |
| `POST /rest/v1/rpc/ler_6b_instancia` (anônimo) | `401` | `42501` (`permission denied for function ler_6b_instancia`) | `118 ms` |

---

## 8. Comparação Estrutural e de Dados Antes × Depois (Gate 10A-6)

| Indicador em Produção (`jxxhdqoyblykqiiyptsp`) | Antes (`14:53:12Z`) | Depois (`14:59:34Z`) | Situação |
| --- | ---: | ---: | --- |
| `supabase_migrations.schema_migrations` | `19` | `20` | Esperado (`+1` `20261119145851`) |
| Tabelas em `public` + `xerife_6b` (`RLS=true`) | `15` (`true`) | `15` (`true`) | **Intacto** |
| Políticas RLS | `27` | `27` | **Intacto** |
| Tabelas na publicação `supabase_realtime` | `10` | `10` | **Intacto** |
| Funções XER-06 `PT409` (`xerife_6b.*_instancia`) | `6` | `6` | **Intacto** |
| `auth.users` / `public.usuarios` | `11` / `11` | `11` / `11` | **Intacto** |
| `public.mesas` / `membros_mesa` / `fichas` | `6` / `9` / `12` | `6` / `9` / `12` | **Intacto** |
| `mesa_tokens` / `mesa_combate_sinais` / `mesa_6b_instancia` | `0` / `1` / `0` | `0` / `1` / `0` | **Intacto** |
| Combates ativos (`combate_ativo IS NOT NULL`) | `0` | `0` | **Intacto (zero reservas negativas)** |
| `storage.objects` | `4` | `4` | **Intacto** |

---

## 9. Compatibilidade com a Versão Pública `1.4.6`

- **Confirmada intacta:** nenhuma tabela, coluna, constraint, trigger, política RLS, publicação Realtime ou assinatura de RPC utilizada pela `1.4.6` (`obter_combate_publico`, `gerenciar_combate`, `gerenciar_acao_combate`, `*_6b_xerife`, `*_6b_instancia`) foi removida ou quebrada.
- Clientes `1.4.6` continuam operando normalmente contra Produção; os novos campos opcionais (`oportunidades_reacao`/`solicitacoes_reacao`) são ignorados por clientes `1.4.6` e passarão a ser consumidos pelos clientes `1.4.7` após a futura publicação.

---

## 10. Incidentes, Riscos Residuais e Observações Operacionais

- **Erros ou incidentes identificados:** **nenhum** (`0`).
- **Observação operacional importante (para o Checkpoint 10B):** a ferramenta `apply_migration` registrou a migração em Produção sob a versão `20261119145851` (`com09_com12_reactions_and_opportunities`), enquanto o arquivo local na working tree está nomeado `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`. **Não** executar `supabase db push` cegamente no futuro contra Produção sem alinhar o nome do arquivo local ao timestamp remoto (`20261119145851`) durante o Checkpoint 10B (ou manter aplicação sempre por migração individual), evitando que a CLI considere `20261119120000` como pendente.
- **Riscos residuais fora do escopo do banco:** permanecem exclusivamente as pendências da futura release `1.4.7` documentadas no Pacote 9.3 (consolidação seletiva da branch, guarda `v1.4.7` em `.github/workflows/release.yml` e decisão sobre o ensaio de updater Windows `1.4.6 → 1.4.7`).

---

## 11. Estado Final do Banco e Próximo Checkpoint Recomendado

- **Produção (`jxxhdqoyblykqiiyptsp`):** operacional, íntegra e consistente com `20` migrações ativas e COM-09 a COM-12 habilitados no backend.
- **Git / Release `1.4.6`:** intocados (`HEAD = f743bbdb694e5400c127551fb546969535e180a9`, versão `1.4.6` preservada, `0` commits/merges/pushes/tags).
- **Próximo checkpoint recomendado (aguardando autorização explícita):** **Checkpoint 10B — Consolidação da Branch e Preparação do Build `1.4.7`** (alinhamento opcional do nome do arquivo de migração local para `20261119145851_com09_com12_reactions_and_opportunities.sql` ou registro explícito, commits seletivos limpos em `feature/com09-com12-reactions`, guarda `v1.4.7` em `.github/workflows/release.yml`, bump `1.4.7`, build NSIS + assinatura Minisign e validação local).
