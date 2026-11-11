# Etapa 1 — Zoom e Pan local

Implementação em `dist/js/mesaScreen.js`, `dist/index.html` e `dist/style.css`.

- Câmera em memória, reiniciada ao entrar/sair da mesa; zoom 0,25–3,0.
- Roda centrada no cursor, botões +/−/100%/Ajustar e pan com botão direito.
- Imagem, grade e tokens compartilham o transform. Controles, toolbar e popups permanecem fora dele.
- Arraste de tokens divide deslocamento de tela pelo zoom; snap continua em coordenadas lógicas.
- Exclusão mútua entre câmera e arraste, isolamento por pointerId e cancelamento em perda de captura/foco.
- Controles se deslocam acima do hub quando os retângulos se sobrepõem.
- Nenhuma migração, alteração de Storage, upload, RLS, turnos ou fichas.

## Testes executados em 10/11/2026

`node tests/map-camera.cjs`: **37 verificações aprovadas** em Chrome headless, com DOM/CSS/código real e eventos sintéticos. Inclui limites e controles, âncora do cursor nos dois sentidos, pan, contextmenu limitado ao viewport, cancelamento, enquadramento, snap em 2× e 0,5× com pan não nulo, exclusão de ponteiros concorrentes, imobilidade da toolbar e desvio do hub.

O movimento de token usa um substituto de `updateMesaTokenPosition` que verifica as coordenadas solicitadas: não representa uma gravação real no banco. Duas instâncias JavaScript em janelas separadas (iframe) validam independência da câmera, sem sessões autenticadas. Um sentinela confirma que as ações de câmera não acessam o cliente Supabase nem agendam persistência da cena.

Regressões aprovadas:

- `node tests/turn-tracker-ui.cjs`: 28 verificações de UI; transporte simulado.
- `node tests/token-initiative.cjs`: 11 grupos; backend/DOM simulados.
- `node tests/scene-read.cjs`: leitura pública/privada e movimentação autorizada; backend simulado.
- `node tests/auth-session.cjs`: validações de sessão simuladas.
- `node tests/mesa-6b.cjs`: dados, cards, popups, hub e visibilidade; persistência simulada.

O primeiro lançamento do Chrome falhou no sandbox por indisponibilidade do processo gráfico. O teste foi reexecutado fora do sandbox e passou. A captura `tests/artifacts/map-camera.png` foi inspecionada visualmente.

O botão Ajustar respeita os limites de zoom: imagens cujo enquadramento exigiria escala inferior a 25% continuam sujeitas a esse mínimo.

## Executável e limite de validação nativa

`node_modules/.bin/tauri.cmd build --no-bundle` terminou com código 0 e gerou `src-tauri/target/release/DarkWest.exe` (11.208.192 bytes). Não foi criado instalador nem substituída a cópia instalada.

A ferramenta de controle do Windows recuperou-se após dois timeouts e uma reinicialização. A chamada de abertura pelo caminho do build resultou numa janela/processo da cópia instalada em `C:/Users/Stéfano/Nova pasta/Dark West Character Sheet/DarkWest.exe`. A captura dessa janela falhou com `FrameArrived timed out`. Não foram executados cliques, movimentos de tokens ou alterações de dados nessa janela. Zoom/pan e duas sessões autenticadas no executável atualizado **não foram validados interativamente** nesta rodada.
