# Teste opcional de Storage e Realtime reais

Requer autorização explícita para criar duas contas descartáveis de teste e uma mesa temporária no projeto `jxxhdqoyblykqiiyptsp`. Não usa senhas, sessões nem mesas de usuários existentes; não envia emails.

Preparação: gerar dois UUIDs, um UUID de mesa e uma senha aleatória em um arquivo temporário fora do repositório. Criar somente esses usuários de teste em `auth.users`/`auth.identities`, com emails únicos no domínio reservado `example.test`; o trigger existente cria seus perfis. Criar a mesa temporária e os dois vínculos (Mestre e jogador).

Execução: `node tests/live-maps.cjs <arquivo-temporario.json>`.

O script faz login nas duas contas descartáveis, envia três PNGs sintéticos de cores diferentes aos slots 1/2/3, substitui somente o slot 2, verifica leituras autorizadas/negadas de imagens e tokens, assina Realtime como jogador e move a flâmula pelo Mestre. Não altera mesas reais existentes.

Limpeza obrigatória: o bloco `finally` remove somente os três caminhos registrados na mesa temporária, exclui somente essa mesa e encerra as sessões das duas contas. Depois, o chamador remove de `auth.users` apenas os dois UUIDs gerados, com conferência adicional dos emails de teste; cascatas removem identidades/perfis/sessões. Verificar contagem zero para mesa, usuários e arquivos desses IDs. Apagar o arquivo temporário de credenciais. Se qualquer limpeza falhar, concluir essa limpeza antes de encerrar o trabalho.

A revisão automática bloqueou a primeira tentativa de preparação antes de qualquer criação. Após autorização explícita em 11/11/2026, o procedimento foi executado: 13 verificações reais passaram e a limpeza de todos os recursos temporários foi confirmada. Consulte `database/multiple-maps-validation.md` e `tests/artifacts/live-maps-results.json`.
