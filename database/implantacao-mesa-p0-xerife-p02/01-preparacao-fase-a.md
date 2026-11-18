# Fase A — Auditoria e Preparação para Implantação Controlada (MESA P0 + P0-2)

**Data:** 17/11/2026  
**Escopo:** MESA P0 (`MESA-01`, `MESA-02`, `MESA-03`) + P0-2 (`XER-01`, `XER-02`, `XER-03`)  
**Parecer de Prontidão (Gate Fase A → Fase B):** **PRONTO COM RESSALVAS**  
**Status da Fase B:** **NÃO INICIADA — aguardando autorização explícita do responsável**

---

## 1. Resumo Executivo

A auditoria somente de leitura confirmou que o repositório local (`main` em `0c996fa`), os testes locais (incluindo PostgreSQL 17 isolado, WebView2 nativo, sintaxe JS e 12/12 regressões), a paridade de Homologação (`igyupxczhczidfgtjiws`) e os pré-requisitos estruturais de Produção (`jxxhdqoyblykqiiyptsp`) estão íntegros e sem conflitos de schema. A migração `20261117151310_xerife_6b_foundation.sql` é puramente aditiva e retrocompatível com o cliente público `1.4.4` (`4d15dfd`).

A liberação está classificada como **PRONTO COM RESSALVAS** por três pré-requisitos operacionais obrigatórios que antecedem ou condicionam a execução da Fase B:
1. **Backup atualizado obrigatório antes do deploy:** a organização está no plano **Free** (`tier_free`), sem PITR/backups gerenciados pela plataforma, e o último `pg_dump` local de Produção (`oeste-jxxhdqoyblykqiiyptsp-20261116-174814.dump`) é de 16/11/2026 (anterior à migração `20261116210603`). Novo `pg_dump` validado em contêiner `postgres:17` isolado é obrigatório na abertura da Fase B.
2. **Canal e reconciliação de migrações:** `supabase/migrations/` local contém apenas `20261117151310_xerife_6b_foundation.sql`, faltando as 16 migrações históricas de Produção; `supabase` CLI não está instalada no PATH local; e `apply_migration` via MCP no Antigravity cancela automaticamente em `0.2 s`–`0.4 s` na camada de elicitação. Não se deve executar `supabase db push` sem reconciliar/alinhar o histórico antes.
3. **Empacotamento/assinatura do cliente:** `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` ainda apontam para `1.4.4`, e o GitHub Actions teve bloqueio anterior de cobrança no lançamento de `1.4.4` (17/11/2026), podendo exigir build e assinatura Minisign locais (`scripts/build-release.ps1`).

---

## 2. Verificação Git (A1)

- **Branch atual:** `main`
- **HEAD:** `0c996fa` (`docs(xerife-6b): add P0-2 tests, security audit, and consolidation report`)
- **Três commits locais consolidados acima da referência `1.4.4` (`4d15dfd`):**
  - `5f9c2c2` — `feat(mesa): implement MESA-01/02/03 panel resize, token delete, and sheet popup`
  - `74473e4` — `feat(xerife-6b): implement P0-2 shared 6B pools foundation and UI`
  - `0c996fa` — `docs(xerife-6b): add P0-2 tests, security audit, and consolidation report`
- **Alterações rastreadas pendentes:** nenhuma (`git status --short --untracked-files=no` vazio; `git diff --check` saída 0).
- **Migração versionada presente:** `supabase/migrations/20261117151310_xerife_6b_foundation.sql` (271 linhas).
- **Delta entre `1.4.4` (`4d15dfd`) e `0c996fa`:** 30 arquivos alterados/criados (`2591 insertions(+), 175 deletions(-)`), sendo 11 arquivos de aplicação em `dist/` (`index.html`, `style.css`, `authSession.js`, `dice.js`, `homeScreen.js`, `inventoryUI.js`, `main.js`, `mesaMaps.js`, `mesaScreen.js`, `mesaXerife6B.js`, `modal.js`), 1 migração SQL e 18 arquivos de testes/evidências/documentação.
- **Segurança no cliente Tauri (`dist/` e `src-tauri/`):** 0 chaves `service_role` ou `sb_secret_` presentes (os 3 matches textuais em `supabaseClient.js` e `supabaseConfig.js` são apenas guarda de rejeição e comentário preventivo).

---

## 3. Estado dos Dois Ambientes (A2 e A4)

### 3.1 Produção — `jxxhdqoyblykqiiyptsp` (`Oeste Sombrio`)
- **Status / Região / Engine:** `ACTIVE_HEALTHY`, `us-east-1`, Postgres `17.11.0.011`.
- **Volumetria observada (somente leitura):** `13.850.291` bytes no banco; `6 mesas`, `9 membros_mesa`, `12 fichas`, `0 mesa_tokens`, `11 auth.users`, `4 storage.objects` (`character-portraits` público, `mesa-maps` privado), `35 policies` em `public`/`storage`.
- **Pré-requisitos estruturais para `20261117151310`:**
  - Tabelas `public.mesas`, `public.membros_mesa` (com `cargo`), `public.fichas` (com `mesa_id`, `usuario_id`, `nivel`, `dados`) e função `public.is_mestre_da_mesa(p_mesa_id uuid)` confirmadas e idênticas às esperadas.
  - `pg_publication`: `supabase_realtime` e `supabase_realtime_messages_publication`; `any_puballtables = false` (a verificação `FOR ALL TABLES` no início da migração passará).
  - Publicação `supabase_realtime` atual: `public.eventos_mesa`, `public.fichas`, `public.itens_entregues_pendentes`, `public.mesa_combate_sinais`, `public.mesa_mapa_sinais`, `public.mesa_token_status`, `public.mesa_tokens`, `public.mesas`.
- **Confirmação de ausência de conflitos:**
  - `to_regnamespace('xerife_6b') = null`
  - `to_regclass('public.mesa_6b_aberto') = null`
  - `wrappers_6b_count = 0` (`public.*_6b_xerife`)
  - `migration_20261117151310_recorded = 0`
- **Diferença não conflitante em relação à Homologação:** Produção possui a função auxiliar `public.rls_auto_enable()` (17/11 lints `security`: `function_search_path_mutable` em `handle_new_user`, `pg_net` em `public`, `auth_leaked_password_protection` desabilitada e RPCs `SECURITY DEFINER` herdadas de `1.4.4`; lints `performance`: 8 FKs sem índice em tabelas existentes, 14 `auth_rls_initplan`, 1 `unused_index` e 1 `multiple_permissive_policies` em `mesa_token_status`). Nenhuma delas colide com `xerife_6b` ou `public.mesa_6b_aberto`.

### 3.2 Homologação — `igyupxczhczidfgtjiws` (`Oeste Sombrio Homologação`)
- **Status / Região / Engine:** `ACTIVE_HEALTHY`, `us-east-1`, Postgres `17.12.0.000`.
- **Paridade completa confirmada contra `supabase/migrations/20261117151310_xerife_6b_foundation.sql`:**
  - `xerife_6b.presencas`: `rls = true`, ACL `{postgres=arwdDxtm/postgres}`, índice `presencas_6b_lease`, PK `presencas_pkey`, FKs para `mesas(id)` e `fichas(id)`.
  - `xerife_6b.conjuntos`: `rls = true`, ACL `{postgres=arwdDxtm/postgres}`, PK `conjuntos_pkey`, FK para `mesas(id)`, constraints `conjuntos_tipo_check`, `conjuntos_versao_check`, `conjuntos_check`, `conjuntos_check1`.
  - `public.mesa_6b_aberto`: `rls = true`, ACL `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}`, policy `mesa_6b_aberto_leitura` (`SELECT` para `authenticated`), única tabela de 6B incluída em `supabase_realtime`.
  - 7 funções em `xerife_6b` (`autorizar`, `composicao`, `consumir`, `ler`, `presenca`, `renovar`, `rolar`): todas `SECURITY DEFINER` (`secdef = true`) com `search_path = ""`.
  - 5 wrappers em `public` (`*_6b_xerife`): todos `SECURITY INVOKER` (`secdef = false`) com `search_path = ""` e `EXECUTE` concedido a `authenticated`/`service_role`.
- **Lint específico em Homologação:** `rls_enabled_no_policy` (nível `INFO`) em `xerife_6b.conjuntos` e `xerife_6b.presencas`, esperado pelo bloqueio proposital de acesso direto às tabelas privadas.
- **Testes remotos anteriores em Homologação (reutilizados explicitamente sem reexecução):** `tests/live-xerife-6b.cjs` em **17/11/2026** no ambiente **`igyupxczhczidfgtjiws`** registrou **17 PASS** em `tests/artifacts/live-xerife-6b-results.json` (Auth HTTP, derivação por nível, deduplicação por conexão, bloqueio 42501 `anon`/jogador, WebSocket Realtime aberto, sigilo do secreto, consumo, renovação bloqueada antes do esgotamento e liberação após zerar, reconexão sem cache). Permanecem apenas 2 usuários QA sintéticos (`aa6b0001-...`, `aa6b0002-...`) e 1 ficha QA órfã em Homologação.

---

## 4. Histórico de Migrações, Divergências e Reconciliação (A3)

| Ambiente | Registros em `supabase_migrations.schema_migrations` | Estado real do schema P0-2 | Divergência encontrada |
|---|---|---|---|
| **Local** (`supabase/migrations/`) | `20261117151310_xerife_6b_foundation.sql` (1 arquivo) | Código SQL versionado | Não possui os 16 arquivos históricos (`20261106000343`..`20261116210603`) de Produção nem `20261116214200` de Homologação |
| **Homologação** (`igyupxczhczidfgtjiws`) | 1 registro: `20261116214200` (`homologacao_144_mapas_notas`) | Todos os objetos de `20261117151310` já existem no banco | `20261117151310` falta em `schema_migrations` (aplicação anterior via SQL Editor); `20261116214200` é exclusiva de Homologação |
| **Produção** (`jxxhdqoyblykqiiyptsp`) | 16 registros (`20261106000343` até `20261116210603_com05_com08_combat_state_and_actions`) | **Nenhum** objeto de `20261117151310` aplicado | Faltam os 16 arquivos base em `supabase/migrations/` localmente |

### Plano de reconciliação proposto (aguardando aprovação — NÃO executado)
1. **Não reaplicar `20261117151310` em Homologação** (DDL sem `IF NOT EXISTS` já está ativa no schema).
2. **Reconciliar Homologação via Supabase CLI** (quando instalada/autenticada e aprovada):
   - `supabase link --project-ref igyupxczhczidfgtjiws`
   - Confirmar visualmente `supabase migration list`
   - Executar **`supabase migration repair --status applied 20261117151310`** (justificado pois todos os objetos de `xerife_6b` e `public.mesa_6b_aberto` já foram comprovados em `igyupxczhczidfgtjiws`).
   - Manter `20261116214200_homologacao_144_mapas_notas.sql` sinalizada como exclusiva de Homologação (não levar para Produção).
3. **Antes de qualquer `supabase db push` em Produção (`jxxhdqoyblykqiiyptsp`):** alinhar os 16 registros históricos (`20261106000343`..`20261116210603`) no diretório/CLI ou aplicar exclusivamente `supabase/migrations/20261117151310_xerife_6b_foundation.sql` pelo canal oficial aprovado com registro correspondente da versão `20261117151310` em `supabase_migrations.schema_migrations`.

---

## 5. Evidências de Backup e Recuperação (A5)

- **Plano da conta:** organização `hxowmohwsloydpkoetfy` está no plano **`free`** (`tier_free`). Não existem snapshots automáticos baixáveis nem Point-in-Time Recovery (PITR) na plataforma Supabase.
- **Inventário local em `%LOCALAPPDATA%\OesteSombrio\backups`:**
  - `oeste-jxxhdqoyblykqiiyptsp-20261116-174814.dump` (`573.889 bytes`, `16/11/2026 17:49`) — **desatualizado**, gerado antes da migração `20261116210603` e das sessões posteriores.
  - `oeste-jxxhdqoyblykqiiyptsp-20261116-174814.dump.roles-local.sql` (`3.502 bytes`) e `prod-ca.crt` (`1.367 bytes`) disponíveis.
- **Conclusão de prontidão de backup:** o backup de 16/11 **não cobre** o estado atual de Produção (`13.850.291 bytes`). **Novo `pg_dump -Fc` pelo Session Pooler (`aws-0-us-east-1.pooler.supabase.com:5432`, `sslmode=verify-full` com `prod-ca.crt`) + validação de restauração em `postgres:17` isolado (`--network none`) são obrigatórios imediatamente antes da Fase B.**
- **Cobertura, RPO/RTO e janela:**
  - O `pg_dump -Fc` cobre `public`, `auth`, `storage` (metadados), `supabase_migrations` e demais schemas lógicos; os `4` objetos binários de `storage.buckets` e configurações externas do Dashboard não vão no dump lógico e permanecem inalterados pela migração P0-2.
  - **RPO esperado:** zero transações perdidas se o dump pré-deploy for tirado em janela controlada sem sessões ativas imediatamente antes do DDL (RPO após o deploy = até o instante do dump pré-deploy).
  - **RTO esperado:** ~5 a 15 minutos para restauração/reversão em banco de ~13,8 MB (ou < 5 minutos para reversão transacional cirúrgica no próprio banco caso a falha ocorra no bloco aditivo).
  - **Indisponibilidade:** a migração `20261117151310` não altera tabelas existentes (`mesas`, `fichas`, `mesa_tokens`), executa em subsegundo e não bloqueia consultas de leitura/escrita da versão `1.4.4`.
- **Compatibilidade do banco atualizado com `1.4.4` (`4d15dfd`):** **100% compatível**. O cliente `1.4.4` desconhece `xerife_6b`, `public.mesa_6b_aberto` e `*_6b_xerife`, não recebendo quebra de contrato nem alteração em tabelas/triggers/RPCs existentes.

---

## 6. Testes Pré-Publicação Executados Nesta Fase A (A6)

Todos os ensaios locais abaixo foram reexecutados e observados diretamente em **17/11/2026** sobre `HEAD 0c996fa`:

| Verificação | Resultado observado |
|---|---|
| `git diff --check` | **PASS** (saída 0) |
| Sintaxe JavaScript ESM (`dist/js/**/*.js`, `43` arquivos) | **PASS (`JS_SYNTAX_OK: 43 files`)** |
| `node tests/mesa-p0-interactions.cjs` (MESA-01/02/03) | **PASS: 33 verificações** |
| `node tests/xerife-6b-ui.cjs` (XER-01/02/03) | **PASS: 39 verificações** |
| Suítes locais de regressão (`auth-session`, `scene-read`, `token-initiative`, `com03-com04-creature-mode`, `com05-com06-initiative-budget`, `com07-com08-controller-events`, `turn-tracker-ui`, `mesa-6b`, `map-camera`, `gm-tools-ui`, `multiple-maps-ui`, `mesa-p0-interactions`) | **PASS: 12/12 (`REGRESSIONS_FAILED=0 / 12`)** |
| PostgreSQL 17 descartável (`postgres:17-alpine`, `--network none`, `tests/xerife-6b-bootstrap.sql` + `20261117151310_xerife_6b_foundation.sql` + `tests/rls-xerife-6b.sql`) | **PASS (`PG_EXIT=0 | PASS_COUNT=46`)** |
| App nativo Windows/Tauri/WebView2 (`src-tauri/target/debug/XerifeP02Verified.exe`, UIA) | **PASS: 39 verificações (`NATIVE_LINE_COUNT=40`)** |
| Backend Rust (`cargo test --manifest-path src-tauri/Cargo.toml`) | **PASS (exit 0; `0` testes Rust definidos)** |
| Homologação remota anterior (`tests/live-xerife-6b.cjs` em `igyupxczhczidfgtjiws`, **17/11/2026**) | **Reutilizado com registro histórico: 17 PASS** (não reexecutado nesta auditoria) |

---

## 7. Riscos e Bloqueios Identificados

1. **Bloqueio operacional até execução na Fase B — Backup de Produção desatualizado:** sem novo `pg_dump` antes da migração em `jxxhdqoyblykqiiyptsp`, não há ponto de recuperação atualizado.
2. **Ferramental de migração:** `apply_migration` via MCP do Antigravity cancela confirmações de escrita/elicitação em `0.2 s`–`0.4 s`, e a CLI `supabase` não está instalada localmente; executar `supabase db push` sem reconciliar o histórico remoto causará erro pelo histórico divergente das 16 migrações anteriores.
3. **Não idempotência da migração `20261117151310`:** contém `CREATE SCHEMA`, `CREATE TABLE` e `ALTER PUBLICATION` sem `IF NOT EXISTS`, devendo rodar exatamente uma vez em Produção.
4. **Ordem de publicação banco × cliente:** clientes novos em Produção sem a migração aplicada falham fechado nos painéis do 6B do Xerife (comportamento seguro, porém sem funcionalidade do pool compartilhado até a migração existir no banco).
5. **Empacotamento/distribuição do cliente Tauri:** versão ainda em `1.4.4` em `package.json`/`Cargo.toml`/`tauri.conf.json`, e possível necessidade de build/assinatura local (`scripts/build-release.ps1`) + publicação via REST API caso o bloqueio de billing do GitHub Actions registrado na publicação da `1.4.4` persista.
6. **Configuração pré-existente fora do escopo:** `"csp": null` em `src-tauri/tauri.conf.json`.

---

## 8. Procedimento Exato de Implantação (Fase B — Somente Após Aprovação)

1. Confirmar janela de manutenção sem sessões críticas ativas e aprovar explicitamente o deploy em `jxxhdqoyblykqiiyptsp`.
2. **Gerar e validar novo backup de Produção:**
   - Executar `pg_dump -Fc` via Session Pooler (`aws-0-us-east-1.pooler.supabase.com:5432`, usuário `postgres.jxxhdqoyblykqiiyptsp`, `sslmode=verify-full` com `prod-ca.crt`) gravando em `%LOCALAPPDATA%\OesteSombrio\backups`.
   - Conferir tamanho, SHA-256, `--list`, `--file /dev/null` e restaurar em contêiner `postgres:17` descartável (`--network none`), conferindo contagens (`mesas`, `membros_mesa`, `fichas`, `usuarios`, `schema_migrations`).
3. Reconfirmar em `jxxhdqoyblykqiiyptsp` (somente leitura) que `xerife_6b` e `public.mesa_6b_aberto` continuam ausentes e `any_puballtables = false`.
4. **Reconciliar Homologação e aplicar migração em Produção:**
   - Em `igyupxczhczidfgtjiws` (quando aprovado): instalar/autenticar CLI oficial e executar `supabase migration repair --status applied 20261117151310`.
   - Em `jxxhdqoyblykqiiyptsp`: aplicar **exclusivamente** `supabase/migrations/20261117151310_xerife_6b_foundation.sql` pelo canal oficial aprovado (CLI com histórico alinhado ou fluxo autenticado com registro de `20261117151310` em `supabase_migrations.schema_migrations` dentro do processo oficial).
5. **Validar banco de Produção (somente leitura):**
   - Confirmar schema `xerife_6b`, tabelas `presencas`/`conjuntos`, `public.mesa_6b_aberto`, `prosecdef`/`search_path` das 12 funções (`7` em `xerife_6b` + `5` wrappers em `public`), policy `mesa_6b_aberto_leitura`, inclusão exclusiva de `public.mesa_6b_aberto` em `supabase_realtime`, e registro `20261117151310` em `supabase_migrations.schema_migrations`.
   - Executar apenas smoke test não destrutivo de leitura (`SELECT` autenticado, verificação de que `anon` recebe bloqueio e `rls` ativo).
6. **Publicar cliente Tauri atualizado (somente após etapa 5 validada):**
   - Atualizar versão (ex.: `1.4.5`) em `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` e `src-tauri/tauri.conf.json`.
   - Reexecutar suítes UI/regressões e gerar instalador + `.sig` Minisign + `latest.json` via `scripts/build-release.ps1` com verificação estrita de hashes/assinatura antes de promover release público e `git push` autorizados.

---

## 9. Estratégia de Rollback

### Cenário A — Falha do cliente atualizado
- Manter o banco de Produção atualizado (`20261117151310` é aditiva e não afeta tabelas usadas pela `1.4.4`).
- Reverter a distribuição pública / anunciar retorno para a versão estável `1.4.4` (`4d15dfd`), preservando instalador e manifesto válidos da `1.4.4` e orientando backup local dos dados do usuário caso necessário downgrade manual.

### Cenário B — Falha crítica no banco pós-migração
- Interromper publicação/uso do cliente novo imediatamente e suspender novas operações.
- Avaliar impacto em `xerife_6b` e `public.mesa_6b_aberto` sem executar `DROP SCHEMA ... CASCADE` automático.
- Caso ainda não haja dados legítimos em `xerife_6b`/`mesa_6b_aberto` ou após captura prévia de auditoria, aplicar procedimento previamente aprovado (restauração do backup validado de Produção ou remoção controlada e ordenada em transação aprovada: retirada de `public.mesa_6b_aberto` da publicação `supabase_realtime`, remoção dos 5 wrappers `public.*_6b_xerife` e objetos na ordem inversa de criação). Lembrar que restaurar snapshot reverte alterações ocorridas após o instante do backup.

---

## 10. Checklist de Monitoramento Pós-Deploy e Pendências para XER-04

### Monitoramento pós-deploy (Produção)
- [ ] `get_advisors` (`security` e `performance`) em `jxxhdqoyblykqiiyptsp` sem novas exposições em `xerife_6b` ou `public.mesa_6b_aberto`.
- [ ] `query_logs` (`postgres`, `postgrest`, `realtime`) sem erros inesperados `42501` em sessões legítimas do Xerife, sem `500`, e sem vazamento de erros em `ler_6b_xerife`/`rolar_6b_xerife`/`consumir_6b_xerife`/`renovar_6b_xerife`/`presenca_6b_xerife`.
- [ ] Conexão Realtime de jogador recebe apenas `mesa_6b_aberto` (`INSERT`/`UPDATE`), nunca `xerife_6b.conjuntos`.
- [ ] Conferir MESA-01 (redimensionamento), MESA-02 (`Delete` só do token selecionado pelo Xerife), MESA-03 (duplo clique abre ficha correta) e XER-01/02/03 em mesa real controlada.

### Pendências registradas antes de iniciar XER-04
- Limpeza controlada dos 2 usuários QA sintéticos (`aa6b0001-...`, `aa6b0002-...`) e 1 ficha órfã em Homologação (`igyupxczhczidfgtjiws`).
- Reconciliação de `supabase_migrations.schema_migrations` em Homologação (`20261117151310`) e espelhamento das migrações históricas locais caso o projeto adote `supabase db push` contínuo.
- Verificação/resolução do billing do GitHub Actions para automação de futuros releases.
- Planejamento e implementação de `XER-04`, `XER-05` e `XER-06` em ciclo posterior separado após estabilização da implantação atual.
