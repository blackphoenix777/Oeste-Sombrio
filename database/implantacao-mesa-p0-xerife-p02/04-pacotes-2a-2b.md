# Pacotes 2A e 2B — preparação e gate

Data: 17/11/2026. Atualização final: backup Storage concluído e histórico de Homologação reparado sob autorização explícita. Produção sem alterações.

## Resultados

| Área | Resultado |
|---|---|
| Pacote 2A | PARCIAL |
| Storage | PROTEGIDO — quatro objetos verificados |
| Dry-run Produção | NÃO EXECUTADO |
| Pacote 2B | REPARAÇÃO CONCLUÍDA |
| Produção | COM PENDÊNCIAS |

## Retomada final após autenticação interativa

Esta seção substitui os estados anteriores preservados abaixo como histórico. `projects list` retornou exit 0; lista e credenciais não foram impressas. Nenhum arquivo privado de tokens foi procurado ou lido.

### Backup Storage — PASS

Destino exclusivamente local previamente autorizado: `C:\Users\Stéfano\AppData\Local\OesteSombrioBackups\storage-20261117-231655`.

CLI 3.2.0, `storage cp --experimental --remote=jxxhdqoyblykqiiyptsp --recursive`. O destino Windows absoluto retornou StorageUnsupportedOperationError; usando diretório corrente privado e destinos relativos `./character-portraits` e `./mesa-maps`, os dois downloads concluíram com exit 0. `--workdir` indicou o repositório apenas para configuração da CLI. Não houve upload, alteração de bucket, política, objeto ou URL pública.

Resultado: 4 arquivos, 2539448 bytes. Caminhos relativos de bucket/objeto correspondem ao inventário remoto; tamanhos individuais conferidos com metadata.size. SHA-256 de cada arquivo calculado e confirmado por segunda leitura completa. Essa verificação comprova leitura local consistente e tamanho remoto, sem alegar comparação com SHA-256 remoto inexistente no inventário.

Manifesto privado: `manifest.json` dentro do destino acima, contendo identificadores, bucket/caminho, tamanho, SHA-256, metadata e datas remotas. SHA-256 do manifesto: **E1F0B47DED3761663FA5246B40DD2169CBA2DEC88DA7A4254615D001FA00D1AB**. Nenhum caminho de objeto privado ou conteúdo foi incluído neste relatório.

ACL NTFS: raiz com herança desabilitada, única concessão ao SID do usuário Windows, FullControl propagável. Verificados arquivos e manifesto com apenas uma concessão; SID de cada arquivo conferido contra o usuário atual. Nenhum backup anterior excluído.

### Reparação Homologação — PASS

Alvo explícito igyupxczhczidfgtjiws; versão única 20261117151310. A chamada inicial, já autenticada, retornou HostedMutationConsentRequiredError porque o modo agente não permite confirmação interativa. Reexecutado o mesmo reparo com `--yes`, amparado pela autorização explícita existente:

```powershell
& $sb migration repair --remote=igyupxczhczidfgtjiws --status applied 20261117151310 --yes
```

Exit 0; resposta confirmou versions=[20261117151310], status=applied, repairAll=false e o projeto correto. A CLI informou Initialising login role no bootstrap; não foi executado DDL de aplicação nem o conteúdo SQL da migração.

SELECT posterior confirmou exatamente:

| Versão | Nome | Ocorrências |
|---|---|---|
| 20261116214200 | homologacao_144_mapas_notas | 1 |
| 20261117151310 | xerife_6b_foundation | 1 |

Comparação dos metadados antes/depois: funções (corpos, SECURITY DEFINER/INVOKER, search_path e ACL), tabelas (RLS/ACL), policies e publicação do pacote **idênticas**. Nenhuma das 16 versões de Produção foi registrada em Homologação.

### Estado final

Pacote 2A PARCIAL apenas pela pendência do dry-run oficial; Storage PROTEGIDO; Pacote 2B REPARAÇÃO CONCLUÍDA; Produção COM PENDÊNCIAS. Dry-run continua NÃO EXECUTADO conforme restrições. Nenhum db push, aplicação de migração, commit, push ou publicação. Os 17 SQLs não foram alterados. Branch main, HEAD 0c996fab7e0c6003a564b09c1a26f80a0115aa04. Atualizado apenas este relatório no repositório; backup e manifesto fora do Git. Execução encerrada.

## Histórico: atualização após autorização explícita no chat

O responsável autorizou expressamente o backup dos quatro objetos e somente a reparação 20261117151310 em igyupxczhczidfgtjiws. Essa autorização substitui as pendências de consentimento descritas no registro inicial abaixo. Nenhuma nova aprovação dessas duas operações é necessária; o impedimento atual é autenticação.

**Storage:** criado diretório privado `C:\Users\Stéfano\AppData\Local\OesteSombrioBackups\storage-20261117-231655`, fora do Git. ACL conferida: AreAccessRulesProtected=True; única entrada explícita DESKTOP-4EFQ4QH\Stéfano, FullControl, IsInherited=False, propagável aos filhos. Nenhum backup anterior foi excluído. Primeira chamada storage cp retornou ExperimentalRequiredError (exit 1). Com --experimental, a CLI confirmou alvo jxxhdqoyblykqiiyptsp e retornou AccessTokenRequiredError (exit 1). Interrompido conforme instrução do responsável. Zero arquivos baixados; nenhum manifesto de objetos ou hash de download foi produzido. O bucket mesa-maps não foi tentado após a falha de autenticação.

**Homologação:** pré-consulta confirmou somente 20261116214200. Executado exatamente o comando autorizado, sem --yes ou outras reparações:

```powershell
& $sb migration repair --remote=igyupxczhczidfgtjiws --status applied 20261117151310
```

CLI confirmou Target: project igyupxczhczidfgtjiws; falhou com AccessTokenRequiredError e exit 1. Não houve reparação. Consulta posterior por MCP confirmou 20261116214200 preservada com ocorrencias=1; 20261117151310 continua ausente. Não foram registradas outras versões. Nenhum SQL de aplicação foi reaplicado.

**Bloqueio comum:** autenticação MCP está disponível para as consultas, mas não fornece automaticamente autenticação à CLI. A CLI solicita supabase login ou SUPABASE_ACCESS_TOKEN. Não foi iniciado login, criado token ou usado outro canal de escrita; essas ações não constam das duas operações autorizadas. Não enviar credenciais no chat nem salvá-las no repositório. Próximo passo requer disponibilizar autenticação segura à CLI e então retomar as mesmas operações autorizadas.

Estado final: Storage PENDENTE; reparação BLOQUEADA por autenticação; Produção COM PENDÊNCIAS. Dry-run permanece NÃO EXECUTADO. Apenas este relatório foi atualizado no Git; diretório privado vazio criado fora dele. Nenhum commit, push, publicação ou alteração remota executada.

## Registro inicial — anterior à autorização

Os trechos seguintes documentam a preparação anterior; os estados de autorização e bloqueio atuais são os da atualização acima.

## Integridade local

Branch main, HEAD 0c996fab7e0c6003a564b09c1a26f80a0115aa04. Os 17 arquivos SQL foram conferidos contra 03-reconciliacao-evidencias.json: todos os hashes coincidem. As 16 versões históricas e a P0-2 permanecem intactas; nenhuma mudança nos SQLs.

SHA-256 P0-2: BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09.
Alterações não rastreadas anteriores foram preservadas. Nenhum commit, push, build ou teste funcional repetido.

## Storage de Produção

SELECT agregado atual: character-portraits = 1 objeto / 50016 bytes; mesa-maps = 3 objetos / 2489432 bytes; total 4 / 2539448 bytes. Não foram consultados conteúdos privados para o relatório.

A ajuda da CLI 3.2.0 confirmou storage cp --recursive --remote=<ref> com origem ss:///bucket/ e destino local. O plano previa diretório novo em LOCALAPPDATA/OesteSombrioBackups, fora do Git, herança NTFS removida e FullControl apenas para o SID do usuário, com herança para arquivos/subdiretórios. Depois seriam preservados metadados e calculados hashes dos downloads.

O comando de preparação/download foi rejeitado antes da execução pela revisão automática. Motivo: cópia persistente de dados privados de Produção sem autorização considerada confiável pelo revisor. Segunda submissão citou expressamente a autorização da seção A2 do anexo; rejeição mantida. Não houve contorno ou download alternativo.

Consequência: nenhum backup Storage, manifesto de arquivos ou validação NTFS foi produzido. Não classificar Storage como protegido. Autenticação administrativa para download também não chegou a ser exercitada; nenhuma variável SUPABASE/SERVICE_ROLE foi encontrada no ambiente consultado, e o arquivo legado de access-token não existia. Isso não prova ausência de autenticação em outros provedores. MCP disponível oferece consulta SQL e chaves publicáveis, não download administrativo de Storage.

Solicitar confirmação explícita no chat para copiar os quatro objetos para backup privado local. Após desbloqueio, usar autenticação oficial disponível, preservar caminhos/metadados em manifesto privado, verificar contagem/tamanhos/SHA-256 e ACLs; sem URLs públicas, credenciais em logs ou mudanças de RLS.

## Dry-run de Produção

CLI existente 3.2.0; ajuda de db push e migration repair consultada novamente, sem reinstalação. --remote=<ref> define alvo; --dry-run não aplica migrações; --skip-vault evita atualização de Vault. Ajuda lista possíveis permissões database_write e network_bans_write no fluxo de conexão. Essas permissões não provam que haverá escrita, mas não garantem ausência de efeitos persistentes de bootstrap.

Consultadas [referência oficial](https://supabase.com/docs/reference/cli/supabase-db-push) e [mudanças CLI v3](https://supabase.com/changelog/supabase-cli-v3). Não foi obtida garantia suficiente de que todo o fluxo de conexão remoto seria exclusivamente de leitura. Por determinação A3, dry-run NÃO EXECUTADO.

Reutilizada comparação determinística do Pacote 1, com hashes locais novamente validados: única versão futura pendente em Produção = 20261117151310_xerife_6b_foundation.sql. Isso não equivale a dry-run oficial nem autoriza deploy. Comando candidato, NÃO executado:

```powershell
& $sb db push --remote=jxxhdqoyblykqiiyptsp --dry-run --skip-vault
```

## Homologação — pré-condições verificadas

Projeto explicitamente consultado: igyupxczhczidfgtjiws. Histórico atual contém somente 20261116214200; 20261117151310 ausente.

12 funções presentes, com corpos correspondentes ao SQL local (normalização CRLF/LF apenas para comparação). Conferidos metadados de segurança e privilégios, sem divergência relevante do Pacote 1. Tabelas presencas/conjuntos privadas com RLS e ACL somente postgres; mesa_6b_aberto com RLS e SELECT authenticated. Única policy do pacote: mesa_6b_aberto_leitura, SELECT para authenticated, Mestre ou membro. Apenas public.mesa_6b_aberto publicada no Realtime; tabelas privadas ausentes. Nenhuma função foi invocada para testes.

## Reparação proposta — gate B3

Autorização específica PENDENTE. Não executado migration repair. Comando exato confirmado no --help:

```powershell
$sb = 'C:\Users\Stéfano\AppData\Local\npm-cache\_npx\a0b0486f7f118473\node_modules\@supabase\cli-windows-x64\bin\supabase.exe'
& $sb migration repair --remote=igyupxczhczidfgtjiws --status applied 20261117151310
```

Efeito esperado: registrar exclusivamente 20261117151310 como aplicada, sem executar o SQL da migração. Preservar 20261116214200; não registrar as 16 versões de Produção nem fazer db push na Homologação. Se a CLI pedir consentimento adicional, confirmar somente dentro desse escopo autorizado. Qualquer erro deve interromper a operação.

Consulta posterior planejada:

```sql
SELECT version, name, count(*) OVER (PARTITION BY version) AS ocorrencias
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

Esperado: exatamente duas linhas, 20261116214200 e 20261117151310, cada uma com ocorrencias=1. Repetir a leitura dos metadados P0-2 e comparar com a pré-verificação acima, sem invocar mutações, verificando tabelas/funções/policies/publicação intactas. Nenhuma alteração em Produção.

## Pendências e encerramento

1. Desbloquear e realizar backup privado do Storage com manifesto e integridade.
2. Aprovação explícita da reparação administrativa da Homologação conforme B3 do pedido.
3. Garantia de fluxo somente leitura para dry-run de Produção; manter não executado até então.
4. Aprovação separada para qualquer migração de Produção, fora deste pacote.

Backup PostgreSQL e restauração anteriores foram reutilizados como evidência, sem repetição. Criado somente este relatório neste pacote; alterações locais anteriores preservadas. Nenhum segredo ou conteúdo dos objetos foi salvo no repositório. Nenhum commit, push, release ou publicação. Execução interrompida no gate para revisão do responsável.
