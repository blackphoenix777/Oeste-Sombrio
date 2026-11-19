# Oeste Sombrio 2.0 — Checkpoint 10B: Consolidação Git, Segurança e Preparação da Release `1.4.7`

**Data e Horário UTC:** `2026-11-19T15:31:28Z`  
**Classificação Final:** **`APROVADO COM RESSALVAS`**

> [!IMPORTANT]
> **Gate Final — Checkpoint 10C Respeitado:** Nenhuma operação pública ou remota foi executada. Sem merge em `main`, sem `git push`, sem tag `v1.4.7`, sem GitHub Release, sem publicação do instalador, sem alteração de `latest.json` público, sem modificação em Produção (`jxxhdqoyblykqiiyptsp`) ou Homologação (`igyupxczhczidfgtjiws`) e sem alteração no Notion. A release pública `v1.4.6` permanece 100% preservada.

---

## 1. Branch e Commits Criados (Fase D e Fase E)

- **Branch de desenvolvimento:** `feature/com09-com12-reactions`
- **Commit-base (`main` = `origin/main` preservados):** `f743bbdb694e5400c127551fb546969535e180a9` (`v1.4.6`)
- **Commits locais criados exclusivamente em `feature/com09-com12-reactions` (sem `git add .`):**

| # | Hash | Mensagem | Escopo |
| --- | --- | --- | --- |
| 1 | `7eb18470a240dc7e8bd45c40d96016bf0b47e46e` | `feat(combat): implement COM-09/10/11/12 reactions, opportunities and contextual bar` | `6` arquivos de produto (`dist/*`) |
| 2 | `1bbf9184f541b4dc2ace8883c720303b5155d69f` | `feat(db): add COM-09/12 reactions migration, rollback and traceability` | Migração SQL + rollback + rastreabilidade |
| 3 | `cab16c6e2a1965cbccea98bd18c9ab6764fbbaf4` | `test(combat): add COM-09/12 UI, PG17 RLS and Homologation suites` | `4` suítes automatizadas (`tests/*`) |
| 4 | `c0780e5a42c02219d8f4526d618896467f0b920c` | `docs(combat): record COM-09/12 validation, homologation and production deploy reports` | `5` relatórios técnicos (Pacotes 9 a 10A) |
| 5 | `19e6f1ccaea099b9580c12bfa951769fc18870ae` | `chore(release): bump version to 1.4.7 and switch release workflow to manual draft dispatch` | `5` arquivos de versão `1.4.7` + `.github/workflows/release.yml` |
| 6 | *(commit de documentação deste relatório)* | `docs(release): record Checkpoint 10B git consolidation and 1.4.7 build report` | `database/com09-com12-acoes-reacoes/07-consolidacao-git-build-147.md` |

---

## 2. Inventário Exato dos Arquivos Versionados na Branch (`25` arquivos no total)

- **Produto (`6`):** `dist/index.html`, `dist/style.css`, `dist/js/rules/index.js`, `dist/js/rules/reactionRules.js`, `dist/js/mesaScreen.js`, `dist/js/turnTracker.js`.
- **Banco e Rastreabilidade (`3`):** `supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql`, `database/com09-com12-acoes-reacoes/02-rollback-com09-com12.sql`, `database/com09-com12-acoes-reacoes/MIGRATION-TRACEABILITY.md`.
- **Testes (`4`):** `tests/com09-com12-reactions-ui.cjs`, `tests/rls-com09-com12-reactions.sql`, `tests/com09-com12-pg17-validation.cjs`, `tests/live-com09-com12-homolog.cjs`.
- **Documentação Técnica (`6`):** `01-auditoria-implementacao-e-gate-homologacao.md`, `03-validacao-postgresql17-e-preparacao-homologacao.md`, `04-homologacao-controlada-com09-com12.md`, `05-preparacao-producao-release-147.md`, `06-implantacao-producao-com09-com12.md`, `07-consolidacao-git-build-147.md`.
- **Metadados `1.4.7` e Workflow (`6`):** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`.
- **Preservados fora dos commits (não incluídos nem apagados):** `supabase/.temp/`, relatórios históricos pré-existentes (`database/com01-com02-auditoria-contratos.md`, `database/homologacao-com05-com08/`, `database/pre-implantacao-com05-com08/`, `database/implantacao-com05-com08/`, `database/implantacao-mesa-p0-xerife-p02/07-publicacao-oficial-145.md`, `database/xerife-6b-xer05-xer06/10-publicacao-oficial-146.md`), backups locais e artefatos compilados.

---

## 3. Análise de Migrações e Estratégia Canônica de Rastreabilidade (Fase B — Gate B: APROVADO)

Consulta somente leitura aos registros efetivos de `supabase_migrations.schema_migrations` comprovou **identidade byte a byte** entre o arquivo local e os dois bancos remotos:

| Ambiente | Versão Registrada | Nome | `statements` (chars) | MD5 (`statements`) |
| --- | --- | --- | ---: | --- |
| **Repositório Local (Canônico)** | `20261119120000` | `20261119120000_com09_com12_reactions_and_opportunities.sql` | `53.631` (`trimEnd`) / `55.995` B | `8ae4b4c1e185240c9eeac8ffd4cd1833` *(SHA-256 `dfa14675...`)* |
| **Homologação (`igyupxczhczidfgtjiws`)** | `20261119121535` | `com09_com12_reactions_and_opportunities` | `53.631` | `8ae4b4c1e185240c9eeac8ffd4cd1833` |
| **Produção (`jxxhdqoyblykqiiyptsp`)** | `20261119145851` | `com09_com12_reactions_and_opportunities` | `53.631` | `8ae4b4c1e185240c9eeac8ffd4cd1833` |

- **Estratégia canônica formalizada em [`MIGRATION-TRACEABILITY.md`](MIGRATION-TRACEABILITY.md):**
  1. Manter o arquivo único `20261119120000_com09_com12_reactions_and_opportunities.sql` no Git (sem renomeação retroativa, sem cópias duplicadas, sem edição manual em `schema_migrations`).
  2. Proibir `supabase db push` indiscriminado contra Produção ou Homologação enquanto existir diferença de timestamp; novas migrações devem ser aplicadas individualmente (`apply_migration` ou `--workdir` isolado validado com `--dry-run`) e registradas na tabela de equivalência.
  3. Qualquer reconciliação futura de timestamps via `supabase migration repair` exigirá autorização separada.
  4. Como salvaguarda adicional, o SQL de `20261119120000` usa exclusivamente `CREATE OR REPLACE FUNCTION`, `REVOKE ALL` e `GRANT EXECUTE` idempotentes (risco zero de perda de dados).

---

## 4. Auditoria `SECURITY DEFINER` e Alerta Supabase (Fase C — APROVADO, `0` Vulnerabilidades)

Auditoria técnica completa sobre `public.gerenciar_reacao_combate` e o incremento `19 → 20` no lint `authenticated_security_definer_function_executable`:

| Critério Auditado | Evidência Verificada | Status |
| --- | --- | :---: |
| **Necessidade de `SECURITY DEFINER`** | `public.mesas` possui policy `mesas_update_only_mestre`; jogadores legítimos precisam solicitar/cancelar reações antecipadas e executar reações pós-turno em `combate_ativo` sem receber permissão de `UPDATE` direto em `public.mesas`. | **Justificado** |
| **Justificativa de `EXECUTE` para `authenticated`** | RPC chamada diretamente por clientes autenticados (Xerife e Jogadores); `PUBLIC` e `anon` explicitamente revogados (`false`). | **Justificado** |
| **Validação de `auth.uid()`** | Bloqueia imediatamente `auth.uid() IS NULL` com `SQLSTATE 42501` (comprovado em PG 17 e Homologação). | **PASS** |
| **Autoridade do Xerife e Controle do Combatente** | `open_opportunity`, `close_opportunity`, `approve_early_reaction`, `deny_early_reaction` exigem `public.is_mestre_da_mesa(p_mesa_id)`; para não-Mestre exige pertencimento em `membros_mesa`, `tok.owner_type = 'player'` e `tok.owner_user_id = auth.uid()`. | **PASS** |
| **Isolamento entre mesas** | Lock `SELECT ... FROM public.mesas WHERE id = p_mesa_id FOR UPDATE`, verificação de `membros_mesa`, `tok.mesa_id = p_mesa_id`, `p_combate_id = estado->>'id'` e `p_mapa_id = estado->>'mapa_id'`. Xerife de outra mesa e usuário externo recebem `42501`. | **PASS** |
| **Parâmetros, custos e idempotência** | Validação estrita de `v_op`, `v_op_id`, `v_action_key`, `public.custo_canonico_acao_combate`, alcance pela grade (`1.5m/quadrado`), idempotência `p_op_id` com checagem de payload e conflito `PT409` sem saldo negativo. | **PASS** |
| **`search_path` e owner** | `SET search_path = ''`, owner `postgres`, todas as referências totalmente qualificadas (`public.*`), zero `EXECUTE` dinâmico (`has_dynamic_execute = false`). | **PASS** |
| **Helper interno** | `public.calcular_fase_turno_combate` é `SECURITY INVOKER`, `search_path = ''`, `REVOKE ALL FROM PUBLIC, anon, authenticated`. | **PASS** |

- **Veredito do alerta Supabase `authenticated_security_definer_function_executable` (`19 → 20`):** alerta informativo esperado para RPCs de domínio com validação interna rigorosa; **zero vulnerabilidades ou riscos de bypass RLS identificados**.

---

## 5. Arquivos de Versão Alterados e Avaliação de `.github/workflows/release.yml` (Fase E)

- **Arquivos atualizados de `1.4.6` → `1.4.7`:**
  - [`package.json`](../../package.json)
  - [`package-lock.json`](../../package-lock.json)
  - [`src-tauri/Cargo.toml`](../../src-tauri/Cargo.toml)
  - [`src-tauri/Cargo.lock`](../../src-tauri/Cargo.lock)
  - [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) *(preservados `identifier = com.stefano.darkwest`, `pubkey` `F08EB962D585140A`, `endpoints` e `installMode = passive`)*
- **Avaliação arquitetural e correção generalizável em [`.github/workflows/release.yml`](../../.github/workflows/release.yml):**
  - **Problema anterior:** `on: push: tags: ['v*']` disparava automaticamente `tauri-action` com `releaseDraft: false` para qualquer nova tag não listada na exclusão manual (`v1.4.4`, `v1.4.5`, `v1.4.6`), criando risco de publicação automática duplicada a cada nova versão.
  - **Solução generalizável aplicada:** removido o gatilho automático `push: tags` e mantido exclusivamente `workflow_dispatch` manual com input explícito `tag_name` e `releaseDraft: true`. Isso protege `v1.4.7`, `v1.4.8`, `v1.5.0` e todas as versões futuras sem listas hardcoded e sem possibilidade de publicação não autorizada.

---

## 6. Regressões Finais Pré-Build sobre `1.4.7` (Fase H — `9/9 PASS` + `44/44` ESM)

- **Sintaxe ES modules (`dist/js/`, excluindo `vendor/`):** **`44/44 OK`**.
- **Suítes automatizadas (`task-627`, `PREBUILD_REGRESSIONS_PASS=9/9`, todas `EXIT=0`):**
  1. `tests/com09-com12-reactions-ui.cjs` (`34.451 ms`) — **PASS**
  2. `tests/com03-com04-creature-mode.cjs` (`4.628 ms`) — **PASS**
  3. `tests/com05-com06-initiative-budget.cjs` (`3.941 ms`) — **PASS**
  4. `tests/com07-com08-controller-events.cjs` (`4.341 ms`) — **PASS**
  5. `tests/turn-tracker-ui.cjs` (`3.253 ms`) — **PASS**
  6. `tests/xerife-6b-ui.cjs` (`5.541 ms`) — **PASS**
  7. `tests/xerife-6b-xer04-own-editor.cjs` (`5.271 ms`) — **PASS**
  8. `tests/xerife-6b-xer05-instance-persistence.cjs` (`5.919 ms`) — **PASS**
  9. `tests/xerife-6b-xer06-instance-combat.cjs` (`4.292 ms`) — **PASS**
- **Configuração de Produção:** `dist/js/supabaseConfig.js` preservado apontando exclusivamente para `https://jxxhdqoyblykqiiyptsp.supabase.co`.

---

## 7. Build Local NSIS, SHA-256, Minisign e Smoke Nativo `1.4.7` (Fase F — `PASS`)

- **Comando executado:** `./scripts/build-release.ps1 -SkipPublish` (`task-631`, `3m 03s`, `EXIT=0`, chave privada carregada de `C:\.tauri\darkwest.key` sem exposição em logs).
- **Stage isolado limpo:** `src-tauri/target/release/bundle/release-upload-1.4.7/` contendo exclusivamente os `3` artefatos da `v1.4.7` (`release-upload-1.4.4/`, `1.4.5/` e `1.4.6/` integralmente preservados).
- **Versão PE de `DarkWest.exe`:** `FileVersion = 1.4.7`, `ProductVersion = 1.4.7`, `ProductName = Dark West Character Sheet`.

### Artefatos Produzidos e Hashes SHA-256 (`VERIFY_147_ALL_PASS=true`)

| Artefato Local | Tamanho (bytes) | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/release/DarkWest.exe` | `15.044.096` | `be4df6c52587fff01997d19abf67b2a65b9c042e12e1aa81d11716f8dddbf969` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.7_x64-setup.exe` | `5.585.243` | `cc6ada86c8ef5af8d2d0a5d50addd42a9a183ecefd2866843b9b9dc6a7858634` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.7_x64-setup.exe.sig` | `440` | `b4c47aae647dd11d26da3f7107f2f227a362119278ea66cb3b5547356bde2526` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.7_x64_en-US.msi` | `7.061.504` | `511c6869277f55efaa53b990afe6b72644a5aad4f727ad3cbf33b9f429a49be0` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.7_x64_en-US.msi.sig` | `440` | `2cde16c2959ee12e96f3f965771712e026a76b5779d9de3ce0ca17c252411ead` |
| `src-tauri/target/release/bundle/release-upload-1.4.7/Dark.West.Character.Sheet_1.4.7_x64-setup.exe` | `5.585.243` | `cc6ada86c8ef5af8d2d0a5d50addd42a9a183ecefd2866843b9b9dc6a7858634` |
| `src-tauri/target/release/bundle/release-upload-1.4.7/Dark.West.Character.Sheet_1.4.7_x64-setup.exe.sig` | `440` | `b4c47aae647dd11d26da3f7107f2f227a362119278ea66cb3b5547356bde2526` |
| `src-tauri/target/release/bundle/release-upload-1.4.7/latest.json` | `1.543` | `9119f79d70187495db65951c197a2dc20620bc22e73bb31e477c74378f908c4c` |

- **Validação Criptográfica Minisign (`Key ID F08EB962D585140A`, `ED` / `blake2b512`):**
  - NSIS, MSI e Stage `release-upload-1.4.7`: `payloadOk = true`, `commentOk = true`, `tamperRejected = true` (adulteração de 1 byte rejeitada).
  - `latest.json` (`pub_date = 2026-11-19T15:30:37Z`): `version = "1.4.7"`, URL sem espaços para `v1.4.7/Dark.West.Character.Sheet_1.4.7_x64-setup.exe`, assinatura byte a byte idêntica ao `.sig`.
- **Smoke isolado do binário compilado nativo `DarkWest.exe` v1.4.7 (WebView2 descartável via CDP):**
  - `origin = http://tauri.localhost`, `getVersion() = "1.4.7"`, `OS.SUPABASE_URL = "https://jxxhdqoyblykqiiyptsp.supabase.co"`, `hasReactionRules = true`, `hasReactionController = true`, `hasActionBarDom = true`, `hasOwn6B = true`, `uncaughtExceptions = 0`.

---

## 8. Teste de Atualização em Windows Isolado (Fase G — `NÃO EXECUTADO`)

- **Verificação do host:** `WindowsSandbox.exe = False`, `VBoxManage.exe = False`, recurso `Containers-DisposableClientVM` não habilitado/acessível neste host sem privilégios administrativos.
- **Classificação honesta:** **`NÃO EXECUTADO`**. Conforme as restrições do Checkpoint 10B, o instalador não foi executado sobre a instalação principal do usuário, o updater não foi apontado para manifesto público alterado e a validação criptográfica não foi desabilitada.
- **Declaração explícita:** o fato de o instalador NSIS e a assinatura Minisign serem válidos **não** equivale à aprovação do teste ponta a ponta do updater `1.4.6 → 1.4.7` em ambiente Windows isolado.

---

## 9. Limitações, Pendências e Riscos Residuais

1. **Teste ponta a ponta do updater `1.4.6 → 1.4.7` (`NÃO EXECUTADO` — principal motivo de `APROVADO COM RESSALVAS`):** requer decisão explícita do proprietário no Checkpoint 10C (executar em VM Windows externa ou conceder dispensa formal equivalente à da `v1.4.6`).
2. **Ausência de certificado Authenticode Windows:** mantida como nas versões `1.4.4`–`1.4.6` (SmartScreen em download manual; updater valida Minisign).
3. **Divergência de timestamp em `schema_migrations` (`20261119120000` local vs `20261119121535` Homologação vs `20261119145851` Produção):** integralmente mitigada pela estratégia canônica em [`MIGRATION-TRACEABILITY.md`](MIGRATION-TRACEABILITY.md) (`MD5` idêntico comprovado; `supabase db push` proibido sem reconciliação autorizada).
4. **Aviso de compilação Rust não bloqueante:** `STATIC_VCRUNTIME is deprecated` durante `tauri build` (apenas warning de depreciação de build flag).

---

## 10. Estado Final do Git e Preservação dos Bancos (Fase I)

- **Branch ativa:** `feature/com09-com12-reactions` (`6` commits locais limpos acima de `f743bbdb694e5400c127551fb546969535e180a9`).
- **`main` e `origin/main`:** preservados em `f743bbdb694e5400c127551fb546969535e180a9`.
- **Tags e Releases:** zero tags `v1.4.7` criadas, zero `git push`, release pública `v1.4.6` e `latest.json` público intocados.
- **Segurança no Git:** zero segredos, zero backups, zero arquivos temporários de Homologação incluídos nos commits.
- **Bancos Supabase:** Produção (`jxxhdqoyblykqiiyptsp`, `20` migrações) e Homologação (`igyupxczhczidfgtjiws`, `5` migrações) **100% intocadas** durante todo o Checkpoint 10B (somente leitura na Fase B).

---

## 11. Recomendação para o Checkpoint 10C

A implementação COM-09 a COM-12 está consolidada em commits rastreáveis, os artefatos `1.4.7` estão compilados, assinados e verificados criptograficamente, e Produção já possui a migração aplicada e validada.

**Recomenda-se solicitar autorização explícita do proprietário para iniciar o Checkpoint 10C (Publicação Oficial `v1.4.7`)**, definindo previamente se:
1. O teste de atualização `1.4.6 → 1.4.7` será executado em máquina Windows isolada antes da publicação; **ou**
2. Será concedida dispensa formal documentada (equivalente à da `v1.4.6`) para prosseguir com merge `--no-ff` em `main`, tag anotada `v1.4.7`, `git push`, criação de draft release verificada criptograficamente com os 3 assets de `release-upload-1.4.7/` e publicação como `latest`.
