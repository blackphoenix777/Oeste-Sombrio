# Autenticação

O app usa Supabase Auth no projeto Oeste Sombrio (`jxxhdqoyblykqiiyptsp`), conexão Primary. A configuração em `dist/js/supabaseConfig.js` contém somente a chave pública.

Login e cadastro existentes usam o cliente único. Ao iniciar, a sessão é recuperada pelo SDK e o usuário é validado com `auth.getUser()`. O perfil local antigo não autoriza acesso. Home e ficha exigem sessão validada; abrir mesa revalida o usuário. Logout e eventos SIGNED_OUT bloqueiam as telas e encerram o realtime. A opção Lembrar de mim usa localStorage; sem ela o token fica em sessionStorage.

A migração remota `require_auth_for_event_reads` restringe a leitura de eventos ao papel authenticated. Todas as tabelas públicas existentes têm RLS ativado. A proteção das telas é navegação; as políticas do banco continuam responsáveis pela autorização dos dados. Os arquivos locais do Tauri continuam pertencendo ao usuário do computador.

Verificação: `node tests/auth-session.cjs`. Foram testados perfil falsificado, sessão ausente, usuário validado, logout, revogação, usuário anônimo e identidade divergente. Uma consulta com o papel anon confirmou zero eventos visíveis. Login real e entrega dos e-mails precisam de uma conta de teste; não foram executados. O teste visual `tests/mesa-6b.cjs` falhou na inicialização da GPU do Chrome neste ambiente.

O verificador do Supabase ainda indica avisos preexistentes em funções SECURITY DEFINER, search_path de handle_new_user, extensão pg_net e proteção de senhas vazadas. Esta alteração não constitui uma auditoria completa das regras de mesas e membros.
