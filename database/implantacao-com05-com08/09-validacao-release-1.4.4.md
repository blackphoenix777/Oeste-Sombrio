# Validação do release 1.4.4

## Autorização de publicação — 17/11/2026

O proprietário autorizou expressamente a publicação geral da v1.4.4 e seu anúncio pelo updater, aceitando o risco do upgrade real Windows não ensaiado. Essa decisão substitui o bloqueio de publicação registrado abaixo, sem transformar o teste ausente em PASS. Permanecem os riscos de ausência de Authenticode e instalação automática sem ensaio isolado.

Os três artefatos aprovados serão preservados byte a byte. O workflow oficial terá um caminho exclusivo para v1.4.4 que baixa os assets do rascunho, verifica SHA-256, assinatura Minisign, manifesto e commit de destino antes de publicar como estável/latest. O build genérico não executa para essa tag. Histórico e resultado público em [11-publicacao-oficial-1.4.4.md](11-publicacao-oficial-1.4.4.md).

## Parecer histórico — desbloqueio exclusivo do updater, 16/11/2026

**NO-GO — ambiente isolado indisponível.** O proprietário confirmou que não há VM Windows descartável ou segundo computador disponível para o ensaio. O 1.4.3 autêntico não foi instalado na máquina principal. Nenhuma suíte já aprovada foi repetida; nenhum arquivo funcional, instalador, assinatura, manifesto ou endpoint foi alterado.

A inspeção confirmou o fluxo de descoberta, confirmação/adiamento e instalação NSIS, sem opção de sobrescrita de endpoint exposta pelo aplicativo. Uma única VM Windows com WebView2 e servidor HTTPS local é a menor infraestrutura proposta. O procedimento serve os bytes exatos do manifesto candidato e do instalador nos caminhos GitHub originais, com DNS/hosts e CA restritos ao convidado, mantendo TLS e Minisign. A confiança do certificado precisa ser comprovada pelo cliente 1.4.3 autêntico; não é resultado já obtido.

Windows Sandbox está ausente; Hyper-V possui módulo e serviços, mas não há convidado Windows acessível comprovado e o inventário privilegiado não foi repetido. Não foram localizados controladores de VirtualBox/VMware/QEMU nos caminhos consultados. O acesso negado às consultas CIM não permite concluir insuficiência de hardware. Não foram instalados programas ou contratados serviços.

[Procedimento completo, requisitos, critérios e alternativa manual](10-ensaio-updater-windows-1.4.4.md). Descoberta real, adiamento, aceite, download, instalação, reabertura e persistência permanecem **BLOCKED**. A alternativa manual está documentada, sujeita à aprovação do proprietário, e não valida o updater. Risco adicional confirmado: NSIS candidato com Authenticode **NotSigned**; a Minisign previamente validada não é verificada automaticamente ao abrir o instalador manualmente.

Somente documentação do release foi alterada nesta missão. Sem acesso de escrita ao Supabase, sem commit/tag/push/merge/release/publicação. Os resultados funcionais e hashes aprovados abaixo permanecem válidos para os mesmos artefatos.

## Resultados preservados — retomada dos testes em 16/11/2026

**NO-GO PARA PUBLICAÇÃO — SOMENTE UPGRADE WINDOWS PENDENTE.** Os testes remotos e as 11 regressões locais foram executados e aprovados nesta retomada. Nenhuma correção de schema foi reaplicada, nenhuma escrita foi enviada à produção e nenhum artefato foi publicado.

### Resultados executados

| Verificação | Resultado real | Evidência |
| --- | --- | --- |
| `live-maps.cjs` integral | **PASS, 13 verificações, EXIT=0** | [resultado](evidencias-retomada-144/live-maps-results.json), [log](evidencias-retomada-144/live-maps.log) |
| `live-gm-tools.cjs` integral | **PASS, 10 verificações, EXIT=0** | [resultado](evidencias-retomada-144/live-gm-tools-results.json), [log](evidencias-retomada-144/live-gm-tools.log) |
| Complemento HTTP/Auth/persistência | **PASS, 17 verificações, EXIT=0** | [resultado](evidencias-retomada-144/live-release-144-persistence-results.json), [log](evidencias-retomada-144/live-persistence.log) |
| PostgreSQL/RLS mapas | **PASS, 31 verificações**, rollback | [resultados SQL](evidencias-retomada-144/sql-e-limpeza.json) |
| PostgreSQL/RLS ferramentas do Xerife | **PASS, 26 verificações**, rollback | [resultados SQL](evidencias-retomada-144/sql-e-limpeza.json) |
| PostgreSQL/RLS COM-05 a COM-08 | **PASS, 12 verificações**, rollback | [resultados SQL](evidencias-retomada-144/sql-e-limpeza.json) |
| Regressões locais | **PASS, 11/11 suítes, EXIT=0** nas execuções finais | Logs individuais em `evidencias-retomada-144` |
| Remoção dos fixtures | **PASS**, zero registros residuais nas 12 categorias conferidas | [consulta final](evidencias-retomada-144/sql-e-limpeza.json) |
| Integridade dos artefatos | **PASS**, hashes anteriores e posteriores idênticos | [SHA-256](evidencias-retomada-144/release-hashes.json) |
| Upgrade Windows autêntico 1.4.3 → 1.4.4 | **BLOCKED**, execução fora desta missão e sem ambiente isolado disponibilizado | Método e requisitos abaixo |

`live-maps` usou Auth real de Xerife e jogador, uploads/downloads de PNG sintéticos e WebSocket autenticado. Comprovou isolamento entre slots, bloqueio de imagem privada e acesso anônimo, ausência de sinalização durante preparação, troca de flâmula por Realtime em **362 ms**, nova grade e tokens corretos, bloqueio do mapa anterior e SELECT direto protegido por RLS.

`live-gm-tools` comprovou entrega HTTP e INSERT Realtime em **469 ms**, ficha intacta antes do consumo, confirmação pelo destinatário, integridade/REM por Realtime, sigilo de criaturas tanto no WebSocket quanto no SELECT HTTP, persistência das notas, incremento de versão, bloqueio de leitura pelo jogador e rejeição de atualização com versão antiga. As latências são observações destas execuções, não garantias de desempenho.

O complemento `tests/live-release-144-persistence.cjs` bloqueia qualquer destino diferente da homologação. Validou HTTP 42501 para jogador adicionar/editar/mover flâmula/excluir e para Xerife de outra mesa; HTTP 22023 para conteúdo de nota objeto, número, null e array, preservando texto e versão anteriores; bloqueio de alteração de notas pelo jogador; isolamento entre mesas; renovação real de sessão Auth; recuperação de nome, grade, notas, versão e flâmula em clientes novos sem cache; exclusão autorizada de mapa sintético. Essa recuperação é por nova sessão/cliente, **não uma nova execução de F5 na interface Tauri**. A evidência anterior de refresh de COM-05 a COM-08 continua histórica, identificada nas seções abaixo.

As três suítes SQL existentes foram executadas em homologação com usuários sintéticos de IDs exclusivos inseridos dentro da mesma transação, substituindo apenas os IDs fixos dos scripts. Cada suíte terminou em ROLLBACK. Cobriram adicionalmente limite/grade de mapas, não membro/anon, bloqueio de exclusão com combate ativo e exclusão após encerramento, inventário legado, entrega idempotente, confirmação prematura, ficha de outra mesa, quantidade inválida, reserva/commit/reação, sigilo e compatibilidade retroativa COM-05 a COM-08. Os testes de Storage SQL avaliam metadados/policies; os bytes foram exercitados pelo `live-maps`.

### Regressões e falhas do executor resolvidas

Suítes finais aprovadas: auth-session; com03-com04-creature-mode; com05-com06-initiative-budget; com07-com08-controller-events; turn-tracker-ui; scene-read; token-initiative; mesa-6b; map-camera; gm-tools-ui; multiple-maps-ui. Comandos: `node tests/<suite>.cjs`, em cópia temporária, com Node 24.12.0 e Chrome headless. As suítes live usaram `node tests/live-maps.cjs <config-privada>` e `node tests/live-gm-tools.cjs <config-privada>`, com o endereço de homologação somente na cópia temporária. Scripts live originais não foram modificados. [Hashes dos testes](evidencias-retomada-144/test-input-sha256.json).

| Ocorrência inicial | Causa raiz e resolução | Situação final |
| --- | --- | --- |
| Cópia Node falhou com EIO/acesso negado | A cópia foi concluída com Copy-Item antes dos testes; nenhuma execução parcial foi contada como aprovação | Resolvido |
| COM-07/08: ENOENT | O teste lê `database/com05-com08-combat-state-and-actions.sql`; a primeira cópia só continha dist/tests. Incluído database | PASS após incluir a dependência |
| COM-07/08 e gm-tools-ui: EBUSY | O harness detectava existência de DevToolsActivePort e lia imediatamente enquanto o Chrome ainda mantinha o arquivo bloqueado | Corrigida apenas a espera em `tests/browser-harness.cjs`: retry limitado a 30 s para ENOENT/EBUSY e validação da porta. Ambas as suítes repetidas passaram |
| Complemento: RLS 42501 no preparo | O fixture tentava inserir outro membro diretamente; a policy permite somente a autoinscrição do Xerife | Alterado o teste para o jogador entrar pela RPC de convite, sem mudar a policy |
| Complemento: convite 22023 | O fixture gerava código em minúsculas, mas a RPC normaliza a busca para maiúsculas | Fixture passou a gerar maiúsculas; repetição integral PASS |

Nenhuma falha de código do produto foi encontrada nesta rodada. Alterações restritas ao executor de testes, ao complemento de testes e à documentação/evidências. As falhas iniciais não foram omitidas nem convertidas em PASS; os resultados finais correspondem às repetições identificadas. Não houve rebuild porque nenhum arquivo funcional do pacote foi alterado.

### Limpeza e integridade

As suítes encerraram seus canais e sessões. Antes da remoção das contas, a consulta mostrou zero mesas, sessões Auth e objetos de Storage dos fixtures. As duas contas Auth temporárias foram removidas por ID e email sintéticos exatos; os quatro usuários dos testes SQL foram revertidos por rollback. A consulta final retornou **zero** para auth.users, auth.identities, auth.sessions, usuarios, mesas, membros_mesa, fichas, mesa_tokens, mesa_token_status, itens_entregues_pendentes, mesa_mapa_sinais e storage.objects nos escopos dos fixtures. Incluídos os seis IDs de mesas das tentativas do complemento. Os dois arquivos locais de credenciais foram removidos e a ausência foi confirmada. Nenhuma credencial integra as evidências.

| Artefato preservado | SHA-256 confirmado antes/depois |
| --- | --- |
| NSIS x64 / payload do updater | `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962` |
| Assinatura | `301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155` |
| latest.json candidato | `479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d` |

Git: HEAD `8016f2a23c93b2394616ddae31f611cdc37b3a47`, árvore com alterações preexistentes. Nesta retomada, modificado `tests/browser-harness.cjs`, adicionado `tests/live-release-144-persistence.cjs` e atualizados relatório/evidências. Sem commit, push, merge, tag, criação de projeto ou alteração de produção, Notion, endpoint público ou schema. `git diff --check` do harness passou.

### Etapa independente ainda necessária

Disponibilizar VM Windows descartável com snapshot, WebView2 compatível, instalador autêntico 1.4.3 e os artefatos 1.4.4 de hashes acima. Usar redirecionamento DNS/hosts **somente no convidado** para servidor HTTPS de laboratório que responda ao hostname original embutido. Certificado com hostname correto e cadeia efetivamente aceita pelo cliente Tauri; testar essa confiança antes do ensaio. Preservar TLS e Minisign. Acesso ao backend de produção bloqueado; dados locais apenas sintéticos. Sem instalar sobre a instalação principal e sem publicar ou alterar latest.json público.

No ensaio, comprovar descoberta de 1.4.4, adiamento sem instalação, nova verificação, aceite, download e instalação pelo updater, abertura em 1.4.4 e preservação dos dados sintéticos. Instalação limpa ou manual por cima não substituem esse fluxo. Se a CA de laboratório não for aceita pelo binário autêntico, manter BLOCKED; não desabilitar verificações. Nenhum desses passos Windows foi executado nesta retomada. A missão atual encerra os testes de homologação, mas **não autoriza publicação**.

## Histórico — correções de homologação em 16/11/2026

**NO-GO PARA PUBLICAÇÃO — correções aplicadas; testes remotos, regressão completa desta rodada e upgrade Windows pendentes.** Não é possível declarar que somente o upgrade está pendente.

### Migração e conferência

Produção `jxxhdqoyblykqiiyptsp` foi consultada somente em leitura. A comparação integral confirmou a ausência de `gerenciar_mapas` e o operador incorreto nas notas da homologação `igyupxczhczidfgtjiws`.

A migração `homologacao_144_mapas_notas`, identificador **20261116214200**, foi aplicada com sucesso pelo mecanismo suportado `Supabase apply_migration`, exclusivamente na homologação. SQL: [20261116214200_homologacao_144_mapas_notas.sql](20261116214200_homologacao_144_mapas_notas.sql). A CLI não estava disponível e nenhum software foi instalado. O identificador do arquivo corresponde ao histórico retornado pelo conector.

Definições integrais preservadas em [schema-antes-correcao-homologacao.json](schema-antes-correcao-homologacao.json) e [schema-apos-correcao-homologacao.json](schema-apos-correcao-homologacao.json). A consulta posterior confirmou:

- `gerenciar_mapas(uuid,text,uuid,jsonb)` idêntica à definição vigente de produção, inclusive parâmetros opcionais, retorno JSONB, validação de Xerife, limites, operações de exclusão, SECURITY DEFINER e search_path vazio. ACL: postgres, authenticated e service_role; sem EXECUTE para PUBLIC ou anon. A execução por authenticated continua sujeita à autorização no corpo.
- `validar_notas_mestre()` preserva o corpo da homologação, com a única substituição `jsonb_typeof(node->>'conteudo')` por `jsonb_typeof(node->'conteudo')`. Mantidos SECURITY INVOKER, search_path vazio, ACL anterior, limite de 2 MB, 12 níveis, 1000 entradas, nomes de 1–120 caracteres e incremento da versão.
- Antes da aplicação, foram conferidos os campos de mesas, a dependência `is_mestre_da_mesa(uuid)` e os 12 triggers de mesas/mesa_tokens. O trigger de notas é BEFORE UPDATE OF notas_mestre. O SQL não altera triggers, tabelas, policies ou publicação Realtime, nem reaplica COM-05 a COM-08. A conferência funcional após a alteração ainda depende dos testes abaixo.

### Evidências desta rodada

| Verificação | Resultado |
| --- | --- |
| Comparação integral anterior e conferência das duas funções após migração | PASS |
| Histórico da migração na homologação | PASS — 20261116214200 |
| live-maps e live-gm-tools após correção | BLOCKED — criação dos fixtures recusada por indisponibilidade da revisão automática; as suítes não chegaram a executar |
| Positivos/negativos, persistência/refresh, exclusão sintética, combate ativo e isolamento | BLOCKED nesta rodada; não inferir aprovação somente pela paridade SQL |
| Compatibilidade funcional COM-05 a COM-08 após correção | BLOCKED para nova confirmação; migração não modifica suas funções e permanecem as evidências anteriores |
| Regressão local auth-session | PASS — sessão forjada, sessão ausente, usuário verificado, logout, revogação, anônimo e identidade divergente |
| Demais dez suítes locais | BLOCKED/sem resultado novo. A tentativa inicial apresentou erro ao mudar para o caminho temporário abreviado e ficou sem conclusão em com03/com04; foi interrompida. O PASS 11/11 anterior permanece histórico, não uma nova execução completa |
| Upgrade automático autêntico Windows 1.4.3 → 1.4.4 | BLOCKED — ambiente Windows descartável apropriado não disponível |
| SHA-256 do instalador, assinatura e manifesto | PASS — recalculados e iguais aos artefatos anteriormente verificados criptograficamente |

A revisão automática retornou: limite de uso atingido; revisão não pôde ser concluída; ação não executada. Isso impediu o SQL de criação de contas/mesas sintéticas e a solicitação de execução remota. Não foi uma conclusão de insegurança. Não houve repetição ou contorno por outro mecanismo. As contas e mesas propostas não foram criadas. A credencial temporária local foi removida ao finalizar. Não há senha no repositório ou nos relatórios.

Os advisors anteriores à alteração registraram quatro funções preexistentes acessíveis a anon, 17 SECURITY DEFINER acessíveis a authenticated e proteção contra senhas vazadas desabilitada; health sem alertas. Performance: oito FKs sem índice, 14 avaliações Auth/RLS por linha, um índice sem uso e uma policy permissiva sobreposta. Nenhum desses objetos foi ampliado nesta missão. A atualização dos advisors após migração ficou pendente. Referências: [acesso anon a SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) e [avaliação Auth/RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).

### Updater e integridade

O frontend chama check sem endpoint alternativo; Rust registra o plugin padrão, sem comando/configuração de sobrescrita. A inspeção anterior do 1.4.3 autêntico já registrava o endpoint público embutido. WindowsSandbox.exe continua ausente; VBoxManage, vmrun e qemu-system-x86_64 não foram encontrados no PATH. O acesso negado anterior ao Hyper-V não foi repetido. Não há máquina secundária ou VM externa autorizada identificada nesta sessão.

Método proposto: VM Windows descartável disponibilizada pelo usuário, snapshot inicial, instalador 1.4.3 autêntico e rede restrita ao convidado. Um servidor HTTPS de laboratório deve responder ao hostname original do manifesto por DNS/hosts apenas da VM, com certificado cujo hostname e cadeia sejam válidos e confiáveis pelo cliente real. A confiança da CA no cliente Tauri precisa ser demonstrada; se não funcionar, interromper, sem desabilitar validação. Servir o manifesto candidato e o instalador assinado somente nessa rede, bloquear acesso ao backend de produção, usar dados locais sintéticos, testar adiamento e depois aceite, download, validação Minisign, instalação automática, reabertura em 1.4.4 e preservação dos dados. Reverter o snapshot ao terminar. Não configurar esse redirecionamento na máquina principal nem alterar o manifesto público. Nenhuma infraestrutura foi criada ou contratada.

Instalação limpa e instalação manual por cima de 1.4.3 são verificações distintas e não substituem o updater automático. Nenhuma das três foi executada nesta rodada. A documentação permite configuração de endpoint em runtime quando implementada no aplicativo; isso não comprova uma opção disponível no binário autêntico: [updater Tauri](https://v2.tauri.app/plugin/updater/).

Não houve mudança de código de produto ou rebuild. Os três hashes abaixo foram recalculados nesta finalização e coincidem com os da validação criptográfica anterior. A comprovação anterior de Minisign, chave pública, manifesto, produção embutida e ausência dos padrões de segredo/homologação continua vinculada a esses mesmos bytes. O código de confirmação e adiamento foi relido e permanece inalterado; o comportamento real no upgrade continua BLOCKED.

| Artefato 1.4.4 | SHA-256 |
| --- | --- |
| NSIS x64 / payload do updater | `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962` |
| Assinatura | `301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155` |
| latest.json candidato | `479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d` |

Git permanece com alterações preexistentes e arquivos não rastreados, sem commit, push, merge ou tag nesta missão. Adicionados o SQL da migração e os snapshots das definições; atualizado este relatório. Produção, Notion, rolagens secretas e COM-09 não foram alterados. Nenhum artefato foi publicado. Para novo parecer, concluir os testes bloqueados após restabelecer a revisão de aprovação e disponibilizar o ambiente Windows isolado.

## Histórico — parecer anterior às correções de homologação

**NO-GO — três bloqueios na validação final.** HEAD `8016f2a23c93b2394616ddae31f611cdc37b3a47`, com a árvore de trabalho já modificada. Metadados npm e Rust/Tauri em 1.4.4. Nenhuma alteração funcional ou rebuild nesta rodada.

| Verificação | Resultado |
| --- | --- |
| live-maps | BLOCKED. Com Auth real, o PostgREST de homologação não encontrou `gerenciar_mapas`. Consulta de catálogo confirmou ausência em `igyupxczhczidfgtjiws` e presença em produção. O teste não chegou à criação dos mapas, Storage ou flâmula. |
| live-gm-tools | FAIL. Na repetição, passaram sete verificações de entrega por HTTP/Realtime, confirmação, integridade, REM e sigilo de status. A etapa de notas falhou com `function jsonb_typeof(text) does not exist`. `validar_notas_mestre` de homologação chama `jsonb_typeof(node->>'conteudo')`; o operador devolve text. Em produção, a definição usa `node->'conteudo'` e mantém JSONB. O timeout WebSocket da primeira tentativa não se repetiu. |
| Upgrade 1.4.3 → 1.4.4 | BLOCKED. Instaladores autênticos verificados, mas Windows Sandbox não estava disponível e o Hyper-V recusou acesso ao inventário. Os executáveis extraídos têm versões corretas e endpoint GitHub embutido. O 1.4.3 não expõe configuração para trocar esse endpoint. Nenhum instalador foi executado na máquina principal. |

As suítes foram executadas com credenciais e mesas sintéticas em cópias temporárias que apontavam apenas à homologação. A limpeza deixou zero mesas, fichas, contas Auth e objetos de Storage dos fixtures. Nenhuma migração ou correção de esquema foi executada. O cotejo aponta divergências de homologação, sem evidência de regressão correspondente na 1.4.4. Produção foi consultada somente em leitura.

### Pacote verificado

Os instaladores NSIS x64 1.4.3 e 1.4.4 passaram na validação criptográfica Minisign com a chave pública configurada. O `latest.json` público ainda responde com 1.4.3 e forneceu a assinatura do instalador anterior. O manifesto candidato declara 1.4.4, inclui a assinatura correspondente e referencia o nome correto do instalador. A extração da 1.4.4 e a inspeção dos assets comprovadamente embutidos confirmaram a URL de produção, sem referência ao projeto de homologação nem padrões detectados de chaves privadas ou `sb_secret_`.

| Artefato | SHA-256 |
| --- | --- |
| Instalador público 1.4.3 | `8ee0ea275c372dc128c07a3cc9be2f4547a9603a797970dded015a60e02a5f75` |
| Instalador candidato 1.4.4 | `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962` |
| Assinatura candidata | `301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155` |
| Manifesto candidato | `479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d` |

Para liberar: alinhar os dois objetos de homologação em operação separada autorizada e repetir as suítes. Para o upgrade, usar VM descartável com o 1.4.3 autêntico e preparar encaminhamento HTTPS restrito ao convidado, que preserve o endpoint do binário e valide TLS e Minisign, caso o cliente aceite a CA de laboratório nessa VM. Testar descoberta, aceite, instalação, inicialização e dados sintéticos persistidos. Se o cliente autêntico não puder usar esse ambiente, um build de teste com endpoint explícito valida o pipeline, mas deixa pendente o requisito do binário autêntico. Somente após as aprovações, registrar a revisão exata e preparar rascunho v1.4.4 com o instalador, .sig e latest.json verificados. A publicação exige autorização específica.

## Evidências da preparação anterior

16/11/2026 · HEAD `8016f2a23c93b2394616ddae31f611cdc37b3a47` com alterações não commitadas preexistentes. Antes do bump, os 220 itens do manifesto conferiram. O cliente COM-05 a COM-08 preserva os mesmos arquivos funcionais revalidados. Nesta rodada os cinco metadados ajustados foram package.json, package-lock.json, Cargo.toml, Cargo.lock e tauri.conf.json. O lock npm registrava a versão raiz 1.0.0 e foi sincronizado sem mudar dependências.

## Validação

| Verificação | Resultado |
| --- | --- |
| 11 suítes locais documentadas | PASS em cópia temporária com Chrome headless |
| SQL/RLS em PostgreSQL 17.12 de homologação | PASS 12/12 com rollback |
| Auth real, corrida HTTP 1 OK/1 P0409, Realtime autenticado e F5 | PASS na revalidação anterior dos mesmos arquivos do cliente, evidência no relatório 04 |
| Suítes auxiliares live-maps e live-gm-tools | NOT RUN. Os executáveis leem o endereço de produção a partir do checkout e alteram ou excluem a mesa indicada. Para rodá-los, usar cópia temporária apontada para homologação, com fixtures descartáveis distintos e limpeza verificada |
| Produção, leitura via MCP | PASS. Oito assinaturas, ACLs, modos de segurança e corpos normalizados conferiram com homologação. Zero EXECUTE para anon, seis mesas, zero combates ativos, 15 triggers e oito tabelas Realtime. Fumaça sem autenticação da implantação permanece registrada no relatório 04 |
| Sessão funcional do cliente em produção | NOT RUN. Produção reservada a leitura; nenhuma partida ou fixture foi criada |

A aplicação normal usa dist/js/turnTracker.js e dist/js/mesaScreen.js para o tracker, RPCs e Realtime, initiativeRules.js para iniciativa e orçamento, cylinder.js para 6B e authSession.js para sessão. O Action Controller bloqueia mutações sem RPC, e a reconciliação usa o snapshot do servidor.

## Rolagens secretas — ADIAR, complexidade alta

O motor em dist/js/rules/diceRules.js e as rotas em cylinder.js, dice.js e mesaScreen.js geram o resultado localmente. O feed grava texto e visibilidade enviados pelo cliente em eventos_mesa. O histórico consulta a tabela e recebe INSERT por Postgres Changes. A policy de leitura permite eventos públicos a membros, registros próprios ao autor e registros da mesa ao Xerife. O frontend só mantém a opção mestre quando o cliente se identifica como Xerife. A policy de INSERT confirma autoria e vínculo com a mesa e não comprova a integridade da rolagem nem valida uma modalidade mestre-exclusiva. Um cliente alterado pode escolher o conteúdo enviado. Refresh, reconexão e consultas diretas precisam ser protegidos por autorização de servidor.

Proposta para uma atualização separada:

- RPC autenticada que valida mesa, papel, modalidade e parâmetros, gera os dados no servidor e registra resultado imutável com idempotência. Acesso direto de escrita revogado para clientes.
- Histórico estruturado com RLS explícita. Privada do jogador visível ao autor e ao Xerife; exclusiva visível apenas ao Xerife autorizado, inclusive quando o vínculo de um participante muda. O feed público não carrega payload secreto; clientes buscam histórico pelo mesmo contrato autorizado usado no refresh.
- Realtime sinaliza a mudança sem incluir resultados secretos. Usar assinaturas autorizadas e reconsulta com RLS, cobrindo canais, snapshots, listas, cache por sessão, notificações e logs. Evitar vazamentos por eventos de exclusão, mensagens derivadas e visibilidade residual após trocar de conta.
- Mudanças esperadas em migração/RPC/RLS e publicação, no motor de integração de dados e no feed e histórico de mesa. Testar autor, outro jogador, Xerife, não membro e anon em REST/RPC, WebSocket, refresh, reconexão e troca de papel; testar envio adulterado e replay.

## Distribuição

**Build local PASS. Publicação NO-GO nesta rodada.** Tauri compilou o executável Rust e gerou NSIS x64 e .sig. O instalador tem 5.538.069 bytes e SHA-256 `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962`. A verificação criptográfica local conferiu payload e comentário autenticado da assinatura Minisign com a chave pública configurada, igual à de 1.4.3. Rust avisou que STATIC_VCRUNTIME está obsoleto. A suíte de instalação/upgrade real 1.4.3 → 1.4.4 e os dois auxiliares live continuam sem execução. A evidência disponível sustenta compatibilidade do manifesto e da assinatura, com a instalação real ainda pendente.

Artefatos locais em `src-tauri/target/release/bundle/release-upload-1.4.4`. A pasta contém `Dark.West.Character.Sheet_1.4.4_x64-setup.exe`, `.sig` correspondente e `latest.json` candidato com o nome e a URL exatos do asset do futuro release. [Notas de lançamento](notas-release-1.4.4.md)

O cliente consulta latest.json do último release GitHub. O manifesto público respondia com 1.4.3 e a tag remota mais recente observada era v1.4.3. O updater detecta versão superior, pede confirmação e permite adiar. Tauri verifica a assinatura Minisign usando a chave pública embutida.

Após aprovação específica, usar o commit aprovado como alvo de v1.4.4. O fluxo .github/workflows/release.yml publica automaticamente se receber uma tag v* ou for acionado manualmente. Prefira preparar o release em rascunho com o NSIS assinado, seu .sig e latest.json para windows-x86_64, conferir URL e assinatura antes de torná-lo público e então testar a resposta do endpoint. O caminho padrão do instalador local é src-tauri/target/release/bundle/nsis. Usar a chave privada existente e a senha quando aplicável por variáveis protegidas do ambiente. A autorização de publicação GitHub é separada. O fallback de scripts/build-release.ps1 pode passar segredos pela linha de comando, e o script publica por padrão. O build desta rodada chamou somente a CLI do Tauri.

Antes de publicar, testar o salto 1.4.3 → 1.4.4 em Windows descartável com manifesto de teste e verificar instalação, abertura, adiamento e retomada. Após aprovação, registrar a revisão exata, preparar o rascunho com os três artefatos verificados, conferir a versão e URLs, publicar e validar o endpoint público. Para diagnosticar falhas, conferir versão detectada, consentimento, HTTP da URL do artefato, assinatura e mensagens [Updater]. Se necessário, distribuir manualmente um instalador íntegro e compatível. A recuperação pelo canal automático pode exigir um novo patch assinado com versão superior, pois reduzir a versão do manifesto não reverte instalações existentes.

[Documentação do updater Tauri](https://v2.tauri.app/plugin/updater/)
