# Pacote 3 — Preparação, Compilação e Validação da Versão 1.4.5

**Data:** 17/11/2026  
**Escopo incluído:** MESA P0 (`MESA-01`, `MESA-02`, `MESA-03`) + XER P0-2 (`XER-01`, `XER-02`, `XER-03`)  
**Exclusões confirmadas:** `XER-04`, `XER-05`, `XER-06` (0 ocorrências no código-fonte/frontend/distribuição)  
**Estado:** **PREPARADA LOCALMENTE — NÃO PUBLICADA / SEM COMMIT / SEM TAG / SEM PUSH**

> [!IMPORTANT]
> Nenhuma operação remota de publicação foi executada. Não houve `git commit`, `git push`, criação de tag, upload de assets, alteração de `latest.json` público ou modificação no Supabase de Produção (`jxxhdqoyblykqiiyptsp`) e Homologação (`igyupxczhczidfgtjiws`).

---

## 1. Estado Inicial Confirmado (Etapa A)

- **Branch e `HEAD`:** `main` em `0c996fab7e0c6003a564b09c1a26f80a0115aa04`.
- **Commits consolidados incluídos sobre `4d15dfd` (`1.4.4`):**
  - `5f9c2c2` — `feat(mesa): implement MESA-01/02/03 panel resize, token delete, and sheet popup`
  - `74473e4` — `feat(xerife-6b): implement P0-2 shared 6B pools foundation and UI`
  - `0c996fa` — `docs(xerife-6b): add P0-2 tests, security audit, and consolidation report`
- **Migrações em `supabase/migrations/`:** `17` arquivos SQL (`16` históricos + `20261117151310_xerife_6b_foundation.sql`), todas aplicadas e validadas em Produção (`jxxhdqoyblykqiiyptsp`).
- **Varredura de segredos e exclusões:** zero ocorrências de `service_role` literal/chave ativa, JWTs, `sb_secret_`, `igyupxczhczidfgtjiws` ou código de `XER-04`/`XER-05`/`XER-06` em `dist/`, `src-tauri/` e `scripts/`. Apenas `dist/js/supabaseConfig.js` contém a URL pública de Produção (`jxxhdqoyblykqiiyptsp`) e `OS.SUPABASE_ANON_KEY` (`sb_publishable_...`).

---

## 2. Testes Executados Nesta Sessão vs. Evidências Históricas (Etapa B)

### 2.1 Executados nesta sessão (após `0c996fa`)

| Verificação | Escopo / Comando | Resultado observado |
|---|---|---|
| Sintaxe ESM JS | `Get-ChildItem dist\js -Filter '*.js' \| node --input-type=module --check` | **PASS** (`JS_SYNTAX_OK=31` arquivos) |
| MESA P0 UI | `node tests/mesa-p0-interactions.cjs` (Chromium headless + mocks) | **PASS: 33 verificações** (`MESA_P0_EXIT=0`) |
| Xerife 6B UI | `node tests/xerife-6b-ui.cjs` (Chromium headless + mocks RPC/Realtime) | **PASS: 39 verificações** (`XER_6B_UI_EXIT=0`) |
| Regressão 1 | `node tests/auth-session.cjs` | **PASS** (`EXIT=0`) |
| Regressão 2 | `node tests/scene-read.cjs` | **PASS** (`EXIT=0`) |
| Regressão 3 | `node tests/token-initiative.cjs` | **PASS: 11 grupos** (`EXIT=0`) |
| Regressão 4 | `node tests/com03-com04-creature-mode.cjs` | **PASS: 25 verificações** (`EXIT=0`) |
| Regressão 5 | `node tests/com05-com06-initiative-budget.cjs` | **PASS: regras puras + 28 verificações** (`EXIT=0`) |
| Regressão 6 | `node tests/com07-com08-controller-events.cjs` | **PASS: JSON/SQL estático + 23 verificações** (`EXIT=0`) |
| Regressão 7 | `node tests/turn-tracker-ui.cjs` | **PASS: 28 verificações** (`EXIT=0`) |
| Regressão 8 | `node tests/mesa-6b.cjs` | **PASS** (`EXIT=0`) |
| Regressão 9 | `node tests/map-camera.cjs` | **PASS: 37 verificações** (`EXIT=0`) |
| Regressão 10 | `node tests/gm-tools-ui.cjs` | **PASS: 33 verificações** (`EXIT=0`) |
| Regressão 11 | `node tests/multiple-maps-ui.cjs` | **PASS: 27 verificações** (`EXIT=0`) |
| Rust/Tauri Cargo | `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS compilação** (`CARGO_TEST_EXIT=0`; **0 testes unitários/doc definidos**) |
| Ambiente WebView2 Windows | Registro `EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` | **Presente** (`WEBVIEW2_PV=157.0.4341.46`) |

*Observação honesta de cobertura:* os `12/12` testes de regressão + `tests/xerife-6b-ui.cjs` passaram com `REGRESSIONS_FAILED=0` em Chromium/Node com backend simulado. O `cargo test` compilou sem erros, mas **não possui testes unitários em Rust** (`0 passed`).

### 2.2 Evidências históricas preservadas (não reexecutadas nesta sessão)

- `tests/live-xerife-6b.cjs` contra Homologação (`igyupxczhczidfgtjiws`): `17/17` PASS em [live-xerife-6b-results.json](../../tests/artifacts/live-xerife-6b-results.json).
- Ensaio nativo WebView2 isolado (`XerifeP02Verified.exe`): `39/39` PASS em [xerife-6b-native.txt](../../tests/artifacts/xerife-6b-native.txt).

---

## 3. Versionamento 1.4.5 (Etapa C)

Arquivos oficiais atualizados de `1.4.4` para `1.4.5` (`6 insertions(+), 6 deletions(-)`):

1. `package.json` (`"version": "1.4.5"`)
2. `package-lock.json` (`"version": "1.4.5"` na raiz e em `packages[""]`)
3. `src-tauri/Cargo.toml` (`version = "1.4.5"`)
4. `src-tauri/Cargo.lock` (`name = "app"`, `version = "1.4.5"`)
5. `src-tauri/tauri.conf.json` (`"version": "1.4.5"`)

**Integridade preservada:**
- `identifier`: `"com.stefano.darkwest"` (inalterado).
- `plugins.updater.pubkey`: chave pública Minisign original preservada integralmente.
- `plugins.updater.endpoints`: `["https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json"]` (inalterado).
- `plugins.updater.windows.installMode`: `"passive"` (inalterado).
- Arquivos históricos `1.4.4` (`scripts/verify-release-144.cjs`, `.github/workflows/release.yml`, `database/implantacao-com05-com08/*`) mantidos intactos.

---

## 4. Build Windows / Tauri e Sistema de Atualização (Etapas D e E)

### 4.1 Compilação executada

- **Comando oficial local:**
  `powershell -ExecutionPolicy Bypass -File ./scripts/build-release.ps1 -SkipPublish -ReleaseNotes <notas-1.4.5>`
- **Resultado:** `BUILD_RELEASE_EXIT=0` (`Finished release profile [optimized] target(s) in 2m 08s`). Aviso não bloqueante do crate `tauri-build`: `STATIC_VCRUNTIME is deprecated`.
- **Chave de assinatura:** lida em memória pelo script oficial a partir de `C:\.tauri\darkwest.key` (sem imprimir, copiar ou modificar a chave privada).
- **Versão PE do binário compilado (`DarkWest.exe`):** `FileVersion = 1.4.5`, `ProductVersion = 1.4.5`, `ProductName = Dark West Character Sheet`.
- **Inventário de `dist/`:** `106` arquivos de produção auditados (`dist/index.html`, `dist/script.js`, `dist/style.css`, `31` arquivos `.js` em `dist/js/` + `vendor/supabase.js`, `rules/`, `data/`, `assets/`), sem arquivos `.map`, scripts de teste ou `XER-04/05/06`.

### 4.2 Artefatos gerados, hashes SHA-256 e pasta limpa de stage

Para evitar mistura com binários `1.4.3`/`1.4.4` acumulados na pasta compartilhada `src-tauri/target/release/bundle/release-upload/`, os `3` artefatos exclusivos da `1.4.5` foram espelhados na pasta limpa `src-tauri/target/release/bundle/release-upload-1.4.5/` (preservando integralmente `release-upload-1.4.4/` e os instaladores históricos):

| Artefato | Tamanho (bytes) | SHA-256 |
|---|---:|---|
| `src-tauri/target/release/DarkWest.exe` | `14.999.040` | `c1fcc4a4a7b5fab7e947059c6f3b36c87919c5b04f033dec3e5b2d2534d33db8` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.5_x64_en-US.msi` | `7.020.544` | `7eb1418409b91bcc3f5d8f51c8147c946fc6fc2cb982a5a3e514906dca691696` |
| `src-tauri/target/release/bundle/msi/Dark West Character Sheet_1.4.5_x64_en-US.msi.sig` | `440` | `28091b84ec5c2c9ed6a8210262e958e94fb8089137b92c4f4065410d484a7514` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.5_x64-setup.exe` | `5.545.164` | `fc14fcd36f5afd805cea830fde810a92cc4205ee6ed2a848b5f925a83a14eaf6` |
| `src-tauri/target/release/bundle/nsis/Dark West Character Sheet_1.4.5_x64-setup.exe.sig` | `440` | `338537a0da2b1402aad5099c244f2d9c9a7ddb4b55ba8f78a44a745147ad1cd4` |
| `src-tauri/target/release/bundle/release-upload-1.4.5/Dark.West.Character.Sheet_1.4.5_x64-setup.exe` | `5.545.164` | `fc14fcd36f5afd805cea830fde810a92cc4205ee6ed2a848b5f925a83a14eaf6` |
| `src-tauri/target/release/bundle/release-upload-1.4.5/Dark.West.Character.Sheet_1.4.5_x64-setup.exe.sig` | `440` | `338537a0da2b1402aad5099c244f2d9c9a7ddb4b55ba8f78a44a745147ad1cd4` |
| `src-tauri/target/release/bundle/release-upload-1.4.5/latest.json` | `1.473` | `b6afa70f13dcba0debf53287c9f0b8bab5aa91a62e086586b04ea965f10e3e84` |

### 4.3 Validação criptográfica e do manifesto `latest.json`

- **Assinatura Minisign verificada (`VERIFY_145=PASS`):**
  - Verificação Ed25519 do hash `blake2b512` do binário + verificação do `trusted comment` contra `plugins.updater.pubkey` de `src-tauri/tauri.conf.json`:
    - NSIS: `trusted comment: timestamp:1794970191\tfile:Dark West Character Sheet_1.4.5_x64-setup.exe` — **PASS**.
    - MSI: `trusted comment: timestamp:1794970191\tfile:Dark West Character Sheet_1.4.5_x64_en-US.msi` — **PASS**.
- **Manifesto `latest.json` local:**
  - `version`: `"1.4.5"` (`pub_date`: `"2026-11-18T02:49:51Z"`).
  - `platforms`: apenas `"windows-x86_64"`.
  - `url`: `"https://github.com/blackphoenix777/Oeste-Sombrio/releases/download/v1.4.5/Dark.West.Character.Sheet_1.4.5_x64-setup.exe"`.
  - `signature`: idêntica ao conteúdo de `Dark.West.Character.Sheet_1.4.5_x64-setup.exe.sig`.
- **Compatibilidade com aplicativo público `1.4.4`:**
  - O cliente `1.4.4` usa a mesma `pubkey`, mesmo `identifier`, mesmo endpoint `releases/latest/download/latest.json`, `windows-x86_64` e `installMode: "passive"`, com confirmação explícita em `dist/js/updater.js` (`window.confirm`) antes do download e instalação.
  - A migração P0-2 (`20261117151310`) já está aplicada em Produção sem alterar contratos da `1.4.4`.

---

## 5. Preparação Git e Plano Separado de Commits (Etapa F)

- **Estado atual:** branch `main`, `HEAD` `0c996fab7e0c6003a564b09c1a26f80a0115aa04`, `git diff --check` PASS (`DIFF_CHECK_EXIT=0`).
- **Alterações rastreadas pendentes (`5` arquivos):** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.
- **Não rastreados preservados:** `supabase/migrations/20261106...`..`20261116...`, `database/implantacao-mesa-p0-xerife-p02/*`, `database/*` anteriores e `supabase/.temp/`.
- **Plano de commits recomendado (NÃO EXECUTADO):**
  1. **Commit 1 — Migrações históricas e documentação de implantação:**
     - `supabase/migrations/20261106000343_*.sql` .. `20261116210603_*.sql` (as `16` migrações históricas recuperadas da Produção);
     - `database/implantacao-mesa-p0-xerife-p02/01-*.md` .. `05-*.md` e `03-reconciliacao-evidencias.json` (mantendo `supabase/.temp/` e relatórios antigos não relacionados fora do commit).
  2. **Commit 2 — Versionamento e metadados da release `1.4.5`:**
     - `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `database/implantacao-mesa-p0-xerife-p02/06-preparacao-release-145.md`.
  3. **Commit 3 — Ajustes de compilação:**
     - **Nenhum necessário** (`build-release.ps1` compilou sem exigir alterações de código-fonte).

---

## 6. Pendências, Riscos e Procedimento de Publicação / Rollback

### Pendências e observações conhecidas
1. **GitHub Actions histórico (`billing issue`):** segundo `database/implantacao-com05-com08/11-publicacao-oficial-1.4.4.md`, os workflows do Actions falharam por bloqueio de cobrança da conta, e `.github/workflows/release.yml` tenta reconstruir tags `v* != v1.4.4`. Publicar `v1.4.5` diretamente pela API/`gh` a partir dos artefatos já assinados em `release-upload-1.4.5/` evita divergência de bytes/assinatura.
2. **Smoke test interativo de upgrade:** a execução real de `DarkWest.exe` `1.4.5` e o fluxo visual de auto-update `1.4.4 -> 1.4.5` no Windows do usuário não foram executados nesta sessão para evitar gravação em `%LOCALAPPDATA%` / Produção.
3. **Assinatura Authenticode:** os instaladores possuem assinatura Minisign válida para o updater Tauri, mas não certificado Authenticode Windows (comportamento idêntico à `1.4.4`).

### Procedimento proposto para publicação após autorização explícita
1. Executar os **Commits 1 e 2** do plano acima na branch `main` (revisando `git status` para manter `supabase/.temp/` fora).
2. Executar `git push origin main` e criar/enviar a tag anotada `v1.4.5` apontando para o commit final aprovado (`git tag -a v1.4.5 -m "Release v1.4.5" && git push origin v1.4.5`).
3. Criar a release `v1.4.5` no repositório `blackphoenix777/Oeste-Sombrio` (preferencialmente como **draft** primeiro ou com upload exclusivo da pasta limpa `src-tauri/target/release/bundle/release-upload-1.4.5/` contendo apenas os `3` arquivos validados: `Dark.West.Character.Sheet_1.4.5_x64-setup.exe`, `.sig` e `latest.json`, conferindo os hashes SHA-256 acima antes de torná-la pública).
4. Após publicação pública, validar HTTP `200` no endpoint `releases/latest/download/latest.json` e smoke test com usuário autenticado.

### Estratégia de retorno à versão `1.4.4` (caso necessário)
- **Nota operacional crítica:** clientes que já tiverem atualizado para `1.4.5` não fazem downgrade automático ao alterar `latest.json` para `1.4.4`; para esses usuários, é necessário reinstalar manualmente o instalador `1.4.4` preservado em `src-tauri/target/release/bundle/release-upload-1.4.4/` (e na tag pública `v1.4.4`) após backup local dos dados em `%APPDATA%`.
- **Banco de Produção (`jxxhdqoyblykqiiyptsp`):** compatível tanto com `1.4.4` quanto com `1.4.5`, pois a P0-2 está isolada em `xerife_6b` / `public.mesa_6b_aberto`; reversão de schema só deve ser executada se houver erro crítico de banco, seguindo a Seção 5 de `05-implantacao-producao-p02.md`.
