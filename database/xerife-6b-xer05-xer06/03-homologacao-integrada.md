# OESTE SOMBRIO 2.0 — PACOTE 5: HOMOLOGAÇÃO INTEGRADA (XER-04, XER-05 E XER-06)

**Data:** 18/11/2026  
**Ambiente Homologado:** `igyupxczhczidfgtjiws` (`Oeste Sombrio Homologação`, PostgreSQL `17.12.0.000`, `us-east-1`)  
**Produção (`jxxhdqoyblykqiiyptsp`):** **INTOCADA** (`17` migrações, última `20261117151310`, zero alterações remotas)  
**Branch de Desenvolvimento:** `feature/xerife-6b-npc-boss` (base `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, versão pública `1.4.5` preservada)

---

## 1. Vereditos Individuais

| Entrega | Classificação | Justificativa Objetiva |
|---|---|---|
| **XER-04 (Editor de 6B Próprio)** | **`APROVADO`** | Editor `1..15` dados (`d4..d12`), independência do checkbox Criatura, preservação de iniciativa/ações/Turn Tracker, persistência em `public.fichas` / `mesas.npcs_mesa` e uso real no Tauri Dev validados integralmente sem pendências. |
| **XER-05 (Persistência por Instância)** | **`APROVADO`** | Isolamento `(mesa_id, instance_id)` entre múltiplos Bosses do mesmo molde, preservação ante edição de molde e troca de mapa (`trg_mesa_tokens_sync_6b_instancia`), remoção individual (`remover_6b_instancia`), reconexão (`ler_6b_instancia` / `refreshInstanceOwn6B`) e Realtime `INSERT`/`UPDATE` validados integralmente em Homologação e Tauri Dev. |
| **XER-06 (Combate por Instância)** | **`APROVADO COM RESSALVAS`** | Rolagem no servidor (`0A000` em duplicidade), consumo atômico, dano com escolha do defensor (`#defender-damage-modal` + `aplicar_dano_6b_instancia` como defensor designado e Mestre), fadiga em cascata (`zeradosPorFadiga` separado de `bloqueados`), renovação pós-esgotamento (`55000` antes, `+1` fadiga após), idempotência (`opId` + retenção 64) e isolamento RLS (`42501`) aprovados em Homologação. **Ressalva crítica:** em corrida concorrente simultânea via HTTP/PostgREST (`C2-3b` e `C2-10b`), o servidor preservou 100% da atomicidade (`1` vencedor, sem dupla dedução), **porém** `SQLSTATE 40001` acionou o loop automático de retry do PostgREST (~120 s até `504 upstream request timeout`) em vez de retornar `409 Conflict` imediato (`SQLSTATE P0409`). |

---

## 2. Fase A & B — Backup Pré-Migração, Aplicação e Validação Estrutural (`igyupxczhczidfgtjiws`)

### 2.1 Backup Lógico Pré-Migração (Fora do Git)
- **Diretório privado:** `C:\Users\Stéfano\AppData\Local\OesteSombrio\backups\homolog-igyupxczhczidfgtjiws-20261118-112808` (ACL NTFS restrita, fora do Git).
- **Artefatos gerados via `supabase db dump --remote=igyupxczhczidfgtjiws`:**
  - `roles.sql` (`297` bytes, SHA-256 `42A9940ED87DFDB8D290F1F4ACF0A05DB03402DF9C94BBF7C87D34C2091D7786`)
  - `app_schema.sql` (SHA-256 `20F0AE75592A4C6657D0A0B5B4378D7C358E6E86F88AA28E0E89669A194C10C0`)
  - `app_data.sql` (SHA-256 `10810B2A41F6BCBACA7E7EA0CD7DAB21FF6279F8FBD9A930B212F94DCAA232AF`)
  - `schema.sql` (`143.602` bytes), `data.sql` (`46.924` bytes), `migrations_data.sql` (`24.636` bytes)
- **Prova de restauração pré-deploy (`public.ecr.aws/supabase/postgres:17.12.0.000`):**
  - `ROLES=0`, `SCHEMA=0`, `DATA=0`, `COUNTS=7|2|4|3|9|9|2|mesa_6b_aberto|xerife_6b.conjuntos`, ensaio da migração `20261118101800` sobre o backup restaurado `EXIT=0`.

### 2.2 Aplicação Controlada da Migração
- **Migração aplicada:** `supabase/migrations/20261118101800_xerife_6b_instance_combat.sql` (`47.968` bytes)
- **Hash SHA-256:** `7A8D54C0E28A2F9D40FEAD1B1C9063070904FC59D2A64DC5C6913AC2F8CB3A0B`
- **Procedimento executado:** `--workdir` isolado contendo apenas as `2` versões já registradas em Homologação (`20261116214200_homologacao_144_mapas_notas.sql` + `20261117151310_xerife_6b_foundation.sql`) e a migração candidata `20261118101800_xerife_6b_instance_combat.sql`, após `--dry-run` confirmar apenas `20261118101800_xerife_6b_instance_combat.sql`:
  ```powershell
  & $sb db push --workdir $homologWork --remote=igyupxczhczidfgtjiws --skip-vault --yes
  ```
  Resultado: `HOMOLOG_DB_PUSH_EXIT=0`, `"migrations":["20261118101800_xerife_6b_instance_combat.sql"]`.

### 2.3 Estado Anterior vs. Posterior (Validação Estrutural B3)

| Item Verificado | Antes (Homologação) | Depois (Homologação) |
|---|---|---|
| **Migrações (`schema_migrations`)** | `2` (`20261116214200`, `20261117151310`) | `3` (`20261116214200`, `20261117151310`, `20261118101800`) |
| **Tabelas XER-05/06** | Ausentes | `public.mesa_6b_instancia` (RLS ativo, `1` policy `mesa_6b_instancia_leitura`) + `xerife_6b.instancia_operacoes` (RLS ativo, `0` policies) |
| **Grants nas Tabelas** | — | `mesa_6b_instancia`: apenas `SELECT` para `authenticated`. `instancia_operacoes`: zero grants para `PUBLIC`, `anon`, `authenticated`. |
| **Trigger e Índices** | — | Trigger `trg_mesa_tokens_sync_6b_instancia` em `public.mesa_tokens`; `5` índices criados (`PKs` + `3` secundários). |
| **Funções e Wrappers** | `7` em `xerife_6b` + `5` em `public` (P0-2) | Adicionadas `16` funções em `xerife_6b` + `9` wrappers `SECURITY INVOKER` em `public` (`*_6b_instancia`), **todas com `search_path=""`** (`auth_exec=true` só nas 9 operacionais, `anon_exec=false` em todas, helpers internos com `auth_exec=false`). |
| **Publicação Realtime (`supabase_realtime`)** | `9` tabelas (`puballtables = false`) | `10` tabelas (adicionada apenas `public.mesa_6b_instancia`; `instancia_operacoes` ausente). |
| **Dados preexistentes** | `7` usuários, `2` mesas, `4` membros, `3` fichas, `9` tokens, `9` `mesa_token_status` | **100% preservados**. |

---

## 3. Fase C — Testes Reais em Homologação (`tests/live-xerife-6b-instances.cjs`)

Executado via HTTP PostgREST, GoTrue Auth e WebSocket Realtime reais contra `https://igyupxczhczidfgtjiws.supabase.co` com 5 personas (`gmA`, `gmA2`, `defenderA`, `playerA`, `gmB`, além de `anon`):

- **C1 (XER-05):** `C1-1..C1-5 PASS` — Dois Bosses do mesmo molde inicializados independentemente (`15` dados e `5` dados); consumo no `#1` preservou `#2` em `versao=0`; edição do molde em `fichas` para `2d6` preservou pool vivo de `15` dados do `#1`; mudança de mapa sincronizou `mapaId` via trigger preservando `versao` e `consumidos`; exclusão do token/instância `#1` preservou `#2` e molde.
- **C2 (XER-06):** `C2-1, C2-2, C2-3a, C2-4, C2-5, C2-6, C2-7, C2-8, C2-9, C2-10a, C2-11 PASS` — Rolagem inicial no servidor e bloqueio de 2ª rolagem (`0A000`); duplo consumo bloqueado (`22023`); dano aplicado diretamente pela sessão real do defensor `defenderA` escolhendo `[1, 4]`, com sincronização automática de `mesa_token_status` (`six_b_total=5, danos_bloqueados=2`) e bloqueio de repetição (`22023`); fadiga em cascata reduzindo maiores dados intactos sem confundir com `bloqueados`; bloqueio de renovação antes de esgotar (`55000`); renovação com `+1` fadiga preservando `[1, 4]`; replay idempotente pelo mesmo `opId` retornando `idempotentReplay=true` sem duplicar fadiga; corridas concorrentes (`C2-3a` e `C2-10a`) garantiram exatamente `1` vencedor sem dupla dedução nem dupla fadiga.
- **C3 (Segurança / RLS Real no Banco):** `C3-1..C3-5 PASS` — Nem `gmA` altera `mesa_6b_instancia` por `UPDATE` direto (`42501`); `playerA` recebe `0` linhas via `SELECT`, `[]` via `ler_6b_instancia(NULL)`, `42501` via RPC específica e `0` linhas ao tentar sequestrar `owner_user_id` em `mesa_tokens`; `defenderA` é bloqueado de `consumir`/`renovar` (`42501`); `gmB` (outra mesa) e `anon` são bloqueados (`42501`); `xerife_6b.instancia_operacoes` e `ler_6b_xerife(..., 'secreto')` bloqueados para não-Mestre.
- **C4 (Realtime WebSocket):** `C4-1..C4-3 PASS` — `gmA2` recebeu `INSERT`/`UPDATE` via WebSocket autenticado; `defenderA` recebeu eventos apenas de `boss2` (seu token) e zero eventos de `boss1` secreto; `playerA` e `gmB` receberam `0` eventos; reconexão do canal WebSocket + `ler_6b_instancia` recuperaram `versao=7` completa.

---

## 4. Fase D — Testes Reais no Tauri Dev e Regressões Locais

1. **Tauri Dev (`npm run tauri dev` + WebView2 CDP, apontamento em memória para `igyupxczhczidfgtjiws`):**
   - `15/15 PASS`, `appVer = "1.4.5"`, `uncaughtExceptions = 0`.
   - Validou `supabaseConfig.js` apontando para Produção em disco, override seguro apenas em memória para Homologação, login real, abertura de mesa + Realtime, criação de Boss com `15` dados no Editor XER-04 (`isCriatura=false`), persistência em `public.fichas` e `npcs_mesa`, instanciação de 2 Bosses em cena (`#1` e `#2`), rolagem/consumo RPC reais, escolha de dados `[2, 3]` no modal `#defender-damage-modal`, fadiga em cascata, renovação (`+1` fadiga preservando `[2, 3]` e `#2` em `versao=0`), troca de mapa (`changeMesaMap`), reconexão Realtime (`reconnectMesaRealtimeNow` + `refreshInstanceOwn6B`) e orçamento do Turn Tracker (`operationalMode="full_sheet"`).
2. **Bateria pós-edição (JS syntax + 17 suítes automatizadas, executadas após a edição final em `dist/js/mesaScreen.js`):**
   - Sintaxe ES module: `44/44` arquivos `.js` OK.
   - `tests/xerife-6b-xer04-own-editor.cjs`: `31/31 PASS`
   - `tests/xerife-6b-xer05-instance-persistence.cjs`: `10/10 PASS`
   - `tests/xerife-6b-xer06-instance-combat.cjs`: `27/27 PASS`
   - `tests/xerife-6b-pg17-sql-rls.cjs`: `11/11` blocos PostgreSQL 17 reais (`EXIT=0`)
   - `13/13` suítes de regressão existentes (`com03-com04`, `com05-com06`, `com07-com08`, `xerife-6b-ui`, `mesa-6b`, `mesa-p0-interactions`, `gm-tools-ui`, `multiple-maps-ui`, `turn-tracker-ui`, `token-initiative`, `scene-read`, `map-camera`, `auth-session`): **todas `EXIT=0`**.

---

## 5. Problema Real Identificado, Correção Local e Riscos Remanescentes

### 5.1 Defeito Real Detectado em Corrida Concorrente via PostgREST (`C2-3b` e `C2-10b`)
- **Observação real:** Nos logs do PostgreSQL da Homologação (`postgres_logs`), a corrida `Promise.all` lançou imediatamente `Versão desatualizada` (`SQLSTATE 40001`), preservando 100% da integridade dos dados. Entretanto, o **PostgREST** trata `SQLSTATE 40001` (`serialization_failure`) como falha transitória e reexecuta a requisição em loop (~1 vez/s por ~120 s) até o API Gateway encerrar com `504 upstream request timeout`.
- **Causa raiz e comparação:** Em `20261116210603_com05_com08_combat_state_and_actions.sql` (`gerenciar_acao_combate`), conflitos de versão usam `SQLSTATE P0409` (`409 Conflict`), que falha rápido no PostgREST sem retry.
- **Correção realizada localmente nesta etapa:** [dist/js/mesaScreen.js](file:///c:/Users/Stéfano/Desktop/ficha%20dark%20westy/dist/js/mesaScreen.js#L936) e [dist/js/mesaScreen.js](file:///c:/Users/Stéfano/Desktop/ficha%20dark%20westy/dist/js/mesaScreen.js#L1492) passaram a tratar ambos `40001` e `P0409` (além de resincronizar estado em caso de `upstream request timeout`).
- **Ação obrigatória antes de Produção:** Autorizar uma migração corretiva pequena alterando `ERRCODE = '40001'` para `ERRCODE = 'P0409'` nas 6 funções `xerife_6b.*_instancia` em Homologação, revalidar `C2-3b` e `C2-10b` com retorno imediato `< 1 s`, e só então gerar a migração consolidada para Produção (em conjunto com a recomendação equivalente para `xerife_6b.*` de P0-2 e `gerenciar_combate`).

### 5.2 Estado Final de Homologação (`igyupxczhczidfgtjiws`) e Dados Efêmeros de Teste
- `mesas` (`2`), `membros_mesa` (`4`), `mesa_tokens` (`9`), `mesa_token_status` (`9`), `mesa_6b_instancia` (`0`) e `xerife_6b.instancia_operacoes` (`0`) permaneceram limpos após a execução.
- Por limitação do cliente MCP (`execute_sql` cancelou automaticamente a instrução `DELETE` em `0.3 s` sem confirmação interativa), permaneceram na base de Homologação apenas as `4` contas QA efêmeras (`0858f08e-8067-41f3-b839-465f1e24f786`, `cc6b0102-0000-4000-8000-000000000002`, `cc6b0103-0000-4000-8000-000000000003`, `cc6b0104-0000-4000-8000-000000000004`) e `1` ficha molde de teste (`Boss Tauri Homolog`, ID `03934347-f8fe-42c9-a132-3cfb690ab7bc`) sem vínculo com nenhuma mesa real. O arquivo de configuração temporário local (`%TEMP%\homolog-xer-qa.json`) foi removido.

---

## 6. Estado Git e Prontidão para Produção

- **Estado Git:** Branch `feature/xerife-6b-npc-boss`, base `496202e0dfbd6cc6a3dc09fba86c7377c0c063ab`, zero commits adicionais, zero `git push`, zero tags/releases, `supabaseConfig.js`, `src-tauri/tauri.conf.json` (`1.4.5`) e `package.json` (`1.4.5`) com `git diff` vazio.
- **Prontidão para Produção (`jxxhdqoyblykqiiyptsp`):** **BLOQUEADA até aplicação e validação da correção `SQLSTATE 40001 -> P0409` nas RPCs de instância em Homologação** (para eliminar a espera de ~120 s no PostgREST em conflito concorrente real). Após esse ajuste em Homologação e novo backup de Produção, o conjunto estará apto ao deploy controlado e futura release.
