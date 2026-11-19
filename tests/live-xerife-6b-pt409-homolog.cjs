/**
 * PACOTE 5.1 — Validação Direcionada em Homologação (HTTP/PostgREST PT409)
 * EXCLUSIVO para Homologação (igyupxczhczidfgtjiws).
 *
 * Reexecuta exclusivamente:
 * - C2-3b: Concorrência real em consumir_6b_instancia -> HTTP 409, code="PT409", < 1000ms, sem 504/duplicidade
 * - C2-10b: Concorrência real em renovar_6b_instancia -> HTTP 409, code="PT409", < 1000ms, sem 504/fadiga duplicada
 * - Smoke tests direcionados: RLS (42501 / 0 linhas), idempotência (opId) e reconexão (Realtime + ler_6b_instancia)
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error("Uso: node tests/live-xerife-6b-pt409-homolog.cjs <config.json>");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, ""));
const url = String(cfg.url || "").trim();
const key = String(cfg.anonKey || "").trim();

if (url !== "https://igyupxczhczidfgtjiws.supabase.co") {
  throw new Error("BLOQUEADO: Exclusivo para Homologação (igyupxczhczidfgtjiws).");
}
if (!key || /service_role/i.test(key)) {
  throw new Error("BLOQUEADO: Exige anon/publishable key.");
}

const clients = [];
const channels = [];
const cleanupMesas = [];

function assertOk(cond, label, detail) {
  if (!cond) throw new Error(label + (detail ? " :: " + detail : ""));
  console.log("PASS: " + label);
}

async function login(email) {
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  clients.push(c);
  const { data, error } = await c.auth.signInWithPassword({ email, password: cfg.password });
  if (error || !data?.session) throw new Error("Falha login " + email + ": " + (error?.message || "sem sessão"));
  return { client: c, token: data.session.access_token };
}

async function rawRpc(accessToken, fnName, body) {
  const t0 = performance.now();
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const elapsedMs = Math.round(performance.now() - t0);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, elapsedMs };
}

async function main() {
  let exitCode = 0;
  try {
    const gmA = await login(cfg.gmAEmail);
    const gmA2 = await login(cfg.gmAEmail);
    const playerA = await login(cfg.playerAEmail);
    const defenderA = await login(cfg.defenderAEmail);
    const gmB = await login(cfg.gmBEmail);

    const mesaA = crypto.randomUUID();
    const map1 = crypto.randomUUID();
    const inviteA = crypto.randomBytes(5).toString("hex").toUpperCase();

    const { error: mErr } = await gmA.client.from("mesas").insert({
      id: mesaA,
      nome: "QA Pacote 5.1 PT409",
      mestre_id: cfg.gmA,
      codigo_convite: inviteA,
      mapas: [{ id: map1, slot: 1, nome: "Mapa PT409", grid_cols: 20, url: null }],
      mapa_ativo_jogadores_id: map1
    });
    if (mErr) throw new Error("Criar Mesa A: " + mErr.message);
    cleanupMesas.push([gmA.client, mesaA]);

    await gmA.client.from("membros_mesa").insert({ mesa_id: mesaA, usuario_id: cfg.gmA, cargo: "mestre" });
    const jP = await playerA.client.rpc("entrar_na_mesa_por_codigo", { p_codigo: inviteA });
    if (jP.error) throw new Error("playerA join: " + jP.error.message);
    const jD = await defenderA.client.rpc("entrar_na_mesa_por_codigo", { p_codigo: inviteA });
    if (jD.error) throw new Error("defenderA join: " + jD.error.message);

    const bossId = crypto.randomUUID();
    const tokId = crypto.randomUUID();
    const { error: tokErr } = await gmA.client.from("mesa_tokens").insert({
      id: tokId,
      mesa_id: mesaA,
      mapa_id: map1,
      owner_type: "creature",
      owner_ref: bossId,
      owner_user_id: cfg.defenderA,
      display_name: "Boss PT409",
      visible_to_players: true
    });
    if (tokErr) throw new Error("Inserir token Boss PT409: " + tokErr.message);

    const init = await gmA.client.rpc("inicializar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: bossId,
      p_dados: [12, 10, 8, 6, 4],
      p_op_id: "pt409-init",
      p_mapa: map1,
      p_token: tokId
    });
    if (init.error) throw new Error("init: " + init.error.message);

    const roll = await gmA.client.rpc("rolar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: bossId,
      p_versao: init.data.versao,
      p_op_id: "pt409-roll"
    });
    if (roll.error) throw new Error("roll: " + roll.error.message);
    const verBeforeConsume = roll.data.versao;

    // ─── C2-3b: Concorrência real HTTP/PostgREST em consumir_6b_instancia ───
    const [consA, consB] = await Promise.all([
      rawRpc(gmA.token, "consumir_6b_instancia", {
        p_mesa: mesaA,
        p_instance: bossId,
        p_versao: verBeforeConsume,
        p_indices: [0],
        p_op_id: "pt409-conc-cons-a"
      }),
      rawRpc(gmA2.token, "consumir_6b_instancia", {
        p_mesa: mesaA,
        p_instance: bossId,
        p_versao: verBeforeConsume,
        p_indices: [2],
        p_op_id: "pt409-conc-cons-b"
      })
    ]);

    const winC = consA.status === 200 ? consA : consB;
    const loseC = consA.status === 200 ? consB : consA;

    assertOk(
      winC.status === 200 &&
        loseC.status === 409 &&
        loseC.json?.code === "PT409" &&
        loseC.elapsedMs < 1000 &&
        winC.elapsedMs < 1000 &&
        winC.json?.versao === verBeforeConsume + 1 &&
        Array.isArray(winC.json?.consumidos) &&
        winC.json.consumidos.length === 1,
      `C2-3b PASS: Concorrência consumo -> HTTP ${loseC.status}, code=${loseC.json?.code}, latência perdedor=${loseC.elapsedMs}ms (vencedor=${winC.elapsedMs}ms), 0x 504, versao=${winC.json?.versao}`,
      JSON.stringify({ consA, consB })
    );

    // Aplicar dano [1, 4] via defensor e esgotar os dados restantes para preparar C2-10b
    const dmg = await defenderA.client.rpc("aplicar_dano_6b_instancia", {
      p_mesa: mesaA,
      p_instance: bossId,
      p_versao: winC.json.versao,
      p_dano: 2,
      p_indices_escolhidos: [1, 4],
      p_op_id: "pt409-dmg"
    });
    if (dmg.error) throw new Error("dmg: " + dmg.error.message);

    let curSt = dmg.data;
    const remaining = [0, 1, 2, 3, 4].filter(
      (i) => !curSt.usados.includes(i) && !curSt.bloqueados.includes(i) && curSt.resultados[i] > 0
    );
    if (remaining.length > 0) {
      const consRest = await gmA.client.rpc("consumir_6b_instancia", {
        p_mesa: mesaA,
        p_instance: bossId,
        p_versao: curSt.versao,
        p_indices: remaining,
        p_op_id: "pt409-cons-rest"
      });
      if (consRest.error) throw new Error("consRest: " + consRest.error.message);
      curSt = consRest.data;
    }

    // ─── C2-10b: Concorrência real HTTP/PostgREST em renovar_6b_instancia ───
    const [renA, renB] = await Promise.all([
      rawRpc(gmA.token, "renovar_6b_instancia", {
        p_mesa: mesaA,
        p_instance: bossId,
        p_versao: curSt.versao,
        p_op_id: "pt409-conc-ren-a",
        p_aplicar_fadiga: true
      }),
      rawRpc(gmA2.token, "renovar_6b_instancia", {
        p_mesa: mesaA,
        p_instance: bossId,
        p_versao: curSt.versao,
        p_op_id: "pt409-conc-ren-b",
        p_aplicar_fadiga: true
      })
    ]);

    const winR = renA.status === 200 ? renA : renB;
    const loseR = renA.status === 200 ? renB : renA;
    const winRenOpId = renA.status === 200 ? "pt409-conc-ren-a" : "pt409-conc-ren-b";

    assertOk(
      winR.status === 200 &&
        loseR.status === 409 &&
        loseR.json?.code === "PT409" &&
        loseR.elapsedMs < 1000 &&
        winR.elapsedMs < 1000 &&
        winR.json?.versao === curSt.versao + 1 &&
        winR.json?.fadiga === 1 &&
        JSON.stringify(winR.json?.bloqueados) === "[1,4]",
      `C2-10b PASS: Concorrência renovação -> HTTP ${loseR.status}, code=${loseR.json?.code}, latência perdedor=${loseR.elapsedMs}ms (vencedor=${winR.elapsedMs}ms), 0x 504, fadiga=${winR.json?.fadiga}`,
      JSON.stringify({ renA, renB })
    );

    // ─── Smoke Idempotência: replay do opId vencedor com versão anterior não duplica fadiga ───
    const replayR = await rawRpc(gmA.token, "renovar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: bossId,
      p_versao: curSt.versao,
      p_op_id: winRenOpId,
      p_aplicar_fadiga: true
    });
    assertOk(
      replayR.status === 200 &&
        replayR.json?.idempotentReplay === true &&
        replayR.json?.versao === winR.json.versao &&
        replayR.json?.fadiga === 1,
      `SMOKE-IDEMP PASS: Replay do opId='${winRenOpId}' retornou HTTP 200 idempotentReplay=true sem duplicar fadiga (versao=${replayR.json?.versao}, fadiga=${replayR.json?.fadiga})`,
      JSON.stringify(replayR)
    );

    // ─── Smoke RLS: playerA, defenderA (ações de Mestre), gmB e UPDATE direto bloqueados com 42501 ───
    const rlsPl = await playerA.client.rpc("consumir_6b_instancia", {
      p_mesa: mesaA, p_instance: bossId, p_versao: winR.json.versao, p_indices: [0], p_op_id: "rls-pl"
    });
    const rlsDef = await defenderA.client.rpc("renovar_6b_instancia", {
      p_mesa: mesaA, p_instance: bossId, p_versao: winR.json.versao, p_op_id: "rls-def", p_aplicar_fadiga: false
    });
    const rlsGmB = await gmB.client.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: bossId });
    const rlsDirectUpd = await gmA.client.from("mesa_6b_instancia").update({ versao: 999 }).eq("instance_id", bossId);
    assertOk(
      rlsPl.error?.code === "42501" &&
        rlsDef.error?.code === "42501" &&
        rlsGmB.error?.code === "42501" &&
        rlsDirectUpd.error?.code === "42501",
      "SMOKE-RLS PASS: playerA, defenderA (renovar), gmB (outra mesa) e UPDATE direto bloqueados com 42501",
      JSON.stringify({ rlsPl: rlsPl.error, rlsDef: rlsDef.error, rlsGmB: rlsGmB.error, rlsDirectUpd: rlsDirectUpd.error })
    );

    // ─── Smoke Reconexão: Realtime SUBSCRIBED + ler_6b_instancia recupera estado autoritativo completo ───
    const sess2 = await gmA2.client.auth.getSession();
    await gmA2.client.realtime.setAuth(sess2.data.session.access_token);
    const ch = gmA2.client.channel("pt409-reconn-" + crypto.randomUUID());
    channels.push([gmA2.client, ch]);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout subscribe Realtime")), 15000);
      ch.on("postgres_changes", { event: "*", schema: "public", table: "mesa_6b_instancia", filter: "mesa_id=eq." + mesaA }, () => {});
      ch.subscribe((st) => {
        if (st === "SUBSCRIBED") {
          clearTimeout(t);
          resolve();
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
          clearTimeout(t);
          reject(new Error("Realtime status: " + st));
        }
      });
    });
    const readReconn = await gmA2.client.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: bossId });
    assertOk(
      readReconn.data?.versao === winR.json.versao &&
        readReconn.data?.fadiga === 1 &&
        JSON.stringify(readReconn.data?.bloqueados) === "[1,4]",
      `SMOKE-RECONN PASS: Canal Realtime SUBSCRIBED + ler_6b_instancia recuperou estado autoritativo (versao=${readReconn.data?.versao}, fadiga=${readReconn.data?.fadiga})`,
      JSON.stringify(readReconn)
    );

    console.log("\n=== PACOTE 5.1 VALIDAÇÃO DIRECIONADA EM HOMOLOGAÇÃO: TODOS OS CENÁRIOS APROVADOS ===");
  } catch (err) {
    console.error("FAIL:", err?.stack || err);
    exitCode = 1;
  } finally {
    for (const [client, ch] of channels) {
      try { await client.removeChannel(ch); } catch {}
    }
    for (const [gmClient, mId] of cleanupMesas) {
      try { await gmClient.from("mesas").delete().eq("id", mId); } catch {}
    }
    for (const c of clients) {
      try { await c.auth.signOut(); } catch {}
      try { c.realtime.disconnect(); } catch {}
    }
    process.exit(exitCode);
  }
}

main();
