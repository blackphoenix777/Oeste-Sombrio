# Catálogo do Mestre, notas e barras — validação

Implementado em 11/11/2026 no projeto `jxxhdqoyblykqiiyptsp`.

## Funcionalidades

- Equipamentos na toolbar exclusiva do Mestre. Modo `gm` oculta saldo/destino pessoal, conserva criação de itens e envia item/variante com quantidade para a ficha escolhida.
- Fila persistente com UUID de entrega usado como chave de idempotência. O Mestre não escreve diretamente o inventário do jogador. O jogador aplica o item em memória, salva item e recibo juntos e só então confirma a entrega. Falha/retry não duplica. Um trigger preserva entregas novas diante de salvamento integral por uma sessão antiga; uma sessão que conhece o recibo pode consumir/remover o item normalmente.
- Notas privadas em árvore, busca, pastas/subpastas, renomeação/exclusão confirmadas. Editor independente do renderizador de criaturas, arraste por Pointer Events, minimização, título editável, textarea e estado de salvamento. Debounce de 1,5 s, fila serializada e comparação de versão; conflito preserva texto local e exige recarregar conscientemente. Fechar editor, sair da mesa ou logout força flush; erro mantém a edição aberta. Encerramento abrupto do processo continua sujeito à perda de alterações ainda não confirmadas pelo servidor.
- Status por token com integridade e REM; jogadores recebem apenas status de tokens de jogadores autorizados no mapa da flâmula. Criaturas visíveis também permanecem sem métricas na rede/DOM do jogador. Mestre lê todas as próprias entidades.
- Dano real persistido em `damagedChambers`, independente de `usedChambers` e fadiga. Aplicação de dano funciona mesmo com todos os dados gastos. Cura manual remove dano real. Cards/popups de criaturas têm campo explícito de dano/cura, por instância. REM ausente/zero não gera barra.

## Banco

Migrações aplicadas: `gm_tools_inbox_notes_token_status`, `gm_tools_status_metadata_sync` e `gm_tools_preserve_legacy_inventory`.

Scripts: `database/gm-tools.sql` (estado consolidado), `database/gm-tools-status-followup.sql` e `database/gm-tools-inventory-compat.sql` (ajustes incrementais já aplicados). A proteção de recibos só atua em fichas com entregas anteriores, preservando o formato legado de inventário nas demais.

Novas colunas: `mesas.notas_mestre`, `mesas.notas_mestre_versao`.

Novas tabelas com RLS e publication Realtime: `itens_entregues_pendentes`, `mesa_token_status`.

RPCs: `enviar_item_para_jogador`, `confirmar_entrega_item`, `sincronizar_token_status`. Todas negam execução a PUBLIC/anon e verificam identidade/autorização explicitamente. Auxiliares internos não são executáveis por clientes.

Triggers: validação/versão das notas; preservação dos recibos do inventário; resumo de status derivado da ficha, instância de cena e criação/alteração de token. Alterações da ficha atualizam suas cópias de token nos diferentes mapas; cada instância de criatura usa seu próprio owner_ref.

Diferenças necessárias em relação ao SQL inicial:

1. Escritas na fila passam pelas RPCs, sem UPDATE direto que permitiria ao destinatário alterar quantidade, conteúdo ou destino. Confirmação exige recibo persistido.
2. RPC de envio verifica também associação do destinatário, valida quantidade/tamanho e aceita identificador idempotente opcional.
3. A policy de status consulta a autorização do token e o helper de mapa; uma subconsulta direta a `mesas` pelo jogador falharia, pois essa tabela é privada. Aliados ocultos também são excluídos.
4. Nulos/token inexistente não contornam a RPC de status. Valores possuem constraints e status são atualizados automaticamente pelas fontes persistidas.
5. Notas usam comparação de versão e validação de estrutura/tamanho/profundidade.
6. Eventos de status assinados são exclusivamente INSERT/UPDATE. [Postgres Changes tem limitações de filtragem RLS em DELETE](https://supabase.com/docs/guides/realtime/postgres-changes).

## Testes efetivamente executados

| Teste | Resultado | Método |
|---|---|---|
| `tests/rls-gm-tools.sql` | 26 PASS | Transações reais com Mestre, jogador, não membro e anon; rollback. Repetido após ajustes incrementais, incluindo compatibilidade de inventário legado |
| `tests/rls-table-isolation.sql` | 21 PASS | Regressão real; rollback |
| `tests/rls-scene-visibility.sql` | 15 PASS | Regressão real; rollback |
| `tests/rls-token-initiative.sql` | 19 PASS | Regressão real; rollback |
| `tests/rls-turn-tracker.sql` | 27 PASS | Regressão real; rollback |
| `tests/rls-multiple-maps.sql` | 31 PASS | Regressão real; rollback |
| `tests/gm-tools-ui.cjs` | 33 PASS | Módulos ES reais e DOM/CSS em Chrome headless, transporte simulado |
| `tests/multiple-maps-ui.cjs` | 27 PASS | Mapas/grades/flâmula/visibilidade/câmera em Chrome headless |
| `tests/map-camera.cjs` | 37 PASS | Zoom, pan, snap 2×/0,5×, isolamento de câmera |
| `tests/turn-tracker-ui.cjs` | 28 PASS | Regressão do tracker em Chrome headless |
| `tests/token-initiative.cjs` | 11 grupos PASS | Backend/DOM simulados |
| `tests/scene-read.cjs` | PASS | Leitura pública, isolamento e atualização de tokens; backend simulado |
| `tests/auth-session.cjs` | PASS | Autenticação, revogação, logout e rejeição de identidade forjada |
| `tests/live-gm-tools.cjs` | 10 PASS | Auth, HTTP e WebSocket reais com duas contas descartáveis |

Resultados SQL individuais: `tests/artifacts/gm-tools-sql-results.json` (139 verificações). Resultados novos da interface: `tests/artifacts/gm-tools-ui-results.txt`. Resultados HTTP/WebSocket: `tests/artifacts/live-gm-tools-results.json`.

O teste real comprovou: entrega INSERT em 316 ms; ficha intacta até o jogador consumir; confirmação após persistência; dano/REM de aliado por WebSocket; atualização de criatura entregue ao Mestre e ausente no WebSocket do jogador durante a janela de observação; SELECT HTTP também sem criaturas; notas privadas e controle de versão via HTTP.

Falhas encontradas e resolvidas durante os testes: a primeira fixture de tokens enviava null em campo obrigatório por misturar chaves num INSERT em lote; corrigida para explicitar false. Uma tentativa de WebSocket expirou imediatamente após inscrições; a repetição aguardando estabilização dos canais passou. O cliente mantém reconciliação após SUBSCRIBED e leitura periódica da fila para cobrir a janela de conexão. Chrome no sandbox falhou ao iniciar GPU; as execuções locais isoladas autorizadas fora do sandbox passaram.

Após autorização explícita do usuário para este teste, foram criadas duas contas e uma mesa descartáveis. Limpeza final SQL confirmou zero usuários, perfis, identidades, sessões, mesas, fichas, tokens, entregas e status desses IDs. O arquivo local de credenciais foi removido. Não houve upload de arquivos nesta integração.

## Limites da validação e legado

- Não foi feita uma sessão manual simultânea em dois executáveis DarkWest. A interface foi exercitada em navegador headless com os módulos reais; a comunicação foi exercitada com clientes Supabase autenticados reais. O executável foi compilado a partir do código final.
- Fichas antigas não distinguem sempre dano, fadiga e consumo. A compatibilidade usa `markedChambers`, excluindo zeros identificáveis por fadiga; nunca transforma `usedChambers` em dano. História já perdida não pode ser reconstruída com certeza. Novas gravações usam o campo explícito; o Mestre pode corrigir o dano de cada criatura no card/popup.
- Itens personalizados continuam no catálogo local existente. A entrega inclui os atributos do item, permitindo recebê-lo sem instalar o catálogo do Mestre.
- Security Advisors foi consultado. As três RPCs novas aparecem no aviso genérico de execução SECURITY DEFINER por authenticated, intencional e protegida por checks testados. Os avisos de `handle_new_user`, `pg_net`, RPCs legadas e proteção de senhas já existentes não foram alterados nesta tarefa. Referências: [funções autenticadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extensão pública](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [execução anônima](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Arquivos de implementação

Novos: `dist/js/mesaDeliveries.js`, `dist/js/mesaNotes.js`, `dist/js/mesaTokenStatus.js`.

Adaptados: `dist/index.html`, `dist/style.css`, `dist/js/main.js`, `dist/js/catalogModal.js`, `dist/js/inventoryUI.js`, `dist/js/storage.js`, `dist/js/cylinder.js`, `dist/js/mesaScreen.js`, `dist/js/mesaMaps.js`, `dist/js/authUI.js`, `dist/js/authSession.js`.

Build: `npx tauri build --no-bundle`; saída `src-tauri/target/release/DarkWest.exe`. Instaladores existentes não foram substituídos.
