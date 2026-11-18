# Pacote 1 — Reconciliação do histórico
Data: 17/11/2026. Nenhuma alteração remota executada.

## Resultado
- Histórico local: **COMPLETO** — 16 históricos e P0-2; 17 versões únicas ordenadas.
- Integridade: **VALIDADA** — cada histórico corresponde byte a byte ao statements[1] UTF-8, sem BOM ou nova linha adicionada. P0-2 preservada.
- Homologação: **PRONTA PARA REPARAÇÃO da versão P0-2**, mediante autorização; não está alinhada para db push geral.
- Produção: **BLOQUEADA** para aprovação final do deploy: dry-run oficial não executado com garantia de ausência de escritas de conexão.

## Ferramentas e método
Git, Supabase MCP execute_sql (apenas SELECT), Node fs/crypto e Supabase CLI **3.2.0** já existente em:
C:/Users/Stéfano/AppData/Local/npm-cache/_npx/a0b0486f7f118473/node_modules/@supabase/cli-windows-x64/bin/supabase.exe

CLI fora do PATH. npx offline falhou ENOTCACHED; binário localizado no cache. Primeira execução bloqueada pelo sandbox ao escrever telemetria local; ajuda/versão executadas com permissão ampliada, sem operação remota.
Ajuda de migration fetch confirma recuperação da tabela de histórico e alvo local por padrão. --remote=<ref> seleciona projeto explicitamente. A ajuda lista database_write e possíveis permissões de network bans no fluxo remoto. Não se presumiu segurança do bootstrap de conexão e não se executou fetch. Portanto não há alegação de equivalência byte a byte do resultado do fetch.

Alternativa executada: SELECT version,name,cardinality(statements),statements FROM supabase_migrations.schema_migrations ORDER BY version em Produção. Todos os 16 registros possuem exatamente um statement. Segunda consulta independente calculou octet_length e encode(sha256(convert_to(statements[1],'UTF8')),'hex'). Escrita local exclusiva (flag wx) do texto recuperado, sem executar SQL nem copiar scripts divergentes de database/. Cada arquivo foi relido e seu SHA-256 comparado ao calculado no servidor.

A primeira tentativa de transportar todos os SQLs num único comando local foi rejeitada pela revisão automática por exceder 64000 bytes. Divisão por migração resolveu; nenhum conteúdo foi truncado ou fabricado.

Referências oficiais consultadas: [changelog](https://supabase.com/changelog.md), incluindo [mudança CLI v3](https://supabase.com/changelog/supabase-cli-v3). A sintaxe efetivamente usada neste relatório foi confirmada no --help da versão instalada.

## Integridade
P0-2 antes/depois: BEF172A634F736752F29F0F88483BE3362FC8BBED11CB48595C1E3E06161EA09, 17777 bytes.
Origem dos históricos: Produção jxxhdqoyblykqiiyptsp / supabase_migrations.schema_migrations.statements[1].
Não se afirma que este histórico substitui um baseline completo para provisionar banco vazio.

| Versão | Nome | Origem | SHA-256 | Resultado |
|---|---|---|---|---|
| 20261106000343 | create_character_portraits_bucket_and_policies | Produção statements[1] | 8c6129d42c9ec88bbdbffc2c9f9faa24105e2d1c62fec01d33d0dbb85e94ba86 | PASS |
| 20261108013940 | create_mesa_maps_bucket_and_mesas_columns | Produção statements[1] | 5143c247912b4313985d6227a97c27abdcb5ed294190eebbbad26c7b26bb8441 | PASS |
| 20261108022143 | create_mesa_tokens_table_and_policies | Produção statements[1] | cb1fb28901af395089dd32022de6376f474ba8e1c88d1ab01c28e5d142e26eae | PASS |
| 20261108025202 | add_mesa_tables_to_supabase_realtime | Produção statements[1] | c1d4bc5ea892a861db6ade8f8205a3425dc84f1fe5f8b7adb9c04f52ae371f83 | PASS |
| 20261109160047 | require_auth_for_event_reads | Produção statements[1] | 848c185ac0431ce270a604ff546846e63773a3809353db33b8bec87501dfcf47 | PASS |
| 20261109171323 | restrict_membership_events_and_sheet_reads | Produção statements[1] | a524707311ade5ad4df93e09ae16cd18716b2c29a3e485c3367c3eb1f56312c2 | PASS |
| 20261109223117 | public_scene_visibility_and_event_membership | Produção statements[1] | 41d1a0b4386cee8d99d1c5d8c4fece1299e185314d25869ecfb1f5bc72ca6036 | PASS |
| 20261110010238 | token_instance_initiative | Produção statements[1] | 07938c6873b009ca769db2781e9cc3185cfd04d13bdbf9aa666b70a6580e5c78 | PASS |
| 20261110105257 | shared_turn_tracker | Produção statements[1] | bbfefc510633108d3c165623fa0a52ca5276ccbbec3af431191dd9c59a90d35d | PASS |
| 20261110110417 | turn_tracker_late_fixed_order | Produção statements[1] | 778615066cbd161672b8abb848fb09caa640a933a175c467784547b38d38386c | PASS |
| 20261110184126 | multiple_maps_private_storage | Produção statements[1] | 836b000ce5ca5d8b8b498b72dfdd176556f0d95ee512f38038a6aab9bdd3d4a0 | PASS |
| 20261111103530 | multiple_maps_combat_guard | Produção statements[1] | 64749474a9d8c7139246172e45a8bf6b929b912428773085d7ae44fa49279166 | PASS |
| 20261111151557 | gm_tools_inbox_notes_token_status | Produção statements[1] | 35b7820bd11e02983cd857aeb8e184e05db1de9244fa3e04904dcdc9d9e76297 | PASS |
| 20261111163758 | gm_tools_status_metadata_sync | Produção statements[1] | 49a34ee6668335d210cca1dcb6b176a1976287874d500582c1dc90e71d9fe2c1 | PASS |
| 20261111164149 | gm_tools_preserve_legacy_inventory | Produção statements[1] | 9ac3f95f358eeeaf576f9b1d5dbef23fc5034be3a4b3922bbca1bcfdd0d16e2d | PASS |
| 20261116210603 | com05_com08_combat_state_and_actions | Produção statements[1] | 3aae98fc5dfe7ca466f55281d5fb7958ff3beec6b21a1cb688c389fc730280ce | PASS |
| 20261117151310 | xerife_6b_foundation | Git/P0-2 preservada | bef172a634f736752f29f0f88483be3362fc8bbed11cb48595c1e3e06161ea09 | PASS |

## Homologação
SELECT atual confirma somente 20261116214200 (homologacao_144_mapas_notas) no histórico; P0-2 ausente.
As 12 funções existentes tiveram prosrc comparado ao SQL local (normalizando apenas CRLF/LF para essa comparação): 12 correspondências. Sete funções privadas SECURITY DEFINER e cinco wrappers SECURITY INVOKER, todos search_path vazio; ACLs mantêm helpers restritos e operações autenticadas. Metadados de tabelas, RLS/policy e publicação foram consultados; somente mesa_6b_aberto participa de Realtime entre os objetos do pacote. Reutilizada a paridade estrutural detalhada dos relatórios 01 e 02; não repetidos restore, testes funcionais ou live.
O comentário inicial da candidata ainda diz não aplicada remotamente; é histórico e não foi editado. A situação atual é aplicação manual em Homologação, ausente em Produção.
A versão exclusiva 20261116214200 permanece fora da pasta de deploy de Produção.
Repair registrará apenas a versão indicada no histórico, sem reaplicar os CREATE. Não autoriza marcar as 16 versões históricas como aplicadas em Homologação: isso exige análise própria da origem do schema.

## Simulação de Produção
Comparação determinística local versus SELECT remoto: 16 versões alinhadas e apenas **20261117151310_xerife_6b_foundation.sql** pendente. Nenhuma migração histórica no plano por diferença de conjuntos.
**Dry-run oficial: BLOCKED / não executado.** --dry-run promete não aplicar migrações, mas a ajuda também informa atualização de Vault e possíveis operações no fluxo de autenticação remota. --skip-vault é necessário; não foi demonstrado que o restante do fluxo seja somente leitura. Comparação de versões não substitui execução do dry-run.

## Próximo pacote — comandos propostos, NÃO executados
Pré-condições: autorização explícita para repair e deploy, credencial via mecanismo seguro sem argumentos/logs, revisão do fluxo de conexão CLI, conferir backup já validado e hashes atuais. Não repetir restauração já aprovada.
PowerShell (usar a CLI 3.2.0 existente):
~~~powershell
$sb = 'C:\Users\Stéfano\AppData\Local\npm-cache\_npx\a0b0486f7f118473\node_modules\@supabase\cli-windows-x64\bin\supabase.exe'
& $sb migration repair --remote=igyupxczhczidfgtjiws --status applied 20261117151310
# Conferir por SELECT o registro e os objetos; não reaplicar o DDL.
& $sb db push --remote=jxxhdqoyblykqiiyptsp --dry-run --skip-vault
# Somente após plano oficial conter exclusivamente P0-2 e aprovação:
& $sb db push --remote=jxxhdqoyblykqiiyptsp --skip-vault
~~~
Não usar --include-all, --include-seed ou --include-roles. Não executar db push contra Homologação com este histórico de Produção.
Backup reutilizado: oeste-jxxhdqoyblykqiiyptsp-20261117-224938.dump, 621973 bytes, SHA-256 5BEB570B6F18C0BB4B4A5F6C989E45177DF4022FEE4593EC434859A749A4A9D7; evidência anterior, não revalidado neste pacote.

## Git e encerramento
Branch main; HEAD 0c996fab7e0c6003a564b09c1a26f80a0115aa04. Criados os 16 SQLs da tabela e este relatório. Evidência JSON de hashes/comparação acompanha o relatório. Sem mudanças funcionais, commit, push, publicação ou alterações remotas. Documentos históricos e supabase/.temp previamente não rastreados foram preservados. Execução encerrada para revisão.
