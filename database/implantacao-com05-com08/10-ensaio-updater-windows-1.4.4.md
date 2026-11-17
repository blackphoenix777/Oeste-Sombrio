# Ensaio autêntico do updater Windows 1.4.3 → 1.4.4

16/11/2026 — **NO-GO — ambiente isolado indisponível.** O proprietário confirmou nesta missão que não dispõe de VM Windows descartável nem segundo computador disponível. Este documento prepara o ensaio; não registra sua execução. Nenhuma instalação, configuração de rede/certificado, publicação ou alteração de Supabase foi realizada.

## Inspeção do mecanismo existente

- `src-tauri/tauri.conf.json`: endpoint `https://github.com/blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json`, chave pública Minisign embutida, artefatos de updater habilitados, instalação Windows em modo `passive`.
- `src-tauri/src/lib.rs`: registra `tauri_plugin_updater::Builder::new().build()`, sem configuração de endpoint alternativa ou comando de sobrescrita. `src-tauri/capabilities/default.json` permite `updater:default`.
- `dist/js/main.js`: consulta automática cerca de três segundos após inicialização. `silent: true` suprime alguns avisos, mas não elimina a confirmação de atualização disponível. `dist/js/homeScreen.js` também liga o botão de verificação manual.
- `dist/js/updater.js`: usa `check()` ou IPC `plugin:updater|check`; exibe versão/notas e confirmação. Adiar fecha o recurso sem chamar download/instalação; aceitar chama `downloadAndInstall` ou `plugin:updater|download_and_install` e acompanha eventos de download.
- A fonte local do plugin 2.14.1 mostra validação de assinatura antes de instalar, execução do NSIS e saída do processo Windows depois de iniciar o instalador. Portanto, a mensagem JavaScript após `downloadAndInstall` não comprova a instalação. É preciso observar o instalador, a reabertura e a versão efetiva.
- A fonte atual usa reqwest 0.13.4/rustls com verificador da plataforma. Isso sustenta a viabilidade de uma CA confiável dentro do convidado, mas **não demonstra** as opções compiladas no 1.4.3 autêntico. A tag v1.4.3 não existe no checkout local para comparação de fonte. A extração anterior do binário autêntico comprovou versão e endpoint; seu comportamento TLS deve ser validado no convidado.

Nenhum mecanismo utilizável de sobrescrita em runtime foi identificado no aplicativo. A possibilidade oferecida pela biblioteca de configurar endpoints não equivale a uma configuração exposta pelo binário. Referência: [documentação oficial do updater Tauri](https://v2.tauri.app/plugin/updater/).

## Disponibilidade verificada

| Recurso | Evidência e limite |
| --- | --- |
| Windows Sandbox | `C:\Windows\System32\WindowsSandbox.exe` ausente |
| Hyper-V | Módulo Get-VM presente; serviços vmms e vmcompute em execução. Isso não comprova a existência de convidado Windows. Inventário negado na missão anterior; não foi repetido nem solicitada nova elevação |
| VirtualBox, VMware, QEMU | Executáveis de controle não encontrados no PATH; nenhuma instalação/VM retornada nos caminhos usuais consultados. Não é inventário exaustivo do computador |
| Informações CIM de Windows/RAM | Acesso negado na consulta desta missão; não usadas para afirmar incapacidade física do computador |
| Segundo computador/VM externa | Proprietário respondeu: “Não há ambiente isolado disponível” |
| Docker já existente | Não fornece, por si só, o convidado Windows com desktop e WebView2 necessário ao ensaio autêntico |

O bloqueio é a ausência de ambiente Windows isolado disponibilizado, não uma conclusão sobre capacidade física insuficiente. Nenhum programa foi instalado, recurso de Windows habilitado, licença adquirida ou serviço contratado.

## Menor infraestrutura proposta

Uma única VM Windows x64 descartável pode hospedar tanto o aplicativo quanto o servidor HTTPS em loopback. Não é necessário um segundo servidor ou serviço externo. Requisitos:

1. Windows licenciado e compatível com a aplicação, desktop interativo, WebView2 já disponível, conta local de teste e snapshot/reversão. Recursos de CPU, memória e disco devem atender à imagem Windows escolhida, com folga para WebView2 e snapshot; como ponto de partida operacional, 2 vCPU e 4–8 GiB de RAM, a confirmar no provisionamento, não como mínimo certificado.
2. Permissão administrativa **somente no convidado** para hosts, certificado e binding HTTPS. Nenhuma pasta com dados privados, perfil real ou chave privada de assinatura Tauri deve ser compartilhada.
3. Servidor HTTPS já disponível no convidado. Pode ser implementado com PowerShell/.NET `HttpListener` e HTTP.sys, sem pacote adicional, desde que sejam configurados certificado, URL ACL e binding da porta 443 no convidado. Alternativamente, usar servidor previamente instalado e autorizado. Não instalar um novo runtime silenciosamente.
4. Certificado de servidor com SAN `github.com`, EKU de autenticação de servidor, validade temporal e cadeia emitida por CA de laboratório confiada somente pelo convidado. É confiança local de laboratório, não certificado público de GitHub. Não importar essa CA na máquina principal. A chave TLS de laboratório também permanece fora do Git e é descartada ao reverter a VM.
5. Rede sem acesso ao Supabase de produção ou homologação, sem credenciais reais. A VM pode permanecer sem acesso externo após preparar arquivos/runtime. O servidor local deve atender somente os dois caminhos abaixo; demais caminhos retornam 404. O convidado não deve receber configuração de proxy externo que ignore o redirecionamento local.

Windows Sandbox ou segundo computador dedicado e restaurável poderiam substituir a VM se já disponíveis e autorizados. Uma conta adicional na instalação principal ou outra pasta de instalação não oferece o isolamento solicitado. Não há autorização de provisionamento/instalação implícita neste documento.

## Arquivos autênticos e endpoints de laboratório

| Arquivo | Origem local / SHA-256 conhecido |
| --- | --- |
| Instalador 1.4.3 | `C:\Users\Stéfano\AppData\Local\Temp\ow-authentic-143\1.4.3.exe`; `8ee0ea275c372dc128c07a3cc9be2f4547a9603a797970dded015a60e02a5f75` — hash reconferido nesta missão |
| Assinatura 1.4.3 | Mesmo diretório, `1.4.3.exe.sig`; validada na missão anterior com a chave pública configurada |
| Instalador 1.4.4 | `src-tauri/target/release/bundle/release-upload-1.4.4/Dark.West.Character.Sheet_1.4.4_x64-setup.exe`; `1555dc6fab22960110c277b6b9c3c0a974cdfd604ac25216a9eddea4ff3ec962` |
| Assinatura 1.4.4 | `.exe.sig` no mesmo diretório; `301a7006b7ac489fabe5ec3fe8d6316748ededfb8cad8a4b31ca8378caba7155` |
| Manifesto candidato | `latest.json` no mesmo diretório; `479da17a7d8871d784aafc8cc1d6c7c1cea3ade92a5be0e9fb122c986511282d` |

Os três hashes 1.4.4 e as assinaturas já foram aprovados; nenhuma alteração desses arquivos foi feita nesta missão. O temporário de 1.4.3 deve ser copiado para a área privada de ensaio quando o convidado existir; se tiver sido removido, obter novamente o artefato autêntico e verificar antes de instalar. Não é necessário transportar a chave privada Minisign para o laboratório.

No **hosts da VM apenas**, mapear `github.com` para o servidor local. O listener HTTPS serve:

| Requisição original do cliente | Resposta local |
| --- | --- |
| `GET /blackphoenix777/Oeste-Sombrio/releases/latest/download/latest.json` | Bytes exatos do latest.json candidato; HTTP 200, `application/json`, sem cache |
| `GET /blackphoenix777/Oeste-Sombrio/releases/download/v1.4.4/Dark.West.Character.Sheet_1.4.4_x64-setup.exe` | Bytes exatos do instalador 1.4.4; HTTP 200, `application/octet-stream`, Content-Length correto |

Assim o manifesto candidato pode ser servido **sem editar sua URL ou assinatura**, pois os dois caminhos usam o mesmo hostname. Não há redirect ao GitHub real. O listener deve lidar com o download completo e registrar horário, caminho, status e bytes, sem dados pessoais/credenciais. Abrir a URL com um navegador ou PowerShell ajuda a conferir o servidor, mas só a consulta feita pelo **1.4.3 autêntico** comprova a confiança TLS do updater. Se falhar, registrar o erro e interromper; não usar `-SkipCertificateCheck`, HTTP, alterações de binário, flags de certificado inválido ou remoção de Minisign.

## Procedimento e critérios de aprovação

1. Registrar identificação da VM e snapshot limpo. Confirmar isolamento, WebView2, relógio correto, certificados e servidor HTTPS restrito ao convidado. Conferir os hashes de todos os arquivos após copiá-los, por `Get-FileHash -Algorithm SHA256 -LiteralPath <arquivo>`. Verificar as assinaturas com a chave pública conhecida usando verificador Minisign confiável já disponível/autorizado. Não confundir essa verificação com Authenticode.
2. Instalar o 1.4.3 autêntico dentro da VM e confirmar versão do executável e versão apresentada pelo aplicativo. Esta é a instalação inicial necessária ao ensaio, não o teste de upgrade. Nenhum 1.4.4 é instalado manualmente.
3. Criar e salvar uma ficha local sintética com nome identificável, inventário, integridade e REM. Fechar/reabrir o 1.4.3 e confirmar persistência. Identificar o diretório efetivamente usado por `app.path().app_data_dir()` e criar cópia dos dados locais/snapshot; incluir armazenamento WebView se usado. Não assumir apenas o nome de uma pasta.
4. Disponibilizar o manifesto candidato no servidor e acionar a verificação do aplicativo. Registrar requisição HTTP pelo cliente e diálogo contendo 1.4.4 como disponível e 1.4.3 como atual. Se o diálogo automático aparecer antes, adiar e continuar os preparativos; `silent` não representa aceite automático.
5. **Adiamento:** recusar. Confirmar ausência de GET do instalador e de novo processo instalador, aplicativo ainda 1.4.3 e dados sintéticos intactos. Reiniciar e/ou usar o botão de nova verificação para provar que adiar não impede atualização futura.
6. **Aceite e download:** confirmar no diálogo. Registrar GET do instalador, total de bytes, progresso e verificação de assinatura pelo fluxo original. Certificado, manifesto, assinatura e binário permanecem inalterados. Uma validação local de assinatura complementa, mas não substitui, a passagem pelo verificador do updater.
7. **Instalação:** observar lançamento do NSIS pelo updater, encerramento do processo 1.4.3 e conclusão do instalador. Registrar erro/UAC/reinício caso ocorram. Não executar o .exe 1.4.4 por fora para transformar uma falha do updater em sucesso.
8. **Inicialização e persistência:** confirmar que o processo reaberto é 1.4.4, verificar versão no executável e na interface, abrir a ficha e comparar os campos sintéticos. Fechar/reabrir novamente. O resultado esperado é que nova consulta não ofereça 1.4.4 à própria 1.4.4.
9. Salvar evidências sem credenciais: versões, hashes, telas dos diálogos, status/bytes do servidor, processos, resultados dos campos sintéticos e horário. Reverter snapshot, eliminando CA, hosts, fixtures e servidor. Só declarar GO se descoberta, adiamento, aceite, download, instalação pelo updater, inicialização e persistência passarem.

| Etapa | Estado nesta missão |
| --- | --- |
| Descoberta pelo 1.4.3 autêntico | BLOCKED |
| Adiamento e nova descoberta | BLOCKED |
| Aceite/download por HTTPS | BLOCKED |
| Minisign no fluxo real do updater | BLOCKED — validação criptográfica anterior dos arquivos continua aprovada |
| Instalação automática/reabertura/persistência | BLOCKED |

## Alternativa de distribuição manual — não aprovada nem executada

O proprietário pode optar por distribuir privadamente o mesmo NSIS 1.4.4 íntegro, com instruções de instalação manual, sem alterar o canal de atualização. Isso exige aprovação explícita e aceitação do risco de o updater continuar não validado. Não é um GO automático nem uma publicação já autorizada.

Procedimento proposto: entregar instalador, `.sig`, chave pública por canal confiável e SHA-256; conferir identidade/origem e assinatura antes de executar; fechar o aplicativo; fazer backup dos dados locais reais em local privado do próprio usuário; instalar no mesmo contexto/destino; verificar versão 1.4.4, abertura e dados; manter cópia do instalador anterior e do backup. **Não desinstalar com remoção de dados como atalho.** Reverter executável não garante compatibilidade dos dados; restauração do backup e eventual reinstalação de 1.4.3 precisam de validação separada.

Riscos explícitos:

- Descoberta automática, adiamento, download, handoff NSIS, reinício e persistência durante upgrade permanecem sem comprovação; a instalação manual não encerra esse requisito.
- `Get-AuthenticodeSignature` do candidato retornou **NotSigned** nesta missão. Minisign válida não equivale a assinatura Authenticode de editor reconhecido pelo Windows. SmartScreen/UAC podem apresentar alertas; não instruir a desabilitar proteções globalmente.
- Duplo clique no NSIS **não executa automaticamente a verificação Minisign do Tauri**. Hash sozinho comprova integridade apenas quando comparado com referência recebida por canal confiável. A verificação separada de assinatura/origem é necessária.
- Troca de contexto de instalação, aplicativo aberto, arquivos bloqueados, atalhos duplicados ou perda de dados locais ainda são riscos não testados no salto real. Backup e suporte de recuperação devem estar preparados antes de oferecer a alternativa.
- O canal público pode continuar indicando uma versão anterior; não apresentar distribuição manual como prova de atualização automática ou de rollback automático. Nenhum endpoint público foi consultado novamente ou alterado nesta missão.

**Conclusão desta missão: NO-GO — ambiente isolado indisponível.** A alternativa manual é uma decisão futura do proprietário; não foi selecionada nem autorizada para distribuição.
