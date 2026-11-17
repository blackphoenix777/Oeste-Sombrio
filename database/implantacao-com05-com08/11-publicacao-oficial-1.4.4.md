# Publicação oficial v1.4.4

17/11/2026 — publicação autorizada expressamente pelo proprietário, com aceitação do risco de upgrade Windows não ensaiado. Registro inicial anterior ao envio; o resultado público será acrescentado após verificação.

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
