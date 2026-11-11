# Etapa 2 — Múltiplos mapas e flâmula

Concluída em 11/11/2026 no projeto `jxxhdqoyblykqiiyptsp`.

## Resultado

- Até quatro mapas, com UUID, slot estável, nome, imagem e grade independente.
- Navegação privada do Mestre; botão explícito e confirmação para mover jogadores.
- Jogador recebe uma fotografia consistente do mapa da flâmula e dos tokens autorizados, via RPC. Abas e mapas de preparação não são enviados.
- Câmera do Mestre preservada por mapa; jogador enquadra a nova cena. Arraste cancelado na transição; respostas antigas não restauram outra aba.
- Reconciliação não usa ausência no cache de um mapa para apagar criaturas da cena global. Remoções de tokens são limitadas ao mapa visualizado.
- Combate permanece ligado ao mapa inicial. Navegar abas não o encerra; adicionar participante de outro mapa é bloqueado. Jogador não recebe combate de um mapa diferente da flâmula.

## Banco aplicado e verificado

Migrações `multiple_maps_private_storage` e `multiple_maps_combat_guard`.

Scripts: `database/multiple-maps.sql` e `database/multiple-maps-combat-guard.sql`.

Colunas: `mesas.mapas`, `mesas.mapa_ativo_jogadores_id`, `mesa_tokens.mapa_id NOT NULL`. Unicidade `(mesa_id,mapa_id,owner_type,owner_ref)`. Triggers validam 1–4 mapas, UUID/slot únicos, nomes, grades, flâmula e pertencimento do token à mesa/mapa. A tabela `mesa_mapa_sinais` tem RLS e está na publication `supabase_realtime`.

RPCs novas: `obter_mapa_publico`, `gerenciar_mapas`. Auxiliares: `mapa_visivel_ao_usuario`, `pode_ler_arquivo_mapa`, `validar_mapas_mesa`, `validar_mapa_token`, `sinalizar_mudanca_mapa`. Adaptadas: `obter_cena_publica`, `listar_mesas_acessiveis`, `gerenciar_combate`, `atualizar_resumo_combate`, `obter_combate_publico`.

Policies alteradas: `mesa_tokens_select_members_or_mestre`, `mesa_tokens_update_mestre_or_owner`; substituição de `mesa_maps_select_public` por `mesa_maps_select_autorizado`; novas restrições `mesa_maps_slots_insert` e `mesa_maps_slots_update`; leitura de sinais por `mapa_sinais_select_membros`. Dados completos de `mesas` continuam privados ao Mestre.

Auditoria final: quatro mesas, todas com mapa/flâmula válidos; URL antiga e grade do Mapa 1 preservadas; zero tokens sem mapa; bucket `mesa-maps` privado; sinal publicado; execução de `obter_mapa_publico` negada a `anon` e concedida a `authenticated`. No momento da migração, não havia tokens persistidos nas quatro mesas; preservação de entidades e isolamento foram exercitados nas fixtures transacionais.

## Ajustes necessários ao SQL proposto

1. A consulta de `mesas` dentro do RLS do jogador não funcionaria, pois essa tabela é privada. O predicado autorizado verifica associação e flâmula sem expor a linha.
2. Toda mesa recebe um primeiro mapa, mesmo sem imagem, evitando tokens vinculados a UUIDs ausentes do array.
3. Alterações parciais de mapas passam por RPC com lock da mesa, evitando sobrescrever o array de outra sessão. Exclusão do mapa com combate ativo é bloqueada; exclusão do último mapa também.
4. O bucket público permitia downloads dos mapas de preparação. Ele foi tornado privado; imagens são baixadas com autenticação e apresentadas por URL temporária `blob:`. Não são criadas URLs assinadas com acesso independente da flâmula.
5. O jogador escuta sinais seguros, não eventos brutos de DELETE de tokens: [Postgres Changes não aplica a mesma filtragem RLS a DELETE](https://supabase.com/docs/guides/realtime/postgres-changes).
6. O sinal também cobre alterações da imagem/grade ativa e tokens, permitindo remover imediatamente entidades ocultadas. Mapas em preparação não mudam a flâmula.

## Testes executados

| Conjunto | Resultado | Método |
|---|---|---|
| `tests/rls-multiple-maps.sql` | 31 PASS | Transação real com identidades Mestre, jogador, não membro e anon; rollback |
| `tests/rls-table-isolation.sql` | 21 PASS | Regressão real de isolamento; rollback |
| `tests/rls-scene-visibility.sql` | 15 PASS | Regressão real de visibilidade; rollback |
| `tests/rls-token-initiative.sql` | 19 PASS | Regressão real de iniciativa por instância; rollback |
| `tests/rls-turn-tracker.sql` | 27 PASS | Regressão real de combate; rollback; repetida após proteção adicional |
| `tests/multiple-maps-ui.cjs` | 27 PASS | Chrome headless, DOM/CSS/handlers reais, backend simulado |
| `tests/map-camera.cjs` | 37 PASS | Zoom/pan/snap em 2× e 0,5×; eventos de ponteiro sintéticos |
| `tests/turn-tracker-ui.cjs` | 28 PASS | UI real com transporte simulado; repetida após ajuste do canal |
| `tests/token-initiative.cjs` | 11 grupos PASS | Backend/DOM simulados |
| `tests/scene-read.cjs` e `tests/auth-session.cjs` | PASS | Regressões de leitura e sessão simuladas |
| `tests/live-maps.cjs` | 13 PASS | Duas contas descartáveis autenticadas, HTTP, Storage e WebSocket reais |

Os 113 resultados SQL individuais estão em `tests/artifacts/multiple-maps-sql-results.json`. O teste novo cobre limite de quatro mapas por RPC e UPDATE, grades independentes, unicidade por mapa, pertencimento de tokens, RLS de leitura/movimentação, dados públicos mínimos, permissões de Storage, flâmula/sinal, combate e exclusão limitada ao mapa. As verificações de Storage desse arquivo SQL testam metadados; os uploads de bytes foram verificados separadamente pelo teste real.

O teste real enviou três PNGs sintéticos diferentes aos slots 1/2/3 e substituiu o slot 2. Confirmou coexistência e preservação dos bytes do slot 1, negação de download privado/URL pública/anon, silêncio durante preparação, recebimento da flâmula por WebSocket em **471 ms**, retorno da grade 32 com apenas o monstro visível e restrição também no SELECT HTTP direto. Resultados: `tests/artifacts/live-maps-results.json`.

Falhas encontradas durante validação: a primeira tentativa WebSocket conectou mas expirou sem evento; a repetição com JWT explicitamente sincronizado antes do join funcionou. O cliente passou a fazer essa sincronização e a reconciliar a cena após a primeira assinatura, cobrindo a janela entre leitura inicial e conexão. Um download sem renovação do cache apresentou autorização antiga; downloads agora usam `cacheNonce` por requisição e `cache: no-store`. O teste final com esse fluxo passou. A execução headless inicial por tempo virtual não aguardou todas as decodificações; o harness passou a esperar o resultado real do teste antes de capturar a imagem.

A criação de contas temporárias foi inicialmente rejeitada pela revisão automática. Após autorização explícita do usuário em 11/11/2026, o teste foi executado. A limpeza final confirmou **zero** contas, perfis, identidades, sessões, mesas, tokens e arquivos desses IDs. O arquivo local de credenciais temporárias também foi apagado.

## Arquivos do cliente

- `dist/js/mesaMaps.js`: ciclo de mapas, RPC, downloads privados, uploads por slot, abas, configurações, flâmula e câmera por mapa.
- `dist/js/mesaScreen.js`: inicialização/saída, leitura/reconciliação, tokens por mapa, Realtime e autenticação do canal; removida limpeza em massa de uploads.
- `dist/js/main.js`: carregamento do módulo novo.
- `dist/js/turnTracker.js`: botão de entrada tardia limitado ao mapa do combate.
- `dist/index.html` e `dist/style.css`: abas e diálogo fora do canvas transformado.

Captura inspecionada: `tests/artifacts/multiple-maps.png`.

## Compatibilidade e limites

- Usar o executável atualizado: cópias antigas tentam abrir URLs públicas, incompatíveis com o bucket agora privado. Não foi substituída a instalação existente.
- Trocas de extensão e exclusão de abas conservam arquivos anteriores privados. Não há remoção em massa nem remoção de arquivos de outros slots; um slot reutiliza seu caminho `slot_N.ext` via upsert.
- Imagens já vistas ou baixadas anteriormente não podem ser retiradas da memória/disco de um jogador. O controle impede novas leituras não autorizadas e entrega de mapas de preparação.
- O tracker mantém um combate por mesa, vinculado a um mapa. Navegação não cria combates simultâneos.
- Os testes reais de rede usaram clientes Node autenticados descartáveis, e os testes de interface usaram Chrome headless. Não foram executadas duas janelas nativas do DarkWest autenticadas simultaneamente.
- Advisories existentes de `handle_new_user`, `pg_net`, funções legadas executáveis por anon e proteção de senhas não foram alterados nesta etapa. Novas RPCs SECURITY DEFINER têm checagem de identidade/participação, search_path fixo e grants restritos; o aviso genérico sobre execução por authenticated é esperado para essas RPCs. [Referência do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Build

`node_modules/.bin/tauri.cmd build --no-bundle`: código 0. Executável `src-tauri/target/release/DarkWest.exe`, 11.211.776 bytes.

SHA-256: `0145946954E070C909BF042737DCCC84B6734D4BEA73F61F1F8605DA9EA57458`.
