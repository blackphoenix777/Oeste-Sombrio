# Fase 3 — Turn Tracker
Implementação em 10/11/2026, projeto Supabase `jxxhdqoyblykqiiyptsp`.

## Entrega
- Botão **Iniciar Combate** no cabeçalho Em Cena; passa a **Abrir Tracker** quando há combate. Botão compacto ⚔️ para reabrir após minimizar.
- Modal de preparo com seleção individual, iniciativa de ficha ou cascata e prioridade. Todos os tokens da cena começam selecionados. Jogadores usam ficha; monstros oficiais começam em cascata. NPCs de catálogo, incluindo Jeb, são reconhecidos pela categoria e começam usando ficha.
- Cascata calculada no servidor: 1d20 + N, depois -1 por participante na prioridade escolhida. Os valores ficam no estado do combate; não sobrescrevem `mesa_tokens.iniciativa`.
- Tracker flutuante arrastável, inicialmente no topo esquerdo do mapa; round, retratos, nomes, iniciativa e destaque do turno atual. Minimização é local e permanece minimizada durante atualizações do mesmo combate.
- Somente o Mestre inicia, avança, adiciona participantes ou encerra. Encerramento exige confirmação na interface.
- Entrada tardia explícita pelo botão **Adicionar ao Combate Ativo** no card. Jogador entra no fim com iniciativa da ficha e só muda de posição na virada do round. Entidades `creature` (incluindo NPCs representados por esse tipo) entram com iniciativa fixa 0 e permanecem ao final, inclusive em empate com jogador de iniciativa 0.
- Valores derivados de ficha acompanham alterações; a ordem é preservada durante o round e reordenada na virada. Cascata e iniciativa fixa não mudam com o valor posterior do token.
- Encerrar limpa somente `mesas.combate_ativo`, preservando fichas, HP, condições, tokens, cena, mapa e eventos. Teste SQL comparou esses dados antes/depois.
- Tokens removidos da cena deixam de aparecer no resumo; o índice é remapeado ao participante sobrevivente correspondente ou seguinte. Combate sem tokens permanece encerrável pelo Mestre, com avanço desabilitado.

## Ajuste necessário para preservar a privacidade
A Fase 1 tornou a linha completa de `mesas` privada do Mestre. A assinatura direta dessa linha pelos jogadores, como sugerida no prompt, conflitaria com a proteção de `cena_ativa`, `npcs_mesa` e participantes ocultos.

Foi preservada a assinatura de `mesas` no canal `mesa-<id>` para o Mestre e adicionada, no **mesmo canal**, a assinatura de `mesa_combate_sinais`. Essa tabela contém apenas `mesa_id` e `revisao`, possui RLS para membros/Mestre e não permite escrita por clientes. Alterações de combate e alterações relevantes dos tokens geram o sinal na mesma transação. Ao recebê-lo, o cliente chama `obter_combate_publico`.

A RPC filtra no servidor antes de transmitir: só entidades visíveis ou o próprio token do jogador, mantendo a exceção de propriedade da Fase 1. Se a vez for de alguém oculto, retorna índice público -1 e um indicador neutro; não transmite o ID, nome, iniciativa ou índice privado desse participante. A tela mostra **Aguardando o Mestre**. A contagem/rolagem completa da cascata só é retornada ao Mestre.

Esse mecanismo também sinaliza ocultações, mesmo quando a RLS do token impede a entrega do UPDATE da própria entidade. O refresh existente continua como recuperação adicional. [Documentação de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## Banco
Migrações aplicadas:
1. `shared_turn_tracker` — fonte em `database/turn-tracker.sql`.
2. `turn_tracker_late_fixed_order` — ajuste de ordenação dos tardios com iniciativa fixa, fonte em `database/turn-tracker-late-order.sql`. O primeiro arquivo também contém essa regra final para instalações novas.

Objetos:
- Coluna `mesas.combate_ativo jsonb DEFAULT NULL`.
- Tabela `mesa_combate_sinais`, policy `combate_sinais_select_membros`, publicação `supabase_realtime`.
- Funções `gerenciar_combate`, `obter_combate_publico`, `atualizar_resumo_combate`, `item_combate`, `sinalizar_mudanca_combate`.
- Triggers `combate_estado_sinal` e `combate_token_sinal`.

As colunas e policies de `mesa_tokens` não foram alteradas. Apenas foi acrescentado o trigger de sinalização. Nenhuma policy anterior de fichas, eventos ou mesas foi relaxada.

O estado contém os campos solicitados e metadados adicionais: ID do combate, versão, fonte da iniciativa por entrada e informações da cascata para o Mestre. A RPC de mutação usa lock da mesa, valida identidade de Mestre e exige ID/versão atuais. Uma tentativa com versão antiga retorna `40001` e não avança o turno. A interface recarrega o estado e exibe o conflito, sem repetir automaticamente a ação.

## Arquivos de frontend
- `dist/js/turnTracker.js`: novo módulo de setup, tracker, controles, drag, carregamento e RPCs.
- `dist/js/mesaScreen.js`: integração de canal, entrada/saída de mesa, refresh, cards e categoria das cópias.
- `dist/js/main.js`: importação e binding do módulo.
- `dist/index.html`: botões e markup dos três componentes (setup, tracker, confirmação).
- `dist/style.css`: estilos do tracker e diálogos.

## Validação efetivamente executada
**82 verificações SQL passaram**: 27 da Fase 3 + 21 da Fase 0 + 15 da Fase 1 + 19 da Fase 2. Scripts executados no Supabase real, cada um em transação terminada em ROLLBACK, assumindo papéis `authenticated`/`anon` e claims das identidades Mestre, membro e não-membro.

A consulta final encontrou zero mesas temporárias e zero combates de teste ativos. Confirmou também as colunas mínimas da tabela de sinais, RLS ativo e inclusão na publicação.

| Verificação Fase 3 | Resultado |
|---|---|
| Mestre consulta mesa sem combate | PASS — null |
| Setup sem participantes | PASS — 22023 |
| Setup com token de outra mesa | PASS — 22023 |
| Setup com token duplicado | PASS — 22023 |
| Mestre inicia combate com apenas os selecionados | PASS — round 1, índice 0, três participantes |
| Cascata d20 + N e prioridades individuais; ordem unificada | PASS — primeiro=d20+2, segundo=primeiro-1 |
| Cascata não sobrescreve iniciativas dos tokens/fichas | PASS |
| Segundo início com combate ativo | PASS — 40001 |
| Início produz sinal Realtime sem nomes/ordem | PASS |
| Jogador recebe só próprio token e criatura visível; mesas segue privada | PASS |
| Membro pode ler sinal para assinar Realtime | PASS |
| Jogador não inicia/avança/adiciona/encerra via RPC | PASS — 42501 nas quatro ações |
| Jogador não altera sinais nem combate via UPDATE direto | PASS |
| Não-membro sem RPC ou sinal da mesa | PASS — 42501 / zero linhas |
| Anon não executa RPC pública | PASS — 42501 |
| Próximo Turno avança o índice | PASS — índice 1 |
| Repetição/segunda sessão com versão antiga | PASS — 40001, sem avanço extra |
| Monstro oculto tardio entra no fim com iniciativa 0 fixa | PASS |
| Jogador tardio entra no fim apesar da iniciativa 30 | PASS |
| Mudança de token sinaliza atualização; cascata mantém iniciativa fixa | PASS |
| Ficha atualizada aparece no resumo sem revelar monstro oculto tardio | PASS |
| Round 2: jogador sobe com iniciativa 40; monstro segue no fim/0; flags limpas | PASS |
| Criatura tardia permanece depois de jogador com iniciativa zero | PASS |
| Turno de criatura oculta: índice público -1, sem ID ou nome oculto | PASS |
| Ocultar gera sinal público seguro e remove entidade da RPC | PASS |
| Encerrar limpa só combate: tokens/fichas/HP/condições/cena/mapa/chat idênticos | PASS |
| Jogador recebe null após encerramento | PASS |

Resultados individuais das quatro suítes: [phase3-sql-results.json](<C:/Users/Stéfano/Desktop/ficha dark westy/tests/artifacts/phase3-sql-results.json>). Asserções reproduzíveis em `tests/rls-turn-tracker.sql` e nos três scripts de regressão.

**Frontend:** `node tests/turn-tracker-ui.cjs` passou em **28 verificações** no Chrome headless. Testa o código real do módulo e os elementos reais do HTML, com transporte/RPC/eventos de rede simulados: preparo, classificação de Jeb, seleção, abertura, round/destaque, olho de oculto, posição, minimização/reabertura, envio de ID/versão, conflito, entrada tardia, confirmação/cancelamento/fim, assinatura de sinal, abertura da visão do jogador, ausência de ocultos/controles de Mestre, rejeição de resposta antiga e fechamento por evento.

Também passaram `token-initiative.cjs` (11 grupos), `scene-read.cjs`, `auth-session.cjs` e `mesa-6b.cjs` (cards, popups, 6B, hub e visibilidade). A primeira execução do teste novo encontrou um problema no leitor do resultado HTML do teste; foi corrigido e a suíte terminou com sucesso.

Capturas inspecionadas visualmente:
- [Preparo](<C:/Users/Stéfano/Desktop/ficha dark westy/tests/artifacts/turn-tracker-setup.png>)
- [Mestre](<C:/Users/Stéfano/Desktop/ficha dark westy/tests/artifacts/turn-tracker-gm.png>)
- [Jogador em turno oculto](<C:/Users/Stéfano/Desktop/ficha dark westy/tests/artifacts/turn-tracker-player.png>)

## Limites da validação
O usuário informou que **não há sessão de jogador aberta**. Portanto, não foi executado o teste ponta a ponta entre duas sessões autenticadas no executável usando WebSockets reais. A configuração/publicação/RLS, as ações reais de banco e o comportamento visual com eventos simulados foram validados separadamente. Isso não comprova latência/entrega de rede entre Mestre e jogador.

A proteção contra sobrescritas foi validada com uma requisição de versão antiga. Não foi realizado ensaio de carga nem corrida simultânea entre dois clientes reais.

O advisor de segurança foi consultado. As duas novas RPCs aparecem no aviso genérico de funções SECURITY DEFINER executáveis por authenticated; seus controles de acesso são intencionais e foram testados. Funções auxiliares têm EXECUTE revogado de PUBLIC/anon/authenticated. Permanecem avisos preexistentes sobre `handle_new_user`, `pg_net`, funções antigas e proteção de senhas, sem alterações fora do escopo. Referência do aviso: [SECURITY DEFINER autenticado](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Executável

`tauri build --no-bundle` concluído com exit code 0, perfil release. Executável: [DarkWest.exe](<C:/Users/Stéfano/Desktop/ficha dark westy/src-tauri/target/release/DarkWest.exe>), 11.206.656 bytes. Nenhum novo instalador foi gerado. O aviso de canonicalização do caminho com acento não impediu a compilação.

SHA-256: `C61D6B7AA1A8E7759A9622EDF0CA83CB6579B58E19BB30D1A3FE5E2BD59CA5F3`.

