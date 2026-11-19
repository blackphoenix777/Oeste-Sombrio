# Oeste Sombrio 2.0 — Pacote 7.1 — Publicação da `1.4.6`

**19/11/2026 · BLOQUEADO**

Faltam a instalação limpa NSIS da `1.4.6` e o ensaio real `1.4.5 → 1.4.6` em Windows descartável, com abertura das duas versões, preservação de fichas locais e smoke tests de XER-04/05/06. A guarda local do GitHub Actions e a conferência dos artefatos foram concluídas. Este procedimento atualiza o plano do [Pacote 7](07-preparacao-release-146.md).

## Instalação e atualização

| Etapa | Resultado do Pacote 7.1 |
| --- | --- |
| Instalação limpa NSIS e abertura da `1.4.6` | Pendente por falta de um convidado Windows descartável acessível. |
| Instalação da `1.4.5`, abertura e dados de referência | Pendente pelo mesmo bloqueio. O instalador e o `.sig` da `1.4.5` já estão disponíveis localmente e coincidem com os SHA-256 registrados na publicação oficial. |
| Updater nativo `1.4.5 → 1.4.6` | Pendente. A verificação criptográfica de arquivos do Pacote 7 continua válida para os mesmos bytes. A detecção, a validação pelo cliente e a instalação em execução permanecem em aberto. |
| Preservação dos dados e smoke tests XER-04/05/06 | Pendentes no aplicativo instalado. Os resultados de Tauri Dev e das suítes do Pacote 7 seguem registrados no relatório original. |

O host é Windows 10 Pro `19045`. O módulo Hyper-V, `vmconnect.exe` e os serviços `vmms` e `vmcompute` estão presentes, com ambos os serviços ativos. `Get-VM` retornou acesso negado no sandbox e, em consulta somente leitura fora dele, o serviço Hyper-V respondeu que a identidade executora não tem permissão na política de autorização local. A sessão não é elevada e seu token não apresenta o grupo Administradores do Hyper-V. O inventário padrão do Hyper-V também ficou inacessível. A existência de uma VM adequada ficou indeterminada. `WindowsSandbox.exe` estava ausente. Os comandos e caminhos usuais inspecionados não revelaram VirtualBox, VMware ou QEMU utilizáveis. [Inventário Hyper-V com `Get-VM`](https://learn.microsoft.com/en-us/powershell/module/hyper-v/get-vm)

Opções para executar o ensaio, em ordem de menor intervenção no host:

1. Um administrador local executa `Get-VM | Select-Object Name,State,Generation` e disponibiliza uma VM Windows x64 dedicada, com WebView2, conta de teste e checkpoint. O acesso pode ser pela console autorizada, com transferência dos artefatos por PowerShell Direct se houver credenciais no convidado e permissão no host. [PowerShell Direct](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/powershell-direct) · [Checkpoints do Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints)
2. Usar uma VM Windows x64 descartável já provisionada em outro host ou na infraestrutura de QA, com WebView2, console autorizada e rede isolável. Transferir somente os instaladores, assinaturas, manifesto candidato e fixtures sintéticas.
3. Se o inventário confirmar que não há VM existente, usar o Hyper-V já ativo para importar uma imagem Windows de QA aprovada ou habilitar Windows Sandbox com autorização específica para alterar o host. A sessão Sandbox precisa de WebView2 e deve permanecer aberta durante a atualização. [Configuração do Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)

### Ensaio obrigatório no convidado

1. Bloquear a saída de rede pública do convidado antes de abrir qualquer versão, pois o aplicativo consulta o updater na inicialização. Usar dois checkpoints ou perfis limpos, um para a instalação limpa da `1.4.6` e outro para a atualização. Conferir os SHA-256 no convidado. No primeiro perfil, instalar o NSIS da `1.4.6`, abrir o aplicativo e registrar `app.getVersion() = 1.4.6`.
2. No perfil de atualização, instalar o NSIS oficial `1.4.5` de `src-tauri/target/release/bundle/release-upload-1.4.5/` e confirmar `app.getVersion() = 1.4.5`. Criar duas fichas sintéticas, fechar e reabrir o app, registrar os nomes e os SHA-256 dos JSON em `%APPDATA%\com.stefano.darkwest\characters` e conferir a leitura na interface. Registrar uma preferência persistida, como a largura do painel quando disponível no fixture.
3. Antes do check manual do updater, preparar no convidado um servidor HTTPS de loopback para o hostname `github.com` e confiar, somente no convidado, em uma CA efêmera de QA que assine o certificado com SAN `github.com`. Resolver `github.com` para `127.0.0.1` no convidado. Configurar o servidor para servir os bytes do `latest.json` candidato em `/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json` e os bytes do NSIS aprovado no caminho exato de `platforms.windows-x86_64.url`. A assinatura é a do `.sig` e a validação TLS permanece ativa. Confirmar que as requisições chegam ao servidor local. O binário distribuído usa o endpoint configurado no Tauri, e o comando IPC `check` não aceita override de URL. [Contrato do updater Tauri](https://v2.tauri.app/plugin/updater/)
4. Pela opção **Verificar Atualizações** do app instalado, aceitar a `1.4.6`. Registrar a detecção da versão, o download e a aceitação do pacote pelo plugin seguido da instalação NSIS. Após a reabertura, conferir `app.getVersion() = 1.4.6`, os SHA-256 das fichas, a leitura pela interface e a preferência registrada. Um novo check contra o mesmo endpoint isolado deve retornar sem atualização disponível.
5. Na `1.4.6` instalada, testar XER-04 com composição de 6B próprio de um NPC ou Boss, salvamento e reabertura. Para XER-05, usar mesa sintética com duas instâncias do mesmo molde e conferir que o consumo de uma persiste após recarregar ou trocar de mapa, enquanto a outra conserva seu estado. Para XER-06, confirmar escolha de câmara no modal de dano, fadiga em cascata, renovação após esgotamento e atualização de estado após `PT409` sem repetição automática da mutação. Executar as interações com um backend descartável ou um fixture controlado de RPC/Realtime no convidado, registrando qual foi usado. Os dois scripts `tests/live-xerife-6b-*.cjs` trabalham com Homologação e ficam fora deste ensaio.
6. Registrar as versões, hashes pré e pós-upgrade, resultado por smoke test e logs ou capturas que demonstrem a execução. A aprovação exige o caminho completo pelo updater instalado. Reverter o convidado ao checkpoint ou encerrar a sessão descartável.

## GitHub Actions

O job `release` em [`.github/workflows/release.yml`](../../.github/workflows/release.yml) exclui `refs/tags/v1.4.6` pela mesma condição usada no precedente `v1.4.5` (`496202e`). A linha de `if` é a única alteração do workflow. O parser `@actions/workflow-parser` `0.3.61` aprovou o YAML e o esquema, e `@actions/expressions` confirmou a matriz abaixo para o `if` dos jobs em `push` e `workflow_dispatch`. Um push de branch não dispara esse workflow, cujo filtro de push é `tags: ['v*']`. O resultado é local. [Sintaxe dos workflows do GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

| Referência | `publish-approved-144` | `release` |
| --- | --- | --- |
| `refs/tags/v1.4.4` | Executa | Ignora |
| `refs/tags/v1.4.5` | Ignora | Ignora |
| `refs/tags/v1.4.6` | Ignora | Ignora |
| `refs/tags/v1.4.7` | Ignora | Executa |
| `refs/heads/main` em execução manual | Ignora | Ignora |

## Arquivos previstos para integração Git

A branch `feature/xerife-6b-npc-boss` segue em `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, também o commit de `main` local e `v1.4.5`. O índice está vazio de alterações. A lista abaixo contém os 35 caminhos previstos, relativos à raiz do repositório. `dist/` é o código-fonte do frontend empacotado pelo Tauri. O tratamento PT409 está em `dist/js/mesaScreen.js` e na segunda migração.

```text
.github/workflows/release.yml
dist/index.html
dist/js/cylinder.js
dist/js/magiasUI.js
dist/js/mesaScreen.js
dist/js/mesaXerife6B.js
dist/js/modal.js
dist/js/rules/cylinderRules.js
dist/js/rules/index.js
dist/js/rules/own6BRules.js
dist/js/storage.js
dist/style.css
package.json
package-lock.json
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
supabase/migrations/20261118101800_xerife_6b_instance_combat.sql
supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql
tests/live-xerife-6b-instances.cjs
tests/live-xerife-6b-pt409-homolog.cjs
tests/xerife-6b-pg17-conflict-pt409.cjs
tests/xerife-6b-pg17-sql-rls.cjs
tests/xerife-6b-xer04-own-editor.cjs
tests/xerife-6b-xer05-instance-persistence.cjs
tests/xerife-6b-xer06-instance-combat.cjs
database/xerife-6b-xer04-contratos-xer05-xer06.md
database/xerife-6b-xer05-xer06/01-relatorio-seguranca-homologacao-implantacao.md
database/xerife-6b-xer05-xer06/02-rollback-migracao-xer05-xer06.sql
database/xerife-6b-xer05-xer06/03-homologacao-integrada.md
database/xerife-6b-xer05-xer06/04-pacote-5-1-correcao-concorrencia-pt409.md
database/xerife-6b-xer05-xer06/05-preparacao-producao.md
database/xerife-6b-xer05-xer06/06-implantacao-producao.md
database/xerife-6b-xer05-xer06/07-preparacao-release-146.md
database/xerife-6b-xer05-xer06/08-pacote-7-1-desbloqueio-release-146.md
```

Ficam fora do plano `supabase/.temp/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/schemas/`, backups, logs, chaves, arquivos de ambiente ou configuração de testes com credenciais e outros binários. Também ficam fora os grupos antigos `database/homologacao-com05-com08/`, `database/pre-implantacao-com05-com08/`, `database/implantacao-com05-com08/` e os arquivos `database/com01-com02-auditoria-contratos.md` e `database/implantacao-mesa-p0-xerife-p02/07-publicacao-oficial-145.md`. Nenhum arquivo de trabalho foi apagado.

`git diff --check` no workflow passou. A verificação do diff preexistente apontou linhas em branco no fim de `dist/js/rules/index.js` e `dist/style.css`. Os bytes desses arquivos correspondem ao binário aprovado e foram preservados.

## Integridade dos artefatos

Os oito registros da seção D do [Pacote 7](07-preparacao-release-146.md#d-artefatos-produzidos-146) coincidiram em tamanho e SHA-256. Isso inclui `DarkWest.exe`, MSI e `.sig`, NSIS e `.sig`, e os três arquivos prontos para upload. O conteúdo dos 11 arquivos de frontend da lista também coincide byte a byte com os recursos do Tauri encontrados no executável. Foram alterados somente o workflow e a documentação de release. O candidato permanece válido e não requer rebuild ou nova assinatura para as mudanças do Pacote 7.1.

| Arquivo em `src-tauri/target/release/bundle/release-upload-1.4.6/` | SHA-256 |
| --- | --- |
| `Dark.West.Character.Sheet_1.4.6_x64-setup.exe` | `8d27ce4cedf7220fdefe4baa8cc6142e3906ff08f1a3ac7c34cb5a02f727202f` |
| `Dark.West.Character.Sheet_1.4.6_x64-setup.exe.sig` | `01ac4a1d86765a2cf2434e39f4545fc03228db23baed09e9dbf8e4c167ae356d` |
| `latest.json` | `76cad3f8a3557f14b21389fd254c60a2b41a54aab13ca1ad52012bbed60f3700` |

O manifesto local declara `1.4.6`, aponta `windows-x86_64` para o NSIS da tag `v1.4.6` e contém a assinatura idêntica ao `.sig`. Os testes já aprovados, o build e a assinatura foram reaproveitados conforme registrados no Pacote 7.

## Procedimento de publicação após autorização

1. Concluir o ensaio obrigatório e registrar **PRONTO** com as evidências. Obter autorização explícita para a integração Git e a publicação. Conferir `origin/main` e confirmar que `v1.4.6` está livre em tags locais, remotas e GitHub Releases, inclusive drafts. Rodar novamente os hashes desta tabela antes do upload. Se uma mudança de integração afetar os insumos compilados, invalidar os artefatos anteriores, gerar e assinar um novo candidato e revalidar as etapas afetadas.
2. Na branch `feature/xerife-6b-npc-boss`, preparar apenas os 35 caminhos da lista com `git add -- <caminhos>`. Conferir a igualdade da lista com `git diff --cached --name-only` e revisar o diff staged. Criar o commit de release, integrar em `main` pelo fluxo autorizado do repositório e confirmar que o `main` remoto aponta para o commit final integrado, que inclui a guarda e os insumos aprovados.
3. Atualizar `origin/main` localmente e criar a tag anotada no commit remoto integrado com `git tag -a v1.4.6 origin/main -m "Oeste Sombrio v1.4.6"`. Conferir `git rev-parse 'v1.4.6^{commit}'` e executar `git push origin refs/tags/v1.4.6`. Confirmar o commit apontado no remoto com `git ls-remote origin 'refs/tags/v1.4.6^{}'`. No GitHub Actions, verificar que os dois jobs foram ignorados para a tag, como na `v1.4.5`, antes de publicar.
4. No repositório `blackphoenix777/Oeste-Sombrio`, criar uma GitHub Release **draft** para a tag existente, com título `Dark West v1.4.6` e notas descrevendo XER-04/05/06 e a correção PT409. Anexar exatamente os três arquivos da tabela de upload. Baixar os três assets do draft com sessão autorizada para um diretório temporário e comparar SHA-256 com a tabela. Conferir `version`, URL `windows-x86_64` e assinatura contra o `.sig`. [Criação de releases no GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
5. Publicar o draft como release estável e marcá-lo como `Latest`. Baixar por HTTPS os três assets de `/releases/download/v1.4.6/` e o `latest.json` de `/releases/latest/download/latest.json`. Confirmar HTTP 200, SHA-256 idêntico ao aprovado e que o manifesto global serve a `1.4.6` e a assinatura do NSIS dessa tag. Em uma nova sessão descartável `1.4.5`, confirmar a oferta e a instalação pelo endpoint público, com fichas sintéticas. [Endpoint do updater Tauri](https://v2.tauri.app/plugin/updater/)

Nesta etapa foram executadas somente preparações e verificações locais. O índice Git, o histórico, as tags e a publicação remota seguem sem operações de escrita, assim como o manifesto público e os projetos Supabase de Produção e Homologação. O bloqueio agora é obter acesso a um Windows descartável apropriado e concluir o ensaio acima. O estado permanece **BLOQUEADO**, aguardando o ambiente de QA e a autorização de publicação.
