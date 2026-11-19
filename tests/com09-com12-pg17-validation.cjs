/**
 * COM-09 / COM-10 / COM-11 / COM-12 — Validação Real em PostgreSQL 17 Descartável (Docker)
 *
 * Cobre:
 *  - Fase B: Bootstrap completo (schema base + COM-05..08 + XER-01..06 + PT409 + COM-09..12)
 *            e execução de tests/rls-com05-com08-combat-actions.sql + tests/rls-com09-com12-reactions.sql
 *  - Fase C: Auditoria pg_proc (SECURITY DEFINER, search_path='', ACLs) + matriz de negações (42501/22023/PT409)
 *            verificando ZERO efeitos colaterais
 *  - Fase D: 7 cenários reais de concorrência com conexões PostgreSQL independentes e barreira de advisory lock
 *  - Rollback controlado (02-rollback-com09-com12.sql) + reaplicação limpa
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const IMAGE = process.env.PG17_IMAGE || "postgres:17";
const containerName = "os-com09-12-pg17-" + process.pid;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "os-com09-12-pg17-"));

function docker(args, opts = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: opts.timeout || 120000,
    ...opts
  });
}

function psqlSync(sql, opts = {}) {
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-X",
        "-q",
        "-t",
        "-A"
      ],
      {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: opts.timeout || 60000
      }
    );
  } catch (err) {
    const details = (err.stderr ? err.stderr.toString("utf8") : "") || (err.stdout ? err.stdout.toString("utf8") : "");
    throw new Error(`psqlSync failed: ${details.trim() || err.message}`);
  }
}

function parseLastJsonLine(raw) {
  const lines = String(raw || "").trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function psqlFileSync(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return psqlSync(content);
}

function psqlAsync(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-X",
        "-q",
        "-t",
        "-A"
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve({ code: -1, stdout, stderr: stderr + "\nTIMEOUT" });
    }, 30000);
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const sqlstateMatch = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/);
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        sqlstate: sqlstateMatch ? sqlstateMatch[1] : null
      });
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPostgresReady() {
  for (let i = 0; i < 40; i++) {
    try {
      docker(["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"], { timeout: 5000 });
      const ver = psqlSync("SELECT version();").trim();
      return ver;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("PostgreSQL 17 container did not become ready in 40s");
}

/**
 * Executa 2+ queries SQL simultaneamente em backends PostgreSQL independentes
 * sincronizados por uma barreira de advisory lock.
 */
async function runBarrierRace(lockKey, workerSqlList) {
  // Coordinator holds exclusive advisory lock until all workers are waiting on shared lock
  const coord = spawn(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-t",
      "-A"
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );

  let coordReady = false;
  coord.stdout.on("data", (d) => {
    if (d.toString("utf8").includes("LOCK_ACQUIRED")) coordReady = true;
  });
  coord.stdin.write(`SELECT pg_advisory_lock(${lockKey}), 'LOCK_ACQUIRED';\n`);

  for (let i = 0; i < 40 && !coordReady; i++) await sleep(100);
  if (!coordReady) {
    try { coord.kill("SIGKILL"); } catch {}
    throw new Error("Coordinator failed to acquire advisory barrier lock");
  }

  const workerPromises = workerSqlList.map((wSql) =>
    psqlAsync(`
      SELECT pg_advisory_lock_shared(${lockKey});
      SELECT pg_advisory_unlock_shared(${lockKey});
      ${wSql}
    `)
  );

  // Wait until all worker backends are actively waiting on the advisory lock
  for (let i = 0; i < 50; i++) {
    const waitingCount = Number(
      psqlSync(
        `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${lockKey} AND NOT granted;`
      ).trim()
    );
    if (waitingCount >= workerSqlList.length) break;
    await sleep(80);
  }

  // Release the barrier so all worker backends collide simultaneously on mesas FOR UPDATE
  coord.stdin.write(`SELECT pg_advisory_unlock(${lockKey});\n\\q\n`);
  coord.stdin.end();

  const results = await Promise.all(workerPromises);
  return results;
}

function buildSupabaseCompatBootstrap() {
  return `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb
    );

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) THEN
        CREATE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $f$
          SELECT coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub', '')
          )::uuid;
        $f$;
      END IF;
    END $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'storage' AND p.proname = 'foldername'
      ) THEN
        CREATE FUNCTION storage.foldername(name text) RETURNS text[]
        LANGUAGE sql IMMUTABLE AS $f$
          SELECT string_to_array(name, '/');
        $f$;
      END IF;
    END $$;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
      END IF;
    END $$;
  `;
}

async function main() {
  const report = {
    image: IMAGE,
    pgVersion: null,
    phaseB: {},
    phaseC: {},
    phaseD: {},
    rollbackCheck: null
  };

  console.log(`Starting disposable PostgreSQL 17 container (${IMAGE})...`);
  docker([
    "run",
    "-d",
    "--rm",
    "--network",
    "none",
    "--name",
    containerName,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=postgres",
    IMAGE
  ]);

  try {
    report.pgVersion = await waitForPostgresReady();
    console.log("PG_VERSION:", report.pgVersion);

    // ═══ FASE B: Bootstrap + Migrações + Suítes RLS Oficiais ═══
    psqlSync(buildSupabaseCompatBootstrap());
    psqlFileSync(path.join(root, "database/homologacao-com05-com08/00-schema-base-homologacao.sql"));
    // Espelha grants padrão do Supabase em tabelas protegidas por RLS (sem liberar anon nem escrita direta em tabelas fechadas)
    psqlSync(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.fichas, public.mesa_tokens, public.eventos_mesa, public.membros_mesa, public.usuarios TO authenticated;
      GRANT SELECT, UPDATE ON public.mesas TO authenticated;
      GRANT SELECT ON public.mesa_combate_sinais, public.mesa_mapa_sinais, public.mesa_token_status, public.itens_entregues_pendentes TO authenticated;
    `);
    psqlFileSync(path.join(root, "supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql"));
    psqlFileSync(path.join(root, "supabase/migrations/20261117151310_xerife_6b_foundation.sql"));
    psqlFileSync(path.join(root, "supabase/migrations/20261118101800_xerife_6b_instance_combat.sql"));
    psqlFileSync(path.join(root, "supabase/migrations/20261118153000_xerife_6b_instance_conflict_pt409.sql"));
    psqlFileSync(path.join(root, "supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql"));
    console.log("MIGRATIONS_APPLIED: OK");

    const rls0508 = psqlFileSync(path.join(root, "tests/rls-com05-com08-combat-actions.sql")).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(rls0508.length === 12 && rls0508.every((l) => l.endsWith("|PASS")), "rls-com05-com08 failed: " + rls0508.join("\n"));
    report.phaseB.rlsCom0508 = { count: rls0508.length, results: rls0508 };
    console.log(`RLS_COM05_08: PASS (${rls0508.length} checks)`);

    const rls0912 = psqlFileSync(path.join(root, "tests/rls-com09-com12-reactions.sql")).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(rls0912.length >= 6 && rls0912.every((l) => l.endsWith("|PASS")), "rls-com09-com12 failed: " + rls0912.join("\n"));
    report.phaseB.rlsCom0912 = { count: rls0912.length, results: rls0912 };
    console.log(`RLS_COM09_12: PASS (${rls0912.length} checks)`);

    // ═══ FASE C: Auditoria de Segurança de public.gerenciar_reacao_combate ═══
    const procAuditRaw = psqlSync(`
      SELECT jsonb_build_object(
        'gerenciar_reacao_combate', (
          SELECT jsonb_build_object(
            'prosecdef', p.prosecdef,
            'proconfig', p.proconfig,
            'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
            'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'gerenciar_reacao_combate'
        ),
        'calcular_fase_turno_combate', (
          SELECT jsonb_build_object(
            'prosecdef', p.prosecdef,
            'proconfig', p.proconfig,
            'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
            'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'calcular_fase_turno_combate'
        ),
        'obter_combate_publico', (
          SELECT jsonb_build_object(
            'prosecdef', p.prosecdef,
            'proconfig', p.proconfig,
            'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
            'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'obter_combate_publico'
        ),
        'gerenciar_combate', (
          SELECT jsonb_build_object(
            'prosecdef', p.prosecdef,
            'proconfig', p.proconfig,
            'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'public_exec', has_function_privilege('public', p.oid, 'EXECUTE'),
            'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'gerenciar_combate'
        )
      )::text;
    `).trim();
    const procAudit = JSON.parse(procAuditRaw);
    assert.equal(procAudit.gerenciar_reacao_combate.prosecdef, true);
    assert.ok(procAudit.gerenciar_reacao_combate.proconfig.includes('search_path=""'));
    assert.equal(procAudit.gerenciar_reacao_combate.anon_exec, false);
    assert.equal(procAudit.gerenciar_reacao_combate.public_exec, false);
    assert.equal(procAudit.gerenciar_reacao_combate.auth_exec, true);
    assert.equal(procAudit.calcular_fase_turno_combate.anon_exec, false);
    assert.equal(procAudit.calcular_fase_turno_combate.public_exec, false);
    assert.equal(procAudit.calcular_fase_turno_combate.auth_exec, false);
    report.phaseC.procAudit = procAudit;
    console.log("PG_PROC_AUDIT: PASS");

    // Seed persistent synthetic fixture for Phase C negative matrix & Phase D concurrency tests
    const GM1 = "11111111-1111-4111-8111-111111111111";
    const GM2 = "11111111-1111-4111-8111-222222222222";
    const PA = "22222222-2222-4222-8222-111111111111";
    const PB = "33333333-3333-4333-8333-111111111111";
    const OUT = "44444444-4444-4444-8444-111111111111";
    const ROOM1 = "aaaa1111-1111-4111-8111-111111111111";
    const ROOM2 = "aaaa2222-2222-4222-8222-222222222222";
    const MAP1 = "bbbb1111-1111-4111-8111-111111111111";
    const MAP2 = "bbbb2222-2222-4222-8222-222222222222";
    const FICHA_A = "cccc1111-1111-4111-8111-111111111111";
    const FICHA_B = "cccc2222-2222-4222-8222-222222222222";
    const TOK_A = "dddd1111-1111-4111-8111-111111111111";
    const TOK_B = "dddd2222-2222-4222-8222-222222222222";
    const TOK_CR = "dddd3333-3333-4333-8333-333333333333";
    const INST_CR = "eeee3333-3333-4333-8333-333333333333";

    psqlSync(`
      INSERT INTO auth.users(id, email) VALUES
        ('${GM1}', 'gm1@test.local'),
        ('${GM2}', 'gm2@test.local'),
        ('${PA}', 'pa@test.local'),
        ('${PB}', 'pb@test.local'),
        ('${OUT}', 'out@test.local');
      INSERT INTO public.usuarios(id, username, email) VALUES
        ('${GM1}', 'gm1', 'gm1@test.local'),
        ('${GM2}', 'gm2', 'gm2@test.local'),
        ('${PA}', 'pa', 'pa@test.local'),
        ('${PB}', 'pb', 'pb@test.local'),
        ('${OUT}', 'out', 'out@test.local')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.mesas(id, nome, mestre_id, codigo_convite, mapas, mapa_ativo_jogadores_id, npcs_mesa, cena_ativa) VALUES
        ('${ROOM1}', 'Mesa 1', '${GM1}', 'MESA01',
         jsonb_build_array(jsonb_build_object('id','${MAP1}','slot',1,'nome','Saloon','grid_cols',24)),
         '${MAP1}', '[]'::jsonb,
         jsonb_build_array(jsonb_build_object('instanceId','${INST_CR}','sourceType','custom','sourceCategory','NPC','operationalMode','creature_mode','data',jsonb_build_object('nome','Capanga','operationalMode','creature_mode','isCriatura',true)))),
        ('${ROOM2}', 'Mesa 2', '${GM2}', 'MESA02',
         jsonb_build_array(jsonb_build_object('id','${MAP2}','slot',1,'nome','Mina','grid_cols',24)),
         '${MAP2}', '[]'::jsonb, '[]'::jsonb);
      INSERT INTO public.membros_mesa(mesa_id, usuario_id, cargo) VALUES
        ('${ROOM1}','${GM1}','mestre'),
        ('${ROOM1}','${PA}','jogador'),
        ('${ROOM1}','${PB}','jogador'),
        ('${ROOM2}','${GM2}','mestre');
      INSERT INTO public.fichas(id, usuario_id, mesa_id, nome_personagem, dados) VALUES
        ('${FICHA_A}','${PA}','${ROOM1}','Pistoleiro A','{"iniciativa":"15","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}'),
        ('${FICHA_B}','${PB}','${ROOM1}','Pistoleiro B','{"iniciativa":"5","tipo_ficha":"jogador","freeEdit":false,"inventoryItems":[]}');
      INSERT INTO public.mesa_tokens(id, mesa_id, mapa_id, owner_type, owner_ref, owner_user_id, display_name, grid_x, grid_y, iniciativa, visible_to_players) VALUES
        ('${TOK_A}','${ROOM1}','${MAP1}','player','${FICHA_A}','${PA}','Pistoleiro A',2,2,15,true),
        ('${TOK_B}','${ROOM1}','${MAP1}','player','${FICHA_B}','${PB}','Pistoleiro B',3,2,5,true),
        ('${TOK_CR}','${ROOM1}','${MAP1}','creature','${INST_CR}',NULL,'Capanga',2,3,2,true);
    `);

    const startJson = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims', '{"sub":"${GM1}","role":"authenticated"}', false);
        SET ROLE authenticated;
        SELECT public.gerenciar_combate(
          '${ROOM1}', 'iniciar', NULL,
          '[{"token_id":"${TOK_A}","modo":"ficha","prioridade":1},{"token_id":"${TOK_B}","modo":"ficha","prioridade":2},{"token_id":"${TOK_CR}","modo":"ficha","prioridade":3}]'::jsonb
        )::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const COMBAT_ID = startJson.combate.id;
    // Note: TOK_A (init 15 -> 4 actions, idx 0 active), TOK_B (init 5 -> 2 actions, idx 1 pre_turn), TOK_CR (init 2 -> 1 action, idx 2 pre_turn)

    // Player B submits a pending early reaction request so we can test negative matrix + races on it!
    const req1Res = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims', '{"sub":"${PB}","role":"authenticated"}', false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate(
          '${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-base-req1',
          'reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'Interceptar', '${MAP1}',1,NULL,NULL,NULL
        )::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const REQ1_ID = req1Res.result.requestId;

    // Helper to snapshot combate_ativo version + TOK_B spentActions for side-effect checks
    function getStateFingerprint() {
      return JSON.parse(
        psqlSync(`
          SELECT jsonb_build_object(
            'versao', (combate_ativo->>'versao')::bigint,
            'round', (combate_ativo->>'round')::integer,
            'req_count', jsonb_array_length(coalesce(combate_ativo->'solicitacoes_reacao','[]'::jsonb)),
            'opp_count', jsonb_array_length(coalesce(combate_ativo->'oportunidades_reacao','[]'::jsonb)),
            'b_spent', (SELECT (e->'action_state'->>'spentActions')::integer FROM jsonb_array_elements(combate_ativo->'ordem') e WHERE e->>'token_id'='${TOK_B}'),
            'b_avail', (SELECT greatest(0, (e->'action_state'->>'initialBudget')::integer - (e->'action_state'->>'spentActions')::integer - (e->'action_state'->>'reservedActions')::integer) FROM jsonb_array_elements(combate_ativo->'ordem') e WHERE e->>'token_id'='${TOK_B}'),
            'cr_spent', (SELECT (e->'action_state'->>'spentActions')::integer FROM jsonb_array_elements(combate_ativo->'ordem') e WHERE e->>'token_id'='${TOK_CR}')
          )::text
          FROM public.mesas WHERE id='${ROOM1}';
        `).trim()
      );
    }

    const fpBeforeNeg = getStateFingerprint();
    const negCases = [
      {
        name: "unauthenticated_null_uid",
        sql: `SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-neg-1','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "anon_role_blocked",
        sql: `SET ROLE anon; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-neg-2','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'x','${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "outsider_blocked",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${OUT}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-neg-3','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'x','${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "cross_table_gm2_approve_in_room1",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${GM2}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-neg-4','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "player_b_self_approve",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${PB}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-neg-5','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "player_a_cancel_player_b_request",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','cancel_early_reaction','op-neg-6','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "player_a_request_for_npc_creature",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','request_early_reaction','op-neg-7','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'x','${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "player_b_open_opportunity",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${PB}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','open_opportunity','op-neg-8','reacao',1,NULL,NULL,NULL,NULL,true,NULL,false,false,'x','${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "42501"
      },
      {
        name: "tampered_cost_zero",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated; SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','open_opportunity','op-neg-9','reacao',0,NULL,NULL,NULL,NULL,true,NULL,false,false,'x','${MAP1}',1,NULL,NULL,NULL);`,
        expectedSqlstate: "22023"
      },
      {
        name: "direct_update_mesas_by_player_blocked",
        sql: `SELECT set_config('request.jwt.claims','{"sub":"${PB}","role":"authenticated"}',false); SET ROLE authenticated; UPDATE public.mesas SET combate_ativo = NULL WHERE id = '${ROOM1}';`,
        expectZeroRowsOrDenied: true
      }
    ];

    report.phaseC.negativeMatrix = [];
    for (const nc of negCases) {
      const r = await psqlAsync(nc.sql);
      if (nc.expectZeroRowsOrDenied) {
        assert.ok(r.code !== 0 || getStateFingerprint().versao === fpBeforeNeg.versao, `Direct UPDATE mutated mesas in ${nc.name}`);
        report.phaseC.negativeMatrix.push({ name: nc.name, status: "PASS", sqlstate: r.sqlstate || "0_ROWS_RLS" });
      } else {
        assert.notEqual(r.code, 0, `Negative case ${nc.name} unexpectedly succeeded!`);
        assert.equal(r.sqlstate, nc.expectedSqlstate, `Case ${nc.name} expected ${nc.expectedSqlstate}, got ${r.sqlstate}: ${r.stderr}`);
        report.phaseC.negativeMatrix.push({ name: nc.name, status: "PASS", sqlstate: r.sqlstate });
      }
    }
    const fpAfterNeg = getStateFingerprint();
    assert.deepEqual(fpAfterNeg, fpBeforeNeg, "Denied operations produced side effects!");
    report.phaseC.zeroSideEffects = true;
    console.log(`NEGATIVE_MATRIX: PASS (${negCases.length}/${negCases.length}, zero side effects)`);

    // ═══ FASE D: CONCORRÊNCIA REAL (CONEXÕES POSTGRESQL INDEPENDENTES) ═══

    // D1: Duas aprovações simultâneas (mesma solicitação REQ1_ID, op_ids distintos)
    const d1 = await runBarrierRace(991001, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-d1-a','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'gm-a')::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-d1-b','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'gm-b')::text;`
    ]);
    const d1Ok = d1.filter((r) => r.code === 0);
    const d1Pt409 = d1.filter((r) => r.code !== 0 && r.sqlstate === "PT409");
    assert.equal(d1Ok.length, 1, "D1: expected exactly 1 winner, got " + JSON.stringify(d1));
    assert.equal(d1Pt409.length, 1, "D1: expected exactly 1 PT409 loser, got " + JSON.stringify(d1));
    const fpD1 = getStateFingerprint();
    assert.equal(fpD1.b_spent, 1);
    assert.equal(fpD1.b_avail, 1);
    report.phaseD.D1_doubleApprove = { winners: 1, pt409: 1, b_spent: fpD1.b_spent, b_avail: fpD1.b_avail };
    console.log("D1_DOUBLE_APPROVE: PASS (1 winner, 1 PT409, spent=1, avail=1)");

    // D3: Repetição simultânea do MESMO p_op_id (race + idempotent replay on TOK_B's 2nd request? First test replay of winning op_id!)
    const winnerOpId = d1[0].code === 0 ? "op-d1-a" : "op-d1-b";
    const d3 = await runBarrierRace(991003, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','${winnerOpId}','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'replay-1')::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','${winnerOpId}','reacao',NULL,NULL,'${REQ1_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'replay-2')::text;`
    ]);
    assert.equal(d3.filter((r) => r.code === 0).length, 2, "D3: same op_id replays must both return ok");
    assert.equal(getStateFingerprint().b_spent, 1, "D3: replay must NOT double debit");
    report.phaseD.D3_sameOpIdRace = { replaysOk: 2, b_spent: 1 };
    console.log("D3_SAME_OP_ID_RACE: PASS (2 idempotent replays, spent still 1)");

    // D2: Aprovação e negação simultâneas (nova solicitação REQ2 de TOK_B, que ainda tem 1 ação disponível)
    const req2Res = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims', '{"sub":"${PB}","role":"authenticated"}', false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate(
          '${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-d2-req',
          'reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'Esquiva', '${MAP1}',1,NULL,NULL,NULL
        )::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const REQ2_ID = req2Res.result.requestId;

    const d2 = await runBarrierRace(991002, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-d2-app','reacao',NULL,NULL,'${REQ2_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'approve')::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','deny_early_reaction','op-d2-deny','reacao',NULL,NULL,'${REQ2_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'deny')::text;`
    ]);
    assert.equal(d2.filter((r) => r.code === 0).length, 1, "D2: exactly 1 of approve/deny must win");
    assert.equal(d2.filter((r) => r.code !== 0 && r.sqlstate === "PT409").length, 1, "D2: loser must get PT409");
    const approveWonD2 = d2[0].code === 0;
    const fpD2 = getStateFingerprint();
    assert.equal(fpD2.b_spent, approveWonD2 ? 2 : 1);
    assert.ok(fpD2.b_avail >= 0);
    report.phaseD.D2_approveVsDeny = { winner: approveWonD2 ? "approve" : "deny", loserSqlstate: "PT409", b_spent: fpD2.b_spent, b_avail: fpD2.b_avail };
    console.log(`D2_APPROVE_VS_DENY: PASS (winner=${approveWonD2 ? "approve" : "deny"}, loser=PT409, spent=${fpD2.b_spent})`);

    // D4: Duas operações concorrentes pela ÚLTIMA ação disponível de TOK_CR (orçamento fixo = 1)
    // D4a: Duas solicitações simultâneas para TOK_CR -> apenas 1 pending permitida
    const d4a = await runBarrierRace(991004, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','request_early_reaction','op-d4-req1','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'R1','${MAP1}',1,NULL,NULL,NULL)::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','request_early_reaction','op-d4-req2','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'R2','${MAP1}',1,NULL,NULL,NULL)::text;`
    ]);
    assert.equal(d4a.filter((r) => r.code === 0).length, 1, "D4a: only 1 pending request allowed");
    assert.equal(d4a.filter((r) => r.code !== 0 && r.sqlstate === "22023").length, 1, "D4a: duplicate pending rejected with 22023");
    const crWinJson = JSON.parse(d4a.find((r) => r.code === 0).stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    const REQ_CR_ID = crWinJson.result.requestId;

    // D4b: Aprovação da solicitação de TOK_CR competindo com reserva direta de última ação (gerenciar_acao_combate)
    const d4b = await runBarrierRace(991005, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','approve_early_reaction','op-d4-app','reacao',NULL,NULL,'${REQ_CR_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',1,NULL,NULL,'approve-cr')::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_acao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','reserve','op-d4-res','reacao',1,NULL,true,false,'${MAP1}',1,NULL,'direct-gm-react')::text;`
    ]);
    assert.equal(d4b.filter((r) => r.code === 0).length, 1, "D4b: exactly 1 consumer of last action must win");
    assert.equal(d4b.filter((r) => r.code !== 0 && (r.sqlstate === "PT409" || r.sqlstate === "22023")).length, 1, "D4b: loser must fail with PT409 or 22023");
    const crAvailAfterD4 = Number(
      psqlSync(`SELECT greatest(0, (e->'action_state'->>'initialBudget')::integer - (e->'action_state'->>'spentActions')::integer - (e->'action_state'->>'reservedActions')::integer) FROM public.mesas, jsonb_array_elements(combate_ativo->'ordem') e WHERE id='${ROOM1}' AND e->>'token_id'='${TOK_CR}';`).trim()
    );
    assert.equal(crAvailAfterD4, 0, "D4b: TOK_CR available must be 0 (never negative)");
    report.phaseD.D4_lastActionRace = {
      d4a_winners: 1,
      d4b_winner: d4b[0].code === 0 ? "approve_early_reaction" : "gerenciar_acao_combate",
      d4b_loserSqlstate: d4b.find((r) => r.code !== 0).sqlstate,
      cr_avail_after: crAvailAfterD4
    };
    console.log(`D4_LAST_ACTION_RACE: PASS (winner=${report.phaseD.D4_lastActionRace.d4b_winner}, loser=${report.phaseD.D4_lastActionRace.d4b_loserSqlstate}, avail=0)`);

    // If reserve won D4b, commit it so Round 1 rollover isn't blocked by a pending ledger reservation
    if (d4b[1].code === 0) {
      const resJson = JSON.parse(d4b[1].stdout.trim().split(/\r?\n/).filter(Boolean).pop());
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_acao_combate('${ROOM1}','${COMBAT_ID}','${TOK_CR}','commit','op-d4-cmt',NULL,NULL,'${resJson.result.reservationId}',true,true,'${MAP1}',1,NULL,NULL);
      `);
    }

    // D5: Virada de rodada durante reação pendente (avança até último turno idx=2, cria solicitação pré-turno no Round 2 ou testa rollover)
    // Primeiro avança para Round 2 para ter todos com orçamento cheio, depois avança até idx=2 (TOK_CR)
    // Wait: na idx=2 (último turno), TOK_A (idx 0) e TOK_B (idx 1) já estão em post_turn.
    // Para testar virada de rodada durante reação pendente, vamos adicionar um cenário limpo:
    // Em Round 2, idx=0 (TOK_A), TOK_B (idx=1) tem solicitação pending; se GM avança para idx=1, ela expira!
    // E se adicionarmos um 4o token ou se avançarmos para Round 2 -> testarmos rollover com solicitação pendente de TOK_CR (mas TOK_CR é idx=2, então na idx=2 já é a vez dele!).
    // Melhor: adicionamos TOK_LATE (pre_turn tardio) quando estamos no último turno? Não, TOK_LATE entra no final, virando o último turno!
    // Vamos testar EXATAMENTE os dois: (a) Race de avanço de turno (idx=0 -> idx=1) vs aprovação de TOK_B pending no Round 2!
    let currState = JSON.parse(psqlSync(`SELECT combate_ativo::text FROM public.mesas WHERE id='${ROOM1}';`).trim());
    while (currState.round === 1) {
      const nxt = JSON.parse(
        psqlSync(`
          SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false);
          SET ROLE authenticated;
          SELECT public.gerenciar_combate('${ROOM1}','proximo',${currState.versao},NULL,NULL,'${COMBAT_ID}')::text;
        `).trim().split(/\r?\n/).filter(Boolean).pop()
      );
      currState = nxt.combate;
    }
    assert.equal(currState.round, 2);

    // Round 2, idx=0 (TOK_A). TOK_B (idx=1, pre_turn) solicita reação antecipada!
    const reqR2 = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${PB}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-d5-req','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'R2-race','${MAP1}',2,NULL,NULL,NULL)::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const REQ_R2_ID = reqR2.result.requestId;
    const verBeforeD5 = reqR2.combate.versao;

    // D5: Race between advancing turn to TOK_B (proximo) vs approving TOK_B's early reaction!
    const d5 = await runBarrierRace(991006, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_combate('${ROOM1}','proximo',${verBeforeD5},NULL,NULL,'${COMBAT_ID}')::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','approve_early_reaction','op-d5-app','reacao',NULL,NULL,'${REQ_R2_ID}',NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',2,NULL,NULL,'d5-app')::text;`
    ]);
    // Either proximo ran first (and approve failed with PT409 because turn started & request expired)
    // OR approve ran first (incrementing versao so proximo failed with 40001 version conflict)!
    const d5Winners = d5.filter((r) => r.code === 0).length;
    const d5Losers = d5.filter((r) => r.code !== 0 && (r.sqlstate === "PT409" || r.sqlstate === "40001")).length;
    assert.equal(d5Winners, 1, "D5: exactly 1 of proximo vs approve must win: " + JSON.stringify(d5));
    assert.equal(d5Losers, 1, "D5: loser must fail cleanly with PT409 or 40001: " + JSON.stringify(d5));
    report.phaseD.D5_turnAdvanceVsPendingApproval = {
      winner: d5[0].code === 0 ? "gerenciar_combate(proximo)" : "approve_early_reaction",
      loserSqlstate: d5.find((r) => r.code !== 0).sqlstate
    };
    console.log(`D5_TURN_ADVANCE_VS_APPROVAL: PASS (winner=${report.phaseD.D5_turnAdvanceVsPendingApproval.winner}, loser=${report.phaseD.D5_turnAdvanceVsPendingApproval.loserSqlstate})`);

    // D5b: Also verify round rollover (Round 2 -> Round 3) with an open opportunity expires it and rejects stale-round execution with PT409!
    const oppR2 = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','open_opportunity','op-d5b-opp','reacao',1,NULL,NULL,NULL,NULL,true,NULL,false,false,'R2 opp','${MAP1}',2,NULL,NULL,NULL)::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const OPP_R2_ID = oppR2.result.opportunityId;
    currState = oppR2.combate;
    while (currState.round === 2) {
      const nxt = JSON.parse(
        psqlSync(`
          SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false);
          SET ROLE authenticated;
          SELECT public.gerenciar_combate('${ROOM1}','proximo',${currState.versao},NULL,NULL,'${COMBAT_ID}')::text;
        `).trim().split(/\r?\n/).filter(Boolean).pop()
      );
      currState = nxt.combate;
    }
    assert.equal(currState.round, 3);
    const staleOppExec = await psqlAsync(`
      SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false);
      SET ROLE authenticated;
      SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','execute_opportunity_reaction','op-d5b-stale','reacao',NULL,'${OPP_R2_ID}',NULL,NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',2,NULL,NULL,NULL)::text;
    `);
    assert.equal(staleOppExec.sqlstate, "PT409", "D5b: stale round opportunity must return PT409");
    report.phaseD.D5b_roundRolloverExpiresOpp = { roundNow: 3, staleExecSqlstate: staleOppExec.sqlstate };
    console.log("D5b_ROUND_ROLLOVER_EXPIRES_OPP: PASS (PT409)");

    // D6: Reconexão e repetição de evento (fresh sessions read obter_combate_publico + replay op_id in Round 3)
    const oppR3 = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','open_opportunity','op-d6-opp','reacao',1,NULL,NULL,NULL,NULL,true,NULL,false,false,'R3 opp','${MAP1}',3,NULL,NULL,NULL)::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const d6Exec1 = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','execute_opportunity_reaction','op-d6-exec','reacao',NULL,'${oppR3.result.opportunityId}',NULL,NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',3,NULL,NULL,NULL)::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const d6Reconnect = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.obter_combate_publico('${ROOM1}')::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    const d6Replay = JSON.parse(
      psqlSync(`
        SELECT set_config('request.jwt.claims','{"sub":"${PA}","role":"authenticated"}',false);
        SET ROLE authenticated;
        SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','execute_opportunity_reaction','op-d6-exec','reacao',NULL,'${oppR3.result.opportunityId}',NULL,NULL,NULL,false,NULL,NULL,false,NULL,'${MAP1}',3,NULL,NULL,NULL)::text;
      `).trim().split(/\r?\n/).filter(Boolean).pop()
    );
    assert.equal(d6Exec1.result.spentActions, 1);
    assert.equal(d6Replay.result.idempotentReplay, true);
    assert.equal(d6Replay.result.spentActions, 1);
    const aAfterReconnect = d6Reconnect.combate.ordem.find((e) => e.token_id === TOK_A);
    assert.equal(aAfterReconnect.action_state.spentActions, 1);
    report.phaseD.D6_reconnectAndReplay = { spentAfterExec: 1, spentAfterReconnect: 1, replayIdempotent: true };
    console.log("D6_RECONNECT_AND_REPLAY: PASS");

    // D7: Acesso concorrente de outro usuário (OUT) e outro Mestre (GM2) enquanto GM1 opera normalmente
    const d7 = await runBarrierRace(991007, [
      `SELECT set_config('request.jwt.claims','{"sub":"${GM1}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','open_opportunity','op-d7-gm1','reacao',1,NULL,NULL,NULL,NULL,true,NULL,false,false,'Legit','${MAP1}',3,NULL,NULL,NULL)::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${GM2}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_A}','open_opportunity','op-d7-gm2','reacao',1,NULL,NULL,NULL,NULL,true,NULL,false,false,'Cross-GM','${MAP1}',3,NULL,NULL,NULL)::text;`,
      `SELECT set_config('request.jwt.claims','{"sub":"${OUT}","role":"authenticated"}',false); SET ROLE authenticated;
       SELECT public.gerenciar_reacao_combate('${ROOM1}','${COMBAT_ID}','${TOK_B}','request_early_reaction','op-d7-out','reacao',1,NULL,NULL,NULL,NULL,false,NULL,false,false,'Outsider','${MAP1}',3,NULL,NULL,NULL)::text;`
    ]);
    assert.equal(d7[0].code, 0, "D7: legitimate GM1 must succeed");
    assert.equal(d7[1].sqlstate, "42501", "D7: cross-table GM2 must get 42501");
    assert.equal(d7[2].sqlstate, "42501", "D7: outsider must get 42501");
    report.phaseD.D7_crossUserAndTableRace = { gm1: "PASS", gm2: d7[1].sqlstate, outsider: d7[2].sqlstate };
    console.log("D7_CROSS_USER_AND_TABLE_RACE: PASS (GM1 ok, GM2=42501, OUT=42501)");

    // ═══ ROLLBACK + REAPLICAÇÃO LIMPA ═══
    psqlFileSync(path.join(root, "database/com09-com12-acoes-reacoes/02-rollback-com09-com12.sql"));
    psqlFileSync(path.join(root, "supabase/migrations/20261116210603_com05_com08_combat_state_and_actions.sql"));
    const rlsAfterRollback = psqlFileSync(path.join(root, "tests/rls-com05-com08-combat-actions.sql")).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(rlsAfterRollback.length === 12 && rlsAfterRollback.every((l) => l.endsWith("|PASS")));
    psqlFileSync(path.join(root, "supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql"));
    const rlsAfterReapply = psqlFileSync(path.join(root, "tests/rls-com09-com12-reactions.sql")).trim().split(/\r?\n/).filter(Boolean);
    assert.ok(rlsAfterReapply.length >= 6 && rlsAfterReapply.every((l) => l.endsWith("|PASS")));
    report.rollbackCheck = { rollbackCom0508Pass: rlsAfterRollback.length, reapplyCom0912Pass: rlsAfterReapply.length };
    console.log("ROLLBACK_AND_REAPPLY: PASS");

    console.log("PG17_VALIDATION_SUMMARY:", JSON.stringify(report));
  } finally {
    try {
      docker(["rm", "-f", containerName], { timeout: 15000 });
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("PG17_VALIDATION_FAILED:", err.stack || err.message);
  process.exit(1);
});
