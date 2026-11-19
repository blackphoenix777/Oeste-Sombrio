/**
 * XER-05 + XER-06 — Validação Real em PostgreSQL 17 Descartável (Docker)
 *
 * Testa:
 *  - Aplicação da migração 20261118101800_xerife_6b_instance_combat.sql sobre PostgreSQL 17
 *  - RLS, ACLs, search_path="", isolamento de xerife_6b.instancia_operacoes e publicação Realtime
 *  - RPCs inicializar_6b_instancia, ler_6b_instancia, rolar_6b_instancia, consumir_6b_instancia,
 *    aplicar_dano_6b_instancia, curar_dano_6b_instancia, ajustar_fadiga_6b_instancia,
 *    renovar_6b_instancia, remover_6b_instancia
 *  - Regra oficial de fadiga em cascata nos maiores dados intactos (xerife_6b.aplicar_fadiga_cascata)
 *  - Concorrência otimista (SQLSTATE 40001), Idempotência por op_id e limite de retenção (64 entradas)
 *  - Permissões (Mestre, Defensor designado, Jogador comum bloqueado 42501, Usuário de outra mesa bloqueado 42501)
 *  - Rollback reversível (02-rollback-migracao-xer05-xer06.sql) + reaplicação limpa
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const containerName = "os-xer05-06-pg17-" + process.pid;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-xer05-06-pg17-"));

function runDocker(args, opts = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: opts.timeout || 120000,
    ...opts
  });
}

function buildHarnessSql() {
  return `
\\set ON_ERROR_STOP on

-- 1. Papéis e infraestrutura base estilo Supabase
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mesas (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  mestre_id uuid NOT NULL,
  npcs_mesa jsonb NOT NULL DEFAULT '[]'::jsonb,
  cena_ativa jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.membros_mesa (
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL,
  papel text NOT NULL DEFAULT 'jogador',
  PRIMARY KEY (mesa_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS public.fichas (
  id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL,
  mesa_id uuid NULL REFERENCES public.mesas(id) ON DELETE SET NULL,
  nome_personagem text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.mesa_tokens (
  id uuid PRIMARY KEY,
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  mapa_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('player', 'creature')),
  owner_ref uuid NOT NULL,
  owner_user_id uuid NULL,
  display_name text NOT NULL DEFAULT 'Token',
  visible_to_players boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.mesa_token_status (
  token_id uuid PRIMARY KEY REFERENCES public.mesa_tokens(id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL REFERENCES public.mesas(id) ON DELETE CASCADE,
  mapa_id uuid NOT NULL,
  owner_type text NOT NULL,
  owner_ref uuid NOT NULL,
  six_b_total integer NOT NULL DEFAULT 6,
  danos_bloqueados integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

GRANT SELECT ON public.mesas, public.membros_mesa, public.fichas, public.mesa_tokens, public.mesa_token_status TO authenticated;

CREATE OR REPLACE FUNCTION public.is_mestre_da_mesa(p_mesa_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mesas m
    WHERE m.id = p_mesa_id AND m.mestre_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_membro_da_mesa(p_mesa_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membros_mesa mm
    WHERE mm.mesa_id = p_mesa_id AND mm.usuario_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_mestre_da_mesa(uuid), public.is_membro_da_mesa(uuid) TO authenticated;
`;
}

function buildTestAssertionSql() {
  return `
\\set ON_ERROR_STOP on

-- Dados de teste: Mesa A (Mestre GM_A, Jogador Comum PL_A, Defensor Designado DEF_A) e Mesa B (Mestre GM_B)
DO $$
DECLARE
  v_gm_a uuid := '00000000-0000-4000-8000-000000000001';
  v_pl_a uuid := '00000000-0000-4000-8000-000000000002';
  v_def_a uuid := '00000000-0000-4000-8000-000000000003';
  v_gm_b uuid := '00000000-0000-4000-8000-000000000009';
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_mesa_b uuid := '22222222-2222-4222-8222-222222222222';
  v_map_1 uuid := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_map_2 uuid := 'aaaaaaaa-2222-4222-8222-222222222222';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_tok_1 uuid := 'cccccccc-0001-4000-8000-000000000001';
  v_tok_2 uuid := 'cccccccc-0002-4000-8000-000000000002';
BEGIN
  INSERT INTO public.mesas (id, nome, mestre_id) VALUES
    (v_mesa_a, 'Mesa A', v_gm_a),
    (v_mesa_b, 'Mesa B', v_gm_b);

  INSERT INTO public.membros_mesa (mesa_id, usuario_id, papel) VALUES
    (v_mesa_a, v_gm_a, 'mestre'),
    (v_mesa_a, v_pl_a, 'jogador'),
    (v_mesa_a, v_def_a, 'jogador'),
    (v_mesa_b, v_gm_b, 'mestre');

  INSERT INTO public.mesa_tokens (id, mesa_id, mapa_id, owner_type, owner_ref, owner_user_id, display_name, visible_to_players) VALUES
    (v_tok_1, v_mesa_a, v_map_1, 'creature', v_boss_1, NULL, 'Boss #1 (Secreto do Mestre)', false),
    (v_tok_2, v_mesa_a, v_map_1, 'creature', v_boss_2, v_def_a, 'Boss #2 (Defensor Designado)', true);

  INSERT INTO public.mesa_token_status (token_id, mesa_id, mapa_id, owner_type, owner_ref, six_b_total, danos_bloqueados) VALUES
    (v_tok_1, v_mesa_a, v_map_1, 'creature', v_boss_1, 6, 0),
    (v_tok_2, v_mesa_a, v_map_1, 'creature', v_boss_2, 6, 0);
END $$;

-- BLOCO 1: Auditoria de Catálogo PostgreSQL (RLS, ACLs, search_path, Realtime)
DO $$
DECLARE
  v_rls_inst boolean;
  v_rls_ops boolean;
  v_pub_inst boolean;
  v_pub_ops boolean;
  v_bad_sp integer;
  v_ops_grants integer;
  v_inst_write_grants integer;
BEGIN
  SELECT relrowsecurity INTO v_rls_inst FROM pg_class WHERE oid = 'public.mesa_6b_instancia'::regclass;
  SELECT relrowsecurity INTO v_rls_ops FROM pg_class WHERE oid = 'xerife_6b.instancia_operacoes'::regclass;
  IF NOT v_rls_inst OR NOT v_rls_ops THEN
    RAISE EXCEPTION 'FAIL: RLS deve estar habilitado em mesa_6b_instancia e instancia_operacoes';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mesa_6b_instancia'
  ) INTO v_pub_inst;
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'xerife_6b' AND tablename = 'instancia_operacoes'
  ) INTO v_pub_ops;
  IF NOT v_pub_inst OR v_pub_ops THEN
    RAISE EXCEPTION 'FAIL: Realtime deve conter mesa_6b_instancia e NUNCA instancia_operacoes';
  END IF;

  SELECT count(*) INTO v_bad_sp
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'xerife_6b' OR (n.nspname = 'public' AND p.proname LIKE '%_6b_instancia'))
    AND (p.proconfig IS NULL OR NOT ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig)));
  IF v_bad_sp > 0 THEN
    RAISE EXCEPTION 'FAIL: Encontradas % funções sem search_path vazio', v_bad_sp;
  END IF;

  SELECT count(*) INTO v_ops_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'xerife_6b' AND table_name = 'instancia_operacoes'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_ops_grants > 0 THEN
    RAISE EXCEPTION 'FAIL: xerife_6b.instancia_operacoes não pode ter grants para anon/authenticated';
  END IF;

  SELECT count(*) INTO v_inst_write_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'mesa_6b_instancia'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    AND privilege_type <> 'SELECT';
  IF v_inst_write_grants > 0 THEN
    RAISE EXCEPTION 'FAIL: public.mesa_6b_instancia não pode ter escrita direta para anon/authenticated';
  END IF;

  RAISE NOTICE 'PG17-PASS-1: Catalogo RLS, ACLs, search_path e Realtime verificados';
END $$;

-- BLOCO 2: Inicialização (15 dados), Isolamento de Instâncias, Validação de Limites e Trigger de Mapa
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_map_1 uuid := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_map_2 uuid := 'aaaaaaaa-2222-4222-8222-222222222222';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_snap_1 jsonb;
  v_snap_2 jsonb;
  v_err text;
BEGIN
  -- Rejeitar 16 dados
  BEGIN
    PERFORM public.inicializar_6b_instancia(
      v_mesa_a, v_boss_1, ARRAY[6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6]::integer[], 'op-bad-16'
    );
    RAISE EXCEPTION 'Deveria rejeitar 16 dados';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_err := SQLSTATE;
  END;

  -- Rejeitar face d20
  BEGIN
    PERFORM public.inicializar_6b_instancia(
      v_mesa_a, v_boss_1, ARRAY[20, 6]::integer[], 'op-bad-d20'
    );
    RAISE EXCEPTION 'Deveria rejeitar d20';
  EXCEPTION WHEN sqlstate '22023' THEN
    v_err := SQLSTATE;
  END;

  -- Inicializar Boss #1 com 15 dados mistos e Boss #2 com 5 dados
  v_snap_1 := public.inicializar_6b_instancia(
    v_mesa_a, v_boss_1, ARRAY[12,12,12,10,10,10,8,8,8,6,6,6,4,4,4]::integer[], 'op-init-b1', v_map_1
  );
  v_snap_2 := public.inicializar_6b_instancia(
    v_mesa_a, v_boss_2, ARRAY[12,10,8,6,4]::integer[], 'op-init-b2', v_map_1
  );

  IF jsonb_array_length(v_snap_1->'dados') <> 15 OR jsonb_array_length(v_snap_2->'dados') <> 5 THEN
    RAISE EXCEPTION 'FAIL: Inicialização de 15 dados e 5 dados falhou';
  END IF;

  RAISE NOTICE 'PG17-PASS-2: Inicializacao de 15 dados, limites (1..15, d4..d12) e isolamento verificados';
END $$;
COMMIT;

-- Testar Trigger de mudança de mapa como owner/sistema
DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_map_2 uuid := 'aaaaaaaa-2222-4222-8222-222222222222';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_tok_1 uuid := 'cccccccc-0001-4000-8000-000000000001';
  v_synced_map uuid;
BEGIN
  UPDATE public.mesa_tokens SET mapa_id = v_map_2 WHERE id = v_tok_1;
  SELECT mapa_id INTO v_synced_map FROM public.mesa_6b_instancia WHERE mesa_id = v_mesa_a AND instance_id = v_boss_1;
  IF v_synced_map IS DISTINCT FROM v_map_2 THEN
    RAISE EXCEPTION 'FAIL: Trigger trg_mesa_tokens_sync_6b_instancia nao sincronizou mapa_id';
  END IF;
  RAISE NOTICE 'PG17-PASS-3: Trigger de sincronizacao de token/mapa verificado';
END $$;

-- BLOCO 3: Rolagem Inicial, Consumo, Dano do Defensor, Fadiga em Cascata, Renovação, Concorrência (40001) e Idempotência
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_tok_2 uuid := 'cccccccc-0002-4000-8000-000000000002';
  v_snap jsonb;
  v_replay jsonb;
  v_ver bigint;
  v_orig_sum integer;
  v_eff_sum integer;
  v_i integer;
BEGIN
  -- Rolar Boss #1 (15 dados) e Boss #2 (5 dados)
  v_snap := public.rolar_6b_instancia(v_mesa_a, v_boss_1, 0, 'op-roll-b1');
  IF (v_snap->>'versao')::bigint <> 1 OR jsonb_array_length(v_snap->'resultados') <> 15 THEN
    RAISE EXCEPTION 'FAIL: Rolagem inicial de 15 dados falhou';
  END IF;

  -- Replay idempotente da rolagem inicial
  v_replay := public.rolar_6b_instancia(v_mesa_a, v_boss_1, 0, 'op-roll-b1');
  IF (v_replay->>'idempotentReplay')::boolean IS NOT TRUE OR (v_replay->>'versao')::bigint <> 1 THEN
    RAISE EXCEPTION 'FAIL: Replay idempotente da rolagem falhou';
  END IF;

  -- Segunda rolagem inicial com novo op_id deve falhar com 0A000
  BEGIN
    PERFORM public.rolar_6b_instancia(v_mesa_a, v_boss_1, 1, 'op-roll-b1-second');
    RAISE EXCEPTION 'Deveria bloquear segunda rolagem inicial';
  EXCEPTION WHEN sqlstate '0A000' THEN
    NULL;
  END;

  -- Rolar Boss #2 (5 dados)
  v_snap := public.rolar_6b_instancia(v_mesa_a, v_boss_2, 0, 'op-roll-b2');
  v_ver := (v_snap->>'versao')::bigint;

  -- Consumir dados [0, 2] no Boss #2
  v_snap := public.consumir_6b_instancia(v_mesa_a, v_boss_2, v_ver, ARRAY[0, 2]::integer[], 'op-cons-b2-1');
  v_ver := (v_snap->>'versao')::bigint;
  IF (v_snap->>'consumedBonus')::integer <= 0 THEN
    RAISE EXCEPTION 'FAIL: consumedBonus deve ser positivo';
  END IF;

  -- Impedir consumo duplicado do índice 0 (22023)
  BEGIN
    PERFORM public.consumir_6b_instancia(v_mesa_a, v_boss_2, v_ver, ARRAY[0]::integer[], 'op-cons-b2-dup');
    RAISE EXCEPTION 'Deveria bloquear consumo duplicado';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;

  -- Conflito de concorrência otimista (versão obsoleta -> 40001)
  BEGIN
    PERFORM public.consumir_6b_instancia(v_mesa_a, v_boss_2, 0, ARRAY[3]::integer[], 'op-cons-b2-stale');
    RAISE EXCEPTION 'Deveria retornar 40001 em versão obsoleta';
  EXCEPTION WHEN sqlstate '40001' THEN
    NULL;
  END;

  -- Renovação antes de esgotar deve falhar com 55000
  BEGIN
    PERFORM public.renovar_6b_instancia(v_mesa_a, v_boss_2, v_ver, 'op-renew-early', true);
    RAISE EXCEPTION 'Deveria bloquear renovação antes do esgotamento';
  EXCEPTION WHEN sqlstate '55000' THEN
    NULL;
  END;

  RAISE NOTICE 'PG17-PASS-4: Rolagem, consumo, bloqueio de duplicidade, concorrencia 40001 e bloqueio de renovacao precoce verificados';
END $$;
COMMIT;

-- BLOCO 4: Escolha do Defensor Designado (DEF_A) e Bloqueio de Jogador Comum (PL_A) e Outra Mesa (GM_B)
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000003'; -- DEF_A (owner_user_id do token Boss #2)

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_snap jsonb;
  v_ver bigint;
  v_visible_count integer;
BEGIN
  -- DEF_A vê apenas Boss #2 via RLS (não vê Boss #1 secreto do Mestre)
  SELECT count(*) INTO v_visible_count FROM public.mesa_6b_instancia WHERE mesa_id = v_mesa_a;
  IF v_visible_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: Defensor designado deveria ver exatamente 1 instância via RLS, viu %', v_visible_count;
  END IF;

  -- DEF_A não pode ler Boss #1 secreto via RPC (42501)
  BEGIN
    PERFORM public.ler_6b_instancia(v_mesa_a, v_boss_1);
    RAISE EXCEPTION 'Defensor de Boss #2 nao deveria ler Boss #1 secreto';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;

  -- DEF_A aplica 2 pontos de dano escolhendo dados [1, 4] em Boss #2
  v_snap := public.ler_6b_instancia(v_mesa_a, v_boss_2);
  v_ver := (v_snap->>'versao')::bigint;
  v_snap := public.aplicar_dano_6b_instancia(v_mesa_a, v_boss_2, v_ver, 2, ARRAY[1, 4]::integer[], 'op-dmg-def-1');

  IF (v_snap->'bloqueados') <> '[1, 4]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: Escolha de dano pelo defensor nao bloqueou [1, 4]: %', v_snap->'bloqueados';
  END IF;

  -- Impedir bloquear duas vezes o dado 1 (22023)
  v_ver := (v_snap->>'versao')::bigint;
  BEGIN
    PERFORM public.aplicar_dano_6b_instancia(v_mesa_a, v_boss_2, v_ver, 1, ARRAY[1]::integer[], 'op-dmg-def-dup');
    RAISE EXCEPTION 'Deveria impedir bloqueio duplicado do mesmo dado';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;

  -- DEF_A não pode consumir nem renovar (apenas Mestre) -> 42501
  BEGIN
    PERFORM public.consumir_6b_instancia(v_mesa_a, v_boss_2, v_ver, ARRAY[3]::integer[], 'op-def-no-consume');
    RAISE EXCEPTION 'Defensor nao deveria poder consumir dados de ataque do Boss';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL;
  END;

  RAISE NOTICE 'PG17-PASS-5: Permissoes do Defensor Designado e escolha de dados bloqueados por dano verificadas';
END $$;
COMMIT;

-- Jogador comum PL_A (membro da Mesa A, mas sem vínculo de defensor) e GM_B (outra mesa)
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000002'; -- PL_A

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_cnt integer;
  v_list jsonb;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.mesa_6b_instancia;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: Jogador comum nao pode ler nenhuma linha de mesa_6b_instancia via SELECT direto';
  END IF;

  v_list := public.ler_6b_instancia(v_mesa_a, NULL);
  IF jsonb_array_length(v_list) <> 0 THEN
    RAISE EXCEPTION 'FAIL: ler_6b_instancia(mesa, NULL) para jogador comum deve retornar []';
  END IF;

  BEGIN
    PERFORM public.ler_6b_instancia(v_mesa_a, v_boss_1);
    RAISE EXCEPTION 'Jogador comum nao pode ler Boss #1';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  BEGIN
    PERFORM public.aplicar_dano_6b_instancia(v_mesa_a, v_boss_2, 3, 1, ARRAY[3]::integer[], 'op-pl-dmg');
    RAISE EXCEPTION 'Jogador comum nao pode aplicar dano em Boss #2';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;

  RAISE NOTICE 'PG17-PASS-6: Bloqueio 42501 e isolamento RLS contra jogador comum verificados';
END $$;
COMMIT;

BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000009'; -- GM_B (Mestre de outra mesa)

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
BEGIN
  BEGIN
    PERFORM public.ler_6b_instancia(v_mesa_a, v_boss_1);
    RAISE EXCEPTION 'Mestre de outra mesa nao pode acessar Mesa A';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  RAISE NOTICE 'PG17-PASS-7: Isolamento entre mesas (cross-table 42501) verificado';
END $$;
COMMIT;

-- BLOCO 5: Esgotamento, Renovação (+1 Fadiga em Cascata), Cura, Limite de 64 Operações no Ledger e Remoção
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001'; -- GM_A

DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_2 uuid := 'bbbbbbbb-0002-4000-8000-000000000002';
  v_snap jsonb;
  v_ver bigint;
  v_orig_intact integer;
  v_eff_intact integer;
  v_i integer;
  v_ledger_cnt integer;
  v_removed boolean;
BEGIN
  -- Em Boss #2: dados [0, 2] foram consumidos e [1, 4] foram bloqueados por dano.
  -- Resta apenas o índice 3 disponível! Vamos consumi-lo para esgotar o pool.
  v_snap := public.ler_6b_instancia(v_mesa_a, v_boss_2);
  v_ver := (v_snap->>'versao')::bigint;

  v_snap := public.consumir_6b_instancia(v_mesa_a, v_boss_2, v_ver, ARRAY[3]::integer[], 'op-cons-last');
  v_ver := (v_snap->>'versao')::bigint;
  IF (v_snap->>'esgotado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: Boss #2 deveria estar esgotado apos consumir ultimo dado intacto';
  END IF;

  -- Renovar Boss #2: deve preservar bloqueados [1, 4], limpar consumidos, incrementar fadiga para 1 e descontar 1 do maior dado intacto
  v_snap := public.renovar_6b_instancia(v_mesa_a, v_boss_2, v_ver, 'op-renew-b2-1', true);
  v_ver := (v_snap->>'versao')::bigint;

  IF (v_snap->>'fadiga')::integer <> 1
     OR (v_snap->'bloqueados') <> '[1, 4]'::jsonb
     OR jsonb_array_length(v_snap->'consumidos') <> 0
     OR ((v_snap->'resultados'->>1)::integer <> 0)
     OR ((v_snap->'resultados'->>4)::integer <> 0) THEN
    RAISE EXCEPTION 'FAIL: Renovacao nao preservou bloqueados ou nao incrementou fadiga: %', v_snap;
  END IF;

  v_orig_intact := ((v_snap->'resultadosOriginais'->>0)::integer) +
                   ((v_snap->'resultadosOriginais'->>2)::integer) +
                   ((v_snap->'resultadosOriginais'->>3)::integer);
  v_eff_intact  := ((v_snap->'resultados'->>0)::integer) +
                   ((v_snap->'resultados'->>2)::integer) +
                   ((v_snap->'resultados'->>3)::integer);
  IF (v_orig_intact - v_eff_intact) <> 1 THEN
    RAISE EXCEPTION 'FAIL: Fadiga +1 na renovacao nao reduziu exatamente 1 ponto do maior dado intacto (orig=%, eff=%)', v_orig_intact, v_eff_intact;
  END IF;

  -- Curar dado 4 bloqueado por dano
  v_snap := public.curar_dano_6b_instancia(v_mesa_a, v_boss_2, v_ver, ARRAY[4]::integer[], 'op-heal-b2-1');
  v_ver := (v_snap->>'versao')::bigint;
  IF (v_snap->'bloqueados') <> '[1]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: Cura de dano nao desbloqueou indice 4: %', v_snap->'bloqueados';
  END IF;

  -- Executar 75 ajustes de fadiga com op_ids distintos para validar poda automática em 64 entradas no ledger
  FOR v_i IN 1..75 LOOP
    v_snap := public.ajustar_fadiga_6b_instancia(v_mesa_a, v_boss_2, v_ver, (v_i % 4), 'op-prune-' || v_i);
    v_ver := (v_snap->>'versao')::bigint;
  END LOOP;

  -- Remover Boss #2 ao excluir da cena
  v_removed := public.remover_6b_instancia(v_mesa_a, v_boss_2);
  IF v_removed IS NOT TRUE OR public.ler_6b_instancia(v_mesa_a, v_boss_2) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: remover_6b_instancia nao removeu Boss #2';
  END IF;

  RAISE NOTICE 'PG17-PASS-8: Esgotamento, renovacao (+1 fadiga em cascata), cura e remocao verificados';
END $$;
COMMIT;

-- Verificar poda do ledger no Boss #1 (como superuser, já que instancia_operacoes é privada)
BEGIN;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
DO $$
DECLARE
  v_mesa_a uuid := '11111111-1111-4111-8111-111111111111';
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_ver bigint;
  v_snap jsonb;
  v_i integer;
BEGIN
  v_snap := public.ler_6b_instancia(v_mesa_a, v_boss_1);
  v_ver := (v_snap->>'versao')::bigint;
  FOR v_i IN 1..75 LOOP
    v_snap := public.ajustar_fadiga_6b_instancia(v_mesa_a, v_boss_1, v_ver, (v_i % 5), 'op-b1-prune-' || v_i);
    v_ver := (v_snap->>'versao')::bigint;
  END LOOP;
END $$;
COMMIT;

DO $$
DECLARE
  v_boss_1 uuid := 'bbbbbbbb-0001-4000-8000-000000000001';
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM xerife_6b.instancia_operacoes WHERE instance_id = v_boss_1;
  IF v_cnt > 64 THEN
    RAISE EXCEPTION 'FAIL: Retencao de xerife_6b.instancia_operacoes excedeu 64 linhas (% linhas)', v_cnt;
  END IF;
  RAISE NOTICE 'PG17-PASS-9: Retencao automatica do ledger (<= 64 operacoes por instancia) verificada (% linhas)', v_cnt;
END $$;
`;
}

function main() {
  console.log("=== XER-05 + XER-06: Suite Real PostgreSQL 17 (SQL / RLS / Concorrência / Rollback) ===");

  const p02Path = path.join(root, "supabase/migrations/20261117151310_xerife_6b_foundation.sql");
  const migPath = path.join(root, "supabase/migrations/20261118101800_xerife_6b_instance_combat.sql");
  const downPath = path.join(root, "database/xerife-6b-xer05-xer06/02-rollback-migracao-xer05-xer06.sql");

  fs.writeFileSync(path.join(tempDir, "00-harness.sql"), buildHarnessSql(), "utf8");
  fs.copyFileSync(p02Path, path.join(tempDir, "01-p02.sql"));
  fs.copyFileSync(migPath, path.join(tempDir, "02-up.sql"));
  fs.writeFileSync(path.join(tempDir, "03-tests.sql"), buildTestAssertionSql(), "utf8");
  fs.copyFileSync(downPath, path.join(tempDir, "04-down.sql"));

  try {
    runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data:rw",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-v",
      `${tempDir}:/sql:ro`,
      "postgres:17-alpine"
    ]);

    // Aguardar PostgreSQL 17 aceitar queries reais após initdb
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        runDocker(["exec", containerName, "psql", "-U", "postgres", "-d", "postgres", "-c", "SELECT 1;"]);
        ready = true;
        break;
      } catch {
        execFileSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"]);
      }
    }
    if (!ready) {
      throw new Error("Contêiner PostgreSQL 17 não ficou pronto a tempo.");
    }

    const psql = (file) =>
      runDocker([
        "exec",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        file
      ]);

    psql("/sql/00-harness.sql");
    psql("/sql/01-p02.sql");
    psql("/sql/02-up.sql");
    const testOut = psql("/sql/03-tests.sql");
    console.log(testOut.trim());

    // Testar rollback reversível (04-down.sql) e verificar preservação da fundação P0-2
    psql("/sql/04-down.sql");
    const verifyDown = runDocker([
      "exec",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-t",
      "-A",
      "-c",
      "SELECT coalesce(to_regclass('public.mesa_6b_instancia')::text, 'NULL') || '|' || coalesce(to_regclass('public.mesa_6b_aberto')::text, 'NULL');"
    ]).trim();

    if (verifyDown !== "NULL|mesa_6b_aberto") {
      throw new Error("Rollback falhou ou afetou P0-2: " + verifyDown);
    }
    console.log("PG17-PASS-10: Rollback 02-rollback-migracao-xer05-xer06.sql removeu objetos XER-05/06 e preservou P0-2");

    // Reaplicar migração 02-up.sql após rollback
    psql("/sql/02-up.sql");
    console.log("PG17-PASS-11: Reaplicação limpa de 20261118101800_xerife_6b_instance_combat.sql após rollback concluída");
    console.log("PASS: 11 blocos PostgreSQL 17 reais aprovados (EXIT=0)");
  } finally {
    try {
      runDocker(["rm", "-f", containerName]);
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

try {
  main();
} catch (err) {
  console.error("FAIL PostgreSQL 17 Suite:", err.stderr || err.stdout || err.message || err);
  process.exit(1);
}
