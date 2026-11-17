# MESA-01, MESA-02 e MESA-03 — implementação e validação

Data: 2026-11-17. Escopo exclusivo do primeiro pacote P0 da mesa virtual.

## Auditoria direcionada

- `dist/js/mesaScreen.js`: câmera e coordenadas lógicas da grade, Pointer Events dos tokens, cache `activeMesaState.mesaTokens`, remoção da cena, persistência das instâncias, resolução de fichas e popups existentes.
- `dist/js/mesaMaps.js`: troca de mapa, recarga por sinais Realtime, isolamento de respostas assíncronas e limpeza ao sair.
- `dist/index.html` e `dist/style.css`: painel de fichas sobreposto ao mapa. Alterar sua largura não precisa alterar a largura lógica do canvas. A ficha já dispõe de rolagem horizontal e vertical em espaços estreitos; esse comportamento foi preservado.
- `dist/js/characterManager.js`, `dist/js/storage.js`, `dist/js/homeScreen.js` e `src-tauri/src/lib.rs`: abertura e armazenamento de fichas são distintos da remoção de tokens. O comando Rust `delete_character` não é chamado pelas novas interações. O Tauri continua carregando o frontend de `dist`.
- Políticas existentes, no schema local `database/homologacao-com05-com08/00-schema-base-homologacao.sql`: `mesa_tokens_delete_mestre_only` permite DELETE ao Mestre; `Jogadores leem suas fichas` permite leitura ao proprietário ou Mestre da mesa. Mover o próprio token não concede ao jogador permissão para removê-lo.
- Não havia seleção persistente de token. Foi acrescentada uma única seleção ao estado atual da mesa, com ID do token, mapa e mesa; o DOM apenas reflete esse estado.

## Alterações separáveis

1. **MESA-01:** alça na borda esquerda da aba Fichas, Pointer Events com captura/cancelamento, limites conforme a janela e preferência de largura em localStorage. Setas/Home/End também ajustam a largura. Chat conserva sua largura. O mapa continua sobre a mesma geometria e câmera.
2. **MESA-02:** clique ou foco seleciona o token. Delete é tratado apenas dentro do viewport do mapa, com seleção válida e Mestre autorizado; ignora campos editáveis, composição, repetição, modificadores e arraste. Usa `removePlayerFromScene` / `removeCreatureFromScene`, agora com filtro opcional pelo ID do token e confirmação das linhas excluídas. Não chama exclusão de fichas. Instâncias ainda presentes em outro mapa são preservadas.
3. **MESA-03:** duplo clique usa o popup de ficha já existente. Para NPCs, usa `owner_ref` como ID exato da instância, nunca o ID compartilhado do template. Jogador abre sua própria ficha; cache de ficha alheia ou de NPC não autoriza abertura. O popup mantém seu caminho existente para visualizar a ficha completa.

A confirmação de linhas removidas usa `.delete().eq(...).select("id")`, conforme a [referência oficial Supabase](https://supabase.com/docs/reference/javascript/delete). As políticas e o schema não foram alterados.

Problemas encontrados e tratados: remoção local mesmo sem cliente/linhas confirmadas; abertura de ficha alheia se presente em cache; perda de foco quando uma recarga recria os tokens; referências de mapa antigo; duplo clique acidental após arraste.

## Testes executados

| Verificação | Resultado |
| --- | --- |
| `node tests/mesa-p0-interactions.cjs` | **PASS — 33 verificações**, DOM/CSS/handlers reais em Chrome headless |
| `node tests/auth-session.cjs` | PASS |
| `node tests/scene-read.cjs` | PASS |
| `node tests/token-initiative.cjs` | PASS — 11 grupos |
| `node tests/com03-com04-creature-mode.cjs` | PASS — 25 verificações |
| `node tests/com05-com06-initiative-budget.cjs` | PASS — regras puras e 28 verificações |
| `node tests/com07-com08-controller-events.cjs` | PASS — regras/auditoria SQL estática e 23 verificações |
| `node tests/turn-tracker-ui.cjs` | PASS — 28 verificações |
| `node tests/mesa-6b.cjs` | PASS |
| `node tests/map-camera.cjs` | PASS — 37 verificações |
| `node tests/gm-tools-ui.cjs` | PASS — 33 verificações |
| `node tests/multiple-maps-ui.cjs` | PASS — 27 verificações |
| `git diff --check` | PASS |

**11/11 regressões aprovadas na revisão funcional final.** O `npm test` do projeto é apenas um placeholder; foram executados os scripts reais acima. Os scripts que geram evidências antigas foram executados numa cópia temporária do frontend para preservar os registros da homologação anterior.

Evidências persistentes desta execução:

- [33 verificações MESA](artifacts/mesa-p0-results.txt).
- [Resultados das regressões](artifacts/mesa-p0-regressions.txt).
- Captura visual inspecionada: `C:\Users\Stéfano\AppData\Local\Temp\darkwest-mesa-p0-QSwZ5F\mesa-p0.png`.
- Logs completos das regressões: `C:\Users\Stéfano\AppData\Local\Temp\darkwest-mesa-regressions-454172b157974aad9f55ff45bf9ea0a8`.

Os critérios foram exercitados com imagem sintética, zoom 1,7x, arraste após redimensionamento, cancelamento, largura mínima/máxima, viewport CSS de 320 px, ficha completa em painel de 330 px, seleção após recarga, digitação, jogador sem permissão de DELETE, erro/zero linhas do servidor, isolamento entre mapas, fichas originais preservadas e duas instâncias do mesmo NPC.

A primeira execução do teste novo detectou uma expectativa incorreta do próprio teste: o renderer existente normaliza campos da ficha antes da exclusão. O snapshot foi movido para depois dessa normalização para medir especificamente o efeito da remoção. Nenhuma regra de 6B foi alterada. A execução final passou integralmente.

## Limites e pendências

- Transporte Supabase simulado: os testes verificam filtros enviados, respostas negadas e comportamento da UI; não equivalem a execução remota de RLS ou WebSocket autenticado. Nenhuma conexão ou escrita em produção/homologação foi realizada nesta tarefa.
- Chrome com perfil temporário: não houve teste nativo desta revisão em Tauri/WebView2. Antes de distribuir, resta o smoke test no aplicativo e a integração em homologação com fixtures sintéticos, usando as mesmas ações e permissões acima.
- A ficha mantém a rolagem existente quando o painel fica estreito; não houve redesenho de seu layout.
- Nenhum arquivo de combate, iniciativa, Turn Tracker, regras 6B, Rust, schema, migração ou artefato de release foi alterado. Nenhuma tarefa XER/P1/COM-09 foi implementada. Sem commit, push ou publicação.
- As alterações não rastreadas anteriores em `database/` foram preservadas.

Conclusão: **MESA-01/02/03 implementadas e critérios verificados localmente; integração remota e smoke test nativo permanecem pendentes.**

SHA-256 dos arquivos funcionais testados, antes de eventual normalização de finais de linha pelo Git:

```text
dist/index.html       02412D212FCA9D8C9B7CE03AF42A3CD757372453BA0E82E55A45C14CAA62A59E
dist/js/mesaScreen.js F0A723C4328F27EADFDFE685AF9306A415122B0D552DC25A291E6E069587B20F
dist/js/mesaMaps.js   C700644C6E63DCE606C0E5DEEF94B0A84BDDFE58D0A27C30A61081AC3500762A
dist/style.css        8F9D826A6AA06A10ED124405A4B437F91858C498337A35E36AA6785BF16D214B
```
