# P0-2 — resultados e homologação

17/11/2026 (atualizado após validação real em Homologação `igyupxczhczidfgtjiws`). Ver também [auditoria e contrato candidato](../database/xerife-6b-auditoria.md).

## Classificação

| Funcionalidade | Classificação | Entregue / situação |
| --- | --- | --- |
| XER-01 — Aberto | **Implementada e homologada** | Composição pelo nível da ficha, rolagem inicial, consumo flexível (`Consumir` / `Gastar todos`), renovação somente após zerar (sem fadiga), seleção via `#chamber-modal` nos ataques/testes de NPC e projeção compartilhada por mesa validados em Homologação (`igyupxczhczidfgtjiws`) |
| XER-02 — Secreto | **Implementada e homologada** | Composição máxima pelo nível, estado privado, consumo flexível, renovação somente após zerar, autorização por papel, limpeza de cache/DOM e bloqueio de leitura/Realtime ao jogador validados em Homologação (`igyupxczhczidfgtjiws`) |
| XER-03 — Painéis | **Implementada e validada** | Dois painéis recolhíveis com seleção direta nas pílulas, botões `Rolar conjunto`, `Consumir`, `Gastar todos` e `Renovar`, aviso de combate ao zerar o Aberto e falha fechada quando a migração estiver ausente |

## Evidências executáveis desta revisão

* **Homologação real (`igyupxczhczidfgtjiws` — `tests/live-xerife-6b.cjs`):** **17 PASS** em [live-xerife-6b-results.json](artifacts/live-xerife-6b-results.json). Testado com Auth HTTP real (`signInWithPassword`), RLS, RPCs HTTP e WebSocket Realtime autenticado:
  * Derivação `6d8` para ficha `nivel=7` e deduplicação de 2 conexões do mesmo jogador (`1` dado secreto);
  * Bloqueio HTTP `42501` para `anon` e jogador (leitura secreta, rolagem e escrita direta em `mesa_6b_aberto`);
  * Rolagem secreta não emite evento Realtime para o jogador;
  * Rolagem aberta, consumo parcial e renovação após esgotamento emitem `INSERT`/`UPDATE` via WebSocket Realtime para o jogador;
  * Renovação bloqueada (`55000`) antes de gastar todos os dados e liberada após esgotamento adotando novo nível (`nivel=13 → d10`);
  * Reconexão de novo cliente recupera estado autoritativo sem cache.
* **PostgreSQL 17 real, local e descartável (`tests/rls-xerife-6b.sql`):** **46 PASS** em [xerife-6b-postgres.txt](artifacts/xerife-6b-postgres.txt) (contêiner `oeste-xerife-p02-test`, `--network none`, removido após execução).
* **Chrome/DOM/CSS reais (`tests/xerife-6b-ui.cjs`):** **39 PASS** em [xerife-6b-ui.txt](artifacts/xerife-6b-ui.txt).
* **Tauri/WebView2 nativo isolado (`XerifeP02Verified.exe`):** **39 PASS** em [xerife-6b-native.txt](artifacts/xerife-6b-native.txt) (compilação em [xerife-6b-native-build.txt](artifacts/xerife-6b-native-build.txt), identificador `com.stefano.darkwest.xerife-p02-test`).
* **Regressões:** **12/12 suítes PASS** em [xerife-6b-regressions.txt](artifacts/xerife-6b-regressions.txt): `auth-session`, `scene-read`, `token-initiative`, `com03-com04-creature-mode`, `com05-com06-initiative-budget`, `com07-com08-controller-events`, `turn-tracker-ui`, `mesa-6b`, `map-camera`, `gm-tools-ui`, `multiple-maps-ui` e `mesa-p0-interactions` (33 verificações).
* **`git diff --check`:** PASS.

## Limpeza de homologação

* A mesa temporária de teste e `xerife_6b.presencas`/`conjuntos`/`mesa_6b_aberto` foram removidos pelo script ao final da execução (`mesas = 0`, `presencas = 0`).
* Restaram apenas os 2 usuários sintéticos temporários (`aa6b0001-0000-4000-8000-000000000001` e `aa6b0002-0000-4000-8000-000000000002`) e 1 ficha órfã vinculada ao segundo, pois `DELETE` via MCP foi cancelado automaticamente pelo prompt do cliente.

## Arquivos alterados ou criados

* Banco de dados: `supabase/migrations/20261117151310_xerife_6b_foundation.sql`
* Frontend: `dist/js/mesaXerife6B.js`, `dist/js/modal.js`, `dist/js/dice.js`, `dist/js/inventoryUI.js`, `dist/js/mesaScreen.js`, `dist/js/homeScreen.js`, `dist/style.css` (preservando `dist/index.html`, `dist/js/main.js`, `dist/js/authSession.js`, `dist/js/mesaMaps.js`)
* Testes e evidências: `tests/rls-xerife-6b.sql`, `tests/xerife-6b-ui.cjs`, `tests/live-xerife-6b.cjs`, `tests/artifacts/live-xerife-6b-results.json`, `tests/artifacts/xerife-6b-postgres.txt`, `tests/artifacts/xerife-6b-ui.txt`, `tests/artifacts/xerife-6b-native.txt`, `tests/artifacts/xerife-6b-native-build.txt`, `tests/artifacts/xerife-6b-regressions.txt`
* Documentação: `database/xerife-6b-auditoria.md`, `tests/xerife-6b-validacao.md`
