# Oeste Sombrio 2.0 — Pacote 9.3: Preparação de Produção e Release `1.4.7` (COM-09 a COM-12)

**Data e Horário UTC:** `2026-11-19T14:46:41Z`  
**Classificação Final:** **`APROVADO COM RESSALVAS`**  
**Modalidade:** Preparação exclusivamente (auditoria, backup somente leitura, ensaio isolado PG 17 e planos operacionais).

> [!IMPORTANT]
> **Gate Final Obrigatório Respeitado:** Nenhuma escrita SQL, migração, commit, merge, push, tag, alteração de versão pública (`1.4.6`), alteração de `latest.json`, publicação de release ou modificação no Notion foi executada. Produção (`jxxhdqoyblykqiiyptsp`) e a release pública `v1.4.6` permanecem 100% preservadas.

---

## 1. Estado Inicial e Final do Git

- **Branch ativa:** `feature/com09-com12-reactions`
- **Remote:** `origin` → `https://github.com/blackphoenix777/Oeste-Sombrio.git`
- **`HEAD` = `main` = `origin/main`:** `f743bbdb694e5400c127551fb546969535e180a9` (`Merge branch 'feature/xerife-6b-npc-boss' into main (v1.4.6)`)
- **Situação de versionamento:** toda a implementação COM-09 a COM-12 encontra-se **na working tree sem commits próprios** sobre `f743bbdb694e5400c127551fb546969535e180a9`. A branch **não** está pronta para merge direto sem etapa prévia de commits seletivos e revisão do diff.
- **Alteração produzida por este Pacote 9.3 no repositório:** exclusivamente a criação deste relatório ([`05-preparacao-producao-release-147.md`](05-preparacao-producao-release-147.md)). Nenhum arquivo rastreado foi alterado.

---

## 2. Inventário Exato de Alterações Candidatas à Versão `1.4.7`

Para garantir uma release reproduzível e livre de arquivos estranhos, os arquivos elegíveis ao stage seletivo da futura versão `1.4.7` foram separados rigorosamente:

### 2.1 Produto (Frontend — `6` arquivos)
- **Modificados (`5`):**
  - [`dist/index.html`](../../dist/index.html) (`+1` linha: contêiner `#mesa-tracker-action-bar`)
  - [`dist/style.css`](../../dist/style.css) (`+38` linhas: estilos da barra contextual COM-12)
  - [`dist/js/rules/index.js`](../../dist/js/rules/index.js) (`+1` linha: reexportação de `reactionRules.js`)
  - [`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js) (`+38/-1` linhas: exports de `reactionRules.js` e `OS.syncContextualActionBarSelection` em `selectMesaMapToken` — **zero alterações em código de Xerife 6B**)
  - [`dist/js/turnTracker.js`](../../dist/js/turnTracker.js) (`+1102/-10` linhas: correção de hidratação `turnEnded`, reconciliação `oportunidades_reacao`/`solicitacoes_reacao`, `executeReactionControllerMutation`, barra `#mesa-tracker-action-bar`)
- **Novo (`1`, ainda não rastreado):**
  - [`dist/js/rules/reactionRules.js`](../../dist/js/rules/reactionRules.js) (motor puro COM-09..12; obrigatório versionar antes do build!)

### 2.2 Migração de Banco (`1` arquivo, ainda não rastreado)
- [`supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`](../../supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql)
- **SHA-256 confirmado:** `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7`

### 2.3 Testes Automatizados COM-09/12 (`4` arquivos, ainda não rastreados)
- [`tests/com09-com12-reactions-ui.cjs`](../../tests/com09-com12-reactions-ui.cjs)
- [`tests/rls-com09-com12-reactions.sql`](../../tests/rls-com09-com12-reactions.sql)
- [`tests/com09-com12-pg17-validation.cjs`](../../tests/com09-com12-pg17-validation.cjs)
- [`tests/live-com09-com12-homolog.cjs`](../../tests/live-com09-com12-homolog.cjs)

### 2.4 Documentação Técnica COM-09/12 (`5` arquivos em `database/com09-com12-acoes-reacoes/`)
- [`01-auditoria-implementacao-e-gate-homologacao.md`](01-auditoria-implementacao-e-gate-homologacao.md)
- [`02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql)
- [`03-validacao-postgresql17-e-preparacao-homologacao.md`](03-validacao-postgresql17-e-preparacao-homologacao.md)
- [`04-homologacao-controlada-com09-com12.md`](04-homologacao-controlada-com09-com12.md)
- [`05-preparacao-producao-release-147.md`](05-preparacao-producao-release-147.md)

### 2.5 Metadados Futuros de Release `1.4.7` (NÃO modificados ainda — reservados ao pacote de release)
- `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (todos preservados em `1.4.6`).
- `.github/workflows/release.yml` (ver Seção 16 quanto à guarda da tag `v1.4.7`).

---

## 3. Identificação de Arquivos Não Rastreados (Separados do Escopo `1.4.7`)

Os seguintes itens não rastreados preexistentes na working tree **não** pertencem a COM-09/12 e **não** devem ser incluídos indiscriminadamente (`git add .` proibido):

| Caminho Não Rastreado | Natureza | Tratamento na Futura Release `1.4.7` |
| --- | --- | --- |
| `supabase/.temp/` | Artefato local temporário do Supabase CLI | **Excluir** (nunca commitar) |
| `database/com01-com02-auditoria-contratos.md` | Relatório histórico anterior | **Excluir** do commit COM-09/12 |
| `database/homologacao-com05-com08/` | Artefatos históricos COM-05..08 | **Excluir** do commit COM-09/12 |
| `database/pre-implantacao-com05-com08/` | Artefatos históricos COM-05..08 | **Excluir** do commit COM-09/12 |
| `database/implantacao-com05-com08/*.md` | Relatórios históricos COM-05..08 | **Excluir** do commit COM-09/12 |
| `database/implantacao-mesa-p0-xerife-p02/07-publicacao-oficial-145.md` | Relatório histórico v1.4.5 | **Excluir** do commit COM-09/12 |
| `database/xerife-6b-xer05-xer06/10-publicacao-oficial-146.md` | Relatório histórico v1.4.6 | Opcional em commit separado de documentação; **não** misturar com COM-09/12 |

---

## 4. Histórico de Migrações de Produção (`jxxhdqoyblykqiiyptsp`)

Confirmado em consulta somente leitura (`2026-11-19T14:39:57Z` e reconfirmado às `14:46:37Z`): **exatamente `19` migrações registradas** em `supabase_migrations.schema_migrations`, alinhadas 1-para-1 com as 19 primeiras migrações do repositório local:

1. `20261106000343` — `create_character_portraits_bucket_and_policies`
2. `20261108013940` — `create_mesa_maps_bucket_and_mesas_columns`
3. `20261108022143` — `create_mesa_tokens_table_and_policies`
4. `20261108025202` — `add_mesa_tables_to_supabase_realtime`
5. `20261109160047` — `require_auth_for_event_reads`
6. `20261109171323` — `restrict_membership_events_and_sheet_reads`
7. `20261109223117` — `public_scene_visibility_and_event_membership`
8. `20261110010238` — `token_instance_initiative`
9. `20261110105257` — `shared_turn_tracker`
10. `20261110110417` — `turn_tracker_late_fixed_order`
11. `20261110184126` — `multiple_maps_private_storage`
12. `20261111103530` — `multiple_maps_combat_guard`
13. `20261111151557` — `gm_tools_inbox_notes_token_status`
14. `20261111163758` — `gm_tools_status_metadata_sync`
15. `20261111164149` — `gm_tools_preserve_legacy_inventory`
16. `20261116210603` — `com05_com08_combat_state_and_actions`
17. `20261117151310` — `xerife_6b_foundation`
18. `20261118101800` — `xerife_6b_instance_combat`
19. `20261118153000` — `xerife_6b_instance_conflict_pt409`

- **Pendente local no repositório (`20` arquivos no total):** exclusivamente `20261119120000_com09_com12_reactions_and_opportunities.sql`.

---

## 5. Comparação Produção (`jxxhdqoyblykqiiyptsp`) × Homologação (`igyupxczhczidfgtjiws`)

| Dimensão | Produção (`jxxhdqoyblykqiiyptsp`) | Homologação (`igyupxczhczidfgtjiws`) | Compatibilidade |
| --- | --- | --- | --- |
| **PostgreSQL** | `17.11` (`x86_64-pc-linux-gnu`) | `17.12` (`aarch64-unknown-linux-gnu`) | Compatível (mesma série major 17) |
| **`schema_migrations`** | `19` versões (alinhado 1:1 com repo até XER-06/PT409) | `5` versões (`4` + COM-09/12; bootstrap estrutural) | Produção mais limpa; zero divergência histórica |
| **Tabelas `public` + `xerife_6b`** | `15` tabelas, todas `RLS = true` | `15` tabelas, todas `RLS = true` | **Idênticas** |
| **Publicação `supabase_realtime`** | `10` tabelas (inclui `mesa_combate_sinais` e `mesa_6b_instancia`) | `10` tabelas (mesma lista exata) | **Idênticas** (sem mudança necessária) |
| **Colunas `mesas`, `mesa_tokens`, `membros_mesa`, `mesa_combate_sinais`** | Todas presentes e com mesmos tipos | Todas presentes e com mesmos tipos | **Idênticas** |
| **Triggers e Policies RLS** | Mesmos triggers (`combate_estado_sinal`, `trg_mesa_tokens_sync_6b_instancia`, etc.) e mesmas policies | Mesmos triggers e policies | **Idênticas** |
| **Funções `obter_combate_publico`, `gerenciar_combate`, `gerenciar_acao_combate` (pré-COM-09/12)** | `obter_combate_publico` byte-a-byte igual; `gerenciar_combate` e `gerenciar_acao_combate` diferem apenas por comentários SQL (`-- ...`), código executável 100% idêntico | Mesmas assinaturas, `search_path=""`, `owner=postgres` | **100% compatíveis** |
| **XER-04/05/06 + `PT409`** | 6 funções mutáveis `xerife_6b.*_instancia` com `PT409` + 9 wrappers `public.*_6b_instancia` | Idêntico | **100% compatíveis** |
| **Contagens agregadas (zero PII)** | `11` usuários, `6` mesas, `9` membros, `12` fichas, `0` tokens, `1` sinal de combate, `0` combates ativos, `4` `storage.objects` | `13` usuários QA (`11+2`), `2` mesas QA, `4` fichas QA, `9` tokens QA | Nenhum combate ativo em Produção no momento da auditoria |
| **`get_advisors (security)`** | Baseline conhecido (`3` INFO `xerife_6b.*` intencionais; `5` WARN `anon_secdef` legados; `1` `pg_net` in public; `1` `handle_new_user` search_path; `1` leaked password) | Equivalente + `gerenciar_reacao_combate` em `authenticated_secdef` | Sem novos bloqueadores |

---

## 6. Resultado da Auditoria de Dependências (Gate B: APROVADO)

- Todas as dependências consumidas por `20261119120000_com09_com12_reactions_and_opportunities.sql` foram confirmadas presentes e com assinaturas exatas em Produção:
  - `public.is_mestre_da_mesa(uuid)`, `public.mapa_visivel_ao_usuario(uuid, uuid)`, `public.normalizar_iniciativa_token(text)`, `public.atualizar_resumo_combate(uuid, jsonb)`, `public.criar_action_state_combate(mesas, uuid, uuid, integer, mesa_tokens, integer)`, `public.custo_canonico_acao_combate(text, integer, boolean, text)`, `public.item_combate_v2(mesa_tokens, integer, integer, text, boolean, jsonb)`, `public.gerenciar_acao_combate(...)`, `public.gerenciar_combate(...)`, `public.obter_combate_publico(uuid)`.
  - Objetos novos `public.gerenciar_reacao_combate` e `public.calcular_fase_turno_combate` ainda não existem em Produção (zero colisão).
  - Nenhuma alteração preliminar de esquema é necessária.

---

## 7. Localização Protegida do Backup Lógico de Produção (Fase C)

- **Projeto de origem:** `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio` — Produção, extração 100% somente leitura via `supabase db dump --remote=jxxhdqoyblykqiiyptsp` + `pg_get_functiondef`).
- **Timestamp UTC:** `2026-11-19T14:42:03Z`
- **Diretório privado local (fora do Git):**  
  `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\prod-jxxhdqoyblykqiiyptsp-com0912-20261119-144203Z`
- **Proteção de acesso:** ACL NTFS restrita via `icacls /inheritance:r /grant:r` exclusivamente ao usuário local e `NT AUTHORITY\SYSTEM`. Nenhum dado pessoal ou conteúdo de fichas foi copiado para o repositório ou para este relatório.
- **Limitações do backup lógico:** dumps `pg_dump`/`supabase db dump` preservam integralmente `public`, `xerife_6b`, `supabase_migrations` e papéis customizados, mas não substituem backups físicos/PITR gerenciados pela plataforma Supabase para objetos internos de `auth`, `storage` (binários de buckets) ou configurações do painel.

---

## 8. Hash e Integridade do Backup de Produção

Todos os 6 artefatos foram gerados com código de saída `0`, validados em tamanho e checksum SHA-256 (registrados em `SHA256SUMS.txt` no diretório de backup) e confirmados inalterados após o ensaio (`app_data.sql` SHA-256 idêntico antes e depois):

| Arquivo | Tamanho (bytes) | SHA-256 |
| --- | ---: | --- |
| `roles.sql` | `297` | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `schema.sql` | `204.505` | `48f4833baa489a8b38371ce5096849d419dfd7c17e66f4b63acb292f269b5326` |
| `app_schema.sql` | `203.125` | `071ad56049dedc68ea5fd242918a66023f3778ee39f497be8aa4d9514c1b796e` |
| `app_data.sql` | `132.291` | `ae09c0181affb0446de675543c8319dfb31eb615bbea7b4aa95cb557d3aa7ecd` |
| `migrations_data.sql` | `211.891` | `9686f23ecfb694eaa6b98c32d6f728fa470a2a44bde9c0df90c6057f5f6098e3` |
| `affected_functions_pre.sql` | `31.020` | `341098439d2211a212b4ef2d40c62a404885e7bf5f65fe95e2a80618bdeb32fb` |

---

## 9. Resultado do Ensaio de Restauração (Fase D — `postgres:17`, `--network none`)

- **Contêiner isolado:** `postgres:17` (`PostgreSQL 17.12`, `--network none`, sem acesso à rede de Produção, removido automaticamente no `finally`).
- **Bootstrap compatível:** papéis (`anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`), `auth.users` populado apenas com UUIDs sinteticamente anonimizados extraídos em memória para satisfazer FKs (sem gravar PII em disco/logs), `auth.uid()`/`auth.role()`, `extensions` (`pgcrypto`, `uuid-ossp`), `supabase_migrations.schema_migrations` e publicação `supabase_realtime`.
- **Resultados de restauração (`task-560`):**
  - `RESTORE_APP_SCHEMA_EXIT=0`
  - `RESTORE_APP_DATA_EXIT=0`
  - `RESTORE_MIG_DATA_EXIT=0`
  - `RESTORED_PROD_COUNTS=11|6|9|12|0|1|19|20261118153000` (`usuarios|mesas|membros_mesa|fichas|mesa_tokens|mesa_combate_sinais|schema_migrations|max_version`) — **100% fiel às contagens reais de Produção**.
- **Limitação esperada do contêiner descartável:** `WARNING: "wal_level" is insufficient to publish logical changes` (esperado em `postgres:17` padrão sem replicação lógica; não afeta DDL, DML nem RLS).

---

## 10. Resultado da Migração no PostgreSQL 17 Isolado (Sobre a Cópia de Produção)

- **Aplicação exclusiva de `20261119120000_com09_com12_reactions_and_opportunities.sql`:** `APPLY_COM0912_ON_PROD_COPY_EXIT=0`.
- **Catálogo `pg_proc` pós-aplicação na cópia de Produção:**

| Função | `SECURITY DEFINER` | `search_path` | `PUBLIC` | `anon` | `authenticated` |
| --- | :---: | :---: | :---: | :---: | :---: |
| `public.calcular_fase_turno_combate` | `false` | `""` | `false` | `false` | `false` |
| `public.gerenciar_acao_combate` | `true` | `""` | `false` | `false` | `true` |
| `public.gerenciar_combate` | `true` | `""` | `false` | `false` | `true` |
| `public.gerenciar_reacao_combate` | `true` | `""` | `false` | `false` | `true` |
| `public.obter_combate_publico` | `true` | `""` | `false` | `false` | `true` |

---

## 11. Resultado dos Testes Direcionados na Cópia de Produção (Gate D: APROVADO)

- **`tests/rls-com05-com08-combat-actions.sql` (`12/12` blocos):** **`RLS_COM05_08_ON_PROD_COPY_EXIT=0`** (comprova integridade COM-05..08 e compatibilidade retroativa sobre o esquema real de Produção).
- **`tests/rls-com09-com12-reactions.sql` (`6/6` blocos):** **`RLS_COM09_12_ON_PROD_COPY_EXIT=0`** (comprova COM-09, COM-10, COM-11, alcance por grade, sigilo da projeção pública, idempotência `p_op_id`, `PT409`, virada de rodada e bloqueio `42501` para `anon`/`public`/externo/autoaprovação).
- **Integridade dos dados restaurados:** `POST_REHEARSAL_PROD_COUNTS=11|6|9|12|0|1|19|20261118153000` (exatamente idêntico ao pré-ensaio; zero deriva ou corrupção).

---

## 12. Resultado do Ensaio de Rollback e Reaplicação

1. **Remoção das novas funções (`02-rollback-com09-com12.sql`):** `ROLLBACK_DROP_EXIT=0`, `POST_ROLLBACK_NEW_FUNCS_COUNT=0`.
2. **Restauração das definições originais de Produção (`affected_functions_pre.sql`):** `ROLLBACK_RESTORE_PREFUNCS_EXIT=0`.
3. **Validação pós-rollback (`tests/rls-com05-com08-combat-actions.sql`):** `POST_ROLLBACK_RLS_COM05_08_EXIT=0` (`12/12 PASS`).
4. **Reaplicação limpa de `20261119120000_com09_com12_reactions_and_opportunities.sql`:** `REAPPLY_COM0912_EXIT=0` e `REAPPLY_RLS_COM09_12_EXIT=0` (`6/6 PASS`), comprovando repetibilidade total.

---

## 13. Compatibilidade com Clientes `1.4.6` Ainda Instalados (Ordem Segura de Implantação)

**Conclusão técnica:** **100% RETROCOMPATÍVEL** → **o banco de Produção DEVE ser migrado ANTES da publicação da versão `1.4.7`**.

Justificativa objetiva comprovada no contrato SQL e nos testes `rls-com05-com08`:
1. **Nenhuma tabela, coluna, constraint, trigger, política RLS ou publicação Realtime é alterada ou removida.**
2. **`public.obter_combate_publico(uuid)` e `public.gerenciar_combate(...)` mantêm assinaturas e todas as chaves JSON esperadas pela `1.4.6`** (`id`, `ativo`, `mapa_id`, `versao`, `round`, `turno_atual_idx`, `turno_oculto`, `ordem`, `action_state`), apenas adicionando as chaves opcionais `oportunidades_reacao` e `solicitacoes_reacao` (que clientes `1.4.6` ignoram com segurança).
3. **`public.gerenciar_acao_combate(...)` e todas as RPCs de Xerife 6B (`*_6b_xerife`, `*_6b_instancia`, `xerife_6b.*`) não são alteradas.**
4. **A nova RPC `public.gerenciar_reacao_combate` nunca é chamada por clientes `1.4.6`.**
5. **Se um cliente `1.4.7` tentar operar contra um banco ainda sem a migração:** `turnTracker.js` trata `PGRST202`/`42883` com `unavailable: true` sem travar a aplicação, mas os recursos COM-09/10/11 só funcionam com o banco migrado — confirmando que a ordem segura é **Passo 1: Banco Produção → Passo 2: Validação pós-deploy → Passo 3: Build/Release `1.4.7`**.

---

## 14. Plano de Implantação em Produção (NÃO EXECUTAR NESTE PACOTE)

### 14.1 Pré-Implantação
1. Confirmar autorização explícita do proprietário para o pacote de implantação em Produção.
2. Confirmar branch `feature/com09-com12-reactions`, SHA-256 de `20261119120000_com09_com12_reactions_and_opportunities.sql` = `dfa14675d32d18a08de63dd59da55aed20b21e5fcb9f3270127264b628c0b8d7`.
3. Confirmar projeto alvo `jxxhdqoyblykqiiyptsp` com `19` migrações e `0` combates ativos (`SELECT count(*) FROM public.mesas WHERE combate_ativo IS NOT NULL`) + `0` locks em `mesas`/`mesa_tokens`.
4. Se o intervalo desde o backup `prod-jxxhdqoyblykqiiyptsp-com0912-20261119-144203Z` for superior à janela desejada (ou houver novos dados em Produção), gerar novo backup lógico fresco antes de aplicar.
5. **Critérios de interrupção (abort imediato):** divergência de SHA-256, número de migrações ≠ `19`, locks ativos prolongados ou ausência de backup validado.

### 14.2 Aplicação Controlada
1. Aplicar **exclusivamente** `20261119120000_com09_com12_reactions_and_opportunities.sql` em `jxxhdqoyblykqiiyptsp` via método oficial em transação única (`supabase_mcp.apply_migration` com nome `com09_com12_reactions_and_opportunities`, ou `supabase db push --remote=jxxhdqoyblykqiiyptsp --dry-run` confirmando exatamente 1 migração pendente antes da execução — com `lock_timeout` curto e zero aplicação em lote).
2. Executar `NOTIFY pgrst, 'reload schema';`.
3. Verificar imediatamente:
   - `schema_migrations` com exatamente **`20`** versões.
   - `pg_proc`: `gerenciar_reacao_combate` (`SECURITY DEFINER`, `search_path=""`, `PUBLIC=false`, `anon=false`, `authenticated=true`), `calcular_fase_turno_combate` (`authenticated=false`), `obter_combate_publico` e `gerenciar_combate` intactas.
   - `get_advisors (security)`: zero novos alertas inesperados (apenas `gerenciar_reacao_combate` em `authenticated_secdef`).

### 14.3 Validação Pós-Implantação (Não Destrutiva em Produção)
1. **Probes HTTP anônimos (`sb_publishable_*` de Produção, zero escrita):**
   - `POST /rest/v1/rpc/gerenciar_reacao_combate` → **`HTTP 401` (`42501`)**.
   - `POST /rest/v1/rpc/calcular_fase_turno_combate` → **`HTTP 401`/`403` (`42501`)**.
   - `GET /rest/v1/mesas?select=id&limit=1` → **`HTTP 200 []`**.
   - `POST /rest/v1/rpc/ler_6b_instancia` → **`HTTP 401` (`42501`)**.
2. **Conferência de preservação de dados reais:** `auth_users`, `public_usuarios`, `mesas`, `membros_mesa`, `fichas`, `storage_objects` 100% preservados.
3. **Teste funcional assistido (com conta real de teste controlada do proprietário ou cliente `1.4.6` existente):** confirmar abertura de mesa, compatibilidade `1.4.6` (Turn Tracker, ações COM-05..08 e 6B) e monitorar `postgres_logs` / `postgrest_logs` por erros `401`/`403`/`409`/`500`/`504`.

---

## 15. Plano de Recuperação (Rollback em Produção)

- **Critérios para acionar rollback:** falha de integridade em `obter_combate_publico` / `gerenciar_combate`, quebra de clientes `1.4.6`, erro `500`/`504` em combate ou falha de segurança/RLS detectada pós-deploy.
- **Procedimento seguro (somente com autorização explícita do proprietário):**
  1. Verificar ausência de combates ativos em `public.mesas` (ou comunicar encerramento controlado).
  2. Executar [`02-rollback-com09-com12.sql`](02-rollback-com09-com12.sql) (remove `gerenciar_reacao_combate` e `calcular_fase_turno_combate`).
  3. Restaurar `obter_combate_publico` e `gerenciar_combate` a partir de `affected_functions_pre.sql` do backup pré-deploy (`34109843...`) e executar `NOTIFY pgrst, 'reload schema';`.
- **Limites e riscos do rollback SQL:** não remove dados de `mesas`, `fichas`, `usuarios` ou `mesa_6b_instancia`; porém, se houver algum combate ativo iniciado após o deploy, chaves JSON extras (`oportunidades_reacao`/`solicitacoes_reacao`) em `combate_ativo` deixarão de ser processadas. Em caso de corrupção grave imprevista fora das funções, acionar PITR/restauração oficial do painel Supabase em conjunto com o backup lógico arquivado. **Nunca executar rollback automático sem avaliação e aprovação.**

---

## 16. Plano de Release `1.4.7` (Auditoria Fase F — NÃO EXECUTAR NESTE PACOTE)

### 16.1 Estado Atual Auditado (`1.4.6` preservada)
- `package.json`: `"version": "1.4.6"` (`@tauri-apps/cli ^2.11.2`, `@tauri-apps/plugin-updater ^2.14.1`, `@supabase/supabase-js ^2.118.0`).
- `src-tauri/tauri.conf.json`: `"version": "1.4.6"`, `"identifier": "com.stefano.darkwest"`, `"createUpdaterArtifacts": true`, `"installMode": "passive"`, `pubkey` Minisign Key ID `F08EB962D585140A`, endpoint `https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json`.
- `src-tauri/Cargo.toml`: `version = "1.4.6"`, `rust-version = "1.90"`.
- `dist/js/supabaseConfig.js`: aponta exclusivamente para Produção (`https://jxxhdqoyblykqiiyptsp.supabase.co`), `0` referências a Homologação.
- Diretórios preservados: `release-upload-1.4.4`, `release-upload-1.4.5`, `release-upload-1.4.6` e releases GitHub `v1.4.4`, `v1.4.5`, `v1.4.6`.
- **Guarda crítica identificada em [`.github/workflows/release.yml`](../../.github/workflows/release.yml#L26):** atualmente a condição do job `release` exclui apenas `v1.4.4`, `v1.4.5` e `v1.4.6`. **Antes de criar e enviar a tag `v1.4.7`**, caso se mantenha o fluxo local assinado (`scripts/build-release.ps1` + draft release verificada antes de publicar), é obrigatório incluir `&& github.ref != 'refs/tags/v1.4.7'` em `.github/workflows/release.yml` para evitar publicação concorrente automática pelo GitHub Actions.

### 16.2 Sequência Futura da Release `1.4.7` (Após Banco de Produção Validado)
1. Consolidar commits seletivos e limpos na branch `feature/com09-com12-reactions` (exclusivamente os arquivos da Seção 2 — sem `supabase/.temp/` nem relatórios históricos não relacionados).
2. Atualizar versão para `1.4.7` em `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` e atualizar a guarda em `.github/workflows/release.yml`.
3. Executar build local assinado (`scripts/build-release.ps1 -SkipPublish`), preservando `release-upload-1.4.6/` e arquivando os novos artefatos em `release-upload-1.4.7/` (`Dark.West.Character.Sheet_1.4.7_x64-setup.exe`, `.sig`, `latest.json`).
4. Validar localmente: SHA-256 dos 3 artefatos, assinatura Minisign (`F08EB962D585140A`) + teste negativo de adulteração de 1 byte, e validação de `latest.json` (`version: "1.4.7"`, `platforms.windows-x86_64`).
5. **Validação segura do updater (`1.4.6 → 1.4.7`) sem tocar a instalação principal do proprietário:** executar o instalador/updater em Windows Sandbox, VM Windows limpa ou conta de usuário Windows dedicada isolada, verificando: (i) presença prévia de uma ficha local em `%APPDATA%\com.stefano.darkwest\characters` e sessão no perfil WebView2; (ii) detecção e instalação silenciosa (`installMode: "passive"`) da `1.4.7`; (iii) preservação integral das fichas locais e reabertura funcional conectada à Produção. Caso o proprietário opte novamente por dispensar o ensaio em Windows isolado, registrar dispensa formal idêntica à da `v1.4.6`.
6. Somente após aprovação: merge `--no-ff` em `main`, tag anotada `v1.4.7`, push, criação de **draft release** no GitHub, upload e conferência criptográfica dos 3 assets baixados do draft, e publicação como `latest`, mantendo `v1.4.4`, `v1.4.5` e `v1.4.6` intactas.

---

## 17. Revisão de Segurança (Fase G) e Riscos Residuais

### 17.1 Revisão de Segurança Executada (`PASS`)
- `SECRET_FINDINGS = 0` em todos os arquivos de `dist/`, `src-tauri/`, migração SQL e suítes COM-09/12 (zero `service_role`, zero JWTs hardcoded, zero tokens GitHub, zero chaves privadas Minisign, zero senhas efêmeras).
- `DUMP_OR_KEY_FILES_IN_REPO = []` (zero dumps `.dump`/`.bak`/`.key`/`.pem` no repositório).
- `SUPABASE_CONFIG_PROD_ONLY = true` (`dist/js/supabaseConfig.js` aponta exclusivamente para `jxxhdqoyblykqiiyptsp`, zero referências a `igyupxczhczidfgtjiws` em `dist/`).
- Diff de `dist/js/mesaScreen.js` inspecionado linha a linha: **zero alterações** na lógica do Xerife 6B (`XER-04/05/06`).

### 17.2 Riscos Residuais
1. **Updater Windows (`1.4.6 → 1.4.7`):** risco herdado da `v1.4.6` por ausência de teste ponta a ponta em máquina Windows isolada; mitigável pelo ensaio em VM/Windows Sandbox descrito na Seção 16.2.
2. **Ausência de certificado Authenticode:** mantida em relação às versões anteriores (SmartScreen em download manual; updater usa Minisign `F08EB962D585140A`).
3. **Diferença minor de PostgreSQL (`17.11` em Produção vs `17.12` em Homologação e no ensaio local):** mesma série major PostgreSQL 17, sem uso de sintaxe específica da `17.12`; risco muito baixo.
4. **Dois registros não confirmados órfãos em Homologação (`igyupxczhczidfgtjiws`):** não afetam Produção (`jxxhdqoyblykqiiyptsp`) e não foram removidos conforme restrição explícita do Pacote 9.3.

---

## 18. Pendências e Pré-requisitos Antes da Autorização de Implantação

| # | Item | Bloqueador para Banco Produção? | Bloqueador para Release `1.4.7`? | Ação Necessária |
| --- | --- | :---: | :---: | --- |
| 1 | Consolidar commits seletivos na branch `feature/com09-com12-reactions` (incluindo `reactionRules.js`, migração e testes; excluindo `supabase/.temp/` e históricos) | Recomendado | **Sim** | Executar no início do próximo pacote autorizado |
| 2 | Adicionar guarda `github.ref != 'refs/tags/v1.4.7'` em `.github/workflows/release.yml` (se mantido o fluxo de publicação manual) | Não | **Sim** | Incluir no commit de metadados `1.4.7` |
| 3 | Decisão do proprietário sobre teste do updater `1.4.6 → 1.4.7` em Windows isolado (executar em VM/Sandbox ou formalizar dispensa) | Não | **Sim (decisão)** | Definir antes da publicação pública da `1.4.7` |
| 4 | Remoção opcional dos 2 usuários não-confirmados órfãos em Homologação (`igyupxczhczidfgtjiws`) | Não | Não | Somente mediante autorização separada |

---

## 19. Recomendação de Próximo Gate

**Classificação final do Pacote 9.3: `APROVADO COM RESSALVAS`** — sem bloqueadores técnicos para o banco de Produção (`jxxhdqoyblykqiiyptsp`).

Recomenda-se solicitar autorização explícita do proprietário para abrir o **Pacote 10 (Implantação Controlada em Produção e Publicação `1.4.7`)** dividido em **3 checkpoints independentes**:
1. **Checkpoint 10A — Banco de Produção (`jxxhdqoyblykqiiyptsp`):** aplicar exclusivamente `20261119120000_com09_com12_reactions_and_opportunities.sql`, validar `pg_proc`/`advisors`/probes anônimos e retrocompatibilidade `1.4.6`.
2. **Checkpoint 10B — Consolidação Git e Build `1.4.7`:** commits seletivos limpos em `feature/com09-com12-reactions`, guarda em `.github/workflows/release.yml`, bump `1.4.7`, build NSIS + Minisign + verificação local (e validação em Windows isolado, se autorizada).
3. **Checkpoint 10C — Publicação GitHub Release `v1.4.7`:** merge em `main`, tag `v1.4.7`, draft release verificada criptograficamente e publicação como `latest`.
