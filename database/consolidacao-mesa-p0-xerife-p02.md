# Consolidação MESA P0 + P0-2 (6B do Xerife) — Oeste Sombrio 2.0

**Data:** 17/11/2026  
**Baseline anterior:** `4d15dfd` (`docs: record verified public release 1.4.4`)  
**Branch:** `main` (local apenas; **nenhum push realizado**)  
**Ambiente de Produção:** `jxxhdqoyblykqiiyptsp` (intocado)  
**Ambiente de Homologação:** `igyupxczhczidfgtjiws` (inspecionado apenas em modo leitura)

---

## 1. Estado inicial encontrado no repositório

Na auditoria inicial sobre `main` em `4d15dfd`:

- Havia **10 arquivos rastreados modificados** no working tree (`642 insertions(+), 175 deletions(-)`), sem alterações staged (`git diff --cached --stat` vazio).
- Os arquivos `dist/js/mesaScreen.js` e `dist/style.css` concentravam alterações adjacentes de **MESA P0** e **P0-2**.
- Havia artefatos não rastreados pertencentes a **MESA P0** (`tests/mesa-p0-interactions.cjs`, `tests/mesa-p0-validacao.md`, `tests/artifacts/mesa-p0-results.txt`, `tests/artifacts/mesa-p0-regressions.txt`), a **P0-2** (`dist/js/mesaXerife6B.js`, `supabase/migrations/20261117151310_xerife_6b_foundation.sql`, `database/xerife-6b-auditoria.md`, testes e logs em `tests/` e `tests/artifacts/`), o arquivo temporário de CLI `supabase/.temp/cli-latest` (`v3.2.0`) e documentos pré-existentes não relacionados à consolidação (`database/com01-com02-auditoria-contratos.md`, `database/homologacao-com05-com08/`, `database/implantacao-com05-com08/`, `database/pre-implantacao-com05-com08/`).
- A varredura de segredos em código, SQL, testes e logs retornou **0 ocorrências** de `service_role`, tokens JWT (`eyJ...`), `sb_secret_`, senhas literais ou credenciais sintéticas.

---

## 2. Branch e commits criados localmente (sem push)

1. **`5f9c2c2`** — `feat(mesa): implement MESA-01/02/03 panel resize, token delete, and sheet popup`
   - Contém exclusivamente a entrega **MESA P0** (`MESA-01`, `MESA-02`, `MESA-03`), testes `tests/mesa-p0-interactions.cjs`, auditoria `tests/mesa-p0-validacao.md` e evidências `tests/artifacts/mesa-p0-*.txt`.
   - Validado isoladamente com `git diff --check` e `node tests/mesa-p0-interactions.cjs` (33/33 PASS) antes do commit seguinte.
2. **`74473e4`** — `feat(xerife-6b): implement P0-2 shared 6B pools foundation and UI`
   - Contém a fundação SQL `supabase/migrations/20261117151310_xerife_6b_foundation.sql`, o módulo `dist/js/mesaXerife6B.js` e as integrações em UI, sessão, modais de 6B, perícias, inventário e ataques de NPC.
   - SHA-256 de `dist/js/mesaScreen.js` (`3D1BDE...`) e `dist/style.css` (`08CB0F...`) restaurados byte a byte em relação ao estado auditado antes do split.
3. **Commit de testes, evidências e consolidação P0-2** — criado logo após este relatório no mesmo branch local `main` (ver `git log -n 5`), agrupando suítes SQL/UI/live, `database/xerife-6b-auditoria.md`, `tests/xerife-6b-validacao.md`, evidências em `tests/artifacts/` e este documento (`database/consolidacao-mesa-p0-xerife-p02.md`).

Nenhum push, merge, tag ou criação de release foi executado.

---

## 3. Inventário completo das entregas consolidadas

### MESA P0 (`5f9c2c2`)
- **MESA-01 — Painel lateral redimensionável:** alça `#mesa-sidebar-resizer`, variável `--mesa-sheet-panel-width`, limites mínimos (`330px` ou largura útil de viewport) e máximos (`innerWidth - 32px`), suporte a teclado (`ArrowLeft`, `ArrowRight`, `Home`, `End`), cancelamento preservando largura anterior e persistência local de preferência em `localStorage`.
- **MESA-02 — Exclusão de token selecionado:** seleção por mapa em `OS.selectMesaMapToken` / `OS.getSelectedMesaMapToken`, exclusão pela tecla `Delete` restrita ao Xerife (`st.isMestre`), guarda contra inputs/composição/repetição/arraste/pan, `.select("id")` autoritativo com filtros `mesa_id`, `mapa_id`, `owner_type`, `owner_ref` e `id`, sem remover ficha original do jogador ou cópias em outros mapas.
- **MESA-03 — Abertura de ficha por duplo clique:** abertura/foco por `dblclick` no token vivo do mapa atual com supressão pós-arraste, isolamento entre instâncias de NPC e validação de permissão via `resolvePlayerFichaRow` e `resolveGmPopupTarget` mesmo na presença de cache local.

### P0-2 — 6B do Xerife (`74473e4`)
- **XER-01 — 6B Aberto compartilhado:** cálculo server-side de 6 dados usando o menor tipo de dado entre jogadores ativos conectados (`xerife_6b.presencas`, `lease` de 90s e derivação por nível/configuração), rolagem inicial autoritativa (`rolar_6b_xerife`), consumo parcial e total com seleção explícita (`consumir_6b_xerife`), renovação liberada somente após esgotamento total (`renovar_6b_xerife`), projeção compartilhada em `public.mesa_6b_aberto` via Realtime e adaptador somente leitura `OS.getXerife6BForNpc` integrado a fichas e ataques de NPC.
- **XER-02 — 6B Secreto compartilhado:** cálculo privado com quantidade igual ao número de jogadores distintos conectados com personagem válido e maior tipo global, armazenamento exclusivo em `xerife_6b.conjuntos` sem exposição direta ou Realtime ao jogador, operações exclusivas do Xerife (`ler_6b_xerife`, `rolar_6b_xerife`, `consumir_6b_xerife`, `renovar_6b_xerife`), falha fechada quando a migração não está presente e limpeza completa ao sair da mesa ou encerrar sessão.
- **XER-03 — Painéis recolhíveis e integração no tambor:** painéis nativos `<details>` recolhidos por padrão (`#mesa-xerife-pools`) na lateral da mesa do Xerife com seleção de dados para consumo/renovação e integração do modal `#chamber-modal` (`OS.openXerife6BCreatureAttackModal`, `dist/js/dice.js`, `dist/js/inventoryUI.js`) em rolagens de NPCs.

---

## 4. Lista de arquivos alterados e criados por entrega

### Commit 1 — MESA P0 (`5f9c2c2`)
- `dist/index.html` (adicionado `#mesa-sidebar-resizer`)
- `dist/js/mesaMaps.js` (limpeza de seleção ao trocar mapa)
- `dist/js/mesaScreen.js` (hunks MESA-01, MESA-02 e MESA-03)
- `dist/style.css` (regras de `#mesa-sidebar-resizer` e `.mesa-map-token.is-selected`)
- `tests/mesa-p0-interactions.cjs`
- `tests/mesa-p0-validacao.md`
- `tests/artifacts/mesa-p0-results.txt`
- `tests/artifacts/mesa-p0-regressions.txt`

### Commit 2 — P0-2 / Xerife 6B (`74473e4`)
- `supabase/migrations/20261117151310_xerife_6b_foundation.sql`
- `dist/js/mesaXerife6B.js`
- `dist/js/authSession.js`
- `dist/js/dice.js`
- `dist/js/homeScreen.js`
- `dist/js/inventoryUI.js`
- `dist/js/main.js`
- `dist/js/mesaScreen.js` (hunks P0-2: ciclo de vida `initXerife6B`/`clearXerife6B` e ataque com 6B Aberto do Xerife)
- `dist/js/modal.js`
- `dist/style.css` (regras `.mesa-xerife-*`)

### Commit 3 — Testes, evidências e consolidação P0-2
- `database/xerife-6b-auditoria.md`
- `database/consolidacao-mesa-p0-xerife-p02.md`
- `tests/xerife-6b-validacao.md`
- `tests/xerife-6b-ui.cjs`
- `tests/xerife-6b-bootstrap.sql`
- `tests/rls-xerife-6b.sql`
- `tests/live-xerife-6b.cjs`
- `tests/artifacts/live-xerife-6b-results.json`
- `tests/artifacts/xerife-6b-gm-tools-first-attempt.txt`
- `tests/artifacts/xerife-6b-native-build.txt`
- `tests/artifacts/xerife-6b-native.txt`
- `tests/artifacts/xerife-6b-postgres.txt`
- `tests/artifacts/xerife-6b-regressions.txt`
- `tests/artifacts/xerife-6b-ui.txt`

### Mantidos intencionalmente fora do Git nesta consolidação
- `supabase/.temp/cli-latest` (cache local temporário da CLI do Supabase)
- `database/com01-com02-auditoria-contratos.md`, `database/homologacao-com05-com08/`, `database/implantacao-com05-com08/`, `database/pre-implantacao-com05-com08/` (arquivos pré-existentes não relacionados a MESA P0 / P0-2)

---

## 5. Migrações envolvidas e dependências com o banco

- **Arquivo de migração:** `supabase/migrations/20261117151310_xerife_6b_foundation.sql`
- **Dependências de esquema pré-existentes esperadas pela migração:**
  - `public.mesas`, `public.membros_mesa`, `public.fichas` e função `public.is_mestre_da_mesa(uuid)`
  - Publicação `supabase_realtime` e papel `authenticated` / `anon`
- **Estado em Produção (`jxxhdqoyblykqiiyptsp`):** verificado via `list_migrations` em modo somente leitura; última migração aplicada é `20261116210603_com05_com08_combat_state_and_actions`. A migração `20261117151310` **não** está aplicada.
- **Estado em Homologação (`igyupxczhczidfgtjiws`):** `list_migrations` retorna apenas `20261116214200_homologacao_144_mapas_notas`, embora os objetos de `20261117151310_xerife_6b_foundation.sql` (`xerife_6b.presencas`, `xerife_6b.conjuntos`, `public.mesa_6b_aberto`, funções `xerife_6b.*`, wrappers `public.*_6b_xerife`, política `mesa_6b_aberto_leitura` e inclusão em `supabase_realtime`) já estejam presentes por execução direta anterior em SQL Editor.

---

## 6. Testes executados nesta auditoria e resultados

Todas as verificações locais abaixo foram executadas **nesta sessão de consolidação** após o estado final do código:

| Verificação | Escopo / Ambiente | Resultado observado |
|---|---|---|
| `git diff --check` | Integridade de whitespace/conflitos | **PASS** (saída 0; avisos LF/CRLF apenas) |
| Sintaxe ESM (`node --input-type=module --check`) | 9 arquivos `.js` modificados/novos em `dist/js/` | **PASS** (`ESM_SYNTAX_OK: 9 files`) |
| `node tests/mesa-p0-interactions.cjs` | Playwright/DOM + mocks (executado tanto no commit `5f9c2c2` quanto no estado consolidado) | **PASS: 33 verificações** |
| `node tests/xerife-6b-ui.cjs` | Playwright/DOM + RPCs/Realtime mockados | **PASS: 39 verificações** |
| Suítes de regressão (`auth-session`, `scene-read`, `token-initiative`, `com03-com04-creature-mode`, `com05-com06-initiative-budget`, `com07-com08-controller-events`, `turn-tracker-ui`, `mesa-6b`, `map-camera`, `gm-tools-ui`, `multiple-maps-ui`, `mesa-p0-interactions`) | 12/12 suítes Node/Playwright locais | **PASS: 12/12 (`TOTAL_FAILED=0`)** |
| PostgreSQL 17 descartável (`postgres:17-alpine`, `--network none`) | `tests/xerife-6b-bootstrap.sql` + `20261117151310_xerife_6b_foundation.sql` + `tests/rls-xerife-6b.sql` | **PASS (`PG_EXIT=0`)** |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Compilação e runner Cargo do backend Rust/Tauri | **PASS (exit 0; 0 unit/doc tests definidos)** |
| Ensaio nativo WebView2 (`XerifeP02Verified.exe` + leitura UIA) | App Tauri Windows compilado em `17/11/2026 18:52:53` (posterior às últimas edições em `dist/`) | **PASS: 39 verificações** |
| `tests/live-xerife-6b.cjs` contra Homologação | **Não reexecutado** nesta auditoria (regra de não executar escrita remota); evidência histórica preservada em `tests/artifacts/live-xerife-6b-results.json` | **Não executado nesta sessão** (registro anterior: `17/17`) |

---

## 7. Evidências de segurança verificadas

- **Sem exposição de credenciais:** 0 ocorrências de `service_role`, tokens JWT ou senhas literais nos arquivos consolidados e históricos recentes verificados.
- **Isolamento de schema e privilégios (verificado em Postgres 17 local e via SQL somente leitura em Homologação):**
  - Todas as 7 funções em `xerife_6b` (`autorizar`, `composicao`, `consumir`, `ler`, `presenca`, `renovar`, `rolar`) têm `prosecdef = true` (`SECURITY DEFINER`) e `proconfig = ["search_path=\"\""]`.
  - Os 5 wrappers em `public` (`presenca_6b_xerife`, `ler_6b_xerife`, `rolar_6b_xerife`, `consumir_6b_xerife`, `renovar_6b_xerife`) têm `prosecdef = false` (`SECURITY INVOKER`) e `proconfig = ["search_path=\"\""]`.
  - Apenas `public.mesa_6b_aberto` possui política de leitura (`mesa_6b_aberto_leitura` para `authenticated`, restrita ao mestre ou membro da mesa) e publicação em `supabase_realtime`.
  - `xerife_6b.conjuntos` (resultados secretos) e `xerife_6b.presencas` não possuem acesso direto para `authenticated`/`anon` nem estão na publicação `supabase_realtime`.
- **Autoridade e concorrência no servidor:**
  - Jogador e usuário anônimo recebem SQLSTATE `42501` ao tentar ler segredo ou operar conjuntos (`rolar`/`consumir`/`renovar`), e `presenca_6b_xerife` deriva a identidade exclusivamente de `auth.uid()` no servidor.
  - Xerife de outra mesa recebe `42501` e isolamento completo entre mesas.
  - Versão desatualizada (`40001`), índice já consumido (`22023`), rolagem inicial repetida (`0A000`) e renovação antes do esgotamento (`55000`) são rejeitados pelo banco.
- **Fronteira de cliente (MESA P0 e P0-2):**
  - MESA-02 exige `st.isMestre`, envia `.delete().select("id")` e só limpa a seleção/DOM após confirmação do servidor.
  - MESA-03 bloqueia abertura de NPC por jogador e bloqueia acesso a ficha alheia em cache local em `resolvePlayerFichaRow` e `resolveGmPopupTarget`.
  - P0-2 nunca grava resultados secretos em `localStorage`, descarta respostas atrasadas após troca de usuário/mesa e limpa estado/DOM em logout e saída.

---

## 8. Problemas ou desvios encontrados e como foram tratados

1. **Arquivos compartilhados entre MESA P0 e P0-2 (`dist/js/mesaScreen.js` e `dist/style.css`):**
   - **Tratamento:** os hunks de MESA P0 e P0-2 foram separados cirurgicamente entre os commits `5f9c2c2` e `74473e4`, validando `tests/mesa-p0-interactions.cjs` isoladamente em `5f9c2c2` e restaurando byte a byte (`SHA-256` conferido) o código final validado em `74473e4`.
2. **Desalinhamento de rastreamento da migração na Homologação:**
   - **Observado:** em `igyupxczhczidfgtjiws`, `20261117151310_xerife_6b_foundation.sql` foi executada diretamente no SQL Editor sem registro em `supabase_migrations.schema_migrations`.
   - **Tratamento:** documentado aqui sem alterar o banco remoto durante esta consolidação.
3. **Resíduo sintético em Homologação:**
   - **Observado:** 2 contas sintéticas em `auth.users` e 1 ficha sintética em `public.fichas` permanecem do teste vivo anterior (`mesas_qa_synthetic = 0`, `presencas_total = 0`, `conjuntos_total = 0`, `mesa_6b_aberto_total = 0`).
   - **Tratamento:** preservado sem operações destrutivas nesta auditoria, registrado nas pendências de Homologação.

---

## 9. Pendências em Homologação

- Registrar a versão `20261117151310` em `supabase_migrations.schema_migrations` no projeto de Homologação (`igyupxczhczidfgtjiws`) antes de usar `supabase db push` para futuras migrações, já que a migração usa DDL sem `IF NOT EXISTS`.
- Remover com aprovação explícita do responsável os 2 usuários QA sintéticos (`aa6b0001-0000-4000-8000-000000000001`, `aa6b0002-0000-4000-8000-000000000002`) e a 1 ficha sintética associada em Homologação.
- Realizar validação manual final na interface real (Windows/Tauri) conectada à Homologação confirmando o fluxo visual completo antes de liberar para Produção.

---

## 10. Riscos conhecidos para implantação em Produção (`jxxhdqoyblykqiiyptsp`)

- **Não idempotência da migração `20261117151310_xerife_6b_foundation.sql`:** utiliza `CREATE SCHEMA xerife_6b`, `CREATE TABLE ...` e `ALTER PUBLICATION supabase_realtime ADD TABLE public.mesa_6b_aberto` sem `IF NOT EXISTS`, devendo ser aplicada uma única vez em Produção.
- **Ordem de deploy cliente × banco:** enquanto a migração não estiver em Produção, clientes atualizados falham fechado nos painéis do 6B do Xerife (comportamento seguro esperado, porém sem uso do pool compartilhado até a migração subir).
- **Dependência de presença (`lease` de 90s):** desconexões breves podem sinalizar pendência de composição sem alterar resultados já rolados; mudanças só passam a valer na renovação após esgotamento do conjunto.
- **CSP em Tauri (`"csp": null` em `src-tauri/tauri.conf.json`):** comportamento pré-existente do projeto, preservado fora do escopo desta consolidação.

---

## 11. Estratégia recomendada de backup, deploy e rollback

1. **Backup prévio (obrigatório):** realizar snapshot/backup completo do banco de Produção (`jxxhdqoyblykqiiyptsp`) e registrar a lista atual de migrações aplicadas antes de qualquer alteração.
2. **Deploy do banco em Produção:** aplicar `supabase/migrations/20261117151310_xerife_6b_foundation.sql` uma única vez pelo fluxo oficial (`supabase db push` ou pipeline homologado), verificar `pg_proc`, `pg_policies` e `pg_publication_tables` em `jxxhdqoyblykqiiyptsp`.
3. **Deploy da aplicação cliente:** após confirmar o backend, gerar/publicar o pacote da próxima versão e validar login, abertura de mesa, MESA-01/02/03 e XER-01/02/03 em mesa controlada.
4. **Rollback:**
   - **Aplicação:** republicar/reverter para a tag estável anterior (`1.4.4`, `4d15dfd`). O schema `xerife_6b` isolado não interfere nas tabelas consumidas pela versão `1.4.4`.
   - **Banco (somente se estritamente necessário):** remover `public.mesa_6b_aberto` da publicação `supabase_realtime`, dropar os wrappers `public.*_6b_xerife`, dropar `public.mesa_6b_aberto` e `DROP SCHEMA xerife_6b CASCADE` (ou restaurar o backup pré-deploy), após garantir que nenhum cliente novo esteja em uso.

---

## 12. Estado final do repositório Git

- **Branch atual:** `main` (local, à frente de `origin/main` pelos commits locais de consolidação; **sem push**).
- **Working tree após o Commit 3:** sem alterações em arquivos rastreados; mantidos não rastreados apenas `supabase/.temp/cli-latest` e os arquivos pré-existentes não relacionados em `database/` (`com01-com02-auditoria-contratos.md`, `homologacao-com05-com08/`, `implantacao-com05-com08/`, `pre-implantacao-com05-com08/`).
