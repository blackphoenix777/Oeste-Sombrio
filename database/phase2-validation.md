# Fase 2 — iniciativa por instância

Conclusão em 10/11/2026. Implementação aplicada ao Supabase `jxxhdqoyblykqiiyptsp` e ao frontend. Nenhuma interface de turnos, rounds ou início/fim de combate foi adicionada.

## Implementação entregue

- `mesa_tokens.iniciativa`: integer NOT NULL DEFAULT 0. A tabela já participava de `supabase_realtime`; a migração preserva essa publicação sem tentar adicioná-la em duplicidade.
- Cada criatura usa sua própria linha, com `owner_ref = instanceId`. O índice único existente `(mesa_id, owner_type, owner_ref)` mantém esse vínculo. Nome e `sourceId` não são usados para sincronizar iniciativa.
- `addNpcMesaToScene` e `addPlayerToScene` enviam a iniciativa inicial. A inserção no cache não duplica o token quando o evento Realtime chega antes da resposta REST.
- Edições de iniciativa do card/popup/ficha completa da instância sincronizam o token. Escritas rápidas são serializadas por mesa e instância. Rolar 6B também passa pela sincronização, preservando as regras de cálculo existentes.
- Triggers internos sincronizam o valor ao salvar `fichas.dados` e `mesas.cena_ativa`. O trigger da ficha atualiza somente token de jogador com mesma ficha, mesa e proprietário; o da cena usa o `instanceId` de cada cópia. Um trigger de INSERT inicializa tokens de jogadores a partir da ficha atual. Os triggers não concedem acesso às fichas nem acesso direto de escrita à iniciativa/visibilidade para jogadores.
- Tokens existentes receberam backfill a partir da ficha ou instância correspondente. A consulta posterior encontrou **zero divergências** entre essas fontes e os tokens associados.
- `obter_cena_publica(uuid)` retorna os oito campos anteriores mais `iniciativa` e `visible_to_players`. Não retorna Defesa, 6B, ataques, condições ou notas. As policies de visibilidade da Fase 1 foram preservadas.
- O jogador continua lendo a RPC. Eventos Realtime provocam nova leitura pública; o Mestre atualiza o cache diretamente. Arraste local suprime apenas o eco da posição, preservando alterações de iniciativa.
- `OS.getMesaCombatantsIniciative()` retorna snapshots ordenados por iniciativa decrescente, nome e tokenId. Respeita visibilidade/propriedade e mantém cada cópia separada. `activeMesaState.tokens` é um alias do cache existente `mesaTokens`.
- `OS.dispatchMesaCombatantsChange()` emite `window` CustomEvent `mesa-combatants-change`, com `{ mesaId, combatants }`, quando o resumo muda. Refresh idêntico não repete a notificação.

## Arquivos e objetos alterados

| Arquivo | Alteração |
|---|---|
| `database/token-initiative.sql` | SQL aplicado pela migração `token_instance_initiative` |
| `dist/js/mesaScreen.js` | Sincronização, leitura, tratamento Realtime, cache, hook e API de consumo |
| `tests/rls-token-initiative.sql` | 19 verificações SQL da Fase 2 |
| `tests/token-initiative.cjs` | 11 grupos de testes do frontend com transporte/DOM simulados |
| `tests/rls-scene-visibility.sql` | Contrato público atualizado de 8 para 10 campos; preservadas as verificações de segurança |
| `database/phase2-validation.md` | Este relatório |

Funções novas: `normalizar_iniciativa_token(text)`, `sincronizar_iniciativa_ficha_token()`, `sincronizar_iniciativa_cena_tokens()` e `inicializar_iniciativa_jogador_token()`. As três últimas possuem triggers correspondentes. Função recriada: `obter_cena_publica(uuid)`, porque PostgreSQL não permite mudar o tipo TABLE de retorno com CREATE OR REPLACE. Recriação e grants ocorreram atomicamente na migração. Nenhuma policy foi alterada nesta fase.

## Testes SQL efetivamente executados

Os três scripts rodaram no Supabase real, em transações separadas terminadas em ROLLBACK. As identidades foram assumidas com `SET LOCAL ROLE authenticated` e `request.jwt.claims`, alternando Mestre, membro e não-membro. Também foi usado `SET LOCAL ROLE anon`. Não foram testes de rede com JWT/WebSocket. Os perfis de teste existentes foram usados sem mudar suas credenciais. A consulta posterior encontrou **zero mesas temporárias** dos testes.

**Fase 2: 19/19 passaram.**

| Identidade / cenário | Resultado observado |
|---|---|
| Mestre cria Inebriados #1 e #2 | Dois IDs/owner_refs distintos, iniciativas 12 e 7, ambos ocultos |
| Mestre cria token sem iniciativa | Iniciativa 0, visibilidade false |
| Mestre cria token do jogador após save da ficha | Iniciativa inicial 9, obtida da ficha |
| Mestre atualiza #1 por mesa + instanceId | #1 passa a 19; #2 fica em 7; outra mesa fica em 0 |
| Mestre salva iniciativa da instância na cena privada | #1 passa a 23; #2 fica em 7 |
| Membro lê RPC e SELECT direto antes de revelar | Somente seu token, com iniciativa 9 |
| Membro salva a própria ficha | Token próprio passa a 31, mantendo visibilidade false |
| Membro faz UPDATE direto de iniciativa no próprio token | Negado, SQLSTATE 42501 |
| Membro tenta alterar visibilidade e depois mover token | Visibilidade negada; movimento permitido, iniciativa preservada |
| Membro tenta mudar criatura oculta | UPDATE afeta zero linhas |
| Mestre verifica efeitos do save do jogador | Outro jogador permanece em 6 e criatura #2 permanece em 7 |
| Membro lê #1 após revelação | Iniciativa 23, exatamente 10 campos públicos; cena privada e ficha alheia continuam inacessíveis |
| Membro tenta mudar criatura visível | UPDATE afeta zero linhas |
| Mestre salva iniciativa textual inválida | Normalizada para 0 apenas na instância correspondente |
| Mestre lê a mesa | Todos os quatro tokens acessíveis, incluindo ocultos |
| Mestre oculta #1 e membro relê | Token e iniciativa deixam de aparecer na RPC e no SELECT |
| Não-membro chama RPC e consulta tokens | RPC negada; SELECT vazio mesmo havendo token/ficha associados ao usuário |
| Anon chama RPC | Negado, SQLSTATE 42501 |
| Verificação de privilégios das funções internas | EXECUTE não concedido aos clientes testados |

**Regressão Fase 0: 21/21 passaram.** Convite inválido; UUID na RPC nova e na legada; INSERT direto como jogador ou falso Mestre; eventos/fichas de não-membro; convite válido; reentrada sem duplicidade; eventos públicos e próprios secretos; segredo do Mestre; ficha de colega; ficha própria; fichas privadas/de outra mesa; edição própria/alheia; leitura das fichas e eventos pelo Mestre; isolamento do Mestre em outras mesas; criação da mesa e vínculo do Mestre; bloqueio da RPC nova para anon. Resultados individuais e asserções estão em `tests/rls-table-isolation.sql`.

**Regressão Fase 1: 15/15 passaram.** Default de visibilidade; inserção de evento por membro/não-membro; RPC e SELECT; proteção da visibilidade/identidade do token; movimento do dono; bloqueio da cena privada; operações completas do Mestre; revelação; payload público mínimo; ocultação; bloqueio de anon; remoção pelo Mestre. A asserção do payload foi adaptada para os dois campos adicionais previstos na Fase 2. Resultados individuais e asserções estão em `tests/rls-scene-visibility.sql`.

## Testes locais efetivamente executados

- `node tests/token-initiative.cjs`: **11 grupos passaram** — criação de duas cópias pelo fluxo real do frontend, ausência de duplicação pelo eco INSERT, edição isolada, serialização de escritas, rolagem sem alteração das regras, API/snapshot/alias, UPDATE durante arraste e descarte de pacote antigo, DELETE e hook, desempate, jogador via RPC e filtro de ocultos, evento de outra mesa, resposta atrasada após troca de mesa. O transporte Supabase e o DOM são simulados.
- `node tests/scene-read.cjs`: passou — RPC do jogador, normalização do ID, movimento próprio, bloqueio do movimento alheio, metadados públicos, remoção após refresh e SELECT completo do Mestre. Backend simulado.
- `node tests/auth-session.cjs`: passou — perfil forjado, sessão ausente, usuário verificado, logout, usuário revogado, anônimo e usuário divergente. Testes locais.
- `node tests/mesa-6b.cjs`: passou no Chrome headless — cards, popups, configurações de 7/8/2 dados, saneamento, hub e botões de visibilidade. Componentes reais, dados/transporte simulados. Captura inspecionada visualmente.

## Limitações e compatibilidade

1. Rolar o 6B da criatura pelo card já não recalculava `data.iniciativa`. Esta fase não introduz uma regra nova: sincroniza a iniciativa existente/calculada pela ficha ou editada pelo Mestre. Monstros oficiais não receberam regra de d20 nem estrutura de combate.
2. O hook e a API estão disponíveis, mas não há nova visualização de iniciativa para o jogador nesta fase. A validação dessa infraestrutura é pelo cache/API; a interface de turnos fica para a Fase 3.
3. O teste ponta a ponta com uma sessão de jogador na mesa **Novo tempo** não foi concluído. Na primeira tentativa, Computer Use falhou com `failed to write kernel assets`. Na retomada, a ferramenta voltou a inicializar, mas o DarkWest não estava aberto. A tentativa de abrir o executável compilado retornou `Computer Use app approval timed out`; não foi possível observar uma sessão autenticada. Os testes SQL e os eventos simulados não comprovam entrega/latência de um WebSocket real.
4. O refresh público de segurança da Fase 1 continua ativo. Ocultar um token pode impedir que o jogador receba justamente o UPDATE que o tornou oculto; a próxima leitura pública o remove. Não é correto prometer ocultação instantânea baseada apenas nesse UPDATE.
5. `DELETE` em Postgres Changes tem tratamento diferente de INSERT/UPDATE: não se deve afirmar que nenhum evento de entidade oculta pode trafegar, pois a autorização RLS da linha removida não pode ser reavaliada. A tabela mantém replica identity DEFAULT, confirmada no banco; não foi habilitado o envio de registros antigos completos. O frontend usa a RPC para reconstruir a visão do jogador e não aproveita campos antigos de DELETE. Essa limitação é da [documentação do Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records). Se o requisito futuro for ausência absoluta até de notificações de remoção, será necessário um canal público de notificações separado.
6. O advisor de segurança foi consultado. As novas funções internas não apareceram como executáveis por clientes. Permanecem avisos em objetos/configurações preexistentes: `handle_new_user` com search_path mutável, `pg_net` no schema public, funções SECURITY DEFINER antigas executáveis por anon/authenticated e proteção contra senhas vazadas desabilitada. A RPC pública autenticada também é sinalizada por ser SECURITY DEFINER; seu acesso por membro/Mestre e bloqueio de anon foram testados. Referências: [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extensão em public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [EXECUTE anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [EXECUTE authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Objetos fora do escopo não foram modificados.

## Consumo na Fase 3

```js
console.table(OS.getMesaCombatantsIniciative());
window.addEventListener('mesa-combatants-change', event => {
  console.table(event.detail.combatants);
});
```

O consumidor recebe apenas o conjunto permitido ao usuário atual. A API preserva a grafia `Iniciative` solicitada no prompt.

## Executável

Compilação `tauri build --no-bundle` concluída com exit code 0, perfil release. Saída: `src-tauri/target/release/DarkWest.exe`, 11.200.512 bytes. Não foi gerado um novo instalador. SHA-256:

```text
228C06CD51E2691AE1E55B43F6964DE1F36D38A2B02FEAEC384EE049550ECFD8
```

O build emitiu o aviso `could not canonicalize path C:\Users\Stéfano`, mas terminou com sucesso e informou o caminho do executável. A pasta do projeto não é um repositório Git; nenhuma alteração foi commitada.
