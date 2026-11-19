# Checkpoint 10C — Publicação Oficial do Oeste Sombrio 2.0 (v1.4.7)

**Classificação Final:** `PUBLICAÇÃO APROVADA COM RESSALVAS`

---

## 1. Data e Horário UTC

- **Início da auditoria pré-publicação (Gate 10C-1):** `2026-11-19T15:51:37Z`
- **Criação da Draft Release (`v1.4.7`, ID `451569480`):** `2026-11-19T15:53:12Z`
- **Publicação oficial no GitHub (`published_at`):** `2026-11-19T15:55:21Z`
- **Conclusão da verificação pública pós-publicação (Gate 10C-9):** `2026-11-19T15:56:36Z`

---

## 2. Estado Inicial do Git (Gate 10C-1)

- **Repositório local:** `C:\Users\Stéfano\Desktop\ficha dark westy`
- **Repositório remoto:** `https://github.com/blackphoenix777/Oeste-Sombrio`
- **Branch ativa inicial:** `feature/com09-com12-reactions`
- **HEAD inicial da branch:** `676ccecc0d9c52e85af6829c27be0c441545cb25`
- **Referência `main` inicial:** `f743bbdb694e5400c127551fb546969535e180a9` (`v1.4.6`)
- **Referência `origin/main` inicial (após `git fetch origin --prune --tags`):** `f743bbdb694e5400c127551fb546969535e180a9` (sem avanço remoto inesperado)
- **Working tree inicial:** `0` arquivos rastreados modificados (`git diff` vazio); apenas arquivos históricos não rastreados preservados fora do escopo.
- **Ausência prévia de tag e release `v1.4.7`:** confirmado localmente (`git tag -l v1.4.7` vazio), remotamente (`git ls-remote --tags origin v1.4.7` vazio) e via GitHub Releases API (`0` releases/drafts com tag ou nome `1.4.7`).
- **Varredura de segredos e vazamentos nos 25 arquivos alterados (`main..HEAD`):** `0` ocorrências de JWT, tokens GitHub/Supabase, chaves privadas ou referências ao projeto de Homologação em `dist/`.

---

## 3. Branch de Origem

- `feature/com09-com12-reactions`

---

## 4. Commits COM-09/12 Integrados

Todos os 6 commits do Checkpoint 10B foram confirmados em sequência íntegra e preservados no histórico:

1. `7eb18470a240dc7e8bd45c40d96016bf0b47e46e` — `feat(combat): implement COM-09/10/11/12 reactions, opportunities and contextual bar`
2. `1bbf9184f541b4dc2ace8883c720303b5155d69f` — `feat(db): add COM-09/12 reactions migration, rollback and traceability`
3. `cab16c6e2a1965cbccea98bd18c9ab6764fbbaf4` — `test(combat): add COM-09/12 UI, PG17 RLS and Homologation suites`
4. `c0780e5a42c02219d8f4526d618896467f0b920c` — `docs(combat): record COM-09/12 validation, homologation and production deploy reports`
5. `19e6f1ccaea099b9580c12bfa951769fc18870ae` — `chore(release): bump version to 1.4.7 and switch release workflow to manual draft dispatch`
6. `676ccecc0d9c52e85af6829c27be0c441545cb25` — `docs(release): record Checkpoint 10B git consolidation and 1.4.7 build report`

---

## 5. Commit de Merge (Gate 10C-4)

- **Estratégia:** `git merge --no-ff feature/com09-com12-reactions` (sem conflitos, preservando todos os 6 commits).
- **Commit de merge em `main`:** `d038aec073a8b02c23c32aac55ea8db78f486520`
- **Parents:** `f743bbdb694e5400c127551fb546969535e180a9` (`main` v1.4.6) e `676ccecc0d9c52e85af6829c27be0c441545cb25` (`feature/com09-com12-reactions`)
- **Diff consolidado (`f743bbdb..d038aec0`):** `25 files changed, 8199 insertions(+), 41 deletions(-)` — abrangendo exclusivamente COM-09/10/11/12, migração SQL + rollback + rastreabilidade, suítes de testes, documentação de validação/homologação/implantação, metadados `1.4.7` e workflow revisado.
- **Verificações rápidas pós-merge em `main`:**
  - Sintaxe ESM (`node --input-type=module --check`): `45/45` arquivos `.js` sob `dist/js` aprovados.
  - `tests/com09-com12-reactions-ui.cjs`: `PASS` (`31/31` verificações + regras puras + auditoria estática SQL).
  - `tests/turn-tracker-ui.cjs`: `PASS` (`28/28` verificações).
  - Metadados de versão confirmados: `package.json = 1.4.7`, `package-lock.json = 1.4.7`, `src-tauri/tauri.conf.json = 1.4.7`, `src-tauri/Cargo.toml = 1.4.7`.

---

## 6. Identificador da Tag (Gate 10C-5)

- **Nome da tag:** `v1.4.7` (tag anotada)
- **Hash do objeto de tag (`refs/tags/v1.4.7`):** `a0371e977d869d60322da5f98dee313396125f1a`
- **Commit apontado (`refs/tags/v1.4.7^{}`):** `d038aec073a8b02c23c32aac55ea8db78f486520`
- **Mensagem da tag:** `Oeste Sombrio 2.0 — v1.4.7 (COM-09 a COM-12)`

---

## 7. Confirmação do Push (Gate 10C-5)

- Push normal executado sem `--force`:
  - `git push origin main` (`f743bbd..d038aec main -> main`)
  - `git push origin refs/tags/v1.4.7` (`* [new tag] v1.4.7 -> v1.4.7`)
- Confirmação remota via `git ls-remote origin`:
  - `refs/heads/main` = `d038aec073a8b02c23c32aac55ea8db78f486520`
  - `refs/tags/v1.4.7` = `a0371e977d869d60322da5f98dee313396125f1a`
  - `refs/tags/v1.4.7^{}` = `d038aec073a8b02c23c32aac55ea8db78f486520`

---

## 8. Workflow Utilizado e Prevenção de Duplicidade (Gate 10C-3)

- **Auditoria de `.github/workflows/release.yml`:**
  - Único workflow no repositório.
  - Gatilho exclusivo `workflow_dispatch` com input obrigatório `tag_name` (`type: string`).
  - Condição de job `if: github.event_name == 'workflow_dispatch'`, `concurrency: group: release-${{ inputs.tag_name || github.ref }}`, `permissions: contents: write`, `releaseDraft: true`, `prerelease: false`, `updaterJsonPreferNsis: true`.
- **Processo autoritativo escolhido para `v1.4.7`:** publicação controlada direta via GitHub Releases API (draft → upload → verificação criptográfica remota → publicação) utilizando exclusivamente os artefatos locais compilados, assinados com Minisign e validados no Checkpoint 10B (`src-tauri/target/release/bundle/release-upload-1.4.7/`).
- **Prevenção de concorrência verificada:** nenhum build concorrente do GitHub Actions foi disparado no push de `main` ou `v1.4.7` (`0` runs ativos ou associados a `v1.4.7` / `d038aec073a8b02c23c32aac55ea8db78f486520` antes, durante e após a publicação).

---

## 9. Resultado do Build Validado

- **Build local autoritativo (Checkpoint 10B):** compilado via `./scripts/build-release.ps1 -SkipPublish` com assinatura Minisign e stage dedicado `src-tauri/target/release/bundle/release-upload-1.4.7/`.
- **Validações herdadas e mantidas íntegras:** `9/9` suítes de regressão aprovadas, smoke nativo WebView2 em `DarkWest.exe` v1.4.7 aprovado via CDP (`origin=http://tauri.localhost`, `ver="1.4.7"`, `OS.SUPABASE_URL="https://jxxhdqoyblykqiiyptsp.supabase.co"`, `0` exceções não tratadas), e `66/66` testes obrigatórios de Homologação aprovados.
- **Compatibilidade do manifesto com Tauri Updater:** `src-tauri/tauri.conf.json` configura endpoint `https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json` e chave pública Minisign Key ID `F08EB962D585140A`; o manifesto `latest.json` declara `version: "1.4.7"`, plataforma `windows-x86_64`, `pub_date: "2026-11-19T15:30:37Z"`, URL canônica da tag `v1.4.7` e assinatura idêntica ao arquivo `.sig`.
- **Assinatura Windows Authenticode:** `NotSigned` (`Get-AuthenticodeSignature` = Status `2`), mantido como risco operacional de alerta do Windows SmartScreen (distinto da assinatura criptográfica Minisign do updater).

---

## 10. Hashes SHA-256 Locais (Gate 10C-2)

Diretório validado: `src-tauri/target/release/bundle/release-upload-1.4.7/` (contendo exclusivamente os 3 arquivos abaixo):

| Arquivo | Tamanho (bytes) | SHA-256 (Local = Esperado) |
| --- | ---: | --- |
| `Dark.West.Character.Sheet_1.4.7_x64-setup.exe` | `5.585.243` | `cc6ada86c8ef5af8d2d0a5d50addd42a9a183ecefd2866843b9b9dc6a7858634` |
| `Dark.West.Character.Sheet_1.4.7_x64-setup.exe.sig` | `440` | `b4c47aae647dd11d26da3f7107f2f227a362119278ea66cb3b5547356bde2526` |
| `latest.json` | `1.543` | `9119f79d70187495db65951c197a2dc20620bc22e73bb31e477c74378f908c4c` |

---

## 11. Confirmação Minisign (Local, Draft Remota e Pública)

Verificação criptográfica Ed25519 completa contra a chave pública declarada em `src-tauri/tauri.conf.json`:

- **Key ID:** `F08EB962D585140A`
- **Algoritmo:** `ED` (Ed25519 pré-hash `blake2b512`)
- **Trusted comment:** `trusted comment: timestamp:1795102236	file:Dark West Character Sheet_1.4.7_x64-setup.exe`
- **Verificação do payload (`.exe`):** `PASS` (local, draft remota e download público)
- **Verificação da assinatura global do trusted comment:** `PASS` (local, draft remota e download público)
- **Teste negativo de adulteração (flip de 1 byte no `.exe`):** `REJEITADO` (`PASS` em local, draft remota e download público)
- **Paridade `latest.json` ↔ `.sig`:** idêntica byte a byte (`PASS`).

---

## 12. ID e URL da GitHub Release (Gate 10C-8)

- **Release ID:** `451569480`
- **Título:** `Oeste Sombrio 2.0 — v1.4.7`
- **URL pública:** https://github.com/blackphoenix777/Oeste-Sombrio/releases/tag/v1.4.7
- **Tag:** `v1.4.7`
- **Target commitish:** `d038aec073a8b02c23c32aac55ea8db78f486520`
- **Published at (UTC):** `2026-11-19T15:55:21Z`
- **Flags:** `draft: false`, `prerelease: false`

---

## 13. Estado da Draft Antes da Publicação (Gate 10C-6)

- Criada inicialmente em `2026-11-19T15:53:12Z` com `draft: true` e `prerelease: false` (ID `451569480`).
- Permaneceu privada (`draft: true`) durante todo o upload e a re-verificação criptográfica remota dos 3 assets, sendo promovida a oficial somente após aprovação integral do Gate 10C-7.

---

## 14. Verificação dos Assets Remotos na Draft (Gate 10C-7)

Todos os 3 assets anexados à draft `451569480` foram consultados via GitHub API e **baixados de volta** para comparação criptográfica antes da publicação:

| Asset ID | Nome | Tamanho Remoto | Estado | SHA-256 Remoto (Draft) | Resultado |
| ---: | --- | ---: | --- | --- | --- |
| `768295811` | `Dark.West.Character.Sheet_1.4.7_x64-setup.exe` | `5.585.243` | `uploaded` | `cc6ada86c8ef5af8d2d0a5d50addd42a9a183ecefd2866843b9b9dc6a7858634` | `PASS` (SHA-256 + Minisign + Tamper) |
| `768295983` | `Dark.West.Character.Sheet_1.4.7_x64-setup.exe.sig` | `440` | `uploaded` | `b4c47aae647dd11d26da3f7107f2f227a362119278ea66cb3b5547356bde2526` | `PASS` |
| `768296012` | `latest.json` | `1.543` | `uploaded` | `9119f79d70187495db65951c197a2dc20620bc22e73bb31e477c74378f908c4c` | `PASS` (URL, versão `1.4.7`, sem Homologação) |

---

## 15. Estado `latest` (Gate 10C-8 / 10C-9)

- `GET https://api.github.com/repos/blackphoenix777/Oeste-Sombrio/releases/latest` (sem autenticação): HTTP `200`, `id: 451569480`, `tag_name: "v1.4.7"`, `published_at: "2026-11-19T15:55:21Z"`.
- Quantidade de releases públicas para `v1.4.7`: exatamente `1` (sem duplicidade).

---

## 16. Resultado das Checagens Públicas Pós-Publicação (Gate 10C-9)

Downloads HTTPS públicos (sem token de autenticação) executados em `2026-11-19T15:55:30Z`:

- `https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json`: HTTP `200`, `1.543` bytes, SHA-256 `9119f79d70187495db65951c197a2dc20620bc22e73bb31e477c74378f908c4c` (`MATCH`).
- `https://github.com/blackphoenix777/Oeste-Sombrio/releases/download/v1.4.7/latest.json`: HTTP `200`, SHA-256 idêntico (`MATCH`).
- `https://github.com/blackphoenix777/Oeste-Sombrio/releases/download/v1.4.7/Dark.West.Character.Sheet_1.4.7_x64-setup.exe` (baixado seguindo a URL declarada dentro do `latest.json` público): HTTP `200`, `5.585.243` bytes, SHA-256 `cc6ada86c8ef5af8d2d0a5d50addd42a9a183ecefd2866843b9b9dc6a7858634` (`MATCH`).
- `https://github.com/blackphoenix777/Oeste-Sombrio/releases/download/v1.4.7/Dark.West.Character.Sheet_1.4.7_x64-setup.exe.sig`: HTTP `200`, `440` bytes, SHA-256 `b4c47aae647dd11d26da3f7107f2f227a362119278ea66cb3b5547356bde2526` (`MATCH`).
- Revalidação Minisign Ed25519 (`F08EB962D585140A`) sobre o instalador baixado publicamente: payload `PASS`, trusted comment `PASS`, rejeição de adulteração de 1 byte `PASS`.
- Workflows concorrentes pós-publicação: `0`.

---

## 17. Preservação das Versões Anteriores

Todas as releases anteriores permaneceram intactas e publicamente acessíveis:

| Versão | Release ID | Assets | `HEAD` no Instalador NSIS | Tamanho (bytes) |
| --- | ---: | ---: | --- | ---: |
| `v1.4.6` | `451214881` | `3` | HTTP `200` | `5.568.792` |
| `v1.4.5` | `449890830` | `3` | HTTP `200` | `5.545.164` |
| `v1.4.4` | `448063212` | `3` | HTTP `200` | `5.538.069` |

Pastas de stage locais (`release-upload-1.4.4/`, `release-upload-1.4.5/`, `release-upload-1.4.6/`) e backups em `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\` permaneceram preservados.

---

## 18. Integridade de Produção (Verificação Não Destrutiva — Gate 10C-9)

**Nenhuma alteração foi realizada em Produção (`jxxhdqoyblykqiiyptsp`) nem em Homologação (`igyupxczhczidfgtjiws`).**

- **Probes públicos HTTP (`6/6 PASS`):**
  - `/auth/v1/health`: HTTP `200` (`GoTrue v2.198.0`).
  - `GET /rest/v1/mesas` (`anon`): HTTP `200` (`[]`, protegido por RLS).
  - `POST /rest/v1/rpc/gerenciar_reacao_combate` (`anon`): HTTP `401` (`42501 permission denied`).
  - `POST /rest/v1/rpc/calcular_fase_turno_combate` (`anon`): HTTP `401` (`42501 permission denied`).
  - `POST /rest/v1/rpc/obter_combate_publico` (`anon`): HTTP `401` (`42501 permission denied`).
  - `POST /rest/v1/rpc/ler_6b_instancia` (`anon`): HTTP `401` (`42501 permission denied`).
- **Auditoria somente leitura via MCP (`jxxhdqoyblykqiiyptsp`):**
  - Histórico de migrações preservado: `20` migrações, última = `20261119145851` (`com09_com12_reactions_and_opportunities`).
  - Contagens preservadas sem alterações: `11` usuários, `6` mesas, `9` membros, `12` fichas, `0` tokens, `0` combates ativos, `4` objetos de storage.
  - Permissões e funções preservadas sem drift (`anon_secdef_count = 5`, `auth_secdef_count = 20`):
    - `gerenciar_reacao_combate` (`secdef=true`, `anon=false`, `authenticated=true`)
    - `calcular_fase_turno_combate` (`secdef=false`, `anon=false`, `authenticated=false`)
    - `gerenciar_combate` (`secdef=true`, `anon=false`, `authenticated=true`) — contrato 1.4.6 preservado
    - `obter_combate_publico` (`secdef=true`, `anon=false`, `authenticated=true`) — contrato 1.4.6 preservado
    - `ler_6b_instancia` (`secdef=false`, `anon=false`, `authenticated=true`) — contrato 1.4.6 preservado

---

## 19. Dispensa Formal do Teste de Atualização Ponta a Ponta

Por decisão expressa do proprietário do projeto no Checkpoint 10C, foi concedida **dispensa formal do teste ponta a ponta do updater automático `1.4.6 → 1.4.7` em ambiente Windows isolado**.

- **Declaração explícita:** esta publicação **NÃO** declara o updater ponta a ponta tecnicamente homologado. A checagem pública de `latest.json` e a validação criptográfica Minisign confirmam a integridade dos artefatos publicados, mas **não substituem** o teste real de auto-atualização em máquina Windows isolada.
- **Registro público:** essa mesma ressalva foi incluída nas notas públicas da release `v1.4.7` no GitHub.

---

## 20. Riscos Residuais

1. **Updater automático `1.4.6 → 1.4.7` sem teste ponta a ponta (dispensa formal):** caso algum usuário encontre falha na aplicação automática da atualização, o instalador direto `Dark.West.Character.Sheet_1.4.7_x64-setup.exe` está disponível na página da release como contorno seguro, sem impacto sobre a migração SQL já estável em Produção.
2. **Ausência de assinatura Windows Authenticode:** o instalador NSIS possui assinatura criptográfica Minisign para o updater Tauri, mas não possui certificado Authenticode, podendo acionar aviso do **Windows SmartScreen** em instalações manuais.
3. **Resíduos históricos fora do escopo (não bloqueantes):** permanece no GitHub o rascunho antigo `v1.4.2` (ID `444905090`, `draft: true`, sem efeito sobre `latest`) e arquivos de relatórios históricos não rastreados no working tree local, preservados deliberadamente por estarem fora do escopo desta release.

---

## 21. Incidentes ou Bloqueios

- **Nenhum incidente e nenhum bloqueio** ocorreram durante os Gates 10C-1 a 10C-9.

---

## 22. Classificação Final

**`PUBLICAÇÃO APROVADA COM RESSALVAS`**

Todos os gates obrigatórios (10C-1 a 10C-9) foram executados e aprovados integralmente, a release oficial `v1.4.7` está pública, assinada, marcada como `latest` e criptograficamente íntegra, as versões `v1.4.4`, `v1.4.5` e `v1.4.6` e o banco de Produção foram preservados intactos; mantém-se a classificação com ressalvas pela dispensa formal do teste ponta a ponta do updater `1.4.6 → 1.4.7` e pelo risco operacional documentado do Windows SmartScreen (ausência de Authenticode).
