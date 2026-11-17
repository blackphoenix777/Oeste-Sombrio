const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "darkwest-com07-com08-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

async function runRealBestiaryJsonChecks() {
  const pureDir = path.join(temp, "pure-rules");
  fs.mkdirSync(pureDir, { recursive: true });
  fs.writeFileSync(path.join(pureDir, "package.json"), JSON.stringify({ type: "module" }));
  const rulesSrcDir = path.join(root, "dist/js/rules");
  for (const file of fs.readdirSync(rulesSrcDir)) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(path.join(rulesSrcDir, file), path.join(pureDir, file));
    }
  }
  const rules = await import(pathToFileURL(path.join(pureDir, "initiativeRules.js")).href);

  const expected = {
    "inebriados.json": { nome: "Inebriados", acoes: 2, defesa: "15", cfg: "2d6" },
    "gosma_eterna.json": { nome: "Gosma Eterna", acoes: 2, defesa: "18", cfg: "4d6" },
    "cao_das_sombras.json": { nome: "Cão das Sombras", acoes: 3, defesa: "16", cfg: "3d6" },
    "verme_do_carvao.json": { nome: "Verme do Carvão", acoes: 3, defesa: "12", cfg: "1d6" }
  };

  for (const [fileName, meta] of Object.entries(expected)) {
    const raw = JSON.parse(read("dist/data/bestiario/" + fileName));
    const d = raw.data;
    assert.equal(d.nome, meta.nome);
    assert.equal(d.acoes_por_turno, meta.acoes, `${fileName} deve ter acoes_por_turno = ${meta.acoes}`);
    assert.equal(d.defesa, meta.defesa, `${fileName} não deve alterar defesa`);
    assert.equal(d["config-6b"], meta.cfg, `${fileName} não deve alterar 6B`);
    assert.equal(rules.extractMonsterFixedActions(d), meta.acoes);

    // Mesmo com iniciativa 28 da cascata, o monstro preserva exatamente acoes_por_turno
    const bud = rules.computeTurnActionBudget({
      combatantId: "tok-" + fileName,
      round: 1,
      kind: "bestiary_monster",
      operationalMode: "creature_mode",
      isOfficialMonster: true,
      currentInitiative: 28,
      sheetData: d
    });
    assert.equal(bud.budgetDefined, true);
    assert.equal(bud.initialBudget, meta.acoes);
    assert.equal(bud.bonusActionsRaw, 0);
  }

  // Jebediah Jeb Cale não pode ser modificado (permanece NPC Veterano sem acoes_por_turno)
  const jebRaw = JSON.parse(read("dist/data/bestiario/jebediah_jeb_cale.json"));
  assert.equal("acoes_por_turno" in jebRaw.data, false, "Jebediah não deve receber acoes_por_turno");
  assert.equal(jebRaw.data.isVeterano, true);

  // Checagens unitárias de custom & reação nas regras puras (initiativeRules.js)
  const deniedCustomPlayer = rules.resolveCanonicalActionCost("custom", 2, { isMestre: false, reason: "Jogador" });
  assert.equal(deniedCustomPlayer.valid, false);
  assert.equal(deniedCustomPlayer.errorCode, "CUSTOM_ACTION_REQUIRES_GM");

  const deniedCustomNoReason = rules.resolveCanonicalActionCost("custom", 2, { isMestre: true, reason: "   " });
  assert.equal(deniedCustomNoReason.valid, false);
  assert.equal(deniedCustomNoReason.errorCode, "CUSTOM_ACTION_REQUIRES_JUSTIFICATION");

  const allowedCustomGm = rules.resolveCanonicalActionCost("custom", 3, { isMestre: true, reason: "Ação narrativa especial" });
  assert.equal(allowedCustomGm.valid, true);
  assert.equal(allowedCustomGm.cost, 3);

  // Idempotência com mesmo opId e payload divergente + retenção limitada (64 entradas)
  let stRule = rules.createCombatantActionState({
    mesaId: "m1",
    combateId: "c1",
    mapaId: "map1",
    round: 1,
    combatantId: "t1",
    kind: "player",
    operationalMode: "full_sheet",
    currentInitiative: 20,
    precomputedBudget: { combatantId: "t1", round: 1, kind: "player", operationalMode: "full_sheet", currentInitiative: 20, budgetDefined: true, initialBudget: 5 }
  });
  const okRes = rules.applyActionControllerOperation(stRule, {
    operation: "reserve",
    opId: "idemp-1",
    combateId: "c1",
    mapaId: "map1",
    round: 1,
    actionType: "atacar",
    isMestre: true
  });
  assert.equal(okRes.ok, true);
  stRule = okRes.state;
  const mismatchRes = rules.applyActionControllerOperation(stRule, {
    operation: "reserve",
    opId: "idemp-1",
    combateId: "c1",
    mapaId: "map1",
    round: 1,
    actionType: "limpar_olhos",
    isMestre: true
  });
  assert.equal(mismatchRes.ok, false);
  assert.equal(mismatchRes.errorCode, "IDEMPOTENCY_PAYLOAD_MISMATCH");

  // Satura até o teto intra-rodada (64 reservas/cancelamentos) e confirma retenção de 64 entradas
  for (let i = 1; i < rules.MAX_ROUND_ACTION_ENTRIES; i++) {
    const r = rules.applyActionControllerOperation(stRule, {
      operation: "reserve",
      opId: "cap-r-" + i,
      combateId: "c1",
      mapaId: "map1",
      round: 1,
      actionType: "atacar",
      isMestre: true
    });
    assert.equal(r.ok, true);
    stRule = r.state;
    const c = rules.applyActionControllerOperation(stRule, {
      operation: "cancel",
      opId: "cap-c-" + i,
      combateId: "c1",
      mapaId: "map1",
      round: 1,
      reservationId: r.reservationId,
      isMestre: true
    });
    assert.equal(c.ok, true);
    stRule = c.state;
  }
  const overCap = rules.applyActionControllerOperation(stRule, {
    operation: "reserve",
    opId: "cap-over",
    combateId: "c1",
    mapaId: "map1",
    round: 1,
    actionType: "atacar",
    isMestre: true
  });
  assert.equal(overCap.ok, false);
  assert.equal(overCap.errorCode, "ACTION_LEDGER_LIMIT_EXCEEDED");
  assert.ok(stRule.auditLog.length <= rules.MAX_ROUND_ACTION_ENTRIES);
  assert.ok(Object.keys(stRule.opResults).length <= rules.MAX_ROUND_ACTION_ENTRIES);

  // Evicted opId protection (Section 9): even after 64 ops evict oldest keys from opResults,
  // replaying old reserve or cancel opIds must NOT re-consume resources or fail spuriously.
  let stEvict = rules.createCombatantActionState({
    mesaId: "m1",
    combateId: "c1",
    mapaId: "map1",
    round: 1,
    combatantId: "t1",
    kind: "player",
    operationalMode: "full_sheet",
    currentInitiative: 20,
    precomputedBudget: { combatantId: "t1", round: 1, kind: "player", operationalMode: "full_sheet", currentInitiative: 20, budgetDefined: true, initialBudget: 5 }
  });
  const evictR0 = rules.applyActionControllerOperation(stEvict, { operation: "reserve", opId: "evict-r-0", combateId: "c1", mapaId: "map1", round: 1, actionType: "atacar", isMestre: true });
  assert.equal(evictR0.ok, true);
  stEvict = evictR0.state;
  const evictC0 = rules.applyActionControllerOperation(stEvict, { operation: "commit", opId: "evict-c-0", combateId: "c1", mapaId: "map1", round: 1, reservationId: evictR0.reservationId, isMestre: true });
  assert.equal(evictC0.ok, true);
  stEvict = evictC0.state;
  for (let i = 1; i <= 35; i++) {
    const r = rules.applyActionControllerOperation(stEvict, { operation: "reserve", opId: "evict-r-" + i, combateId: "c1", mapaId: "map1", round: 1, actionType: "atacar", isMestre: true });
    assert.equal(r.ok, true);
    stEvict = r.state;
    const c = rules.applyActionControllerOperation(stEvict, { operation: "cancel", opId: "evict-x-" + i, combateId: "c1", mapaId: "map1", round: 1, reservationId: r.reservationId, isMestre: true });
    assert.equal(c.ok, true);
    stEvict = c.state;
  }
  assert.equal(Object.prototype.hasOwnProperty.call(stEvict.opResults, "evict-r-0"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stEvict.opResults, "evict-c-0"), false);
  const availBeforeReplay = rules.computeAvailableActionsFromState(stEvict);
  const evictReplayR = rules.applyActionControllerOperation(stEvict, { operation: "reserve", opId: "evict-r-0", combateId: "c1", mapaId: "map1", round: 1, actionType: "atacar", isMestre: true });
  assert.equal(evictReplayR.ok, true);
  assert.equal(evictReplayR.idempotentReplay, true);
  assert.equal(evictReplayR.evictedFromRecentCache, true);
  assert.equal(rules.computeAvailableActionsFromState(evictReplayR.state), availBeforeReplay);
  const evictReplayC = rules.applyActionControllerOperation(evictReplayR.state, { operation: "commit", opId: "evict-c-0", combateId: "c1", mapaId: "map1", round: 1, reservationId: evictR0.reservationId, isMestre: true });
  assert.equal(evictReplayC.ok, true);
  assert.equal(evictReplayC.idempotentReplay, true);
  assert.equal(evictReplayC.evictedFromRecentCache, true);
  const evictMismatch = rules.applyActionControllerOperation(evictReplayC.state, { operation: "reserve", opId: "evict-r-0", combateId: "c1", mapaId: "map1", round: 1, actionType: "custom", cost: 2, reason: "alterado", isMestre: true });
  assert.equal(evictMismatch.ok, false);
  assert.equal(evictMismatch.errorCode, "IDEMPOTENCY_PAYLOAD_MISMATCH");

  // Auditoria estática da migração SQL e scripts de verificação RLS (COM-05..COM-08)
  const sqlMig = read("database/com05-com08-combat-state-and-actions.sql");
  const sqlRlsTest = read("tests/rls-com05-com08-combat-actions.sql");
  const sqlRlsMirror = read("database/rls-com05-com08-combat-actions.sql");
  assert.ok(sqlMig.includes("SECURITY DEFINER SET search_path=''"), "SQL precisa de SECURITY DEFINER e search_path=''");
  assert.ok(sqlMig.includes("FOR UPDATE"), "SQL precisa de lock transacional FOR UPDATE");
  assert.ok(sqlMig.includes("p_justificativa text DEFAULT NULL"), "SQL deve exigir justificativa para ações custom");
  assert.ok(sqlMig.includes("Reação fora de turno ou sem gatilho verificado exige autorização do Xerife"), "SQL deve bloquear reação sem Xerife");
  assert.ok(sqlMig.includes("Conflito de idempotência"), "SQL deve rejeitar mesmo p_op_id com payload diferente");
  assert.ok(sqlMig.includes("jsonb_array_length(v_ledger) >= 64"), "SQL deve limitar ledger intra-rodada em 64 entradas");
  assert.ok(sqlMig.includes("public.criar_action_state_combate("), "atualizar_resumo_combate deve inicializar combates pré-migração");
  assert.ok(sqlRlsTest.includes("'slot'") && sqlRlsTest.includes("'grid_cols'") && sqlRlsTest.includes("has_function_privilege"), "Teste RLS deve respeitar validar_mapas_mesa e checar has_function_privilege");
  assert.ok(sqlRlsTest.includes("op-player-custom") && sqlRlsTest.includes("op-player-react"), "Teste RLS deve cobrir custom/reação por jogador");
  assert.ok(sqlRlsMirror.includes("op-player-custom") && sqlRlsMirror.includes("ROLLBACK;"), "Espelho database/rls-com05-com08-combat-actions.sql sincronizado");

  return "PASS pure bestiary JSON, rules hardening & static SQL audit";
}

const browserTest = async function () {
  const results = [];
  const check = (ok, label) => {
    if (!ok) throw Error("Falha em: " + label);
    results.push(label);
    document.getElementById("result").textContent = "RUNNING: " + label;
  };
  const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  try {
    try {
      localStorage.clear();
    } catch {}

    const modules = [
      "config",
      "state",
      "ui",
      "dice",
      "modal",
      "cylinder",
      "skills",
      "combat",
      "storage",
      "equipment",
      "equipCatalog",
      "gameData",
      "catalogModal",
      "inventoryUI",
      "magiasUI",
      "characterManager",
      "homeScreen",
      "authUI",
      "mesaScreen",
      "mesaMaps",
      "turnTracker",
      "mesaTokenStatus",
      "mesaDeliveries",
      "mesaNotes"
    ];
    for (const name of modules) {
      await import("/js/" + name + ".js");
    }

    const OS = window.OS;
    OS.saveStatusEl = OS.$("save-status");
    OS.scheduleSave = () => {};
    OS.scheduleMesaSceneSave = () => {};
    OS.renderSkills();
    OS.renderCombat();
    if (OS.bindModalEvents) OS.bindModalEvents();
    OS.bindCylinderEvents();
    if (OS.bindEquipamentos) OS.bindEquipamentos();
    if (OS.bindFichaTabs) OS.bindFichaTabs();
    if (OS.bindInventoryUI) OS.bindInventoryUI();
    if (OS.bindFateTokensEvents) OS.bindFateTokensEvents();
    if (OS.bindTurnTrackerEvents) OS.bindTurnTrackerEvents();
    OS.initCylinder();

    const gmId = "11111111-1111-4111-8111-111111111111";
    const playerAId = "22222222-2222-4222-8222-222222222222";
    const playerBId = "33333333-3333-4333-8333-333333333333";
    const roomId = "44444444-4444-4444-8444-444444444444";
    const map1Id = "55555555-5555-4555-8555-555555555555";
    const map2Id = "66666666-6666-4666-8666-666666666666";

    const db = {
      usuarios: [
        { id: gmId, email: "gm@darkwest.local", username: "Xerife" },
        { id: playerAId, email: "a@darkwest.local", username: "JogadorA" },
        { id: playerBId, email: "b@darkwest.local", username: "JogadorB" }
      ],
      fichas: [],
      mesas: [
        {
          id: roomId,
          mestre_id: gmId,
          nome: "Mesa COM07-08",
          npcs_mesa: [],
          cena_ativa: [],
          combate_ativo: null
        }
      ],
      mesa_tokens: []
    };

    let combat = null;
    let combatRev = 0;
    let nextD20Roll = 12;
    let forceStaleCombatError = false;
    let enableServerActionRpc = false;
    let missingRpcCode = "PGRST202";
    let dropRpcBeforeCommitOnce = false;
    let dropRpcResponseOnce = false;

    const normInt = (v) => OS.normalizeMesaInitiative(v);

    function atualizarResumoMock(stateObj) {
      if (!stateObj) return null;
      const out = clone(stateObj);
      out.ordem = (out.ordem || [])
        .map((item) => {
          const tok = db.mesa_tokens.find(
            (t) =>
              String(t.id) === String(item.token_id) &&
              String(t.mesa_id) === String(roomId) &&
              (!out.mapa_id || String(t.mapa_id) === String(out.mapa_id))
          );
          if (!tok) return null;
          const frozenCurr =
            item.current_initiative !== undefined && item.current_initiative !== null
              ? normInt(item.current_initiative)
              : normInt(item.iniciativa);
          const nextRoundVal =
            item.iniciativa_fonte === "ficha" && normInt(tok.iniciativa) !== frozenCurr
              ? normInt(tok.iniciativa)
              : item.iniciativa_fonte === "ficha" &&
                item.next_round_initiative !== undefined &&
                item.next_round_initiative !== null
              ? normInt(item.next_round_initiative)
              : null;
          return {
            token_id: tok.id,
            owner_ref: tok.owner_ref,
            owner_type: tok.owner_type,
            name: tok.display_name,
            image_url: tok.image_url || null,
            iniciativa: frozenCurr,
            current_initiative: frozenCurr,
            next_round_initiative: nextRoundVal,
            visible_to_players: !!tok.visible_to_players,
            entrou_no_meio: !!item.entrou_no_meio,
            iniciativa_fonte: item.iniciativa_fonte,
            action_state: item.action_state ? clone(item.action_state) : undefined
          };
        })
        .filter(Boolean);
      if (out.turno_atual_idx >= out.ordem.length) out.turno_atual_idx = 0;
      return out;
    }

    function snapshotForCaller(isMestreView, userIdView) {
      const full = atualizarResumoMock(combat);
      if (!full || isMestreView) {
        return { combate: full, revisao: combatRev };
      }
      const currentTid = full.ordem[full.turno_atual_idx]?.token_id;
      const visibleOrder = full.ordem
        .filter((c) => {
          const tok = db.mesa_tokens.find((t) => String(t.id) === String(c.token_id));
          return tok && (tok.visible_to_players || tok.owner_user_id === userIdView);
        })
        .map((c) => {
          const tok = db.mesa_tokens.find((t) => String(t.id) === String(c.token_id));
          const copyItem = clone(c);
          if (!tok || tok.owner_user_id !== userIdView) {
            delete copyItem.action_state;
            delete copyItem.next_round_initiative;
          }
          return copyItem;
        });
      const vIdx = visibleOrder.findIndex((c) => c.token_id === currentTid);
      return {
        revisao: combatRev,
        combate: {
          id: full.id,
          ativo: true,
          mapa_id: full.mapa_id,
          versao: full.versao,
          round: full.round,
          turno_atual_idx: vIdx,
          turno_oculto: !!currentTid && vIdx < 0,
          ordem: visibleOrder
        }
      };
    }

    let currentAuthUid = gmId;
    const client = {
      auth: {
        getUser: async () =>
          currentAuthUid
            ? { data: { user: { id: currentAuthUid } }, error: null }
            : { data: { user: null }, error: null }
      },
      from(table) {
        let op = "select", payload = null, filters = [], isSingle = false;
        const q = {
          select() { return q; },
          insert(p) { op = "insert"; payload = clone(p); return q; },
          update(p) { op = "update"; payload = clone(p); return q; },
          upsert(p) { op = "upsert"; payload = clone(p); return q; },
          eq(k, v) { filters.push([k, v]); return q; },
          is(k, v) { filters.push([k, v]); return q; },
          order() { return q; },
          limit() { return q; },
          single() { isSingle = true; return q; },
          then(resolve) {
            const rows = db[table] || (db[table] = []);
            const nowIso = new Date().toISOString();
            const match = (r) => filters.every(([k, v]) => (v === null ? r[k] == null : String(r[k]) === String(v)));
            let out = [];
            if (op === "insert") {
              for (const it of Array.isArray(payload) ? payload : [payload]) {
                const row = Object.assign({ id: crypto.randomUUID(), created_at: nowIso, updated_at: nowIso }, clone(it));
                rows.push(row);
                out.push(clone(row));
              }
            } else if (op === "update" || op === "upsert") {
              for (const r of rows) {
                if (match(r)) {
                  Object.assign(r, clone(payload), { updated_at: nowIso });
                  out.push(clone(r));
                }
              }
            } else {
              out = rows.filter(match).map(clone);
            }
            if (isSingle) return resolve({ data: out[0] || null, error: out[0] ? null : { message: "Not found" } });
            return resolve({ data: out, error: null });
          }
        };
        return q;
      },
      channel() {
        return { on() { return this; }, subscribe() { return this; } };
      },
      rpc: async (name, args) => {
        if (name === "obter_combate_publico") {
          return { data: snapshotForCaller(OS.activeMesaState.isMestre, OS.activeMesaState.currentUserId), error: null };
        }
        if (name === "gerenciar_acao_combate") {
          if (!enableServerActionRpc) {
            return { error: { code: missingRpcCode, message: "Could not find the function public.gerenciar_acao_combate" } };
          }
          if (dropRpcBeforeCommitOnce) {
            dropRpcBeforeCommitOnce = false;
            throw new Error("Failed to fetch (connection dropped before commit)");
          }
          if (!currentAuthUid) return { error: { code: "42501", message: "UNAUTHENTICATED_USER" } };
          if (!combat || !combat.ativo) return { error: { code: "22023", message: "NO_ACTIVE_COMBAT" } };
          if (!args.p_combate_id || String(args.p_combate_id) !== String(combat.id)) {
            return { error: { code: "40001", message: "COMBAT_MISMATCH" } };
          }
          if (args.p_mapa_id && String(args.p_mapa_id) !== String(combat.mapa_id)) {
            return { error: { code: "22023", message: "MAP_MISMATCH" } };
          }
          if (args.p_round && Number(args.p_round) !== Number(combat.round)) {
            return { error: { code: "40001", message: "ROUND_MISMATCH" } };
          }
          const tok = db.mesa_tokens.find((t) => String(t.id) === String(args.p_token_id));
          const isGm = String(currentAuthUid) === String(gmId);
          if (!isGm && (!tok || tok.owner_type !== "player" || String(tok.owner_user_id) !== String(currentAuthUid))) {
            return { error: { code: "42501", message: "UNAUTHORIZED_COMBATANT_ACCESS" } };
          }
          const idxItem = combat.ordem.findIndex((c) => String(c.token_id) === String(args.p_token_id));
          const item = combat.ordem[idxItem];
          if (!item) return { error: { code: "22023", message: "COMBATANT_NOT_IN_COMBAT" } };

          let as = item.action_state;
          if (!as || Number(as.round) !== Number(combat.round)) {
            const b = OS.computeCombatantTurnBudget(item, combat.round);
            as = OS.createCombatantActionState({
              mesaId: roomId,
              combateId: combat.id,
              mapaId: combat.mapa_id,
              round: combat.round,
              combatantId: item.token_id,
              instanceId: item.owner_ref,
              precomputedBudget: b
            });
          }
          const opOut = OS.applyActionControllerOperation(as, {
            operation: args.p_operacao,
            opId: args.p_op_id,
            combateId: args.p_combate_id,
            mapaId: args.p_mapa_id,
            round: args.p_round,
            expectedVersion: args.p_expected_version,
            actionType: args.p_action_type,
            cost: args.p_cost,
            reservationId: args.p_reservation_id,
            isReaction: args.p_is_reaction,
            isMestre: isGm,
            reason: args.p_justificativa,
            isCurrentTurn: idxItem === combat.turno_atual_idx && !as.turnEnded,
            resultRevealed: args.p_result_revealed,
            actorUserId: currentAuthUid
          });
          if (!opOut.ok) {
            const sqlCode =
              opOut.sqlstate ||
              (opOut.errorCode === "STALE_STATE_VERSION" || opOut.errorCode === "COMBAT_MISMATCH" || opOut.errorCode === "ROUND_MISMATCH"
                ? "40001"
                : opOut.errorCode === "CUSTOM_ACTION_REQUIRES_GM" ||
                  opOut.errorCode === "REACTION_REQUIRES_GM_AUTHORIZATION" ||
                  opOut.errorCode === "UNAUTHORIZED_COMBATANT_ACCESS"
                ? "42501"
                : "22023");
            return { error: { code: sqlCode, message: opOut.errorCode } };
          }
          if (!opOut.idempotentReplay && opOut.state) {
            item.action_state = opOut.state;
            combat.versao += 1;
            combatRev += 1;
          }
          if (dropRpcResponseOnce) {
            dropRpcResponseOnce = false;
            return { error: { code: "NETWORK_ERROR", message: "Failed to fetch / timeout after commit" } };
          }
          return {
            data: {
              result: opOut,
              combate: snapshotForCaller(isGm, currentAuthUid).combate,
              revisao: combatRev
            },
            error: null
          };
        }
        if (name === "gerenciar_combate") {
          if (!OS.activeMesaState.isMestre || String(currentAuthUid) !== String(gmId)) {
            return { error: { code: "42501", message: "Apenas o Mestre pode controlar o combate" } };
          }
          if (forceStaleCombatError) {
            forceStaleCombatError = false;
            return { error: { code: "40001", message: "Combate atualizado em outra sessão." } };
          }
          if (args.p_acao === "iniciar") {
            const parts = (args.p_participantes || []).map((p) => {
              const tok = db.mesa_tokens.find((t) => String(t.id) === String(p.token_id));
              return {
                token_id: tok.id,
                owner_ref: tok.owner_ref,
                owner_type: tok.owner_type,
                name: tok.display_name,
                image_url: tok.image_url || null,
                visible_to_players: !!tok.visible_to_players,
                iniciativa: normInt(tok.iniciativa),
                modo: p.modo,
                prioridade: p.prioridade,
                mapa_id: tok.mapa_id
              };
            });
            const cascaded = OS.computeCascadeInitiatives(parts, { d20Roll: nextD20Roll });
            combat = {
              id: crypto.randomUUID(),
              ativo: true,
              mapa_id: parts[0].mapa_id,
              round: 1,
              turno_atual_idx: 0,
              versao: 1,
              cascata_d20: cascaded.cascata_d20,
              cascata_total: cascaded.cascata_total,
              ordem: cascaded.ordem.map((x) => {
                const it = {
                  token_id: x.token_id,
                  owner_ref: x.owner_ref,
                  owner_type: x.owner_type,
                  name: x.name,
                  image_url: x.image_url,
                  iniciativa: x.iniciativa,
                  current_initiative: x.iniciativa,
                  next_round_initiative: null,
                  visible_to_players: x.visible_to_players,
                  entrou_no_meio: false,
                  iniciativa_fonte: x.iniciativa_fonte
                };
                const b = OS.computeCombatantTurnBudget(it, 1, { currentInitiative: x.iniciativa });
                it.action_state = OS.createCombatantActionState({
                  mesaId: roomId,
                  combateId: null,
                  mapaId: parts[0].mapa_id,
                  round: 1,
                  combatantId: x.token_id,
                  instanceId: x.owner_ref,
                  precomputedBudget: b
                });
                return it;
              })
            };
            combat.ordem.forEach((it) => { it.action_state.combateId = combat.id; });
          } else if (args.p_acao === "proximo") {
            combat = atualizarResumoMock(combat);
            const nextIdx = combat.turno_atual_idx + 1;
            if (nextIdx >= combat.ordem.length) {
              const hasPending = combat.ordem.some(
                (it) => it && it.action_state && Array.isArray(it.action_state.ledger) && it.action_state.ledger.some((e) => e && e.status === "reserved")
              );
              if (hasPending) {
                return { error: { code: "22023", message: "Resolva ou cancele as reservas de ação pendentes antes de encerrar a rodada" } };
              }
              const oldLast = combat.ordem[combat.turno_atual_idx];
              if (oldLast && oldLast.action_state) oldLast.action_state.turnEnded = true;
              combat.turno_atual_idx = 0;
              combat.round += 1;
              combat.ordem = combat.ordem
                .map((c) => {
                  const tok = db.mesa_tokens.find((t) => String(t.id) === String(c.token_id));
                  const promoted =
                    c.iniciativa_fonte === "ficha"
                      ? normInt(c.next_round_initiative !== null && c.next_round_initiative !== undefined ? c.next_round_initiative : (tok ? tok.iniciativa : c.iniciativa))
                      : normInt(c.current_initiative !== undefined ? c.current_initiative : c.iniciativa);
                  const nextCopy = Object.assign({}, c, {
                    iniciativa: promoted,
                    current_initiative: promoted,
                    next_round_initiative: null,
                    entrou_no_meio: false
                  });
                  const b = OS.computeCombatantTurnBudget(nextCopy, combat.round, { currentInitiative: promoted });
                  nextCopy.action_state = OS.createCombatantActionState({
                    mesaId: roomId,
                    combateId: combat.id,
                    mapaId: combat.mapa_id,
                    round: combat.round,
                    combatantId: c.token_id,
                    instanceId: c.owner_ref,
                    precomputedBudget: b
                  });
                  return nextCopy;
                })
                .sort((a, b) => {
                  const af = a.iniciativa_fonte === "fixa" ? 1 : 0;
                  const bf = b.iniciativa_fonte === "fixa" ? 1 : 0;
                  if (af !== bf) return af - bf;
                  if (b.iniciativa !== a.iniciativa) return b.iniciativa - a.iniciativa;
                  const na = String(a.name || ""), nb = String(b.name || "");
                  if (na !== nb) return na < nb ? -1 : 1;
                  return String(a.token_id).localeCompare(String(b.token_id));
                });
            } else {
              const oldItem = combat.ordem[combat.turno_atual_idx];
              if (oldItem && oldItem.action_state) oldItem.action_state.turnEnded = true;
              combat.turno_atual_idx = nextIdx;
              const newItem = combat.ordem[combat.turno_atual_idx];
              if (newItem && newItem.action_state) newItem.action_state.turnEnded = false;
            }
            combat.versao += 1;
          } else if (args.p_acao === "adicionar") {
            combat = atualizarResumoMock(combat);
            const tok = db.mesa_tokens.find((t) => String(t.id) === String(args.p_token_id));
            if (!tok || String(tok.mapa_id) !== String(combat.mapa_id)) {
              return { error: { code: "22023", message: "Token fora do mapa" } };
            }
            const lateInit = tok.owner_type === "player" ? normInt(tok.iniciativa) : 0;
            const lateItem = {
              token_id: tok.id,
              owner_ref: tok.owner_ref,
              owner_type: tok.owner_type,
              name: tok.display_name,
              image_url: tok.image_url || null,
              iniciativa: lateInit,
              current_initiative: lateInit,
              next_round_initiative: null,
              visible_to_players: !!tok.visible_to_players,
              entrou_no_meio: true,
              iniciativa_fonte: tok.owner_type === "player" ? "ficha" : "fixa"
            };
            const lateBud = OS.computeCombatantTurnBudget(lateItem, combat.round, { currentInitiative: lateInit });
            lateItem.action_state = OS.createCombatantActionState({
              mesaId: roomId,
              combateId: combat.id,
              mapaId: combat.mapa_id,
              round: combat.round,
              combatantId: tok.id,
              instanceId: tok.owner_ref,
              precomputedBudget: lateBud
            });
            combat.ordem.push(lateItem);
            combat.versao += 1;
          } else if (args.p_acao === "encerrar") {
            combat = null;
          }
          combatRev += 1;
          return { data: snapshotForCaller(true, gmId), error: null };
        }
        return { data: [], error: null };
      }
    };

    OS.getSupabaseClient = () => client;
    OS.authSession = { userId: gmId, email: "gm@darkwest.local", username: "Xerife" };
    Object.assign(OS.activeMesaState, {
      mesaId: roomId,
      activeMapId: map1Id,
      isMestre: true,
      currentUserId: gmId,
      mesa: db.mesas[0],
      npcsMesa: [],
      sceneCreatures: [],
      playerSheets: [],
      mesaTokens: db.mesa_tokens,
      pendingLocalTokenUpdates: {},
      maps: [
        { id: map1Id, nome: "Saloon", grid_cols: 20, grid_rows: 15 },
        { id: map2Id, nome: "Canion", grid_cols: 20, grid_rows: 15 }
      ]
    });
    OS.loadMesaTokens = async () => OS.activeMesaState.mesaTokens;

    await OS.loadOfficialBestiary();

    /* ─── B1: Bestiário oficial carregado em runtime e instâncias independentes ─── */
    const inebEntry = OS.getOfficialBestiaryEntry("inebriados");
    const gosmaEntry = OS.getOfficialBestiaryEntry("gosma_eterna");
    const caoEntry = OS.getOfficialBestiaryEntry("cao_das_sombras");
    const vermeEntry = OS.getOfficialBestiaryEntry("verme_do_carvao");
    const mesaIneb = await OS.addBestiarioEntryToMesa(inebEntry);
    const inebRes1 = await OS.addNpcMesaToScene(mesaIneb.mesaNpcId);
    const inebRes2 = await OS.addNpcMesaToScene(mesaIneb.mesaNpcId);
    const mesaGosma = await OS.addBestiarioEntryToMesa(gosmaEntry);
    const gosmaRes = await OS.addNpcMesaToScene(mesaGosma.mesaNpcId);
    const mesaCao = await OS.addBestiarioEntryToMesa(caoEntry);
    const caoRes = await OS.addNpcMesaToScene(mesaCao.mesaNpcId);
    const mesaVerme = await OS.addBestiarioEntryToMesa(vermeEntry);
    const vermeRes = await OS.addNpcMesaToScene(mesaVerme.mesaNpcId);

    check(
      OS.computeCombatantTurnBudget(inebRes1.token, 1, { currentInitiative: 25 }).initialBudget === 2 &&
        OS.computeCombatantTurnBudget(inebRes2.token, 1, { currentInitiative: 24 }).initialBudget === 2 &&
        OS.computeCombatantTurnBudget(gosmaRes.token, 1, { currentInitiative: 23 }).initialBudget === 2 &&
        OS.computeCombatantTurnBudget(caoRes.token, 1, { currentInitiative: 22 }).initialBudget === 3 &&
        OS.computeCombatantTurnBudget(vermeRes.token, 1, { currentInitiative: 21 }).initialBudget === 3,
      "B1: os 4 monstros oficiais retornam orçamentos fixos 2, 2, 3 e 3 sem escalar pela cascata"
    );

    // Inicia combate curto com Inebriados #1 e #2 para validar bloqueio de fallback local sem RPC + orçamento via servidor
    nextD20Roll = 18;
    await OS.runMesaCombatAction("iniciar", {
      p_participantes: [
        { token_id: inebRes1.token.id, modo: "cascata", prioridade: 1 },
        { token_id: inebRes2.token.id, modo: "cascata", prioridade: 2 }
      ]
    });

    // B0: Sem RPC (PGRST202 / 42883 / client.rpc ausente), reserva falha explicitamente e NÃO consome saldo local
    enableServerActionRpc = false;
    missingRpcCode = "PGRST202";
    const rpcUnavailPgrst = await OS.combatActionController.reserveAction({
      opId: "op-ineb-unavail-pgrst",
      combatantId: inebRes1.token.id,
      actionType: "atacar"
    });
    missingRpcCode = "42883";
    const rpcUnavail42883 = await OS.combatActionController.reserveAction({
      opId: "op-ineb-unavail-42883",
      combatantId: inebRes1.token.id,
      actionType: "atacar"
    });
    const origGetSupabaseClient = OS.getSupabaseClient;
    OS.getSupabaseClient = () => ({ auth: client.auth });
    const rpcUnavailNoClientRpc = await OS.combatActionController.reserveAction({
      opId: "op-ineb-no-rpc",
      combatantId: inebRes1.token.id,
      actionType: "atacar"
    });
    OS.getSupabaseClient = origGetSupabaseClient;

    check(
      !rpcUnavailPgrst.ok &&
        rpcUnavailPgrst.unavailable === true &&
        rpcUnavailPgrst.persistedOnServer === false &&
        rpcUnavailPgrst.errorCode === "ACTION_CONTROLLER_RPC_UNAVAILABLE" &&
        !rpcUnavail42883.ok &&
        rpcUnavail42883.unavailable === true &&
        !rpcUnavailNoClientRpc.ok &&
        rpcUnavailNoClientRpc.unavailable === true &&
        OS.combatActionController.getAvailableActions(inebRes1.token.id) === 2 &&
        OS.combatActionController.getRoundBudget(inebRes1.token.id).initialBudget === 2 &&
        OS.combatActionController.getAuditHistory(inebRes1.token.id).length === 0,
      "B0: PGRST202, 42883 e RPC ausente retornam indisponibilidade sem mutar saldo ou histórico local"
    );

    // Quando a RPC passa a responder, NÃO há reserva local anterior para auto-ativar
    enableServerActionRpc = true;
    const resIneb = await OS.combatActionController.reserveAction({
      opId: "op-ineb-1",
      combatantId: inebRes1.token.id,
      actionType: "atacar"
    });
    check(
      resIneb.ok &&
        resIneb.persistedOnServer === true &&
        OS.combatActionController.getAvailableActions(inebRes1.token.id) === 1 &&
        OS.combatActionController.getAvailableActions(inebRes2.token.id) === 2,
      "B2: instância Inebriados #1 gasta reserva no servidor sem alterar saldo de Inebriados #2 e sem auto-ativar falhas anteriores"
    );
    await OS.combatActionController.cancelReservation({
      opId: "op-ineb-1-cancel",
      combatantId: inebRes1.token.id,
      reservationId: resIneb.reservationId
    });
    await OS.runMesaCombatAction("encerrar");

    /* ─── Setup completo para Persistencia (COM-05), Eventos (COM-07) e Action Controller (COM-08) ─── */
    db.mesas[0].npcs_mesa = [];
    db.mesas[0].cena_ativa = [];
    db.mesa_tokens = [];
    OS.activeMesaState.npcsMesa = [];
    OS.activeMesaState.sceneCreatures = [];
    OS.activeMesaState.mesaTokens = db.mesa_tokens;
    OS.clearCanonicalCombatPersistence(roomId);
    OS.resetMesaCombat();

    const pSheetA = {
      id: "sheet-pa",
      usuario_id: playerAId,
      nome_personagem: "Pistoleiro A",
      dados: { nome: "Pistoleiro A", tipo_ficha: "jogador", freeEdit: false, iniciativa: "10", inventoryItems: [], activeConditions: [] }
    };
    const pSheetB = {
      id: "sheet-pb",
      usuario_id: playerBId,
      nome_personagem: "Pistoleiro B",
      dados: { nome: "Pistoleiro B", tipo_ficha: "jogador", freeEdit: false, iniciativa: "6", inventoryItems: [], activeConditions: [] }
    };
    OS.activeMesaState.playerSheets = [pSheetA, pSheetB];

    const tokA = {
      id: "tok-a",
      mesa_id: roomId,
      mapa_id: map1Id,
      owner_type: "player",
      owner_ref: "sheet-pa",
      owner_user_id: playerAId,
      display_name: "Pistoleiro A",
      iniciativa: 10,
      visible_to_players: true
    };
    const tokB = {
      id: "tok-b",
      mesa_id: roomId,
      mapa_id: map1Id,
      owner_type: "player",
      owner_ref: "sheet-pb",
      owner_user_id: playerBId,
      display_name: "Pistoleiro B",
      iniciativa: 6,
      visible_to_players: true
    };
    const tokMap2 = {
      id: "tok-map2",
      mesa_id: roomId,
      mapa_id: map2Id,
      owner_type: "player",
      owner_ref: "sheet-off",
      owner_user_id: playerBId,
      display_name: "Outro Mapa",
      iniciativa: 20,
      visible_to_players: true
    };
    db.mesa_tokens.push(tokA, tokB, tokMap2);

    const bandidoTemplate = {
      key: "custom:bandido",
      id: "bandido",
      sourceType: "custom",
      name: "Bandido",
      category: "NPC",
      data: { nome: "Bandido", tipo_ficha: "npc", freeEdit: true, isBestiaryCustom: true, isCriatura: true, operationalMode: "creature_mode", defesa: "12" }
    };
    const bossTemplate = {
      key: "custom:boss",
      id: "boss",
      sourceType: "custom",
      name: "Boss Avancado",
      category: "NPC",
      data: {
        nome: "Boss Avancado",
        tipo_ficha: "npc",
        freeEdit: true,
        isBestiaryCustom: true,
        isCriatura: false,
        operationalMode: "full_sheet",
        defesa: "16",
        "config-6b": "4d6",
        "chamber-0": "5",
        "chamber-1": "6",
        "chamber-2": "4",
        "chamber-3": "3",
        inventoryItems: []
      }
    };

    const mesaBand = await OS.addBestiarioEntryToMesa(bandidoTemplate);
    const band8 = [];
    for (let i = 0; i < 8; i++) {
      band8.push(await OS.addNpcMesaToScene(mesaBand.mesaNpcId));
    }
    const mesaBoss = await OS.addBestiarioEntryToMesa(bossTemplate);
    const bossRes = await OS.addNpcMesaToScene(mesaBoss.mesaNpcId);
    // Deixa tok-a (10) e tok-b (6) + os 9 NPCs; antes testamos primeiro o ciclo COM-07/COM-08 + Persistencia com tok-a, tok-b e tok-hidden!
    const mesaOculto = await OS.addBestiarioEntryToMesa(bandidoTemplate);
    const hiddenRes = await OS.addNpcMesaToScene(mesaOculto.mesaNpcId);
    hiddenRes.token.display_name = "Sniper Oculto";
    hiddenRes.token.visible_to_players = false;

    const observedEvents = [];
    const unsub = OS.onTurnTrackerEvent((evt) => observedEvents.push(evt));

    // Garante que clique falho/conflito 40001 NÃO emite evento autoritativo
    forceStaleCombatError = true;
    const failedStart = await OS.runMesaCombatAction("iniciar", {
      p_participantes: [{ token_id: tokA.id, modo: "ficha", prioridade: 1 }]
    });
    check(!failedStart && observedEvents.length === 0, "E1: falha/conflito no backend não emite evento");

    // Inicia combate com tokA (10, 3 ações) e tokB (6, 2 ações) e hiddenRes (cascata d20=12 -> 13, mas hidden!)
    // Usar d20=1 -> hidden fica com 2 (atrás de tokA e tokB!) para que Round 1 Turn 0 seja tokA!
    nextD20Roll = 1;
    await OS.runMesaCombatAction("iniciar", {
      p_participantes: [
        { token_id: tokA.id, modo: "ficha", prioridade: 1 },
        { token_id: tokB.id, modo: "ficha", prioridade: 2 },
        { token_id: hiddenRes.token.id, modo: "cascata", prioridade: 1 }
      ]
    });

    check(
      observedEvents.length === 2 &&
        observedEvents[0].type === "ROUND_STARTED" &&
        observedEvents[0].round === 1 &&
        observedEvents[1].type === "TURN_STARTED" &&
        observedEvents[1].combatantId === tokA.id,
      "E2: início confirmado emite ROUND_STARTED(1) e TURN_STARTED(tokA) exatamente 1 vez"
    );

    /* ─── COM-08: Reservas, Commit, Cancelamento, Idempotência, Concorrência ─── */
    // Pistoleiro A tem 3 ações (init 10)
    const rValid = await OS.combatActionController.reserveAction({
      opId: "op-a-1",
      combatantId: tokA.id,
      actionType: "limpar_olhos",
      mapaId: map1Id,
      round: 1,
      expectedVersion: 1
    });
    check(
      rValid.ok &&
        rValid.cost === 2 &&
        rValid.version === 2 &&
        OS.combatActionController.getAvailableActions(tokA.id) === 1 &&
        OS.combatActionController.getActionState(tokA.id).reservedActions === 2,
      "C1: reserva válida deduz saldo derivado (3 - 0 - 2 = 1)"
    );

    // Cancelamento permitido antes de revelar/confirmar
    const cAllowed = await OS.combatActionController.cancelReservation({
      opId: "op-a-cancel-ok",
      combatantId: tokA.id,
      reservationId: rValid.reservationId,
      expectedVersion: 2
    });
    // Tentar confirmar/reutilizar reserva já cancelada deve falhar
    const commitCancelled = await OS.combatActionController.commitReservation({
      opId: "op-commit-cancelled",
      combatantId: tokA.id,
      reservationId: rValid.reservationId
    });
    check(
      cAllowed.ok &&
        !commitCancelled.ok &&
        commitCancelled.errorCode === "RESERVATION_NOT_PENDING" &&
        OS.combatActionController.getAvailableActions(tokA.id) === 3 &&
        OS.combatActionController.getActionState(tokA.id).reservedActions === 0,
      "C2: cancelamento permitido restaura saldo (3) e impede reutilização posterior"
    );

    // Reserva superior ao saldo (custo 3 quando resta 1 após reservar 2)
    const rTwo = await OS.combatActionController.reserveAction({
      opId: "op-a-2",
      combatantId: tokA.id,
      actionType: "limpar_olhos",
      expectedVersion: 3
    });
    const rTooExpensive = await OS.combatActionController.reserveAction({
      opId: "op-a-too-big",
      combatantId: tokA.id,
      actionType: "remover_desorientado"
    });
    check(
      !rTooExpensive.ok && rTooExpensive.errorCode === "INSUFFICIENT_AVAILABLE_ACTIONS",
      "C3: reserva superior ao saldo (3 > 1) é rejeitada"
    );

    // Reserva concorrente disputando o último 1 ponto de ação (Promise.all)
    const [conc1, conc2] = await Promise.all([
      OS.combatActionController.reserveAction({ opId: "op-conc-1", combatantId: tokA.id, actionType: "atacar" }),
      OS.combatActionController.reserveAction({ opId: "op-conc-2", combatantId: tokA.id, actionType: "mover" })
    ]);
    const concWins = [conc1, conc2].filter((r) => r.ok);
    const concFails = [conc1, conc2].filter((r) => !r.ok);
    check(
      concWins.length === 1 &&
        concFails.length === 1 &&
        concFails[0].errorCode === "INSUFFICIENT_AVAILABLE_ACTIONS" &&
        OS.combatActionController.getAvailableActions(tokA.id) === 0,
      "C4: duas reservas concorrentes pela última ação permitem só 1 e impedem duplo gasto"
    );

    // Tentar virar rodada com reserva pendente deve bloquear
    await OS.runMesaCombatAction("proximo"); // tokB
    await OS.runMesaCombatAction("proximo"); // hiddenRes (último do round 1)
    const blockedWrap = await OS.runMesaCombatAction("proximo"); // tentaria virar Round 2 com rTwo e concWins[0] ainda pendentes!
    check(
      blockedWrap === false &&
        OS.activeMesaState.combateAtivo.round === 1 &&
        OS.$("mesa-tracker-feedback").textContent.includes("reservas de ação pendentes"),
      "C5: virada de rodada bloqueada enquanto houver reservas pendentes"
    );

    // Rejeita cancelamento após commit & dupla confirmação concorrente & reutilização de reserva já consumida
    const [commitA, commitB] = await Promise.all([
      OS.combatActionController.commitReservation({
        opId: "op-commit-1",
        combatantId: tokA.id,
        reservationId: rTwo.reservationId,
        resultRevealed: true
      }),
      OS.combatActionController.commitReservation({
        opId: "op-commit-2-dup",
        combatantId: tokA.id,
        reservationId: rTwo.reservationId,
        resultRevealed: true
      })
    ]);
    const retryAfterNetDrop = await OS.combatActionController.commitReservation({
      opId: "op-commit-1",
      combatantId: tokA.id,
      reservationId: rTwo.reservationId,
      resultRevealed: true
    });
    const cancelAfterCommit = await OS.combatActionController.cancelReservation({
      opId: "op-cancel-forbidden",
      combatantId: tokA.id,
      reservationId: rTwo.reservationId
    });
    check(
      commitA.ok &&
        !commitB.ok &&
        commitB.errorCode === "RESERVATION_NOT_PENDING" &&
        retryAfterNetDrop.ok &&
        retryAfterNetDrop.idempotentReplay === true &&
        !cancelAfterCommit.ok &&
        cancelAfterCommit.errorCode === "CANCEL_FORBIDDEN_ALREADY_COMMITTED",
      "C6: commit concorrente duplicado bloqueado, replay com mesmo opId idempotente e reembolso pós-commit proibido"
    );

    // Deixa 1 reserva PENDENTE em concWins[0] para testar persistência após refresh/reinicialização,
    // além de alteração de 6B de Pistoleiro B (6 -> 22) durante desconexão!
    // Pistoleiro A encerrou seu turno no Round 1, então ação normal para A deve ser bloqueada e só reação permitida!
    // Cancela concWins[0] -> 1 restante disponível só para reação!
    await OS.combatActionController.cancelReservation({
      opId: "op-cancel-conc-temp",
      combatantId: tokA.id,
      reservationId: concWins[0].reservationId
    });
    const normalAfterTurnEnded = await OS.combatActionController.reserveAction({
      opId: "op-a-after-turn",
      combatantId: tokA.id,
      actionType: "atacar",
      isReaction: false
    });
    const reactionAfterTurnEnded = await OS.combatActionController.reserveAction({
      opId: "op-a-reaction",
      combatantId: tokA.id,
      actionType: "ataque_oportunidade",
      isReaction: true
    });
    check(
      !normalAfterTurnEnded.ok &&
        normalAfterTurnEnded.errorCode === "OUT_OF_TURN_NORMAL_ACTION_FORBIDDEN" &&
        reactionAfterTurnEnded.ok &&
        OS.combatActionController.getAvailableActions(tokA.id) === 0,
      "C7: após encerrar turno, ações normais fora do turno são proibidas e reação válida usa saldo restante"
    );

    // Simula que Pistoleiro B teve iniciativa 6B atualizada para 22 durante desconexão (atualiza tokB + grava)
    tokB.iniciativa = 22;
    OS.updatePlayerSheetStats("sheet-pb", { iniciativa: "22" });

    /* ─── PERSISTÊNCIA (COM-05 / COM-08): Simula fechamento completo / refresh / reconexão ─── */
    const eventsBeforeRestart = observedEvents.length;
    OS.resetMesaCombat(); // limpa estado em memória mantendo localStorage (como reinicialização do app!)
    await OS.loadMesaCombat(); // reconecta e lê snapshot do servidor (onde atualizar_resumo envia tokB.iniciativa = 22)

    const restoredA = OS.combatActionController.getActionState(tokA.id);
    const restoredBInit = OS.getCombatantInitiativeState(tokB.id);
    // Snapshot repetido após reconexão NÃO pode reemitir eventos nem restaurar ações gastas!
    await OS.loadMesaCombat();

    check(
      observedEvents.length === eventsBeforeRestart &&
        restoredA.spentActions === 2 &&
        restoredA.reservedActions === 1 &&
        restoredA.availableActions === 0 &&
        restoredA.turnEnded === true &&
        restoredBInit.currentInitiative === 6 &&
        restoredBInit.nextRoundInitiative === 22 &&
        OS.combatActionController.getAvailableActions(tokB.id) === 2,
      "P1: após reinício/refresh/reconexão, iniciativa vigente (6), futura (22), saldo/reserva pendente e eventos não duplicados são preservados"
    );

    // Testa rejeição de evento/snapshot de rodada anterior recebido fora de ordem
    // Primeiro confirma a reação pendente para poder virar para Round 2
    await OS.combatActionController.commitReservation({
      opId: "op-a-reaction-commit",
      combatantId: tokA.id,
      reservationId: reactionAfterTurnEnded.reservationId,
      resultRevealed: true
    });
    const staleRound1Snapshot = clone({ combate: combat, revisao: combatRev });
    staleRound1Snapshot.combate.round = 1;
    staleRound1Snapshot.revisao = combatRev + 50; // mesmo se sinal Realtime vier com revisão maior, round antigo não sobrescreve R2!

    await OS.runMesaCombatAction("proximo"); // vira para Round 2!
    const eventsAfterR2 = observedEvents.length;
    OS.acceptMesaCombatSnapshot(roomId, staleRound1Snapshot); // snapshot fora de ordem da rodada 1 após entrar na rodada 2!

    check(
      OS.activeMesaState.combateAtivo.round === 2 &&
        observedEvents.length === eventsAfterR2 &&
        observedEvents.some((e) => e.type === "ROUND_ENDED" && e.round === 1) &&
        observedEvents.some((e) => e.type === "ROUND_STARTED" && e.round === 2) &&
        OS.getCombatantInitiativeState(tokB.id).currentInitiative === 22 &&
        OS.getCombatantInitiativeState(tokB.id).nextRoundInitiative === null &&
        OS.combatActionController.getAvailableActions(tokB.id) === 5 &&
        OS.combatActionController.getAvailableActions(tokA.id) === 3 &&
        OS.combatActionController.getActionState(tokA.id).spentActions === 0,
      "P2/E3: virada para Round 2 promove tokB(22->5 ações), não transporta saldo/gastos de A e rejeita snapshot antigo fora de ordem"
    );

    /* ─── Testes de Segurança (Action Controller & Turn Tracker) ─── */
    // 1. Custo adulterado
    const tamperedZero = await OS.combatActionController.reserveAction({
      opId: "sec-tamper-0",
      combatantId: tokB.id,
      actionType: "atacar",
      cost: 0
    });
    const tamperedMismatch = await OS.combatActionController.reserveAction({
      opId: "sec-tamper-mismatch",
      combatantId: tokB.id,
      actionType: "remover_desorientado",
      cost: 1
    });
    // 2. Mapa incorreto
    const wrongMap = await OS.combatActionController.reserveAction({
      opId: "sec-wrong-map",
      combatantId: tokB.id,
      actionType: "atacar",
      mapaId: map2Id
    });
    // 3. Versão obsoleta
    const staleVersion = await OS.combatActionController.reserveAction({
      opId: "sec-stale-ver",
      combatantId: tokB.id,
      actionType: "atacar",
      expectedVersion: 999
    });
    check(
      !tamperedZero.ok &&
        tamperedZero.errorCode === "INVALID_OR_TAMPERED_COST" &&
        !tamperedMismatch.ok &&
        tamperedMismatch.errorCode === "INVALID_OR_TAMPERED_COST" &&
        !wrongMap.ok &&
        wrongMap.errorCode === "MAP_MISMATCH" &&
        !staleVersion.ok &&
        staleVersion.errorCode === "STALE_STATE_VERSION",
      "S1: custo adulterado, mapa incorreto e versão obsoleta são bloqueados"
    );

    // 4. Usuário não autenticado
    const savedAuth = OS.authSession;
    OS.authSession = null;
    OS.activeMesaState.currentUserId = null;
    currentAuthUid = null;
    const unauthOp = await OS.combatActionController.reserveAction({
      opId: "sec-unauth",
      combatantId: tokB.id,
      actionType: "atacar"
    });
    check(!unauthOp.ok && unauthOp.errorCode === "UNAUTHENTICATED_USER", "S2: usuário não autenticado bloqueado");

    // 5. Jogador B tenta modificar Pistoleiro A, ver/modificar oculto e avançar rodada sem ser Xerife
    currentAuthUid = playerBId;
    OS.authSession = { userId: playerBId };
    OS.activeMesaState.currentUserId = playerBId;
    OS.activeMesaState.isMestre = false;
    OS.activeMesaState.playerFichaId = "sheet-pb";
    await OS.loadMesaCombat(); // recebe visão pública filtrada (sem hiddenRes!)

    const playerTurnEvents = [];
    const unsubP = OS.onTurnTrackerEvent((e) => playerTurnEvents.push(e));

    const playerAttackOther = await OS.combatActionController.reserveAction({
      opId: "sec-other-player",
      combatantId: tokA.id,
      actionType: "atacar"
    });
    const playerTouchHidden = await OS.combatActionController.reserveAction({
      opId: "sec-hidden-npc",
      combatantId: hiddenRes.token.id,
      actionType: "atacar"
    });
    const playerAdvanceTurn = await OS.runMesaCombatAction("proximo");
    check(
      !playerAttackOther.ok &&
        playerAttackOther.errorCode === "UNAUTHORIZED_COMBATANT_ACCESS" &&
        !playerTouchHidden.ok &&
        playerTouchHidden.errorCode === "COMBATANT_NOT_IN_COMBAT" &&
        playerAdvanceTurn === false &&
        !OS.activeMesaState.combateAtivo.ordem.some((c) => c.token_id === hiddenRes.token.id),
      "S3: jogador bloqueado de alterar outro combatente, entidade oculta ou avançar rodada"
    );

    // Avança no servidor como GM até o turno do token oculto e verifica evento público com hiddenTurn: true e combatantId: null
    currentAuthUid = gmId;
    const gmSaveState = { isMestre: true, currentUserId: gmId };
    OS.activeMesaState.isMestre = true;
    OS.activeMesaState.currentUserId = gmId;
    // Em R2 ordem: [tokB(22), tokA(10), hiddenRes]. idx 0=tokB -> proximo idx 1=tokA -> proximo idx 2=hiddenRes
    await client.rpc("gerenciar_combate", { p_mesa_id: roomId, p_acao: "proximo", p_versao: combat.versao, p_combate_id: combat.id });
    await client.rpc("gerenciar_combate", { p_mesa_id: roomId, p_acao: "proximo", p_versao: combat.versao, p_combate_id: combat.id });
    // Volta visão do jogador para ler o turno oculto sem vazar identidade
    currentAuthUid = playerBId;
    OS.activeMesaState.isMestre = false;
    OS.activeMesaState.currentUserId = playerBId;
    await OS.loadMesaCombat();
    const lastPlayerEvt = playerTurnEvents[playerTurnEvents.length - 1];
    check(
      lastPlayerEvt &&
        lastPlayerEvt.type === "TURN_STARTED" &&
        lastPlayerEvt.hiddenTurn === true &&
        lastPlayerEvt.combatantId === null,
      "S4: turno de participante oculto emite evento neutro para jogador sem vazar identidade"
    );
    unsubP();

    // 6. Jogador B tenta custom e reação adulterada + verificação de isolamento e sanitização de cache localStorage
    const playerCustomDenied = await OS.combatActionController.reserveAction({
      opId: "sec-player-custom",
      combatantId: tokB.id,
      actionType: "custom",
      cost: 1,
      reason: "Quero gastar 1 apenas"
    });
    const playerDirectRpcCustom = await client.rpc("gerenciar_acao_combate", {
      p_mesa_id: roomId,
      p_combate_id: combat.id,
      p_token_id: tokB.id,
      p_operacao: "reserve",
      p_op_id: "sec-player-custom-rpc",
      p_action_type: "custom",
      p_cost: 1,
      p_is_reaction: false,
      p_mapa_id: map1Id,
      p_round: 2,
      p_justificativa: "Tentativa direta na RPC"
    });
    const playerReactSpoof = await OS.combatActionController.reserveAction({
      opId: "sec-player-react-spoof",
      combatantId: tokB.id,
      actionType: "ataque_oportunidade",
      isReaction: true,
      gmAuthorizedReaction: true
    });
    const playerReactDirectRpc = await client.rpc("gerenciar_acao_combate", {
      p_mesa_id: roomId,
      p_combate_id: combat.id,
      p_token_id: tokB.id,
      p_operacao: "reserve",
      p_op_id: "sec-player-react-rpc",
      p_action_type: "ataque_oportunidade",
      p_cost: 1,
      p_is_reaction: true,
      p_mapa_id: map1Id,
      p_round: 2
    });
    const lsPlayerKey = "oesteSombrioCombatCanonical_" + playerBId + "_" + roomId;
    const lsGmKey = "oesteSombrioCombatCanonical_" + gmId + "_" + roomId;
    const rawPlayerCache = JSON.parse(localStorage.getItem(lsPlayerKey) || "null");
    check(
      !playerCustomDenied.ok &&
        playerCustomDenied.errorCode === "CUSTOM_ACTION_REQUIRES_GM" &&
        playerDirectRpcCustom.error &&
        playerDirectRpcCustom.error.code === "42501" &&
        !playerReactSpoof.ok &&
        playerReactSpoof.errorCode === "REACTION_REQUIRES_GM_AUTHORIZATION" &&
        playerReactDirectRpc.error &&
        playerReactDirectRpc.error.code === "42501" &&
        localStorage.getItem("oesteSombrioCombatCanonical_" + roomId) === null &&
        rawPlayerCache &&
        String(rawPlayerCache.userId) === String(playerBId) &&
        !rawPlayerCache.byTokenId[hiddenRes.token.id] &&
        rawPlayerCache.byTokenId[tokA.id] &&
        rawPlayerCache.byTokenId[tokA.id].actionState === null &&
        localStorage.getItem(lsGmKey) !== null,
      "S6: jogador bloqueado em custom e reação adulterada (client+RPC), cache isolado por usuário e sanitizado"
    );

    // 7. Queda antes do commit, conflito concorrente multi-aba, reconexão sem auto-ativar localStorage, custom GM e drop pós-commit
    OS.authSession = savedAuth;
    currentAuthUid = gmId;
    OS.activeMesaState.isMestre = true;
    OS.activeMesaState.currentUserId = gmId;
    OS.activeMesaState.playerFichaId = null;
    await OS.loadMesaCombat();

    enableServerActionRpc = true;
    // Avança para terminar turno de hiddenRes e iniciar Round 3 (idx 0 = tokB!)
    await OS.runMesaCombatAction("proximo");

    // 7a. Custom do GM sem justificativa falha; com justificativa é aprovado e auditado; reação com tipo inválido falha
    const gmCustomNoReason = await OS.combatActionController.reserveAction({
      opId: "sec-gm-custom-noreason",
      combatantId: tokB.id,
      actionType: "custom",
      cost: 2,
      reason: "   "
    });
    const gmReactInvalidType = await OS.combatActionController.reserveAction({
      opId: "sec-gm-react-badtype",
      combatantId: tokB.id,
      actionType: "limpar_olhos",
      isReaction: true
    });
    const gmCustomValid = await OS.combatActionController.reserveAction({
      opId: "sec-gm-custom-ok",
      combatantId: tokB.id,
      actionType: "custom",
      cost: 1,
      reason: "Puxar alavanca da ponte"
    });
    check(
      !gmCustomNoReason.ok &&
        gmCustomNoReason.errorCode === "CUSTOM_ACTION_REQUIRES_JUSTIFICATION" &&
        !gmReactInvalidType.ok &&
        gmReactInvalidType.errorCode === "INVALID_REACTION_ACTION_TYPE" &&
        gmCustomValid.ok &&
        gmCustomValid.reason === "Puxar alavanca da ponte",
      "S7: custom do Xerife exige justificativa e grava trilha; tipo inválido de reação rejeitado"
    );
    await OS.combatActionController.cancelReservation({
      opId: "sec-gm-custom-cancel",
      combatantId: tokB.id,
      reservationId: gmCustomValid.reservationId
    });

    // 7b. Queda de conexão ANTES de confirmar no servidor: zero gasto local!
    dropRpcBeforeCommitOnce = true;
    const beforeDropAvail = OS.combatActionController.getAvailableActions(tokB.id);
    const dropBeforeCommitRes = await OS.combatActionController.reserveAction({
      opId: "sec-drop-before",
      combatantId: tokB.id,
      actionType: "atacar"
    });
    // Reserva normal após reconexão + queda APÓS commit (timeout na resposta) + retry idempotente
    const srvRes = await OS.combatActionController.reserveAction({
      opId: "srv-op-1",
      combatantId: tokB.id,
      actionType: "atacar"
    });
    dropRpcResponseOnce = true;
    const srvCommitDrop = await OS.combatActionController.commitReservation({
      opId: "srv-commit-1",
      combatantId: tokB.id,
      reservationId: srvRes.reservationId,
      resultRevealed: true
    });
    const srvCommitRetry = await OS.combatActionController.commitReservation({
      opId: "srv-commit-1",
      combatantId: tokB.id,
      reservationId: srvRes.reservationId,
      resultRevealed: true
    });
    const srvIdempMismatch = await OS.combatActionController.reserveAction({
      opId: "srv-op-1",
      combatantId: tokB.id,
      actionType: "limpar_olhos"
    });
    const wrongCombatRes = await OS.combatActionController.reserveAction({
      opId: "sec-wrong-combat",
      combateId: crypto.randomUUID(),
      combatantId: tokB.id,
      actionType: "atacar"
    });

    // 7c. Duas abas concorrentes chamam gerenciar_acao_combate diretamente com a MESMA expectedVersion atual
    const currBVer = OS.combatActionController.getActionState(tokB.id).version;
    const [tabRpcA, tabRpcB] = await Promise.all([
      client.rpc("gerenciar_acao_combate", {
        p_mesa_id: roomId,
        p_combate_id: combat.id,
        p_token_id: tokB.id,
        p_operacao: "reserve",
        p_op_id: "tab-conc-a",
        p_action_type: "atacar",
        p_cost: 1,
        p_is_reaction: false,
        p_mapa_id: map1Id,
        p_round: 3,
        p_expected_version: currBVer
      }),
      client.rpc("gerenciar_acao_combate", {
        p_mesa_id: roomId,
        p_combate_id: combat.id,
        p_token_id: tokB.id,
        p_operacao: "reserve",
        p_op_id: "tab-conc-b",
        p_action_type: "mover",
        p_cost: 1,
        p_is_reaction: false,
        p_mapa_id: map1Id,
        p_round: 3,
        p_expected_version: currBVer
      })
    ]);

    // 7d. Cache adulterado com reserva local não confirmada (`persistedOnServer: false`) NÃO pode ressuscitar no loadMesaCombat
    const lsGmRaw = JSON.parse(localStorage.getItem(lsGmKey));
    lsGmRaw.byTokenId[tokB.id].actionState.persistedOnServer = false;
    lsGmRaw.byTokenId[tokB.id].actionState.ledger.push({ opId: "forged", reservationId: "res_forged", actionType: "atacar", cost: 1, status: "reserved" });
    localStorage.setItem(lsGmKey, JSON.stringify(lsGmRaw));
    OS.resetMesaCombat();
    await OS.loadMesaCombat();
    const afterCacheHeal = OS.combatActionController.getActionState(tokB.id);

    check(
      !dropBeforeCommitRes.ok &&
        dropBeforeCommitRes.persistedOnServer === false &&
        beforeDropAvail === 5 &&
        srvRes.ok &&
        srvRes.persistedOnServer === true &&
        !srvCommitDrop.ok &&
        srvCommitDrop.persistedOnServer === false &&
        srvCommitRetry.ok &&
        srvCommitRetry.idempotentReplay === true &&
        !srvIdempMismatch.ok &&
        srvIdempMismatch.errorCode === "IDEMPOTENCY_PAYLOAD_MISMATCH" &&
        !wrongCombatRes.ok &&
        wrongCombatRes.errorCode === "COMBAT_MISMATCH" &&
        !tabRpcA.error &&
        tabRpcB.error &&
        tabRpcB.error.code === "40001" &&
        afterCacheHeal.spentActions === 1 &&
        !afterCacheHeal.ledger.some((e) => e.opId === "forged"),
      "S8: queda pré/pós-commit, combate divergente, corrida 40001 entre abas e descarte de cache local adulterado"
    );

    // Finaliza combate e confirma ROUND_ENDED / TURN_ENDED
    await OS.runMesaCombatAction("encerrar");
    const endRoundEvts = observedEvents.filter((e) => e.type === "ROUND_ENDED");
    check(endRoundEvts.length >= 2, "E4: encerramento emite ROUND_ENDED e limpa persistência");

    // Regressão Turn Tracker com Action Controller indisponível (RPC OFF) + 9 combatentes (8 bandidos Criatura cascata + Boss Avançado) + entrada tardia legada
    const legacyEntry = {
      key: "custom:leg-ctrl",
      id: "leg-ctrl",
      sourceType: "custom",
      name: "Legado Sem Modo",
      category: "NPC",
      data: { nome: "Legado Sem Modo", freeEdit: true, isBestiaryCustom: true, iniciativa: "11" }
    };
    const mesaLegacy = await OS.addBestiarioEntryToMesa(legacyEntry);
    const legacyRes = await OS.addNpcMesaToScene(mesaLegacy.mesaNpcId);

    enableServerActionRpc = false;
    nextD20Roll = 12;
    await OS.runMesaCombatAction("iniciar", {
      p_participantes: band8
        .map((b, i) => ({ token_id: b.token.id, modo: "cascata", prioridade: i + 1 }))
        .concat([{ token_id: bossRes.token.id, modo: "ficha", prioridade: 9 }])
    });
    await OS.runMesaCombatAction("adicionar", { p_token_id: legacyRes.token.id });
    const reserveBlockedOffline = await OS.combatActionController.reserveAction({
      opId: "op-offline-blocked",
      combatantId: band8[0].token.id,
      actionType: "atacar"
    });
    enableServerActionRpc = true;
    const reserveLegacyDenied = await OS.combatActionController.reserveAction({
      opId: "op-leg-denied",
      combatantId: legacyRes.token.id,
      actionType: "ataque_oportunidade",
      isReaction: true
    });
    const audit9 = OS.activeMesaState.combateAtivo.ordem;
    const actionCheck9 =
      audit9.length === 10 &&
      OS.combatActionController.getAvailableActions(band8[0].token.id) === 1 &&
      OS.combatActionController.getAvailableActions(bossRes.token.id) === 4 &&
      OS.combatActionController.getAvailableActions(legacyRes.token.id) === null &&
      !reserveBlockedOffline.ok &&
      reserveBlockedOffline.unavailable === true &&
      !reserveLegacyDenied.ok &&
      reserveLegacyDenied.errorCode === "BUDGET_UNDEFINED";
    await OS.runMesaCombatAction("encerrar");
    check(actionCheck9, "E5: Turn Tracker + 8 Criaturas + Boss + legado funcionam com RPC indisponível, sem fallback local autoritativo e BUDGET_UNDEFINED");

    unsub();
    document.getElementById("result").textContent =
      "PASS: " + results.length + " verificações | " + results.join(" | ");
  } catch (e) {
    document.getElementById("result").textContent = "FAIL: " + (e && e.stack ? e.stack : String(e));
  }
};

const html = read("dist/index.html")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(
    "</body>",
    '<pre id="result" style="position:fixed;inset:0 auto auto 0;background:#17120f;color:white;z-index:99999;max-width:100%;white-space:pre-wrap;font:11px monospace">Executando…</pre><script type="module">(' +
      browserTest.toString() +
      ")();</script></body>"
  );

(async () => {
  try {
    const pureBestiary = await runRealBestiaryJsonChecks();
    console.log(pureBestiary);

    const server = http.createServer((req, res) => {
      if (req.url === "/test") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(html);
      }
      const pathname = decodeURIComponent(req.url.split("?")[0]);
      const file = path.resolve(root, "dist", "." + pathname);
      if (!file.startsWith(path.join(root, "dist") + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      try {
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
            ? "application/json"
            : "application/octet-stream"
        );
        res.end(fs.readFileSync(file));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await require("./browser-harness.cjs")(
        "http://127.0.0.1:" + server.address().port + "/test",
        temp,
        path.join(temp, "com07-com08.png")
      );
      console.log(result);
      if (!result.startsWith("PASS:")) process.exitCode = 1;
      console.log("Screenshot: " + path.join(temp, "com07-com08.png"));
    } finally {
      server.close();
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
