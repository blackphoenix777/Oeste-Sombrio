const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "darkwest-com09-com12-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

async function runPureRulesAndSqlAudit() {
  const pureDir = path.join(temp, "pure-rules");
  fs.mkdirSync(pureDir, { recursive: true });
  fs.writeFileSync(path.join(pureDir, "package.json"), JSON.stringify({ type: "module" }));
  const rulesSrcDir = path.join(root, "dist/js/rules");
  for (const file of fs.readdirSync(rulesSrcDir)) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(path.join(rulesSrcDir, file), path.join(pureDir, file));
    }
  }
  const rules = await import(pathToFileURL(path.join(pureDir, "reactionRules.js")).href);

  // 1. COM-09: turn phases, preservation post-turn, expiration on round end, NPC Criatura fixed 1 action
  const baseCombat = {
    id: "c-1",
    ativo: true,
    mapa_id: "map-1",
    round: 1,
    turno_atual_idx: 1,
    ordem: [
      {
        token_id: "tok-a",
        owner_type: "player",
        name: "Pistoleiro A",
        currentInitiative: 15,
        actionState: {
          round: 1,
          budgetDefined: true,
          initialBudget: 4,
          spentActions: 2,
          reservedActions: 0,
          turnEnded: true,
          version: 3,
          ledger: [{ status: "committed", cost: 2 }]
        }
      },
      {
        token_id: "tok-b",
        owner_type: "player",
        name: "Pistoleiro B",
        currentInitiative: 10,
        actionState: {
          round: 1,
          budgetDefined: true,
          initialBudget: 3,
          spentActions: 0,
          reservedActions: 0,
          turnEnded: false,
          version: 1,
          ledger: []
        }
      },
      {
        token_id: "tok-c",
        owner_type: "creature",
        name: "Bandido Criatura",
        currentInitiative: 18,
        actionState: {
          round: 1,
          budgetDefined: true,
          initialBudget: 1,
          spentActions: 0,
          reservedActions: 0,
          turnEnded: false,
          version: 1,
          ledger: []
        }
      }
    ]
  };

  assert.equal(rules.deriveCombatantTurnPhase(baseCombat, baseCombat.ordem[0], { itemIndex: 0 }), "post_turn");
  assert.equal(rules.deriveCombatantTurnPhase(baseCombat, baseCombat.ordem[1], { itemIndex: 1 }), "active_turn");
  assert.equal(rules.deriveCombatantTurnPhase(baseCombat, baseCombat.ordem[2], { itemIndex: 2 }), "pre_turn");
  assert.equal(rules.deriveCombatantTurnPhase({ ativo: false }, baseCombat.ordem[0]), "round_ended");

  const sumA = rules.summarizeCombatantActionEconomy(baseCombat, baseCombat.ordem[0], { itemIndex: 0 });
  assert.equal(sumA.turnPhase, "post_turn");
  assert.equal(sumA.availableActions, 2);
  assert.equal(sumA.ordinaryActionsAvailable, 0);
  assert.equal(sumA.postTurnReactionsAvailable, 2);
  assert.equal(sumA.canPerformOrdinaryAction, false);

  const sumEnded = rules.summarizeCombatantActionEconomy({ ativo: false, round: 1 }, baseCombat.ordem[0]);
  assert.equal(sumEnded.turnPhase, "round_ended");
  assert.equal(sumEnded.actionsExpired, true);
  assert.equal(sumEnded.availableActions, 0);

  // 2. COM-11: Grid distance strictly in squares * 1.5m (never pixels)
  const dClose = rules.computeGridDistanceBetweenTokens(
    { mapa_id: "map-1", grid_x: 4, grid_y: 4 },
    { mapa_id: "map-1", grid_x: 5, grid_y: 5 }
  );
  assert.equal(dClose.valid, true);
  assert.equal(dClose.squares, 1);
  assert.equal(dClose.meters, 1.5);

  const dFar = rules.computeGridDistanceBetweenTokens(
    { mapa_id: "map-1", grid_x: 1, grid_y: 1 },
    { mapa_id: "map-1", grid_x: 4, grid_y: 1 }
  );
  assert.equal(dFar.valid, true);
  assert.equal(dFar.squares, 3);
  assert.equal(dFar.meters, 4.5);

  const dDiffMap = rules.computeGridDistanceBetweenTokens(
    { mapa_id: "map-1", grid_x: 1, grid_y: 1 },
    { mapa_id: "map-2", grid_x: 1, grid_y: 1 }
  );
  assert.equal(dDiffMap.valid, false);
  assert.equal(dDiffMap.reason, "DIFFERENT_MAP");

  const dMissing = rules.computeGridDistanceBetweenTokens(
    { mapa_id: "map-1", grid_x: 1, grid_y: 1 },
    { mapa_id: "map-1" }
  );
  assert.equal(dMissing.valid, false);
  assert.equal(dMissing.reason, "MISSING_GRID_COORDS");

  // 3. COM-11: Passive skill inspection never invents missing sheet data
  const passMissing = rules.inspectPassiveSkillForReaction(null, "combate-corpo-a-corpo");
  assert.equal(passMissing.status, "needs_gm_confirmation");
  assert.equal(passMissing.needsGmConfirmation, true);

  const passValid = rules.inspectPassiveSkillForReaction(
    {
      "combate-corpo-a-corpo-d6": true,
      "combate-corpo-a-corpo-d8": true,
      "chamber-0": "6",
      "chamber-1": "4",
      usedChambers: [0],
      damagedChambers: []
    },
    "combate-corpo-a-corpo"
  );
  assert.equal(passValid.status, "evaluated");
  assert.equal(passValid.maxAvailable6B, 4);
  assert.deepEqual(passValid.trainedDice, ["d6", "d8"]);

  // 4. COM-11: Full contextual opportunity evaluation
  const validOpp = rules.evaluateContextualOpportunity({
    combatState: baseCombat,
    mesaId: "m-1",
    activeMesaId: "m-1",
    mapaId: "map-1",
    round: 1,
    combatantId: "tok-a",
    actionType: "ataque_oportunidade",
    isMestre: true,
    reactorToken: { id: "tok-a", mapa_id: "map-1", grid_x: 2, grid_y: 2 },
    targetToken: { id: "tok-c", mapa_id: "map-1", grid_x: 3, grid_y: 2 },
    sheetData: { "combate-corpo-a-corpo-d8": true, "chamber-0": "5", usedChambers: [], damagedChambers: [] }
  });
  assert.equal(validOpp.eligible, true);
  assert.equal(validOpp.authorizationMode, "post_turn_gm_opportunity");
  assert.equal(validOpp.requiresEarlyApproval, false);
  assert.equal(validOpp.rangeCheck.status, "in_range");
  assert.equal(validOpp.passiveSkillCheck.status, "evaluated");

  const outOfRangeOpp = rules.evaluateContextualOpportunity({
    combatState: baseCombat,
    mesaId: "m-1",
    activeMesaId: "m-1",
    mapaId: "map-1",
    round: 1,
    combatantId: "tok-a",
    actionType: "ataque_oportunidade",
    isMestre: true,
    reactorToken: { id: "tok-a", mapa_id: "map-1", grid_x: 2, grid_y: 2 },
    targetToken: { id: "tok-c", mapa_id: "map-1", grid_x: 8, grid_y: 2 },
    sheetData: { "combate-corpo-a-corpo-d8": true, "chamber-0": "5", usedChambers: [], damagedChambers: [] }
  });
  assert.equal(outOfRangeOpp.eligible, false);
  assert.equal(outOfRangeOpp.rangeCheck.status, "out_of_range");

  const preTurnOpp = rules.evaluateContextualOpportunity({
    combatState: baseCombat,
    mesaId: "m-1",
    activeMesaId: "m-1",
    mapaId: "map-1",
    round: 1,
    combatantId: "tok-c",
    actionType: "reacao",
    isMestre: true,
    rangeConfirmedByGm: true
  });
  assert.equal(preTurnOpp.eligible, true);
  assert.equal(preTurnOpp.requiresEarlyApproval, true);
  assert.equal(preTurnOpp.authorizationMode, "requires_early_reaction_approval");

  const wrongRoundOpp = rules.evaluateContextualOpportunity({
    combatState: baseCombat,
    mesaId: "m-1",
    activeMesaId: "m-1",
    mapaId: "map-1",
    round: 0,
    combatantId: "tok-a",
    actionType: "reacao",
    isMestre: true,
    rangeConfirmedByGm: true
  });
  assert.equal(wrongRoundOpp.eligible, false);

  // 5. COM-12: Contextual bar commands
  const barPostTurn = rules.evaluateContextualBarCommands({
    combatState: baseCombat,
    selectedItem: baseCombat.ordem[0],
    isMestre: false,
    canOperateCombatant: true,
    selectedActionType: "atacar",
    opportunities: [
      { opportunityId: "opp-1", combatantId: "tok-a", round: 1, status: "open", actionType: "ataque_oportunidade", cost: 1 }
    ],
    requests: []
  });
  assert.equal(barPostTurn.canReserveOrdinary, false);
  assert.equal(barPostTurn.canRequestEarlyReaction, false);
  assert.equal(barPostTurn.openOpportunities.length, 1);
  assert.equal(barPostTurn.openOpportunities[0].canExecuteDirectly, true);

  const barPreTurn = rules.evaluateContextualBarCommands({
    combatState: baseCombat,
    selectedItem: baseCombat.ordem[2],
    isMestre: false,
    canOperateCombatant: true,
    selectedActionType: "reacao",
    opportunities: [],
    requests: []
  });
  assert.equal(barPreTurn.canReserveOrdinary, false);
  assert.equal(barPreTurn.canRequestEarlyReaction, true);

  // 6. Static SQL audit of COM-09..COM-12 migration
  const sqlMig = read("supabase/migrations/20261119120000_com09_com12_reactions_and_opportunities.sql");
  assert.ok(sqlMig.includes("SECURITY DEFINER SET search_path = ''"), "Migration must use SECURITY DEFINER SET search_path = ''");
  assert.ok(sqlMig.includes("FOR UPDATE"), "Migration must serialize mutations with FOR UPDATE");
  assert.ok(sqlMig.includes("ERRCODE = 'PT409'"), "Migration must use PT409 for version/concurrency conflicts");
  assert.ok(sqlMig.includes("REVOKE ALL ON FUNCTION public.gerenciar_reacao_combate"), "Migration must revoke PUBLIC/anon");
  assert.ok(sqlMig.includes("GRANT EXECUTE ON FUNCTION public.gerenciar_reacao_combate"), "Migration must grant authenticated");

  return "PASS pure COM-09..12 rules & static SQL audit";
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
    try { localStorage.clear(); } catch {}
    const modules = [
      "config", "state", "ui", "dice", "modal", "cylinder", "skills", "combat",
      "storage", "equipment", "equipCatalog", "gameData", "catalogModal",
      "inventoryUI", "magiasUI", "characterManager", "homeScreen", "authUI",
      "mesaScreen", "mesaMaps", "turnTracker", "mesaTokenStatus",
      "mesaDeliveries", "mesaNotes"
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
    if (OS.bindTurnTrackerEvents) OS.bindTurnTrackerEvents();
    OS.initCylinder();

    const gmId = "11111111-1111-4111-8111-111111111111";
    const playerAId = "22222222-2222-4222-8222-222222222222";
    const playerBId = "33333333-3333-4333-8333-333333333333";
    const roomId = "44444444-4444-4444-8444-444444444444";
    const map1Id = "55555555-5555-4555-8555-555555555555";
    const map2Id = "66666666-6666-4666-8666-666666666666";

    const tokA = { id: "tok-a", mesa_id: roomId, mapa_id: map1Id, owner_type: "player", owner_ref: "ficha-a", owner_user_id: playerAId, display_name: "Pistoleiro A", grid_x: 2, grid_y: 2, iniciativa: 10, visible_to_players: true };
    const tokB = { id: "tok-b", mesa_id: roomId, mapa_id: map1Id, owner_type: "player", owner_ref: "ficha-b", owner_user_id: playerBId, display_name: "Pistoleiro B", grid_x: 3, grid_y: 2, iniciativa: 6, visible_to_players: true };
    const tokCr = { id: "tok-cr", mesa_id: roomId, mapa_id: map1Id, owner_type: "creature", owner_ref: "inst-cr", owner_user_id: null, display_name: "Bandido Criatura", grid_x: 2, grid_y: 3, iniciativa: 4, visible_to_players: true };
    const tokFar = { id: "tok-far", mesa_id: roomId, mapa_id: map1Id, owner_type: "creature", owner_ref: "inst-far", owner_user_id: null, display_name: "Bandido Longe", grid_x: 10, grid_y: 10, iniciativa: 2, visible_to_players: true };
    const tokHidden = { id: "tok-hid", mesa_id: roomId, mapa_id: map1Id, owner_type: "creature", owner_ref: "inst-hid", owner_user_id: null, display_name: "Emboscador Oculto", grid_x: 3, grid_y: 3, iniciativa: 1, visible_to_players: false };

    const allTokens = [tokA, tokB, tokCr, tokFar, tokHidden];
    const playerSheets = [
      { id: "ficha-a", usuario_id: playerAId, mesa_id: roomId, dados: { nome: "Pistoleiro A", iniciativa: "10", "combate-corpo-a-corpo-d8": true, "chamber-0": "6", "chamber-1": "4", usedChambers: [], damagedChambers: [], inventoryItems: [] } },
      { id: "ficha-b", usuario_id: playerBId, mesa_id: roomId, dados: { nome: "Pistoleiro B", iniciativa: "6", "combate-corpo-a-corpo-d6": true, "chamber-0": "5", usedChambers: [], damagedChambers: [], inventoryItems: [] } }
    ];
    const sceneCreatures = [
      { instanceId: "inst-cr", sourceType: "custom", sourceCategory: "NPC", operationalMode: "creature_mode", data: { nome: "Bandido Criatura", operationalMode: "creature_mode", isCriatura: true } },
      { instanceId: "inst-far", sourceType: "custom", sourceCategory: "NPC", operationalMode: "creature_mode", data: { nome: "Bandido Longe", operationalMode: "creature_mode", isCriatura: true } },
      { instanceId: "inst-hid", sourceType: "custom", sourceCategory: "NPC", operationalMode: "creature_mode", data: { nome: "Emboscador Oculto", operationalMode: "creature_mode", isCriatura: true } }
    ];

    // Mock server faithfully mirroring Postgres 20261119120000_com09_com12_reactions_and_opportunities.sql
    let combat = null;
    let rev = 0;
    const rtHandlers = [];
    let forceDropNextResponseOnce = false;

    function makeActionState(tok, roundNum, initVal) {
      const budget = tok.owner_type === "player" ? 1 + Math.floor(initVal / 5) : 1;
      return {
        mesaId: roomId, combateId: "comb-1", mapaId: map1Id, round: roundNum,
        combatantId: tok.id, instanceId: tok.owner_ref,
        kind: tok.owner_type === "player" ? "player" : "npc_human",
        operationalMode: tok.owner_type === "player" ? "full_sheet" : "creature_mode",
        currentInitiative: initVal, budgetDefined: true, pendingReason: null,
        initialBudget: budget, spentActions: 0, reservedActions: 0, turnEnded: false,
        version: 1, ledger: [], auditLog: [], opResults: {}
      };
    }

    function calcPhase(stObj, item, idx) {
      if (!stObj || !stObj.ativo || !item) return "round_ended";
      if (item.action_state && item.action_state.turnEnded) return "post_turn";
      if (idx === stObj.turno_atual_idx) return "active_turn";
      if (idx < stObj.turno_atual_idx && !item.entrou_no_meio) return "post_turn";
      return "pre_turn";
    }

    function snapshotFor(isGm, uid) {
      if (!combat) return { combate: null, revisao: rev };
      const c = clone(combat);
      delete c.reaction_op_results;
      if (isGm) return { combate: c, revisao: rev };
      const activeTid = c.ordem[c.turno_atual_idx] ? c.ordem[c.turno_atual_idx].token_id : null;
      c.ordem = c.ordem.filter((it) => {
        const t = allTokens.find((x) => x.id === it.token_id);
        return t && (t.visible_to_players || t.owner_user_id === uid);
      }).map((it) => {
        const t = allTokens.find((x) => x.id === it.token_id);
        if (t && t.owner_user_id === uid) return it;
        delete it.action_state;
        delete it.next_round_initiative;
        return it;
      });
      c.turno_atual_idx = c.ordem.findIndex((it) => it.token_id === activeTid);
      c.turno_oculto = activeTid !== null && c.turno_atual_idx < 0;
      c.oportunidades_reacao = (c.oportunidades_reacao || []).filter((o) => {
        const t = allTokens.find((x) => x.id === o.combatantId);
        return t && t.owner_user_id === uid;
      });
      c.solicitacoes_reacao = (c.solicitacoes_reacao || []).filter((r) => {
        const t = allTokens.find((x) => x.id === r.combatantId);
        return t && t.owner_user_id === uid;
      });
      return { combate: c, revisao: rev };
    }

    function err(code, message) { return { error: { code, message } }; }

    const client = {
      auth: { getUser: async () => ({ data: { user: { id: OS.activeMesaState.currentUserId } } }) },
      channel: () => ({
        on: function (t, cfg, fn) { rtHandlers.push({ t, cfg, fn }); return this; },
        subscribe: function () { return this; }
      }),
      rpc: async (name, args) => {
        const st = OS.activeMesaState;
        const isGm = !!st.isMestre;
        const uid = st.currentUserId;

        if (name === "obter_combate_publico") {
          return { data: snapshotFor(isGm, uid) };
        }

        if (name === "gerenciar_combate") {
          if (!isGm) return err("42501", "Apenas o Mestre pode controlar o combate");
          if (args.p_acao === "iniciar") {
            combat = {
              id: "comb-1", ativo: true, mapa_id: map1Id, round: 1, turno_atual_idx: 0, versao: 1,
              ordem: allTokens.map((t) => ({
                token_id: t.id, owner_ref: t.owner_ref, owner_type: t.owner_type,
                name: t.display_name, iniciativa: t.iniciativa, current_initiative: t.iniciativa,
                next_round_initiative: null, visible_to_players: t.visible_to_players,
                entrou_no_meio: false, iniciativa_fonte: "ficha",
                action_state: makeActionState(t, 1, t.iniciativa)
              })),
              oportunidades_reacao: [], solicitacoes_reacao: [], reaction_op_results: {}
            };
            rev++;
            return { data: snapshotFor(isGm, uid) };
          }
          if (args.p_acao === "proximo") {
            const oldItem = combat.ordem[combat.turno_atual_idx];
            if (oldItem) oldItem.action_state.turnEnded = true;
            combat.turno_atual_idx++;
            if (combat.turno_atual_idx >= combat.ordem.length) {
              if (combat.ordem.some((it) => (it.action_state.ledger || []).some((l) => l.status === "reserved"))) {
                combat.turno_atual_idx--;
                return err("22023", "Resolva ou cancele as reservas pendentes");
              }
              combat.round++;
              combat.turno_atual_idx = 0;
              combat.oportunidades_reacao = [];
              combat.solicitacoes_reacao = [];
              combat.reaction_op_results = {};
              combat.ordem.forEach((it) => {
                const t = allTokens.find((x) => x.id === it.token_id);
                it.action_state = makeActionState(t, combat.round, it.current_initiative);
              });
            } else {
              const newItem = combat.ordem[combat.turno_atual_idx];
              if (newItem) newItem.action_state.turnEnded = false;
              combat.solicitacoes_reacao.forEach((r) => {
                if (r.status === "pending" && (r.combatantId === newItem.token_id || (oldItem && r.combatantId === oldItem.token_id))) {
                  r.status = "expired";
                  r.resolutionReason = "combatant_turn_started";
                }
              });
            }
            combat.versao++;
            rev++;
            return { data: snapshotFor(isGm, uid) };
          }
          if (args.p_acao === "encerrar") { combat = null; rev++; return { data: snapshotFor(isGm, uid) }; }
        }

        if (name === "gerenciar_acao_combate") {
          const itemIdx = combat.ordem.findIndex((i) => i.token_id === args.p_token_id);
          const item = combat.ordem[itemIdx];
          const tok = allTokens.find((t) => t.id === args.p_token_id);
          if (!isGm && (!tok || tok.owner_user_id !== uid)) return err("42501", "Acesso negado");
          const opRes = OS.applyActionControllerOperation(item.action_state, {
            operation: args.p_operacao, opId: args.p_op_id, combateId: args.p_combate_id,
            mapaId: args.p_mapa_id, round: args.p_round, actionType: args.p_action_type,
            cost: args.p_cost, reservationId: args.p_reservation_id, isReaction: !!args.p_is_reaction,
            resultRevealed: args.p_result_revealed, expectedVersion: args.p_expected_version,
            isMestre: isGm, isCurrentTurn: itemIdx === combat.turno_atual_idx && !item.action_state.turnEnded,
            actorUserId: uid, reason: args.p_justificativa
          });
          if (!opRes.ok) return err(opRes.sqlstate || "22023", opRes.errorCode);
          item.action_state = opRes.state;
          combat.versao++; rev++;
          const out = clone(opRes); delete out.state;
          return { data: Object.assign({ result: out }, snapshotFor(isGm, uid)) };
        }

        if (name === "gerenciar_reacao_combate") {
          if (!combat || !combat.ativo) return err("22023", "Sem combate ativo");
          if (args.p_combate_id !== combat.id) return err("PT409", "Combate divergente");
          if (args.p_mapa_id && args.p_mapa_id !== combat.mapa_id) return err("22023", "Mapa incorreto");
          if (args.p_round != null && Number(args.p_round) !== Number(combat.round)) return err("PT409", "Rodada obsoleta");
          const op = args.p_operacao;
          const opId = args.p_op_id;
          if (["open_opportunity", "close_opportunity", "approve_early_reaction", "deny_early_reaction"].includes(op) && !isGm) {
            return err("42501", "Apenas o Xerife pode executar esta operação");
          }
          if (combat.reaction_op_results[opId]) {
            const prev = clone(combat.reaction_op_results[opId]);
            if (prev.operation !== op) return err("22023", "Conflito de idempotência");
            prev.idempotentReplay = true;
            return { data: Object.assign({ result: prev }, snapshotFor(isGm, uid)) };
          }
          if (args.p_expected_combat_version != null && Number(args.p_expected_combat_version) !== Number(combat.versao)) {
            return err("PT409", "Versão do combate desatualizada");
          }

          let tokenId = args.p_token_id;
          let reqObj = null;
          if (["approve_early_reaction", "deny_early_reaction", "cancel_early_reaction"].includes(op)) {
            reqObj = combat.solicitacoes_reacao.find((r) => r.requestId === args.p_request_id);
            if (!reqObj) return err("PT409", "Solicitação não encontrada na rodada atual");
            tokenId = reqObj.combatantId;
          }
          const tok = allTokens.find((t) => t.id === tokenId);
          if (!tok) return err("22023", "Combatente inválido");
          if (!isGm && tok.owner_user_id !== uid) return err("42501", "Acesso negado ao combatente");
          const itemIdx = combat.ordem.findIndex((i) => i.token_id === tokenId);
          const item = combat.ordem[itemIdx];
          if (!item) return err("22023", "Combatente fora da ordem");
          const as = item.action_state;
          if (args.p_expected_action_version != null && Number(args.p_expected_action_version) !== Number(as.version)) {
            return err("PT409", "Versão do estado de ações desatualizada");
          }
          const phase = calcPhase(combat, item, itemIdx);
          const avail = OS.computeAvailableActionsFromState(as);
          let out = null;

          if (op === "open_opportunity") {
            const cost = 1;
            if (avail < cost) return err("22023", "Sem ações disponíveis");
            let distM = null, rangeStatus = args.p_range_confirmed ? "confirmed_by_gm" : "not_applicable";
            const reach = args.p_reach_meters != null ? Number(args.p_reach_meters) : (args.p_action_type === "ataque_oportunidade" ? 1.5 : null);
            if (args.p_target_token_id) {
              const tt = allTokens.find((t) => t.id === args.p_target_token_id);
              if (!tt || tt.mapa_id !== tok.mapa_id) return err("22023", "Alvo fora do mapa");
              distM = Math.max(Math.abs(tok.grid_x - tt.grid_x), Math.abs(tok.grid_y - tt.grid_y)) * 1.5;
              if (reach != null && distM > reach && !args.p_range_confirmed) return err("22023", "Alvo fora de alcance");
              rangeStatus = distM <= reach ? "in_range" : "confirmed_by_gm";
            } else if (reach != null && !args.p_range_confirmed) {
              return err("22023", "Confirme o alcance");
            }
            const opp = {
              opportunityId: "opp_" + opId, opId, mesaId: roomId, combateId: combat.id, mapaId: combat.mapa_id,
              round: combat.round, combatantId: tokenId, combatantName: tok.display_name,
              targetTokenId: args.p_target_token_id || null, actionType: args.p_action_type, cost,
              reachMeters: reach, gridDistanceMeters: distM, rangeStatus, rangeConfirmedByGm: !!args.p_range_confirmed,
              passiveSkillRequired: args.p_action_type === "ataque_oportunidade", passiveSkillKey: args.p_action_type === "ataque_oportunidade" ? "combate-corpo-a-corpo" : null,
              triggerLabel: args.p_trigger_label || "Oportunidade", requiresEarlyApproval: phase === "pre_turn", status: "open"
            };
            combat.oportunidades_reacao.push(opp);
            out = { ok: true, idempotentReplay: false, operation: op, opId, opportunityId: opp.opportunityId, combatantId: tokenId, actionType: opp.actionType, cost, rangeStatus, gridDistanceMeters: distM, status: "open" };
          } else if (op === "close_opportunity") {
            const opp = combat.oportunidades_reacao.find((o) => o.opportunityId === args.p_opportunity_id);
            if (!opp || opp.status !== "open") return err("PT409", "Oportunidade já encerrada");
            opp.status = "closed";
            out = { ok: true, idempotentReplay: false, operation: op, opId, opportunityId: opp.opportunityId, combatantId: tokenId, status: "closed" };
          } else if (op === "execute_opportunity_reaction") {
            const opp = combat.oportunidades_reacao.find((o) => o.opportunityId === args.p_opportunity_id);
            if (!opp || opp.status !== "open") return err("PT409", "Oportunidade não está aberta");
            if (opp.combatantId !== tokenId) return err("22023", "Oportunidade de outro combatente");
            if (phase === "pre_turn") return err("42501", "Antes da própria vez exige solicitação e aprovação do Xerife");
            if (avail < opp.cost) return err("PT409", "Saldo insuficiente");
            as.ledger.push({ opId, reservationId: "react_" + opId, actionType: opp.actionType, cost: opp.cost, isReaction: true, authorizedByGm: true, status: "committed", resultRevealed: true });
            as.spentActions += opp.cost;
            as.version++;
            opp.status = "consumed";
            out = { ok: true, idempotentReplay: false, operation: op, opId, opportunityId: opp.opportunityId, combatantId: tokenId, cost: opp.cost, status: "committed", version: as.version, spentActions: as.spentActions, availableActions: OS.computeAvailableActionsFromState(as) };
          } else if (op === "request_early_reaction") {
            if (phase !== "pre_turn") return err("22023", "Reação antecipada só antes da própria vez");
            if (avail < 1) return err("22023", "Sem ações disponíveis");
            if (combat.solicitacoes_reacao.some((r) => r.combatantId === tokenId && r.status === "pending")) return err("22023", "Já existe solicitação pendente");
            const r = {
              requestId: "req_" + opId, opId, mesaId: roomId, combateId: combat.id, mapaId: combat.mapa_id,
              round: combat.round, combatantId: tokenId, combatantName: tok.display_name,
              actionType: args.p_action_type || "reacao", cost: 1, opportunityId: args.p_opportunity_id || null,
              triggerSummary: args.p_trigger_label || "Reação antecipada", status: "pending"
            };
            combat.solicitacoes_reacao.push(r);
            out = { ok: true, idempotentReplay: false, operation: op, opId, requestId: r.requestId, combatantId: tokenId, status: "pending", availableActions: avail };
          } else if (op === "approve_early_reaction") {
            if (reqObj.status !== "pending") return err("PT409", "Solicitação já processada");
            if (phase !== "pre_turn") return err("PT409", "Turno já iniciou ou encerrou");
            if (avail < reqObj.cost) return err("PT409", "Saldo insuficiente no momento da aprovação");
            as.ledger.push({ opId, reservationId: "early_" + reqObj.requestId, actionType: reqObj.actionType, cost: reqObj.cost, isReaction: true, authorizedByGm: true, requestId: reqObj.requestId, status: "committed", resultRevealed: true });
            as.spentActions += reqObj.cost;
            as.version++;
            reqObj.status = "approved";
            if (reqObj.opportunityId) {
              const linked = combat.oportunidades_reacao.find((o) => o.opportunityId === reqObj.opportunityId);
              if (linked) linked.status = "consumed";
            }
            out = { ok: true, idempotentReplay: false, operation: op, opId, requestId: reqObj.requestId, combatantId: tokenId, cost: reqObj.cost, status: "approved", version: as.version, spentActions: as.spentActions, availableActions: OS.computeAvailableActionsFromState(as) };
          } else if (op === "deny_early_reaction") {
            if (reqObj.status !== "pending") return err("PT409", "Solicitação não está pendente");
            reqObj.status = "denied";
            out = { ok: true, idempotentReplay: false, operation: op, opId, requestId: reqObj.requestId, combatantId: tokenId, status: "denied", availableActions: avail };
          } else if (op === "cancel_early_reaction") {
            if (reqObj.status !== "pending") return err("PT409", "Solicitação já decidida");
            reqObj.status = "cancelled";
            out = { ok: true, idempotentReplay: false, operation: op, opId, requestId: reqObj.requestId, combatantId: tokenId, status: "cancelled", availableActions: avail };
          }

          combat.versao++;
          combat.reaction_op_results[opId] = clone(out);
          rev++;
          if (forceDropNextResponseOnce) {
            forceDropNextResponseOnce = false;
            throw new Error("Simulated network drop after server commit");
          }
          return { data: Object.assign({ result: out }, snapshotFor(isGm, uid)) };
        }
        throw new Error("Unexpected RPC: " + name);
      }
    };

    OS.getSupabaseClient = () => client;
    OS.renderMesaSceneCards = () => {};
    OS.setMesaRealtimeStatusUi = () => {};

    function setPerspective(role, uid, fichaId) {
      OS.authSession = { userId: uid, email: role + "@test.local" };
      Object.assign(OS.activeMesaState, {
        mesaId: roomId, activeMapId: map1Id, isMestre: role === "gm",
        currentUserId: uid, playerFichaId: fichaId || null,
        mesaTokens: allTokens, playerSheets, sceneCreatures
      });
    }

    // 1. GM starts combat
    setPerspective("gm", gmId, null);
    OS.resetMesaCombat({ clearPersisted: true });
    await OS.runMesaCombatAction("iniciar", { p_participantes: [] });
    check(OS.activeMesaState.combateAtivo.round === 1, "T1: Combate iniciado na Rodada 1");

    // Verify COM-12 contextual bar renders inside #mesa-turn-tracker without editable action inputs
    const bar = OS.$("mesa-tracker-action-bar");
    check(bar && !bar.hidden && bar.dataset.selectedCombatant === "tok-a", "T2: Barra contextual COM-12 integrada ao Turn Tracker");
    check(bar.querySelector('[data-stat="available"]').textContent === "3", "T3: Saldo inicial de Pistoleiro A = 3");
    check(bar.querySelectorAll('input[type="number"]').length === 0, "T4: Nenhum input numérico para editar saldo de ações");

    // 2. Pistoleiro A reserves & commits 1 ordinary action via contextual bar UI (3 -> 2)
    OS.$("btn-action-bar-reserve").click();
    await tick(20);
    check(bar.querySelector('[data-stat="reserved"]').textContent === "1" && bar.querySelector('[data-stat="available"]').textContent === "2", "T5: Reserva ordinária via barra contextual deduz 3 -> 2");
    bar.querySelector('[data-cmd="commit-reservation"]').click();
    await tick(20);
    check(bar.querySelector('[data-stat="spent"]').textContent === "1" && bar.querySelector('[data-stat="available"]').textContent === "2", "T6: Confirmação via barra contextual grava gasto (disponível=2)");

    // 3. Advance turn A -> B: A enters post_turn with 2 actions preserved (COM-09)
    await OS.runMesaCombatAction("proximo");
    check(OS.combatActionController.getTurnPhase("tok-a") === "post_turn", "T7: Pistoleiro A em fase post_turn após encerrar turno");
    check(OS.combatActionController.getAvailableActions("tok-a") === 2, "T8: 2 ações de A preservadas pós-turno");

    // Switch to Player A perspective: ordinary action blocked, reconnect preserves turnEnded=true
    setPerspective("player", playerAId, "ficha-a");
    OS.resetMesaCombat();
    await OS.loadMesaCombat();
    check(OS.combatActionController.getTurnPhase("tok-a") === "post_turn", "T9: Reconexão de Jogador A preserva turnEnded=true (post_turn)");
    check(OS.$("btn-action-bar-reserve").disabled === true, "T10: Botão de ação ordinária desabilitado pós-turno com motivo");
    const postOrdAttempt = await OS.combatActionController.reserveAction({ combatantId: "tok-a", opId: "ord-after", actionType: "atacar", round: 1 });
    check(!postOrdAttempt.ok, "T11: Ação ordinária bloqueada pelo backend após encerramento do turno");

    // 4. GM opens COM-11 opportunity for A (in range 1.5m vs Bandido Criatura) & rejects out-of-range (tokFar)
    setPerspective("gm", gmId, null);
    await OS.loadMesaCombat();
    const outRangeRes = await OS.combatActionController.openOpportunity({
      combatantId: "tok-a", opId: "opp-far-1", actionType: "ataque_oportunidade",
      targetTokenId: "tok-far", reachMeters: 1.5, rangeConfirmedByGm: false, round: 1
    });
    check(!outRangeRes.ok, "T12: Oportunidade fora de alcance (12m > 1.5m) rejeitada");

    const openOppA = await OS.combatActionController.openOpportunity({
      combatantId: "tok-a", opId: "opp-a-1", actionType: "ataque_oportunidade",
      targetTokenId: "tok-cr", reachMeters: 1.5, triggerLabel: "Bandido recuou", round: 1
    });
    check(openOppA.ok && openOppA.rangeStatus === "in_range", "T13: Oportunidade válida (1.5m) aberta para Pistoleiro A");

    // Player A sees opportunity in contextual bar and confirms reaction via UI (2 -> 1)
    setPerspective("player", playerAId, "ficha-a");
    await OS.loadMesaCombat();
    const execBtn = bar.querySelector('[data-cmd="execute-opportunity"]');
    check(!!execBtn, "T14: Jogador A vê botão Confirmar Reação pós-turno na barra contextual");
    execBtn.click();
    await tick(25);
    check(OS.combatActionController.getAvailableActions("tok-a") === 1, "T15: Reação pós-turno consome 1 ação (2 -> 1)");

    // 5. Consume last action of A via second opportunity -> 0 remaining -> third opportunity blocked
    setPerspective("gm", gmId, null);
    await OS.loadMesaCombat();
    const oppA2 = await OS.combatActionController.openOpportunity({
      combatantId: "tok-a", opId: "opp-a-2", actionType: "reacao",
      rangeConfirmedByGm: true, triggerLabel: "Última reação", round: 1
    });
    check(oppA2.ok, "T16: Segunda oportunidade aberta para última ação de A");
    const execA2 = await OS.combatActionController.executeOpportunityReaction({
      combatantId: "tok-a", opId: "exec-a-2", opportunityId: oppA2.opportunityId, round: 1
    });
    check(execA2.ok && execA2.availableActions === 0, "T17: Última ação de A consumida (0 restantes)");
    const oppA3 = await OS.combatActionController.openOpportunity({
      combatantId: "tok-a", opId: "opp-a-3", actionType: "reacao",
      rangeConfirmedByGm: true, triggerLabel: "Sem saldo", round: 1
    });
    check(!oppA3.ok, "T18: Oportunidade rejeitada quando combatente tem 0 ações");

    // 6. COM-10: Player B (active) -> advance to Bandido Criatura (idx 2); wait — test pre-turn on tokCr while B is active!
    // Currently turno_atual_idx = 1 (tokB). Let's test COM-10 on tokB? No, tokCr is idx 2 (pre_turn).
    // Even better: advance to Round 2 where tokA is idx 0 (active) and tokB is idx 1 (pre_turn)!
    await OS.runMesaCombatAction("proximo"); // idx 2 (tokCr)
    await OS.runMesaCombatAction("proximo"); // idx 3 (tokFar)
    await OS.runMesaCombatAction("proximo"); // idx 4 (tokHid)
    await OS.runMesaCombatAction("proximo"); // Round 2, idx 0 (tokA)
    check(OS.activeMesaState.combateAtivo.round === 2, "T19: Virada para Rodada 2 sob controle do Turn Tracker");
    check(OS.combatActionController.getAvailableActions("tok-a") === 3 && OS.combatActionController.getAvailableActions("tok-cr") === 1, "T20: Saldos expirados e renovados em Round 2 (A=3, Criatura fixa=1)");

    // In Round 2: tokA is active (idx 0), tokB is pre_turn (idx 1, 2 actions)
    const orderBeforeEarly = combat.ordem.map((c) => c.token_id + ":" + c.current_initiative).join("|");
    setPerspective("player", playerBId, "ficha-b");
    OS.resetMesaCombat();
    await OS.loadMesaCombat();
    check(OS.combatActionController.getTurnPhase("tok-b") === "pre_turn", "T21: Pistoleiro B em pre_turn na Rodada 2");
    const reqEarlyBtn = OS.$("btn-action-bar-request-early");
    check(!!reqEarlyBtn && !reqEarlyBtn.disabled, "T22: Botão Solicitar Reação Antecipada habilitado para B pré-turno");

    // Player B requests early reaction via UI
    reqEarlyBtn.click();
    await tick(25);
    const pendingReqsB = OS.combatActionController.getReactionRequests("tok-b").filter((r) => r.status === "pending");
    check(pendingReqsB.length === 1, "T23: Solicitação antecipada de B registrada como pending");
    const reqIdB = pendingReqsB[0].requestId;

    // Player B cannot self-approve (42501)
    const selfApprove = await OS.combatActionController.approveEarlyReaction({ combatantId: "tok-b", opId: "self-app", requestId: reqIdB, round: 2 });
    check(!selfApprove.ok && selfApprove.sqlstate === "42501", "T24: Jogador B bloqueado de aprovar própria solicitação (42501)");

    // Player A cannot see B's pending request
    setPerspective("player", playerAId, "ficha-a");
    await OS.loadMesaCombat();
    check(OS.combatActionController.getReactionRequests().length === 0, "T25: Solicitação de B não vaza para Jogador A");

    // GM receives request via Realtime signal and sees Aprovar/Negar even with tok-a selected!
    setPerspective("gm", gmId, null);
    OS.subscribeMesaRealtimeChannel(roomId);
    const sigHandler = rtHandlers.find((h) => h.cfg && h.cfg.table === "mesa_combate_sinais");
    sigHandler.fn({ new: { mesa_id: roomId, revisao: rev } });
    await tick(30);
    check(!!bar.querySelector('[data-cmd="approve-request"]') && !!bar.querySelector('[data-cmd="deny-request"]'), "T26: Xerife recebe solicitação via Realtime na barra contextual com Aprovar/Negar");

    // Simulate GM disconnect AFTER server commit during approval -> idempotent retry absorbs without double debit!
    forceDropNextResponseOnce = true;
    const droppedApp = await OS.combatActionController.approveEarlyReaction({ combatantId: "tok-b", opId: "gm-app-drop", requestId: reqIdB, round: 2 });
    check(!droppedApp.ok, "T27: Queda de rede pós-commit capturada sem mutação fantasma");
    const retryApp = await OS.combatActionController.approveEarlyReaction({ combatantId: "tok-b", opId: "gm-app-drop", requestId: reqIdB, round: 2 });
    check(retryApp.ok && retryApp.idempotentReplay === true && retryApp.availableActions === 1, "T28: Retry com mesmo opId após reconexão do Xerife é idempotente (2 -> 1, sem duplo débito)");
    const orderAfterEarly = combat.ordem.map((c) => c.token_id + ":" + c.current_initiative).join("|");
    check(orderAfterEarly === orderBeforeEarly, "T29: Reação antecipada aprovada preserva ordem de iniciativa intacta");

    // Race condition / stale version PT409 test
    const staleOpp = await OS.combatActionController.openOpportunity({
      combatantId: "tok-b", opId: "stale-ver", actionType: "reacao",
      rangeConfirmedByGm: true, round: 2, expectedCombatVersion: 1
    });
    check(!staleOpp.ok && staleOpp.conflict === true && staleOpp.sqlstate === "PT409", "T30: Conflito de versão retorna PT409 e recarrega estado sem retry automático");

    // Map mismatch test
    const wrongMap = await OS.combatActionController.openOpportunity({
      combatantId: "tok-b", opId: "wrong-map", actionType: "reacao",
      rangeConfirmedByGm: true, round: 2, mapaId: map2Id
    });
    check(!wrongMap.ok, "T31: Mudança de mapa / mapa divergente bloqueado");

    document.getElementById("result").textContent = "PASS: " + results.length + " verificações | " + results.join(" | ");
  } catch (e) {
    document.getElementById("result").textContent = "FAIL: " + (e.stack || e.message);
  }
};

async function runBrowserSuite() {
  const testHtml = read("dist/index.html")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(
      "</body>",
      '<pre id="result" style="position:fixed;inset:0 auto auto 0;background:#17120f;color:#8f8;z-index:99999;max-width:100%;white-space:pre-wrap;font:11px monospace">Executando...</pre>' +
        '<script type="module">(' +
        browserTest.toString() +
        ")();</script></body>"
    );

  const server = http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || "/").split("?")[0]);
    if (cleanUrl === "/" || cleanUrl === "/test" || cleanUrl === "/test.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(testHtml);
      return;
    }
    const filePath = path.resolve(root, "dist", "." + cleanUrl);
    if (!filePath.startsWith(path.join(root, "dist") + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === ".js" ? "text/javascript; charset=utf-8"
        : ext === ".css" ? "text/css; charset=utf-8"
        : ext === ".json" ? "application/json; charset=utf-8"
        : ext === ".png" ? "image/png"
        : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(fs.readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const screenshot = path.join(temp, "com09-com12.png");
    const result = await require("./browser-harness.cjs")(
      `http://127.0.0.1:${port}/test`,
      temp,
      screenshot
    );
    console.log(result || "FAIL: resultado ausente");
    console.log("Screenshot:", screenshot);
    if (!result || !result.startsWith("PASS:")) process.exitCode = 1;
  } finally {
    server.close();
  }
}

(async () => {
  console.log(await runPureRulesAndSqlAudit());
  await runBrowserSuite();
})().catch((err) => {
  console.error("FAIL:", err.stack || err.message);
  process.exitCode = 1;
});
