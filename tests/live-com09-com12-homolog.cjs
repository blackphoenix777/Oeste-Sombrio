/**
 * PACOTE 9.2 — Homologação Controlada COM-09 a COM-12 (Fases D, E, F e G)
 * EXCLUSIVO para Homologação Supabase (igyupxczhczidfgtjiws).
 *
 * Não contém credenciais nem chaves embutidas; lê configuração privada via argv[2].
 * Garante limpeza cirúrgica exclusivamente das mesas/tokens sintéticos criados por esta execução.
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error("Uso: node tests/live-com09-com12-homolog.cjs <config.json>");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, ""));
const url = String(cfg.url || "").trim();
const key = String(cfg.publishableKey || cfg.anonKey || "").trim();

if (url !== "https://igyupxczhczidfgtjiws.supabase.co") {
  throw new Error("BLOQUEADO: Exclusivo para Homologação (igyupxczhczidfgtjiws).");
}
if (!key || /service_role/i.test(key)) {
  throw new Error("BLOQUEADO: Exige publishable/anon key.");
}

const clients = [];
const channels = [];
const cleanupMesas = [];
const results = [];

function record(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail: detail || "" });
  if (!ok) {
    console.error(`FAIL [${id}]: ${detail}`);
    throw new Error(`FAIL [${id}]: ${detail}`);
  }
  console.log(`PASS [${id}]${detail ? " :: " + detail : ""}`);
}

async function login(email) {
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });
  clients.push(c);
  const { data, error } = await c.auth.signInWithPassword({ email, password: cfg.password });
  if (error || !data?.session?.access_token) {
    throw new Error(`Falha login ${email}: ${error?.message || "sem sessão"}`);
  }
  return { client: c, token: data.session.access_token, userId: data.user.id };
}

async function rawRpc(accessToken, fnName, body) {
  const headers = {
    apikey: key,
    "Content-Type": "application/json"
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const t0 = performance.now();
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
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

async function rawPatchMesas(accessToken, mesaId, patchBody) {
  const t0 = performance.now();
  const res = await fetch(`${url}/rest/v1/mesas?id=eq.${mesaId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(patchBody)
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

function getCombatant(combate, tokenId) {
  return (combate?.ordem || []).find((it) => it.token_id === tokenId) || null;
}

function availableOf(as) {
  if (!as || as.initialBudget == null) return 0;
  return Math.max(0, Number(as.initialBudget) - Number(as.spentActions || 0) - Number(as.reservedActions || 0));
}

function fingerprintCombat(combate) {
  return JSON.stringify({
    versao: combate?.versao,
    round: combate?.round,
    turno_atual_idx: combate?.turno_atual_idx,
    opps: (combate?.oportunidades_reacao || []).map((o) => [o.opportunityId, o.status]),
    reqs: (combate?.solicitacoes_reacao || []).map((r) => [r.requestId, r.status]),
    balances: (combate?.ordem || []).map((it) => [
      it.token_id,
      it.action_state?.version,
      it.action_state?.spentActions,
      it.action_state?.reservedActions,
      it.action_state?.turnEnded
    ])
  });
}

function subscribeChannel(client, name, configs, onEvent) {
  return new Promise((resolve, reject) => {
    const ch = client.channel(name);
    for (const c of configs) {
      ch.on("postgres_changes", c, (payload) => onEvent(c.table, payload));
    }
    const timer = setTimeout(() => reject(new Error(`Timeout SUBSCRIBED em ${name}`)), 15000);
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        channels.push([client, ch]);
        resolve(ch);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`Canal ${name} falhou: ${status} ${err?.message || ""}`));
      }
    });
  });
}

async function waitFor(predicate, timeoutMs = 8000, stepMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return predicate();
}

async function main() {
  let exitCode = 0;
  const runId = crypto.randomBytes(4).toString("hex");
  const metrics = {
    runId,
    utcStart: new Date().toISOString(),
    latenciesMs: {},
    httpCodes: {}
  };

  try {
    // ── Autenticação real via GoTrue Homologação ─────────────────────────
    const gm1 = await login(cfg.gm1.email);
    const gm1b = await login(cfg.gm1.email);
    const playerA = await login(cfg.playerA.email);
    const playerB = await login(cfg.playerB.email);
    const gm2 = await login(cfg.gm2.email);
    const outsider = await login(cfg.outsider.email);
    record("AUTH-LOGIN", true, "6 sessões JWT autenticadas via GoTrue (gm1, gm1b, playerA, playerB, gm2, outsider)");

    // ── Setup Mesa 1 (combate principal) e Mesa 2 (isolamento cross-table) ─
    const mesa1 = crypto.randomUUID();
    const map1 = crypto.randomUUID();
    const invite1 = "M1" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const mesa2 = crypto.randomUUID();
    const map2 = crypto.randomUUID();
    const invite2 = "M2" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const crRefId = crypto.randomUUID();
    const hiddenRefId = crypto.randomUUID();

    const m1Ins = await gm1.client.from("mesas").insert({
      id: mesa1,
      nome: `QA P9.2 Mesa 1 ${runId}`,
      mestre_id: gm1.userId,
      codigo_convite: invite1,
      mapas: [{ id: map1, slot: 1, nome: "Saloon P9.2", grid_cols: 20, url: null }],
      mapa_ativo_jogadores_id: map1,
      cena_ativa: [
        {
          instanceId: crRefId,
          sourceType: "custom",
          sourceCategory: "NPC",
          operationalMode: "creature_mode",
          data: { nome: "Capanga Criatura", operationalMode: "creature_mode", isCriatura: true }
        },
        {
          instanceId: hiddenRefId,
          sourceType: "custom",
          sourceCategory: "NPC",
          operationalMode: "creature_mode",
          data: { nome: "Atirador Oculto", operationalMode: "creature_mode", isCriatura: true }
        }
      ]
    });
    if (m1Ins.error) throw new Error("Criar Mesa 1: " + m1Ins.error.message);
    cleanupMesas.push([gm1.client, mesa1]);

    const m2Ins = await gm2.client.from("mesas").insert({
      id: mesa2,
      nome: `QA P9.2 Mesa 2 ${runId}`,
      mestre_id: gm2.userId,
      codigo_convite: invite2,
      mapas: [{ id: map2, slot: 1, nome: "Canyon P9.2", grid_cols: 20, url: null }],
      mapa_ativo_jogadores_id: map2
    });
    if (m2Ins.error) throw new Error("Criar Mesa 2: " + m2Ins.error.message);
    cleanupMesas.push([gm2.client, mesa2]);

    await gm1.client.from("membros_mesa").insert({ mesa_id: mesa1, usuario_id: gm1.userId, cargo: "mestre" });
    await gm2.client.from("membros_mesa").insert({ mesa_id: mesa2, usuario_id: gm2.userId, cargo: "mestre" });

    const joinA = await playerA.client.rpc("entrar_na_mesa_por_codigo", { p_codigo: invite1 });
    if (joinA.error) throw new Error("playerA join: " + joinA.error.message);
    const joinB = await playerB.client.rpc("entrar_na_mesa_por_codigo", { p_codigo: invite1 });
    if (joinB.error) throw new Error("playerB join: " + joinB.error.message);

    // Tokens na Mesa 1:
    // tokA (playerA, init 16 => 4 ações, grid 2,2)
    // tokB (playerB, init 10 => 2 ações, grid 3,2 => distância 1 quadrado = 1.5m de tokA)
    // tokCr (criatura do Xerife, init 6 => 2 ações, grid 10,10 => distância 8 quadrados = 12m de tokA)
    // tokHidden (NPC oculto do Xerife, init 4, visible_to_players=false, grid 4,2)
    const tokA = crypto.randomUUID();
    const tokB = crypto.randomUUID();
    const tokCr = crypto.randomUUID();
    const tokHidden = crypto.randomUUID();

    const toksIns = await gm1.client.from("mesa_tokens").insert([
      {
        id: tokA,
        mesa_id: mesa1,
        mapa_id: map1,
        owner_type: "player",
        owner_ref: crypto.randomUUID(),
        owner_user_id: playerA.userId,
        display_name: "Pistoleiro A",
        grid_x: 2,
        grid_y: 2,
        iniciativa: 16,
        visible_to_players: true
      },
      {
        id: tokB,
        mesa_id: mesa1,
        mapa_id: map1,
        owner_type: "player",
        owner_ref: crypto.randomUUID(),
        owner_user_id: playerB.userId,
        display_name: "Batedora B",
        grid_x: 3,
        grid_y: 2,
        iniciativa: 10,
        visible_to_players: true
      },
      {
        id: tokCr,
        mesa_id: mesa1,
        mapa_id: map1,
        owner_type: "creature",
        owner_ref: crRefId,
        owner_user_id: null,
        display_name: "Coiote",
        grid_x: 10,
        grid_y: 10,
        iniciativa: 6,
        visible_to_players: true
      },
      {
        id: tokHidden,
        mesa_id: mesa1,
        mapa_id: map1,
        owner_type: "creature",
        owner_ref: hiddenRefId,
        owner_user_id: null,
        display_name: "Atirador Oculto",
        grid_x: 4,
        grid_y: 2,
        iniciativa: 4,
        visible_to_players: false
      }
    ]);
    if (toksIns.error) throw new Error("Inserir tokens Mesa 1: " + toksIns.error.message);

    // Garantir iniciativa exata dos tokens de jogador após o trigger BEFORE INSERT
    const uA = await gm1.client.from("mesa_tokens").update({ iniciativa: 16 }).eq("id", tokA);
    if (uA.error) throw new Error("Update init tokA: " + uA.error.message);
    const uB = await gm1.client.from("mesa_tokens").update({ iniciativa: 8 }).eq("id", tokB);
    if (uB.error) throw new Error("Update init tokB: " + uB.error.message);

    // ── Iniciar Combate (Round 1, turno_atual_idx = 0 => tokA) ───────────
    const startRes = await rawRpc(gm1.token, "gerenciar_combate", {
      p_mesa_id: mesa1,
      p_acao: "iniciar",
      p_participantes: [
        { token_id: tokA, modo: "ficha", prioridade: 1 },
        { token_id: tokB, modo: "ficha", prioridade: 2 },
        { token_id: tokCr, modo: "ficha", prioridade: 3 },
        { token_id: tokHidden, modo: "ficha", prioridade: 4 }
      ]
    });
    const orderSummary = (startRes.json?.combate?.ordem || []).map((o) => `${o.name}:${o.iniciativa}(b=${o.action_state?.initialBudget})`).join(", ");
    record(
      "SETUP-COMBAT",
      startRes.status === 200 &&
        startRes.json?.combate?.round === 1 &&
        startRes.json?.combate?.turno_atual_idx === 0 &&
        startRes.json?.combate?.ordem?.[0]?.token_id === tokA,
      `HTTP ${startRes.status} (${startRes.elapsedMs}ms) ordem=[${orderSummary}]`
    );

    const combateId = startRes.json.combate.id;
    let currentCombat = startRes.json.combate;

    // ═════════════════════════════════════════════════════════════════════
    // FASE G (Setup antecipado de Realtime para capturar toda a bateria!)
    // ═════════════════════════════════════════════════════════════════════
    const rtEvents = { gm1: [], playerB: [], gm2: [], outsider: [] };
    await subscribeChannel(
      gm1.client,
      `rt-gm1-${runId}`,
      [{ event: "*", schema: "public", table: "mesa_combate_sinais", filter: `mesa_id=eq.${mesa1}` }],
      (tbl, p) => rtEvents.gm1.push({ tbl, rev: p.new?.revisao, mesa_id: p.new?.mesa_id, eventType: p.eventType })
    );
    await subscribeChannel(
      playerB.client,
      `rt-plb-${runId}`,
      [{ event: "*", schema: "public", table: "mesa_combate_sinais", filter: `mesa_id=eq.${mesa1}` }],
      (tbl, p) => rtEvents.playerB.push({ tbl, rev: p.new?.revisao, mesa_id: p.new?.mesa_id, eventType: p.eventType })
    );
    // gm2 e outsider escutam SEM filtro para provar que RLS impede vazamento de outra mesa!
    await subscribeChannel(
      gm2.client,
      `rt-gm2-${runId}`,
      [
        { event: "*", schema: "public", table: "mesa_combate_sinais" },
        { event: "*", schema: "public", table: "mesas" },
        { event: "*", schema: "public", table: "mesa_tokens" }
      ],
      (tbl, p) => {
        const mid = p.new?.mesa_id || p.new?.id || p.old?.mesa_id || p.old?.id;
        if (mid === mesa1) rtEvents.gm2.push({ tbl, mid, eventType: p.eventType });
      }
    );
    await subscribeChannel(
      outsider.client,
      `rt-out-${runId}`,
      [
        { event: "*", schema: "public", table: "mesa_combate_sinais" },
        { event: "*", schema: "public", table: "mesas" },
        { event: "*", schema: "public", table: "mesa_tokens" }
      ],
      (tbl, p) => {
        const mid = p.new?.mesa_id || p.new?.id || p.old?.mesa_id || p.old?.id;
        if (mid === mesa1) rtEvents.outsider.push({ tbl, mid, eventType: p.eventType });
      }
    );
    record("G-REALTIME-SUBSCRIBE", true, "4 canais WebSocket SUBSCRIBED (gm1, playerB, gm2-unfiltered, outsider-unfiltered)");

    // ═════════════════════════════════════════════════════════════════════
    // FASE E (COM-11 — Oportunidades contextuais) + preparação p/ Fase D
    // ═════════════════════════════════════════════════════════════════════
    const e11Far = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-e11-far-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: tokCr,
      p_reach_meters: 1.5,
      p_range_confirmed: false,
      p_mapa_id: map1,
      p_round: 1
    });
    record(
      "E11-GRID-OUT-OF-RANGE",
      e11Far.status === 400 && e11Far.json?.code === "22023",
      `HTTP ${e11Far.status} code=${e11Far.json?.code} msg="${e11Far.json?.message}" (${e11Far.elapsedMs}ms)`
    );

    const e11NoTarget = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-e11-notarget-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: null,
      p_reach_meters: 1.5,
      p_range_confirmed: false,
      p_mapa_id: map1,
      p_round: 1
    });
    record(
      "E11-NO-INVENTED-RANGE",
      e11NoTarget.status === 400 && e11NoTarget.json?.code === "22023",
      `HTTP ${e11NoTarget.status} code=${e11NoTarget.json?.code} (${e11NoTarget.elapsedMs}ms)`
    );

    const e11Valid = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-e11-valid-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: tokB,
      p_reach_meters: 1.5,
      p_range_confirmed: false,
      p_trigger_label: "Batedora B recuou adjacente",
      p_mapa_id: map1,
      p_round: 1
    });
    const opp1Id = e11Valid.json?.result?.opportunityId;
    const opp1Obj = (e11Valid.json?.combate?.oportunidades_reacao || []).find((o) => o.opportunityId === opp1Id);
    record(
      "E11-VALID-GRID",
      e11Valid.status === 200 &&
        e11Valid.json?.result?.rangeStatus === "in_range" &&
        Number(e11Valid.json?.result?.gridDistanceMeters) === 1.5 &&
        opp1Obj?.passiveSkillRequired === true &&
        opp1Obj?.passiveSkillKey === "combate-corpo-a-corpo",
      `HTTP ${e11Valid.status} dist=1.5m rangeStatus=in_range skill=combate-corpo-a-corpo (${e11Valid.elapsedMs}ms)`
    );

    const e11Close = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "close_opportunity",
      p_op_id: `op-e11-close-${runId}`,
      p_opportunity_id: opp1Id,
      p_justificativa: "Gatilho cancelado pelo Xerife",
      p_mapa_id: map1,
      p_round: 1
    });
    record(
      "E11-CLOSE",
      e11Close.status === 200 && e11Close.json?.result?.status === "closed",
      `HTTP ${e11Close.status} status=closed (${e11Close.elapsedMs}ms)`
    );

    const e11DoubleClose = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "close_opportunity",
      p_op_id: `op-e11-close2-${runId}`,
      p_opportunity_id: opp1Id,
      p_mapa_id: map1,
      p_round: 1
    });
    record(
      "E11-CLOSE-ALREADY-CLOSED-PT409",
      e11DoubleClose.status === 409 && e11DoubleClose.json?.code === "PT409",
      `HTTP ${e11DoubleClose.status} code=${e11DoubleClose.json?.code} (${e11DoubleClose.elapsedMs}ms)`
    );

    // ── Player B solicita reação antecipada (pré-turno) para servir à Fase D & E10 ──
    const req1 = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-e10-req1-${runId}`,
      p_action_type: "reacao",
      p_trigger_label: "Esquiva antecipada antes da vez",
      p_mapa_id: map1,
      p_round: 1
    });
    const req1Id = req1.json?.result?.requestId;
    record(
      "E10-REQUEST",
      req1.status === 200 &&
        req1.json?.result?.status === "pending" &&
        req1.json?.result?.spentActions === 0 &&
        req1.json?.result?.availableActions === 2,
      `HTTP ${req1.status} reqId=${req1Id} spent=0 avail=2 (${req1.elapsedMs}ms)`
    );

    // ═════════════════════════════════════════════════════════════════════
    // FASE D — AUDITORIA REAL DE SEGURANÇA (12 tentativas negativas + zero side effects)
    // ═════════════════════════════════════════════════════════════════════
    const beforeNeg = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const fpBefore = fingerprintCombat(beforeNeg);

    // D1: anon sem JWT
    const dAnon = await rawRpc(null, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-d-anon-${runId}`
    });
    metrics.httpCodes.dAnon = { status: dAnon.status, code: dAnon.json?.code };
    record(
      "D-ANON-BLOCKED",
      (dAnon.status === 401 || dAnon.status === 403) && dAnon.json?.code === "42501",
      `HTTP ${dAnon.status} code=${dAnon.json?.code} (${dAnon.elapsedMs}ms)`
    );

    // D2: helper interno bloqueado para authenticated
    const dHelper = await rawRpc(playerB.token, "calcular_fase_turno_combate", {
      p_estado: {},
      p_item: {},
      p_item_pos: 0
    });
    record(
      "D-HELPER-BLOCKED",
      (dHelper.status === 403 || dHelper.status === 404) && (dHelper.json?.code === "42501" || dHelper.json?.code === "PGRST202"),
      `HTTP ${dHelper.status} code=${dHelper.json?.code} (${dHelper.elapsedMs}ms)`
    );

    // D3: outsider leitura
    const dOutRead = await rawRpc(outsider.token, "obter_combate_publico", { p_mesa_id: mesa1 });
    record(
      "D-OUTSIDER-READ-BLOCKED",
      (dOutRead.status === 403 || dOutRead.status === 400) && dOutRead.json?.code === "42501",
      `HTTP ${dOutRead.status} code=${dOutRead.json?.code} (${dOutRead.elapsedMs}ms)`
    );

    // D4: outsider escrita
    const dOutWrite = await rawRpc(outsider.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-d-out-${runId}`
    });
    record(
      "D-OUTSIDER-WRITE-BLOCKED",
      (dOutWrite.status === 403 || dOutWrite.status === 400) && dOutWrite.json?.code === "42501",
      `HTTP ${dOutWrite.status} code=${dOutWrite.json?.code} (${dOutWrite.elapsedMs}ms)`
    );

    // D5: Xerife de outra mesa (gm2) tentando aprovar na Mesa 1
    const dGm2Approve = await rawRpc(gm2.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "approve_early_reaction",
      p_request_id: req1Id,
      p_op_id: `op-d-gm2-app-${runId}`
    });
    record(
      "D-CROSS-GM2-APPROVE-BLOCKED",
      (dGm2Approve.status === 403 || dGm2Approve.status === 400) && dGm2Approve.json?.code === "42501",
      `HTTP ${dGm2Approve.status} code=${dGm2Approve.json?.code} (${dGm2Approve.elapsedMs}ms)`
    );

    // D6: Xerife de outra mesa (gm2) tentando abrir oportunidade na Mesa 1
    const dGm2Opp = await rawRpc(gm2.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-d-gm2-opp-${runId}`,
      p_range_confirmed: true
    });
    record(
      "D-CROSS-GM2-OPP-BLOCKED",
      (dGm2Opp.status === 403 || dGm2Opp.status === 400) && dGm2Opp.json?.code === "42501",
      `HTTP ${dGm2Opp.status} code=${dGm2Opp.json?.code} (${dGm2Opp.elapsedMs}ms)`
    );

    // D7: Jogador tentando aprovar a própria solicitação
    const dSelfApprove = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "approve_early_reaction",
      p_request_id: req1Id,
      p_op_id: `op-d-self-app-${runId}`
    });
    record(
      "D-SELF-APPROVE-BLOCKED",
      (dSelfApprove.status === 403 || dSelfApprove.status === 400) && dSelfApprove.json?.code === "42501",
      `HTTP ${dSelfApprove.status} code=${dSelfApprove.json?.code} (${dSelfApprove.elapsedMs}ms)`
    );

    // D8: Jogador A tentando cancelar solicitação de Jogador B
    const dCancelOther = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "cancel_early_reaction",
      p_request_id: req1Id,
      p_op_id: `op-d-cancel-other-${runId}`
    });
    record(
      "D-CANCEL-OTHER-BLOCKED",
      (dCancelOther.status === 403 || dCancelOther.status === 400) && dCancelOther.json?.code === "42501",
      `HTTP ${dCancelOther.status} code=${dCancelOther.json?.code} (${dCancelOther.elapsedMs}ms)`
    );

    // D9: Jogador tentando abrir oportunidade COM-11
    const dPlayerOpp = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "open_opportunity",
      p_op_id: `op-d-pl-opp-${runId}`,
      p_range_confirmed: true
    });
    record(
      "D-PLAYER-OPEN-OPP-BLOCKED",
      (dPlayerOpp.status === 403 || dPlayerOpp.status === 400) && dPlayerOpp.json?.code === "42501",
      `HTTP ${dPlayerOpp.status} code=${dPlayerOpp.json?.code} (${dPlayerOpp.elapsedMs}ms)`
    );

    // D10: Jogador tentando operar NPC/Criatura sem controle
    const dPlayerNpc = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokCr,
      p_operacao: "request_early_reaction",
      p_op_id: `op-d-pl-npc-${runId}`
    });
    record(
      "D-PLAYER-NPC-BLOCKED",
      (dPlayerNpc.status === 403 || dPlayerNpc.status === 400) && dPlayerNpc.json?.code === "42501",
      `HTTP ${dPlayerNpc.status} code=${dPlayerNpc.json?.code} (${dPlayerNpc.elapsedMs}ms)`
    );

    // D11: Jogador tentando UPDATE direto em public.mesas.combate_ativo
    const dDirectPatch = await rawPatchMesas(playerB.token, mesa1, { combate_ativo: null });
    record(
      "D-DIRECT-UPDATE-MESAS-BLOCKED",
      (dDirectPatch.status === 200 && Array.isArray(dDirectPatch.json) && dDirectPatch.json.length === 0) ||
        dDirectPatch.status === 403 ||
        dDirectPatch.status === 401,
      `HTTP ${dDirectPatch.status} rowsUpdated=${Array.isArray(dDirectPatch.json) ? dDirectPatch.json.length : "err"} (${dDirectPatch.elapsedMs}ms)`
    );

    // D12: Custo adulterado (p_cost = 0)
    const dTamperCost = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-d-cost0-${runId}`,
      p_action_type: "reacao",
      p_cost: 0,
      p_range_confirmed: true
    });
    record(
      "D-TAMPER-COST-BLOCKED",
      dTamperCost.status === 400 && dTamperCost.json?.code === "22023",
      `HTTP ${dTamperCost.status} code=${dTamperCost.json?.code} (${dTamperCost.elapsedMs}ms)`
    );

    // Zero efeitos colaterais
    const afterNeg = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const fpAfter = fingerprintCombat(afterNeg);
    record(
      "D-ZERO-SIDE-EFFECTS",
      fpBefore === fpAfter,
      fpBefore === fpAfter ? "Fingerprint 100% idêntico após 12 ataques negativos" : `DIFF: ${fpBefore} vs ${fpAfter}`
    );

    // ═════════════════════════════════════════════════════════════════════
    // FASE E (COM-10 & COM-09 completos)
    // ═════════════════════════════════════════════════════════════════════
    // Privacidade da projeção de obter_combate_publico para playerA
    const pubA = (await rawRpc(playerA.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const pubATokB = getCombatant(pubA, tokB);
    const pubAHidden = getCombatant(pubA, tokHidden);
    record(
      "E10-PRIVACY-PROJECTION",
      (pubA.solicitacoes_reacao || []).length === 0 &&
        pubATokB != null &&
        pubATokB.action_state === undefined &&
        pubAHidden === null &&
        pubA.reaction_op_results === undefined,
      "playerA não vê solicitações/action_state de playerB, nem tokHidden, nem reaction_op_results"
    );

    // Negação pelo Xerife (zero consumo)
    const e10Deny = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "deny_early_reaction",
      p_request_id: req1Id,
      p_op_id: `op-e10-deny-${runId}`,
      p_justificativa: "Sem linha de visão"
    });
    record(
      "E10-DENY-ZERO-COST",
      e10Deny.status === 200 &&
        e10Deny.json?.result?.status === "denied" &&
        e10Deny.json?.result?.spentActions === 0 &&
        e10Deny.json?.result?.availableActions === 2,
      `HTTP ${e10Deny.status} status=denied spent=0 avail=2 (${e10Deny.elapsedMs}ms)`
    );

    // Solicitar + Cancelar pelo jogador (zero consumo)
    const req2 = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-e10-req2-${runId}`,
      p_action_type: "reacao"
    });
    const req2Id = req2.json?.result?.requestId;
    const e10Cancel = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "cancel_early_reaction",
      p_request_id: req2Id,
      p_op_id: `op-e10-cancel-${runId}`
    });
    record(
      "E10-CANCEL-ZERO-COST",
      e10Cancel.status === 200 &&
        e10Cancel.json?.result?.status === "cancelled" &&
        e10Cancel.json?.result?.spentActions === 0 &&
        e10Cancel.json?.result?.availableActions === 2,
      `HTTP ${e10Cancel.status} status=cancelled spent=0 avail=2 (${e10Cancel.elapsedMs}ms)`
    );

    // Solicitar + Aprovar pelo Xerife (-1 ação, iniciativa preservada)
    const req3 = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-e10-req3-${runId}`,
      p_action_type: "reacao"
    });
    const req3Id = req3.json?.result?.requestId;
    const gmBeforeApprove = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const orderBeforeApprove = (gmBeforeApprove.ordem || []).map((x) => x.token_id).join(",");

    const e10Approve = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "approve_early_reaction",
      p_request_id: req3Id,
      p_op_id: `op-e10-approve-${runId}`
    });
    const orderAfterApprove = (e10Approve.json.combate.ordem || []).map((x) => x.token_id).join(",");
    record(
      "E10-APPROVE-ONE-ACTION-KEEP-ORDER",
      e10Approve.status === 200 &&
        e10Approve.json?.result?.status === "approved" &&
        e10Approve.json?.result?.spentActions === 1 &&
        e10Approve.json?.result?.availableActions === 1 &&
        e10Approve.json?.combate?.turno_atual_idx === 0 &&
        orderBeforeApprove === orderAfterApprove,
      `HTTP ${e10Approve.status} spent=1 avail=1 turno_atual_idx=0 ordem preservada (${e10Approve.elapsedMs}ms)`
    );
    currentCombat = e10Approve.json.combate;

    // ── COM-09: Encerrar turno de tokA (com 4 ações restantes) -> pós-turno ─
    const next1 = await rawRpc(gm1.token, "gerenciar_combate", {
      p_mesa_id: mesa1,
      p_acao: "proximo",
      p_combate_id: combateId,
      p_versao: currentCombat.versao
    });
    currentCombat = next1.json.combate;
    const tokAAfterEnd = getCombatant(currentCombat, tokA);
    record(
      "E09-END-TURN-PRESERVES-BUDGET",
      next1.status === 200 &&
        currentCombat.turno_atual_idx === 1 &&
        tokAAfterEnd?.action_state?.turnEnded === true &&
        availableOf(tokAAfterEnd?.action_state) === 4,
      `HTTP ${next1.status} tokA turnEnded=true avail=4 (${next1.elapsedMs}ms)`
    );

    // Bloqueio de ação comum pós-turno
    const e09OrdBlocked = await rawRpc(playerA.token, "gerenciar_acao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "commit",
      p_op_id: `op-e09-ord-${runId}`,
      p_action_type: "ataque",
      p_cost: 1,
      p_is_reaction: false,
      p_result_revealed: true,
      p_mapa_id: map1,
      p_round: 1
    });
    record(
      "E09-ORDINARY-ACTION-BLOCKED-POST-TURN",
      e09OrdBlocked.status === 400 && e09OrdBlocked.json?.code === "22023",
      `HTTP ${e09OrdBlocked.status} code=${e09OrdBlocked.json?.code} (${e09OrdBlocked.elapsedMs}ms)`
    );

    // Reconexão fresca do playerA recupera turnEnded=true
    const playerA2 = await login(cfg.playerA.email);
    const pubA2 = await rawRpc(playerA2.token, "obter_combate_publico", { p_mesa_id: mesa1 });
    const tokAReconn = getCombatant(pubA2.json?.combate, tokA);
    record(
      "E09-RECONNECT-HYDRATES-TURN-ENDED",
      pubA2.status === 200 &&
        tokAReconn?.action_state?.turnEnded === true &&
        availableOf(tokAReconn?.action_state) === 4,
      `Nova sessão playerA2 recuperou turnEnded=true, avail=4 (${pubA2.elapsedMs}ms)`
    );

    // Abrir oportunidade válida pós-turno para tokA e executar reação pós-turno (4 -> 3)
    const oppPost = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-e09-opp-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: tokB,
      p_reach_meters: 1.5,
      p_mapa_id: map1,
      p_round: 1
    });
    const oppPostId = oppPost.json?.result?.opportunityId;

    const execPost = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "execute_opportunity_reaction",
      p_op_id: `op-e09-exec-${runId}`,
      p_opportunity_id: oppPostId,
      p_mapa_id: map1,
      p_round: 1
    });
    currentCombat = execPost.json.combate;
    record(
      "E09-POST-TURN-REACTION-CONSUMES-ONE",
      execPost.status === 200 &&
        execPost.json?.result?.turnPhase === "post_turn" &&
        execPost.json?.result?.spentActions === 1 &&
        execPost.json?.result?.availableActions === 3,
      `HTTP ${execPost.status} phase=post_turn spent=1 avail=3 (${execPost.elapsedMs}ms)`
    );

    // Virada de rodada (R1 -> R2): expira saldo restante R1 (não transfere), limpa opps/reqs
    // Atualmente turno_atual_idx=1 (tokB), avançar 3 vezes (tokB->tokCr->tokHidden->R2 tokA)
    for (let i = 0; i < 3; i++) {
      const adv = await rawRpc(gm1.token, "gerenciar_combate", {
        p_mesa_id: mesa1,
        p_acao: "proximo",
        p_combate_id: combateId,
        p_versao: currentCombat.versao
      });
      if (adv.status !== 200) throw new Error(`Avanço para R2 passo ${i} falhou: HTTP ${adv.status} ${JSON.stringify(adv.json)}`);
      currentCombat = adv.json.combate;
    }
    const tokAR2 = getCombatant(currentCombat, tokA);
    record(
      "E09-ROLLOVER-EXPIRES-AND-NO-CARRYOVER",
      currentCombat.round === 2 &&
        currentCombat.turno_atual_idx === 0 &&
        tokAR2?.action_state?.initialBudget === 4 &&
        tokAR2?.action_state?.spentActions === 0 &&
        (currentCombat.oportunidades_reacao || []).length === 0 &&
        (currentCombat.solicitacoes_reacao || []).length === 0,
      `Round=2 tokA budget=4 (sem carryover de R1), spent=0, opps=0, reqs=0`
    );

    // ═════════════════════════════════════════════════════════════════════
    // FASE F — CONCORRÊNCIA REAL HTTP/PostgREST & PT409 (8 CENÁRIOS CRÍTICOS)
    // ═════════════════════════════════════════════════════════════════════
    // F1: Duas aprovações simultâneas na mesma solicitação
    const f1Req = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-f1-req-${runId}`,
      p_action_type: "reacao",
      p_round: 2
    });
    const f1ReqId = f1Req.json.result.requestId;
    const f1Ver = f1Req.json.combate.versao;

    const [f1a, f1b] = await Promise.all([
      rawRpc(gm1.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f1ReqId,
        p_op_id: `op-f1-app-a-${runId}`,
        p_expected_combat_version: f1Ver,
        p_round: 2
      }),
      rawRpc(gm1b.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f1ReqId,
        p_op_id: `op-f1-app-b-${runId}`,
        p_expected_combat_version: f1Ver,
        p_round: 2
      })
    ]);
    const f1Win = f1a.status === 200 ? f1a : f1b;
    const f1Lose = f1a.status === 200 ? f1b : f1a;
    const f1WinnerOpId = f1a.status === 200 ? `op-f1-app-a-${runId}` : `op-f1-app-b-${runId}`;
    metrics.latenciesMs.f1Win = f1Win.elapsedMs;
    metrics.latenciesMs.f1LosePt409 = f1Lose.elapsedMs;
    record(
      "F1-CONCURRENT-DOUBLE-APPROVE-PT409",
      f1Win.status === 200 &&
        f1Lose.status === 409 &&
        f1Lose.json?.code === "PT409" &&
        f1Lose.elapsedMs < 3000 &&
        f1Win.json?.result?.spentActions === 1 &&
        f1Win.json?.result?.availableActions === 1,
      `win=HTTP ${f1Win.status} (${f1Win.elapsedMs}ms), lose=HTTP ${f1Lose.status} code=${f1Lose.json?.code} (${f1Lose.elapsedMs}ms), spent=1, avail=1`
    );

    // F3: Replay simultâneo do mesmo p_op_id vencedor de F1 (mesmo com versão obsoleta f1Ver!)
    const [f3a, f3b] = await Promise.all([
      rawRpc(gm1.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f1ReqId,
        p_op_id: f1WinnerOpId,
        p_expected_combat_version: f1Ver,
        p_round: 2
      }),
      rawRpc(gm1b.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f1ReqId,
        p_op_id: f1WinnerOpId,
        p_expected_combat_version: f1Ver,
        p_round: 2
      })
    ]);
    const tokBAfterF3 = getCombatant(f3a.json?.combate, tokB);
    record(
      "F3-CONCURRENT-IDEMPOTENT-REPLAY",
      f3a.status === 200 &&
        f3b.status === 200 &&
        f3a.json?.result?.idempotentReplay === true &&
        f3b.json?.result?.idempotentReplay === true &&
        tokBAfterF3?.action_state?.spentActions === 1,
      `2x HTTP 200 idempotentReplay=true (${f3a.elapsedMs}ms/${f3b.elapsedMs}ms), spent permanece 1`
    );

    // F2: Aprovação vs Negação simultâneas na mesma solicitação
    const f2Req = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-f2-req-${runId}`,
      p_action_type: "reacao",
      p_round: 2
    });
    const f2ReqId = f2Req.json.result.requestId;
    const [f2App, f2Den] = await Promise.all([
      rawRpc(gm1.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f2ReqId,
        p_op_id: `op-f2-app-${runId}`,
        p_round: 2
      }),
      rawRpc(gm1b.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "deny_early_reaction",
        p_request_id: f2ReqId,
        p_op_id: `op-f2-den-${runId}`,
        p_round: 2
      })
    ]);
    const f2Win = f2App.status === 200 ? f2App : f2Den;
    const f2Lose = f2App.status === 200 ? f2Den : f2App;
    metrics.latenciesMs.f2LosePt409 = f2Lose.elapsedMs;
    record(
      "F2-CONCURRENT-APPROVE-VS-DENY-PT409",
      f2Win.status === 200 && f2Lose.status === 409 && f2Lose.json?.code === "PT409" && f2Lose.elapsedMs < 3000,
      `winner=${f2Win.json?.result?.operation} HTTP ${f2Win.status} (${f2Win.elapsedMs}ms), loser=HTTP ${f2Lose.status} code=${f2Lose.json?.code} (${f2Lose.elapsedMs}ms)`
    );

    // F4: Disputa pela última ação disponível (tokCr em creature_mode tem budget=1 => avail=1!)
    const f4Req = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokCr,
      p_operacao: "request_early_reaction",
      p_op_id: `op-f4-req-${runId}`,
      p_action_type: "reacao",
      p_round: 2
    });
    if (f4Req.status !== 200) throw new Error("F4 req tokCr falhou: " + JSON.stringify(f4Req.json));
    const f4ReqId = f4Req.json.result.requestId;

    const [f4a, f4b] = await Promise.all([
      rawRpc(gm1.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokCr,
        p_operacao: "approve_early_reaction",
        p_request_id: f4ReqId,
        p_op_id: `op-f4-app-${runId}`,
        p_round: 2
      }),
      rawRpc(gm1b.token, "gerenciar_acao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokCr,
        p_operacao: "reserve",
        p_op_id: `op-f4-res-${runId}`,
        p_action_type: "reacao",
        p_cost: 1,
        p_is_reaction: true,
        p_mapa_id: map1,
        p_round: 2
      })
    ]);
    const f4SuccessCount = (f4a.status === 200 ? 1 : 0) + (f4b.status === 200 ? 1 : 0);
    const f4State = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const tokCrAfterF4 = getCombatant(f4State, tokCr);
    const crAvailAfterF4 = availableOf(tokCrAfterF4?.action_state);
    // Se reserve venceu, cancelar reserva para permitir virada de rodada em F5/F6!
    const crReservedEntry = (tokCrAfterF4?.action_state?.ledger || []).find((e) => e.status === "reserved");
    if (crReservedEntry) {
      await rawRpc(gm1.token, "gerenciar_acao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokCr,
        p_operacao: "cancel",
        p_op_id: `op-f4-unres-${runId}`,
        p_reservation_id: crReservedEntry.reservationId,
        p_mapa_id: map1,
        p_round: 2
      });
    }
    record(
      "F4-LAST-ACTION-RACE-NO-NEGATIVE",
      f4SuccessCount === 1 && crAvailAfterF4 === 0 && tokCrAfterF4.action_state.spentActions + tokCrAfterF4.action_state.reservedActions === 1,
      `approve=HTTP ${f4a.status} (${f4a.json?.code || "ok"}), reserve=HTTP ${f4b.status} (${f4b.json?.code || "ok"}), finalAvail=${crAvailAfterF4} (nunca negativo)`
    );

    // F5: Avanço de turno concorrente à aprovação
    // Garantir que tokB tem 1 ação disponível (se F2 aprovou, vamos avançar para Round 3 primeiro)
    currentCombat = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    for (let i = 0; i < 4; i++) {
      const adv = await rawRpc(gm1.token, "gerenciar_combate", {
        p_mesa_id: mesa1,
        p_acao: "proximo",
        p_combate_id: combateId,
        p_versao: currentCombat.versao
      });
      currentCombat = adv.json.combate;
    }
    // Agora Round 3, turno_atual_idx=0 (tokA), tokB com avail=2 em pre_turn
    const f5Req = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "request_early_reaction",
      p_op_id: `op-f5-req-${runId}`,
      p_action_type: "reacao",
      p_round: 3
    });
    const f5ReqId = f5Req.json.result.requestId;
    const f5Ver = f5Req.json.combate.versao;

    const [f5Adv, f5App] = await Promise.all([
      rawRpc(gm1.token, "gerenciar_combate", {
        p_mesa_id: mesa1,
        p_acao: "proximo",
        p_combate_id: combateId,
        p_versao: f5Ver
      }),
      rawRpc(gm1b.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "approve_early_reaction",
        p_request_id: f5ReqId,
        p_op_id: `op-f5-app-${runId}`,
        p_expected_combat_version: f5Ver,
        p_round: 3
      })
    ]);
    const f5Post = (await rawRpc(gm1.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const f5ReqState = (f5Post.solicitacoes_reacao || []).find((r) => r.requestId === f5ReqId);
    const f5TokB = getCombatant(f5Post, tokB);
    const f5Consistent =
      (f5Adv.status === 200 &&
        f5App.status === 409 &&
        f5App.json?.code === "PT409" &&
        f5ReqState?.status === "expired" &&
        f5TokB?.action_state?.spentActions === 0) ||
      (f5App.status === 200 &&
        f5Adv.status !== 200 &&
        f5ReqState?.status === "approved" &&
        f5TokB?.action_state?.spentActions === 1);
    record(
      "F5-TURN-ADVANCE-VS-APPROVE",
      f5Consistent,
      `proximo=HTTP ${f5Adv.status} (${f5Adv.elapsedMs}ms), approve=HTTP ${f5App.status} code=${f5App.json?.code || "ok"} (${f5App.elapsedMs}ms), reqStatus=${f5ReqState?.status}, spent=${f5TokB?.action_state?.spentActions}`
    );

    // F6: Encerramento de rodada durante oportunidade pendente + tentativa tardia -> PT409
    currentCombat = f5Post;
    const f6Opp = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-f6-opp-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: tokB,
      p_reach_meters: 1.5,
      p_round: 3
    });
    const f6OppId = f6Opp.json.result.opportunityId;
    currentCombat = f6Opp.json.combate;
    while (currentCombat.round === 3) {
      const adv = await rawRpc(gm1.token, "gerenciar_combate", {
        p_mesa_id: mesa1,
        p_acao: "proximo",
        p_combate_id: combateId,
        p_versao: currentCombat.versao
      });
      currentCombat = adv.json.combate;
    }
    const f6LateExec = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "execute_opportunity_reaction",
      p_op_id: `op-f6-late-${runId}`,
      p_opportunity_id: f6OppId,
      p_round: 3
    });
    const f6LateExecR4 = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "execute_opportunity_reaction",
      p_op_id: `op-f6-late-r4-${runId}`,
      p_opportunity_id: f6OppId,
      p_round: 4
    });
    record(
      "F6-ROLLOVER-EXPIRES-OPEN-OPP-PT409",
      currentCombat.round === 4 &&
        (currentCombat.oportunidades_reacao || []).length === 0 &&
        f6LateExec.status === 409 &&
        f6LateExec.json?.code === "PT409" &&
        f6LateExecR4.status === 409 &&
        f6LateExecR4.json?.code === "PT409",
      `R4 opps=0, lateR3=HTTP ${f6LateExec.status} (${f6LateExec.json?.code}, ${f6LateExec.elapsedMs}ms), lateR4=HTTP ${f6LateExecR4.status} (${f6LateExecR4.json?.code}, ${f6LateExecR4.elapsedMs}ms)`
    );

    // F7: Reconexão seguida de replay do mesmo p_op_id na rodada atual (R4)
    const f7Opp = await rawRpc(gm1.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "open_opportunity",
      p_op_id: `op-f7-opp-${runId}`,
      p_action_type: "ataque_oportunidade",
      p_target_token_id: tokB,
      p_reach_meters: 1.5,
      p_round: 4
    });
    const f7OppId = f7Opp.json.result.opportunityId;
    const f7Exec1 = await rawRpc(playerA.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "execute_opportunity_reaction",
      p_op_id: `op-f7-exec-${runId}`,
      p_opportunity_id: f7OppId,
      p_round: 4
    });
    // Nova sessão fresca (reconexão)
    const playerAReconn = await login(cfg.playerA.email);
    const f7Read = await rawRpc(playerAReconn.token, "obter_combate_publico", { p_mesa_id: mesa1 });
    const f7Replay = await rawRpc(playerAReconn.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokA,
      p_operacao: "execute_opportunity_reaction",
      p_op_id: `op-f7-exec-${runId}`,
      p_opportunity_id: f7OppId,
      p_round: 4
    });
    const tokAF7 = getCombatant(f7Replay.json?.combate, tokA);
    record(
      "F7-RECONNECT-AND-REPLAY",
      f7Exec1.status === 200 &&
        f7Read.status === 200 &&
        f7Replay.status === 200 &&
        f7Replay.json?.result?.idempotentReplay === true &&
        tokAF7?.action_state?.spentActions === 1,
      `Reconexão + replay: HTTP ${f7Replay.status} idempotentReplay=true, spent permanece 1 (${f7Replay.elapsedMs}ms)`
    );

    // F8: Operações concorrentes envolvendo outra mesa (gm1 + gm2 + outsider)
    const [f8Legit, f8Gm2, f8Out] = await Promise.all([
      rawRpc(playerB.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "request_early_reaction",
        p_op_id: `op-f8-legit-${runId}`,
        p_action_type: "reacao",
        p_round: 4
      }),
      rawRpc(gm2.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "open_opportunity",
        p_op_id: `op-f8-gm2-${runId}`,
        p_range_confirmed: true,
        p_round: 4
      }),
      rawRpc(outsider.token, "gerenciar_reacao_combate", {
        p_mesa_id: mesa1,
        p_combate_id: combateId,
        p_token_id: tokB,
        p_operacao: "request_early_reaction",
        p_op_id: `op-f8-out-${runId}`,
        p_round: 4
      })
    ]);
    record(
      "F8-CONCURRENT-CROSS-TABLE-ISOLATION",
      f8Legit.status === 200 &&
        (f8Gm2.status === 403 || f8Gm2.status === 400) &&
        f8Gm2.json?.code === "42501" &&
        (f8Out.status === 403 || f8Out.status === 400) &&
        f8Out.json?.code === "42501",
      `legit=HTTP ${f8Legit.status}, gm2=HTTP ${f8Gm2.status} (${f8Gm2.json?.code}), outsider=HTTP ${f8Out.status} (${f8Out.json?.code})`
    );

    // ═════════════════════════════════════════════════════════════════════
    // FASE G — REALTIME WEBSOCKET: ENTREGA, PRIVACIDADE & RECONEXÃO
    // ═════════════════════════════════════════════════════════════════════
    const gotRt = await waitFor(() => rtEvents.gm1.length >= 5 && rtEvents.playerB.length >= 5, 6000);
    // Verificar ausência de revisões duplicadas no mesmo cliente
    const gm1Revs = rtEvents.gm1.map((e) => e.rev);
    const plbRevs = rtEvents.playerB.map((e) => e.rev);
    const gm1Dup = gm1Revs.length !== new Set(gm1Revs).size;
    const plbDup = plbRevs.length !== new Set(plbRevs).size;

    record(
      "G-REALTIME-DELIVERY-AND-NO-DUPLICATES",
      gotRt && !gm1Dup && !plbDup,
      `gm1 recebeu ${rtEvents.gm1.length} sinais únicos, playerB recebeu ${rtEvents.playerB.length} sinais únicos`
    );

    record(
      "G-REALTIME-ZERO-CROSS-TABLE-LEAKS",
      rtEvents.gm2.length === 0 && rtEvents.outsider.length === 0,
      `gm2 recebeu ${rtEvents.gm2.length} eventos da Mesa 1, outsider recebeu ${rtEvents.outsider.length} eventos da Mesa 1`
    );

    // Verificar privacidade de reidratação do playerB após eventos
    const pubB = (await rawRpc(playerB.token, "obter_combate_publico", { p_mesa_id: mesa1 })).json.combate;
    const pubBTokA = getCombatant(pubB, tokA);
    const pubBTokB = getCombatant(pubB, tokB);
    const pubBHidden = getCombatant(pubB, tokHidden);
    record(
      "G-REALTIME-REHYDRATION-PRIVACY",
      pubBTokB?.action_state != null &&
        pubBTokA?.action_state === undefined &&
        pubBHidden === null &&
        pubB.reaction_op_results === undefined &&
        (pubB.solicitacoes_reacao || []).every((r) => r.combatantId === tokB) &&
        (pubB.oportunidades_reacao || []).every((o) => o.combatantId === tokB),
      "playerB reidratou apenas próprio action_state/solicitações; zero vazamento de tokA, tokHidden ou reaction_op_results"
    );

    // Reconexão do canal Realtime do playerB
    const oldPlbChannel = channels.find(([, ch]) => ch.topic.includes(`rt-plb-${runId}`));
    if (oldPlbChannel) {
      await oldPlbChannel[0].removeChannel(oldPlbChannel[1]);
    }
    const reconnEvents = [];
    await subscribeChannel(
      playerB.client,
      `rt-plb-reconn-${runId}`,
      [{ event: "*", schema: "public", table: "mesa_combate_sinais", filter: `mesa_id=eq.${mesa1}` }],
      (tbl, p) => reconnEvents.push({ tbl, rev: p.new?.revisao })
    );
    const f8ReqId = f8Legit.json.result.requestId;
    const postReconnCancel = await rawRpc(playerB.token, "gerenciar_reacao_combate", {
      p_mesa_id: mesa1,
      p_combate_id: combateId,
      p_token_id: tokB,
      p_operacao: "cancel_early_reaction",
      p_request_id: f8ReqId,
      p_op_id: `op-g-reconn-cancel-${runId}`,
      p_round: 4
    });
    const gotReconnEvent = await waitFor(() => reconnEvents.length >= 1, 6000);
    record(
      "G-REALTIME-RECONNECT",
      postReconnCancel.status === 200 && gotReconnEvent && reconnEvents.length === 1,
      `Reconexão canal WebSocket recebeu exatamente ${reconnEvents.length} evento (rev=${reconnEvents[0]?.rev})`
    );

    // ═════════════════════════════════════════════════════════════════════
    // SMOKE NÃO-REGRESSÃO XER-05 / XER-06 EM HOMOLOGAÇÃO
    // ═════════════════════════════════════════════════════════════════════
    const bossInst = crypto.randomUUID();
    const xInit = await rawRpc(gm1.token, "inicializar_6b_instancia", {
      p_mesa: mesa1,
      p_instance: bossInst,
      p_dados: [10, 8, 6],
      p_op_id: `xer-init-${runId}`,
      p_mapa: map1,
      p_token: tokCr
    });
    const xRoll = await rawRpc(gm1.token, "rolar_6b_instancia", {
      p_mesa: mesa1,
      p_instance: bossInst,
      p_versao: xInit.json?.versao,
      p_op_id: `xer-roll-${runId}`
    });
    const xCons = await rawRpc(gm1.token, "consumir_6b_instancia", {
      p_mesa: mesa1,
      p_instance: bossInst,
      p_versao: xRoll.json?.versao,
      p_indices: [0],
      p_op_id: `xer-cons-${runId}`
    });
    record(
      "NONREG-XER05-XER06-SMOKE",
      xInit.status === 200 && xRoll.status === 200 && xCons.status === 200 && xCons.json?.versao === 2,
      `init=200 roll=200 consume=200 versao=${xCons.json?.versao}`
    );

    metrics.utcEnd = new Date().toISOString();
    metrics.totalPassed = results.filter((r) => r.ok).length;
    metrics.totalFailed = results.filter((r) => !r.ok).length;
    console.log("SUMMARY_JSON=" + JSON.stringify(metrics));
  } catch (err) {
    exitCode = 1;
    console.error("FATAL:", err.message || err);
  } finally {
    // Limpeza cirúrgica de canais e exclusivamente das 2 mesas de teste criadas por esta execução
    for (const [c, ch] of channels) {
      try {
        await c.removeChannel(ch);
      } catch {}
    }
    for (const [c, mid] of cleanupMesas) {
      try {
        const del = await c.from("mesas").delete().eq("id", mid);
        if (del.error) console.error(`WARN cleanup mesa ${mid}: ${del.error.message}`);
        else console.log(`CLEANED_MESA=${mid}`);
      } catch (e) {
        console.error(`WARN cleanup mesa ${mid}:`, e.message);
      }
    }
    for (const c of clients) {
      try {
        await c.auth.signOut();
      } catch {}
    }
    process.exit(exitCode);
  }
}

main();
