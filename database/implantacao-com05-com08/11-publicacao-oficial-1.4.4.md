# Publicação oficial v1.4.4

17/11/2026 — **PUBLICADO** com autorização expressa do proprietário e aceitação do risco de upgrade Windows não ensaiado.

## Resultado público confirmado

- Release estável: https://github.com/blackphoenix777/Oeste-Sombrio/releases/tag/v1.4.4 — ID `448063212`, draft=false, prerelease=false.
- Commit do produto/release: `71ab25720eb4688c8d7d23d109f215034825e7d5`; tag anotada `v1.4.4`.
- Verificação pública em 17/11/2026, 06:39 BRT: três assets HTTP 200 por HTTPS, bytes e hashes iguais aos aprovados, payload e comentário autenticado Minisign PASS, chave pública compatível.
- Endpoint https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json retornou 1.4.4, windows-x86_64, URL e assinatura corretas. A nova versão está anunciada aos clientes que consultam esse endpoint; não houve instalação ou descoberta na interface do 1.4.3 autêntico nesta máquina.
- 1.4.3 continua público; instalador baixado com HTTP 200 e SHA-256 `8ee0ea275c372dc128c07a3cc9be2f4547a9603a797970dded015a60e02a5f75`.
- [Evidência estruturada](evidencia-publicacao-1.4.4.json).

### GitHub Actions e recuperação da publicação

As execuções [44009232574](https://github.com/blackphoenix777/Oeste-Sombrio/actions/runs/44009232574) e [44009522277](https://github.com/blackphoenix777/Oeste-Sombrio/actions/runs/44009522277) terminaram em failure sem iniciar o job de publicação. A anotação informou: `The job was not started because your account is locked due to a billing issue.` O build genérico foi skipped. Não foi alterada cobrança ou contratado serviço. **GitHub Actions não passou**; esse impedimento operacional permanece para futuros workflows.

Depois de confirmar a conclusão do Actions, o mesmo verificador foi executado localmente com credencial existente em memória, baixou os assets do rascunho pela API, validou hashes/Minisign/manifesto/commit e publicou esse único rascunho como estável/latest pela API oficial. Nenhum processo de publicação permaneceu concorrente.

Foi corrigida a busca de rascunhos: a consulta por tag retornou 404, então o publicador passou a usar a listagem autenticada. A correção gerou o commit final `71ab257`; antes de qualquer release público, a tag própria foi atualizada de `04c9a70` para esse commit usando force-with-lease. O produto e os artefatos não mudaram. Ao atualizar o destino, o GitHub apresentou o rascunho como `untagged`; ele foi reassociado explicitamente à tag v1.4.4, preservando ID e assets. A publicação final passou, e não houve criação de release duplicado.

O commit posterior de documentação registra o resultado em main sem mover a tag publicada. Os relatórios locais de pré-implantação e homologação não selecionados continuam preservados, fora dos commits deste lançamento.

## Origem e código aprovado

Destino confirmado: `blackphoenix777/Oeste-Sombrio`, branch principal `main`, inicialmente em `8016f2a23c93b2394616ddae31f611cdc37b3a47`. Tag/release v1.4.4 ausentes antes da operação. A árvore contém alterações homologadas ainda não commitadas; arquivos funcionais da 1.4.4 são registrados junto com testes e documentação pertinentes. Relatórios anteriores de pré-implantação/homologação que não compõem este release permanecem locais.

O manifesto histórico de 220 entradas conferiu todos os arquivos funcionais. Diferenças esperadas: cinco metadados de versão 1.4.4 e o harness corrigido após homologação. A inspeção dos bytes Brotli presentes no executável 1.4.4 extraído do instalador autêntico encontrou correspondência de conteúdo para **105/105 arquivos atuais de dist**, sem ausências. Código Rust/build/capabilities corresponde ao manifesto aprovado; Cargo.lock só muda a versão da aplicação e não dependências. A configuração Tauri só muda a versão. Não foi necessário rebuild.

SHA-256 do executável extraído: `1c7fa05eb23c838aa5436cf502f0866b8bebf3bb4e98e460dd1cbff143002f6c`. [Proveniência detalhada](proveniencia-release-1.4.4.json).

## Publicação única pelo workflow

O fluxo genérico anterior reconstruía e publicava automaticamente ao receber tags v*. Para preservar os bytes aprovados, `.github/workflows/release.yml` agora usa exclusivamente o job `publish-approved-144` para `refs/tags/v1.4.4`. Há exclusão mútua por ref; o job genérico é ignorado nessa tag. A publicação só ocorre depois da verificação do rascunho, das três assinaturas/hash/manifesto e da correspondência entre target_commitish e GITHUB_SHA. A revisão local de assinatura verifica o payload e o comentário autenticado Minisign. Os testes negativos rejeitaram adulterações em cada um dos três arquivos.

O rascunho será preparado via API REST oficial, mecanismo já utilizado no script local de release. Só o GitHub Actions fará a transição para público/latest. O script não substitui assets já públicos em reexecuções. Nenhum segredo é incluído no Git: credencial GitHub vem do gerenciador existente em memória; Actions usa GITHUB_TOKEN; a chave privada de assinatura não é necessária.

## Artefatos aprovados

| Arquivo | SHA-256 |
| --- | --- |
| Dark.West.Character.Sheet_1.4.4_x64-setup.exe | `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962` |
| Dark.West.Character.Sheet_1.4.4_x64-setup.exe.sig | `301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155` |
| latest.json | `479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d` |

Local: `src-tauri/target/release/bundle/release-upload-1.4.4`. Verificador: `node scripts/verify-release-144.cjs`. Resultado local: hashes, chave pública, assinatura Minisign e manifesto PASS. Plataforma única `windows-x86_64`, versão 1.4.4, URL do instalador apontada à tag v1.4.4. Nenhuma alteração de Supabase, migração, COM-09, rolagens secretas ou Notion.

## Riscos aceitos e acompanhamento

O anúncio público não comprova o upgrade real: descoberta na interface, adiamento, handoff NSIS, reinício e preservação de dados durante instalação continuam sem ensaio isolado. O código mantém confirmação antes de instalar. NSIS tem assinatura Minisign válida, mas não Authenticode; não desabilitar SmartScreen ou outras proteções. O 1.4.3 deve continuar disponível para recuperação manual; downgrade não garante compatibilidade dos dados, portanto preservar backup privado dos dados locais antes de uma recuperação.

Se surgirem falhas, coletar versão, etapa, status HTTP, mensagens do updater e códigos do instalador sem credenciais/dados privados. Preparar uma correção futura separada com novo diagnóstico e testes, sem substituir silenciosamente os bytes de v1.4.4 ou presumir que reduzir latest.json reverte instalações. Nenhuma correção futura está autorizada a modificar este release automaticamente.
