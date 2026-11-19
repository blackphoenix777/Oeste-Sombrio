# OESTE SOMBRIO 2.0 — PACOTE 7: PREPARAÇÃO, BUILD E VALIDAÇÃO DA RELEASE CANDIDATA `1.4.6`

**Data:** 18/11/2026  
**Classificação Gate Final:** **`BLOQUEADO`** *(pendência de validação isolada da Fase I — instalação limpa NSIS e fluxo vivo `1.4.5 -> 1.4.6` em ambiente Windows descartável/VM; todos os testes de código, Tauri Dev, build `1.4.6`, binário nativo e assinaturas Minisign passaram `100%`)*

O [relatório complementar do Pacote 7.1](08-pacote-7-1-desbloqueio-release-146.md) registra a guarda aplicada, a verificação dos artefatos, a lista de integração e o procedimento vigente para a publicação.

> [!IMPORTANT]
> **Nenhuma operação pública ou remota foi executada:** sem `git commit`, sem merge em `main`, sem criação de tag, sem `git push`, sem GitHub Release, sem alteração de `latest.json` público, sem substituição dos artefatos `1.4.4`/`1.4.5` e sem alterações em Produção (`jxxhdqoyblykqiiyptsp`) ou Homologação (`igyupxczhczidfgtjiws`).

---

## A. Identificação

| Item | Valor Verificado |
|---|---|
| **Branch de Desenvolvimento** | `feature/xerife-6b-npc-boss` |
| **Commit Base (`main` / `v1.4.5^{commit}`) e `HEAD` Atual** | `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab` (objeto tag anotada `v1.4.5`: `0a2de19c3e03a02f532553336027bd8641e98d58`) |
| **Versão Candidata** | `1.4.6` (verificada livre em `git tag -l`, `git ls-remote --tags origin` e GitHub Releases) |
| **Banco de Produção (`jxxhdqoyblykqiiyptsp`)** | `19` migrações aplicadas (`20261118101800` + `20261118153000`), RLS validado, `6` RPCs mutáveis com `PT409`, `9` wrappers `public.*_6b_instancia`, `10` tabelas Realtime, dados preservados (`06-implantacao-producao.md`) |
| **Banco de Homologação (`igyupxczhczidfgtjiws`)** | `4` migrações aplicadas, XER-04/05/06 e `PT409` homologados (`XER-06 APROVADO PARA PRODUÇÃO`) |

---

## B. Mudanças Incluídas na Release `1.4.6`

1. **XER-04 (Editor de 6B Próprio para NPCs e Bosses):**
   - Motor puro [`dist/js/rules/own6BRules.js`](../../dist/js/rules/own6BRules.js), exportações em [`dist/js/rules/cylinderRules.js`](../../dist/js/rules/cylinderRules.js) e [`dist/js/rules/index.js`](../../dist/js/rules/index.js).
   - Compositor `#npc-own-6b-editor` e toggle `#has-own-6b` integrados ao `freeEdit` em [`dist/index.html`](../../dist/index.html), [`dist/style.css`](../../dist/style.css), [`dist/js/cylinder.js`](../../dist/js/cylinder.js), [`dist/js/storage.js`](../../dist/js/storage.js), [`dist/js/magiasUI.js`](../../dist/js/magiasUI.js), [`dist/js/modal.js`](../../dist/js/modal.js) e [`dist/js/mesaXerife6B.js`](../../dist/js/mesaXerife6B.js) (`1..15` dados entre `d4..d12`, independente de Criatura, preservando iniciativa e orçamento de ações).
2. **XER-05 e XER-06 (Persistência e Combate por Instância):**
   - Gerenciamento de instâncias, modal `#defender-damage-modal`, cascata de fadiga, consumo, renovação pós-esgotamento, idempotência (`opId`), troca de mapa, remoção e sincronização Realtime em [`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js), sustentados pelas migrações [`20261118101800_xerife_6b_instance_combat.sql`](../../supabase/migrations/20261118101800_xerife_6b_instance_combat.sql) e [`20261118153000_xerife_6b_instance_conflict_pt409.sql`](../../supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql) já implantadas em Produção.
3. **Tratamento `PT409` / HTTP `409` / Timeout `504` no Frontend:**
   - `isInstance6BConflictError`, `isInstance6BGatewayTimeoutError`, `formatInstance6BError` e `executeInstanceOwn6BCommand` em [`dist/js/mesaScreen.js`](../../dist/js/mesaScreen.js) tratando `PT409`, HTTP `409`, históricos `40001`/`P0409` e timeout `504` separadamente, disparando `OS.refreshInstanceOwn6B` e impedindo retry automático de mutação.
4. **Versionamento Candidato `1.4.6` (Fase D):**
   - [`package.json`](../../package.json), [`package-lock.json`](../../package-lock.json), [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json), [`src-tauri/Cargo.toml`](../../src-tauri/Cargo.toml) e [`src-tauri/Cargo.lock`](../../src-tauri/Cargo.lock) atualizados de `1.4.5` para `1.4.6`.
   - `identifier` (`com.stefano.darkwest`), `plugins.updater.pubkey`, `plugins.updater.endpoints` e `windows.installMode` (`passive`) preservados intactos.
5. **Auditoria de Workspace / Arquivos Não Rastreados (Fases A e K):**
   - Alterados rastreados (`15`): `10` de frontend (`dist/*`) + `5` de versionamento `1.4.6`.
   - Novos/não rastreados relacionados ao ciclo: `dist/js/rules/own6BRules.js`, `2` migrações SQL, `7` testes em `tests/` e `database/xerife-6b-*`.
   - Pré-existentes preservados (não descartados): relatórios `database/com01-com02-auditoria-contratos.md`, `database/homologacao-com05-com08/`, `database/pre-implantacao-com05-com08/`, `database/implantacao-com05-com08/`, `database/implantacao-mesa-p0-xerife-p02/07-publicacao-oficial-145.md` e `supabase/.temp/`.

---

## C. Validações Executadas

### C1. Sintaxe, Segurança e Contrato Frontend ↔ Produção (Fases A, C e E)
- **Sintaxe ESM:** `43/43` arquivos em `dist/js/` (excluindo `vendor/`) aprovados via `node --input-type=module --check` (`ESM_SYNTAX_OK=43/43`).
- **Configuração de Produção:** [`dist/js/supabaseConfig.js`](../../dist/js/supabaseConfig.js) aponta exclusivamente para `https://jxxhdqoyblykqiiyptsp.supabase.co` com chave pública `sb_publishable_DfYQXnw7eoSg4RX5dYLw-g_9IUISoNu`; zero `service_role`, zero credenciais privadas e zero referências a `igyupxczhczidfgtjiws` em `dist/`.
- **Alinhamento SQL ↔ JS:** parâmetros de todas as 9 RPCs `public.*_6b_instancia` conferidos 1-to-1 entre `mesaScreen.js` e `pg_proc` de Produção (`jxxhdqoyblykqiiyptsp`).

### C2. Suítes Automatizadas Executadas em `1.4.6` (`ALL_SUITES_DONE TOTAL=16 FAILED=0`)

| Suíte | Exit | Duração | Resultado |
|---|---:|---:|---|
| [`tests/xerife-6b-xer04-own-editor.cjs`](../../tests/xerife-6b-xer04-own-editor.cjs) | `0` | `9.453 ms` | **PASS: 31 verificações** |
| [`tests/xerife-6b-xer05-instance-persistence.cjs`](../../tests/xerife-6b-xer05-instance-persistence.cjs) | `0` | `8.020 ms` | **PASS: 10 verificações** |
| [`tests/xerife-6b-xer06-instance-combat.cjs`](../../tests/xerife-6b-xer06-instance-combat.cjs) | `0` | `2.196 ms` | **PASS: 32 verificações** *(incl. `PT409`, `409`, `40001`, `P0409`, `504`)* |
| [`tests/com03-com04-creature-mode.cjs`](../../tests/com03-com04-creature-mode.cjs) | `0` | `2.499 ms` | **PASS: 25 verificações** |
| [`tests/com05-com06-initiative-budget.cjs`](../../tests/com05-com06-initiative-budget.cjs) | `0` | `3.051 ms` | **PASS: 28 verificações** |
| [`tests/com07-com08-controller-events.cjs`](../../tests/com07-com08-controller-events.cjs) | `0` | `2.764 ms` | **PASS: 23 verificações** |
| [`tests/xerife-6b-ui.cjs`](../../tests/xerife-6b-ui.cjs) | `0` | `2.820 ms` | **PASS: 39 verificações** |
| [`tests/mesa-6b.cjs`](../../tests/mesa-6b.cjs) | `0` | `4.871 ms` | **PASS** |
| [`tests/mesa-p0-interactions.cjs`](../../tests/mesa-p0-interactions.cjs) | `0` | `5.463 ms` | **PASS: 33 verificações** |
| [`tests/gm-tools-ui.cjs`](../../tests/gm-tools-ui.cjs) | `0` | `4.731 ms` | **PASS: 33 verificações** |
| [`tests/multiple-maps-ui.cjs`](../../tests/multiple-maps-ui.cjs) | `0` | `1.839 ms` | **PASS: 27 verificações** |
| [`tests/turn-tracker-ui.cjs`](../../tests/turn-tracker-ui.cjs) | `0` | `3.060 ms` | **PASS: 28 verificações** |
| [`tests/token-initiative.cjs`](../../tests/token-initiative.cjs) | `0` | `180 ms` | **PASS: 11 grupos** |
| [`tests/scene-read.cjs`](../../tests/scene-read.cjs) | `0` | `204 ms` | **PASS** |
| [`tests/map-camera.cjs`](../../tests/map-camera.cjs) | `0` | `4.085 ms` | **PASS: 37 verificações** |
| [`tests/auth-session.cjs`](../../tests/auth-session.cjs) | `0` | `103 ms` | **PASS** |

- **Rust / Cargo (`cargo test --manifest-path src-tauri/Cargo.toml`):** após limpeza exclusiva do cache antigo em `src-tauri/target/debug` (`12,05 GB` -> resolvendo `os error 112` inicial de disco em `C:`), compilou em `5m 07s` com **`CARGO_TEST_EXIT=0`** (`0` testes unitários definidos em Rust; `0 failed`).
- **PostgreSQL / Homologação / Produção:** zero alterações SQL nesta etapa; preservadas as validações PG 17 dos Pacotes 5, 5.1 (`xerife-6b-pg17-conflict-pt409.cjs` `EXIT=0`, `live-xerife-6b-pt409-homolog.cjs` `EXIT=0` em `142–332 ms` HTTP `409 PT409`) e Pacote 6 (`jxxhdqoyblykqiiyptsp` `19` migrações e probe HTTP `401`/`42501`). Docker Desktop permaneceu desligado no Pacote 7.

### C3. Tauri Dev (`npm run tauri dev`) e Binário Nativo `DarkWest.exe` v1.4.6 (Fases F e H)
- **Tauri Dev (`npm run tauri dev`, WebView2 isolado + CDP `9346`, `task-2453`):** **`TAURI_DEV_PASS=19/15_AREAS | UNCAUGHT=0 | PHASE_F_EXIT=0`**:
  - Validados: `getVersion() === "1.4.6"`, `ProductName === "Dark West Character Sheet"`, `OS.SUPABASE_URL === "https://jxxhdqoyblykqiiyptsp.supabase.co"`, IPC `list/save/load/delete` preservando as `4` fichas locais, rejeição de sessão inexistente (`await OS.verifyAuthSession() === false`), ping read-only HTTPS em Produção (`anon 0 linhas`), ações/iniciativa legado, editor XER-04 (`15 / 15 dados` independente de `isCriatura`), 2 Bosses independentes, consumo, `#defender-damage-modal`, fadiga cascata, renovação `+1`, Realtime + troca de mapa, `PT409` sem retry automático e Turn Tracker (`operationalMode === "full_sheet"`).
- **Binário Compilado Nativo (`src-tauri/target/release/DarkWest.exe` v1.4.6, WebView2 isolado `9347`, `task-2315`):** **`NATIVE_146_EXIT=0`** (`origin=http://tauri.localhost`, `ver=1.4.6`, `upd=null` contra `latest.json` público atual `1.4.5`, `charsCount=4`, `anonMesasOk=true`, `hasOwn6BRules=true`, `0` exceções).

### C4. Build Local, Assinaturas Minisign e Auditoria do Updater / CI (Fases G, H, I e J)
- **Build (`./scripts/build-release.ps1 -SkipPublish`):** **`BUILD_146_EXIT=0`** (`1m 46s`), carregando chave privada de `C:\.tauri\darkwest.key` (sem imprimir chave, `C:\.tauri\darkwest.key.pub` idêntica à `plugins.updater.pubkey` de `tauri.conf.json`).
- **Verificação Criptográfica (`VERIFY_146_EXIT=0`):**
  - `minisign_nsis: PASS` (`trusted comment: timestamp:1795055182\tfile:Dark West Character Sheet_1.4.6_x64-setup.exe`)
  - `minisign_msi: PASS` (`trusted comment: timestamp:1795055182\tfile:Dark West Character Sheet_1.4.6_x64_en-US.msi`)
  - `tamper_reject: PASS` (adulteração de 1 byte rejeitada)
  - Compatibilidade `latest.json` (`1.4.5` -> `1.4.6`): mesma `pubkey` (`F08EB962D585140A`), plataforma `windows-x86_64`, `url` sem espaços e assinatura idêntica ao `.sig`.
  - Artefatos históricos em `release-upload-1.4.4/` e `release-upload-1.4.5/` **100% preservados**.
- **Instalação Limpa NSIS e Atualização `1.4.5 -> 1.4.6` (Fase I — PENDÊNCIA BLOQUEANTE):**
  - **Não executada** em ambiente Windows isolado (`WindowsSandbox.exe` ausente neste host; executar o instalador NSIS diretamente no host gravaria registro `HKCU` / `%LOCALAPPDATA%`, e o binário público `1.4.5` possui o endpoint HTTPS do GitHub compilado estaticamente, sem override por variável de ambiente para manifesto local sem modificar hosts/DNS).
- **Workflow GitHub Actions ([`.github/workflows/release.yml`](../../.github/workflows/release.yml), Fase J):**
  - Linha 30 contém `if: startsWith(github.ref, 'refs/tags/') && github.ref != 'refs/tags/v1.4.4' && github.ref != 'refs/tags/v1.4.5'`.
  - **Ajuste necessário antes do envio da tag `v1.4.6` (se publicar artefatos assinados localmente):** adicionar `&& github.ref != 'refs/tags/v1.4.6'` na linha 30 (ou regularizar o billing do Actions caso queira build remoto no runner Windows).

---

## D. Artefatos Produzidos (`1.4.6`)

| Nome / Caminho Local | Bytes | SHA-256 | Assinatura / Versão |
|---|---:|---|---|
| `src-tauri/target/release/DarkWest.exe` | `15.027.712` | `2103737dc08aec75f73948fea658f791b9856d4f6029e45ca916c18fca1fd8bd` | PE `FileVersion=1.4.6` / `ProductVersion=1.4.6` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.6_x64_en-US.msi` | `7.041.024` | `4c22dab45e426ebdbe815cbeb1c1fbdb25512d49de357084178b9ba4b94b1201` | Assinado Minisign (`PASS`) / `1.4.6` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.6_x64_en-US.msi.sig` | `440` | `bf6a524c7f7b94501f533ec46198ace4b47d201915f6f70c97cba0ea73c20654` | `.sig` MSI válida / `1.4.6` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.6_x64-setup.exe` | `5.568.792` | `8d27ce4cedf7220fdefe4baa8cc6142e3906ff08f1a3ac7c34cb5a02f727202f` | Assinado Minisign (`PASS`) / `1.4.6` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.6_x64-setup.exe.sig` | `440` | `01ac4a1d86765a2cf2434e39f4545fc03228db23baed09e9dbf8e4c167ae356d` | `.sig` NSIS válida / `1.4.6` |
| `src-tauri/target/release/bundle/release-upload-1.4.6/Dark.West.Character.Sheet_1.4.6_x64-setup.exe` | `5.568.792` | `8d27ce4cedf7220fdefe4baa8cc6142e3906ff08f1a3ac7c34cb5a02f727202f` | Stage limpo upload / `1.4.6` |
| `src-tauri/target/release/bundle/release-upload-1.4.6/Dark.West.Character.Sheet_1.4.6_x64-setup.exe.sig` | `440` | `01ac4a1d86765a2cf2434e39f4545fc03228db23baed09e9dbf8e4c167ae356d` | Stage limpo `.sig` / `1.4.6` |
| `src-tauri/target/release/bundle/release-upload-1.4.6/latest.json` | `1.670` | `76cad3f8a3557f14b21389fd254c60a2b41a54aab13ca1ad52012bbed60f3700` | Manifesto updater `pub_date: 2026-11-19T02:26:22Z` / `1.4.6` |

---

## E. Riscos, Limitações e Ressalvas

1. **Bloqueio de Fase I (Teste de Instalação Limpa e Auto-Update `1.4.5 -> 1.4.6` em VM Windows):** não foi possível executar o ciclo completo do instalador NSIS nem simular servidor local de `latest.json` contra o binário `1.4.5` sem poluir o registro do host ou editar DNS/`hosts`. Conforme critério do Pacote 7, isso mantém o status **`BLOQUEADO`** até execução em VM/Sandbox ou dispensa explícita na autorização de publicação.
2. **Testes Unitários Rust:** `cargo test` compilou sem erros, mas `src-tauri` possui `0` testes unitários escritos.
3. **Guarda no `.github/workflows/release.yml`:** sem adicionar `&& github.ref != 'refs/tags/v1.4.6'` na linha 30, o push da tag `v1.4.6` acionará o job `release` no GitHub Actions.
4. **Higiene Git antes do commit/merge:** arquivos não rastreados antigos (`database/com01-com02-auditoria-contratos.md`, `database/*-com05-com08/`, `supabase/.temp/`) devem permanecer fora dos commits finais de release.
5. **Authenticode:** como nas releases `1.4.4`/`1.4.5`, os instaladores têm assinatura Minisign do updater, mas não certificado Authenticode Windows.

---

## F. Plano Exato de Publicação (Aguardando Autorização)

1. **Decisão sobre Fase I & guarda de CI:** executar o ensaio de instalação/update em VM Windows descartável (ou autorizar publicação com dispensa formal) e decidir pela inclusão de `&& github.ref != 'refs/tags/v1.4.6'` em `.github/workflows/release.yml`.
2. **Integração Git (sem `supabase/.temp/` nem pastas antigas não relacionadas):** consolidar commits na branch `feature/xerife-6b-npc-boss`, fazer merge `--no-ff` (ou fast-forward controlado) em `main` e `git push origin main`.
3. **Tag anotada `v1.4.6`:** `git tag -a v1.4.6 -m "Release v1.4.6"` apontando para o commit final em `main` e `git push origin v1.4.6`.
4. **Publicação GitHub Release (`v1.4.6`):** criar release preferencialmente como **draft** com os 3 arquivos de `src-tauri/target/release/bundle/release-upload-1.4.6/` (`Dark.West.Character.Sheet_1.4.6_x64-setup.exe`, `.sig`, `latest.json`), validar hashes e publicar tornando-a `latest`. *(Alternativamente, se buildar via GitHub Actions, garantir billing ativo e secret `TAURI_SIGNING_PRIVATE_KEY`).*
5. **Validação pós-publicação:** confirmar `HTTP 200`, SHA-256 e assinatura Minisign nos downloads públicos de `releases/download/v1.4.6/*` e `releases/latest/download/latest.json`, além de teste de atualização em uma instância real `1.4.5 -> 1.4.6` com conta autenticada em Produção.
6. **Monitoramento e rollback:** acompanhar abertura das mesas e RPCs `*_6b_instancia` no Supabase; em caso de falha do cliente `1.4.6`, clientes atualizados não fazem downgrade automático pelo updater — disponibilizar reinstalador `1.4.5` preservado em `release-upload-1.4.5/` e na tag `v1.4.5` mantendo o banco de Produção compatível.
