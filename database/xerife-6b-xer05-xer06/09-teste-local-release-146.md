# Oeste Sombrio 2.0 — Teste local da release 1.4.6

**19/11/2026 · Windows principal · Candidata nativa aprovada nos smoke tests. Updater real pendente.**

O teste usou o executável compilado da candidata com perfis descartáveis do WebView2. A instalação principal segue na **1.4.4**, confirmada pelo executável e pelo Registro. A versão pública informada para o ensaio é a **1.4.5**.

## Instalação e dados identificados

| Item | Resultado |
| --- | --- |
| Executável instalado | `C:\Users\Stéfano\Nova pasta\Dark West Character Sheet\DarkWest.exe`, versão `1.4.4`. Os atalhos do Menu Iniciar e da Área de Trabalho apontam para esse caminho. |
| Tipo de instalação | NSIS x64 por usuário. O diretório tem `DarkWest.exe` e `uninstall.exe`, ambos com versão `1.4.4`. |
| Processo Windows | `DarkWest.exe`. A instalação principal estava fechada antes do backup. Os processos da candidata foram encerrados ao final. |
| Fichas locais | Quatro JSON em `%APPDATA%\com.stefano.darkwest\characters`. O backend usa a pasta de dados da conta do Windows. |
| Configurações e sessão | `%LOCALAPPDATA%\com.stefano.darkwest\EBWebView`, com `Local State`, `Default\Preferences`, `Default\Secure Preferences`, armazenamento local e de sessão e cookies. A mesma raiz contém `logs`. |
| Registro | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Dark West Character Sheet` e `HKCU\Software\stefano\Dark West Character Sheet`. As chaves equivalentes consultadas em `HKLM` estavam ausentes. |

A variável de ambiente `WEBVIEW2_USER_DATA_FOLDER` isolou as configurações do navegador. As fichas em Roaming continuam vinculadas à conta do Windows. O único IPC usado com as fichas reais foi `list_characters`, que retornou uma contagem de quatro. Os smoke tests usaram dados sintéticos em memória, com autosave e IPC de fichas desativados durante os cenários. [Configuração do WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl)

## Backup e restauração de ensaio

- Pasta fora do repositório em `%LOCALAPPDATA%\OesteSombrioBackups\release146-local-20261119-073210-3a635d`.
- `snapshot` contém as árvores Roaming, Local e da instalação, os dois atalhos e os instaladores oficiais NSIS com `.sig` da `1.4.4` e da `1.4.5`. As duas chaves HKCU foram exportadas como arquivos `.reg` na raiz do backup.
- **543 arquivos, 122.846.462 bytes.** Cada arquivo coincidiu em tamanho e SHA-256 na origem, em `snapshot` e na cópia de restauração `restore-check`. A restauração de ensaio usou outro diretório e a mesma conta do Windows.
- O manifesto `backup-manifest.json` registra caminhos, tamanhos, hashes, versão, diretório da instalação e valores das chaves consultadas. Seu SHA-256 é `e9bfef367ea1495f3ae5ae22b8c46e78088d7f5d4e2af85a8a7151629a7ac585`.
- Depois dos testes, a nova comparação dos 543 caminhos e das chaves de Registro inventariadas teve zero divergências. As árvores de dados e instalação mantiveram os mesmos 537 arquivos. Os dados pessoais ficaram no Windows local.

## Resultados

| Teste | Classificação | Evidência |
| --- | --- | --- |
| Diagnóstico da instalação | **APROVADO** | Executável e Registro retornaram `1.4.4`, com o mesmo caminho identificado nos atalhos. |
| Backup, hashes e restauração de ensaio | **APROVADO** | 543 arquivos coincidentes, incluindo os quatro JSON, a configuração do WebView2 e os instaladores de recuperação. |
| Inicialização e versão da candidata | **APROVADO** | Executável compilado abriu em `http://tauri.localhost` e `app.getVersion()` retornou `1.4.6`. |
| Interface e leitura local | **APROVADO** | Tela de login visível, folha de estilo carregada, interface de ficha presente e quatro fichas listadas por IPC somente leitura. |
| Supabase Produção somente leitura | **APROVADO** | GET anônimo real de `mesas`, HTTP 200 e zero linhas retornadas. O filtro da sessão permitiu apenas o GET e seu preflight durante a sondagem. Zero tentativas de escrita observadas. |
| XER-04 | **APROVADO** | Editor no modo livre, ativação do 6B próprio, cinco tipos de dados, contador e serialização em memória com modo Criatura desligado. A primeira asserção esperava a ordem inversa dos dados. O reteste dirigido confirmou a ordem canônica e passou. |
| XER-05 | **APROVADO** | Duas instâncias do mesmo molde mantiveram estados independentes. A recarga com uma RPC simulada recuperou as câmaras consumidas da primeira. |
| XER-06 | **APROVADO** | Modal de dano com escolha de câmaras, dano, fadiga em cascata, renovação depois do esgotamento e recarga após PT409 simulado, com uma tentativa de mutação no fixture. |
| Exceções críticas no aplicativo | **APROVADO** | Zero exceções não tratadas observadas por CDP nas sessões válidas. A primeira tentativa de automação dentro do sandbox expirou antes de executar as verificações. |
| Preservação durante o teste não destrutivo | **APROVADO** | Zero diferenças nos arquivos e no Registro conferidos depois do teste. A versão instalada continuou `1.4.4`. |
| Instalação limpa NSIS e substituição da instalação principal | **NÃO EXECUTADO** | O binário já compilado foi executado diretamente. Qualquer substituição da instalação principal depende de aprovação específica. |
| Updater original `1.4.5 → 1.4.6` | **NÃO EXECUTADO** | Instalação principal em `1.4.4` e endpoint HTTPS oficial fixo no cliente da `1.4.5`. |
| Dados e configurações após uma atualização | **NÃO EXECUTADO** | Depende da execução de uma atualização autorizada e da comparação pré e pós-instalação. |

## Updater e impacto de uma eventual substituição

O cliente distribuído da `1.4.5` consulta o manifesto HTTPS do GitHub. O comando do updater aceita proxy, mas conserva a URL e a validação TLS. O WebView2 pode isolar a interface, enquanto a consulta do updater ocorre no backend nativo. Não foi identificado um meio de servir o manifesto candidato ao cliente original com TLS válido sob as restrições deste ensaio. O procedimento para o updater real continua no [relatório do Pacote 7.1](08-pacote-7-1-desbloqueio-release-146.md). [Contrato do updater Tauri](https://v2.tauri.app/plugin/updater/)

Uma instalação manual aprovada substituiria a **1.4.4 por 1.4.6** no caminho registrado. O NSIS atualiza `DarkWest.exe`, `uninstall.exe`, atalhos e as chaves HKCU de versão, caminho e desinstalação. Conforme o modo escolhido, pode invocar o desinstalador da versão anterior. As duas pastas `com.stefano.darkwest` guardam as fichas e o perfil. Se um desinstalador apresentar uma opção para remover dados, ela deve permanecer desmarcada.

**Riscos residuais.** O instalador pode ser interrompido, provocar aviso de reputação do Windows ou alterar a configuração consumida na primeira abertura. As sessões do WebView2 podem pedir novo login após recuperação dos arquivos. O ensaio de restauração confirmou os bytes em diretório separado. A inicialização a partir de um perfil restaurado ainda depende da recuperação efetiva. A instalação manual deixa pendente o teste do updater original.

**Recuperação se houver falha após uma substituição autorizada.** Fechar o app, preservar em outra pasta qualquer dado criado depois do backup e reinstalar a `1.4.4` com o NSIS preservado em `snapshot\Recovery\1.4.4`, no caminho original. Se necessário e autorizado, restaurar `snapshot\Roaming` e `snapshot\Local` para as respectivas pastas `com.stefano.darkwest`, com a mesma conta e o aplicativo fechado. Usar as exportações `.reg` somente caso a reinstalação não recupere os valores esperados e haja aprovação específica para o Registro. Conferir novamente a versão, os hashes das quatro fichas, o acesso pela interface, os identificadores e as preferências. O NSIS da `1.4.5` permanece disponível para preparar o ponto de partida do futuro ensaio do updater.

**Recomendação.** Adiar a substituição da instalação principal se o objetivo continuar sendo validar o updater `1.4.5 → 1.4.6`. Uma instalação manual é um teste separado e requer autorização específica para substituir a `1.4.4`. A publicação segue bloqueada pelo ensaio de instalação e atualização.
