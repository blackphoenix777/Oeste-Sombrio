const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "darkwest-com05-com06-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

async function runPureNodeRulesChecks() {
  const pureDir = path.join(temp, "pure-rules");
  fs.mkdirSync(pureDir, { recursive: true });
  fs.writeFileSync(path.join(pureDir, "package.json"), JSON.stringify({ type: "module" }));
  const rulesSrcDir = path.join(root, "dist/js/rules");
  for (const file of fs.readdirSync(rulesSrcDir)) {
    if (file.endsWith(".js")) {
      fs.copyFileSync(path.join(rulesSrcDir, file), path.join(pureDir, file));
    }
  }
  const rulesUrl = pathToFileURL(path.join(pureDir, "initiativeRules.js")).href;
  const rules = await import(rulesUrl);

  assert.equal(globalThis.document, undefined, "Node puro deve rodar sem document");
  assert.equal(globalThis.window, undefined, "Node puro deve rodar sem window");
  assert.equal(globalThis.OS, undefined, "Node puro deve rodar sem OS");

  // Iniciativas 0, 4, 5, 9, 10 e negativa
  const expectedByInit = [
    [-3, 1],
    [0, 1],
    [4, 1],
    [5, 2],
    [9, 2],
    [10, 3]
  ];
  for (const [init, exp] of expectedByInit) {
    const b = rules.computeTurnActionBudget({
      combatantId: "p-pure",
      round: 1,
      kind: "player",
      operationalMode: "full_sheet",
      currentInitiative: init,
      nextRoundInitiative: 25
    });
    assert.equal(b.initialBudget, exp, `Jogador puro init ${init} => ${exp} ações`);
    assert.equal(b.currentInitiative, init, "Orçamento puro usa somente currentInitiative");
  }

  // NPC Criatura com iniciativa altíssima continua com exatamente 1 ação
  const pureCreature = rules.computeTurnActionBudget({
    combatantId: "c-pure",
    round: 1,
    kind: "npc_human",
    operationalMode: "creature_mode",
    currentInitiative: 35
  });
  assert.equal(pureCreature.initialBudget, 1);
  assert.equal(pureCreature.bonusActionsRaw, 0);

  // Monstro oficial sem ações fixas estruturadas registra pendência sem escalar nem inventar valor
  const pureMonsterUnset = rules.computeTurnActionBudget({
    combatantId: "m-pure",
    round: 1,
    kind: "bestiary_monster",
    operationalMode: "creature_mode",
    isOfficialMonster: true,
    currentInitiative: 24,
    sheetData: { nome: "Inebriados" }
  });
  assert.equal(pureMonsterUnset.budgetDefined, false);
  assert.equal(pureMonsterUnset.pendingReason, "bestiary_monster_fixed_actions_undefined");
  assert.equal(pureMonsterUnset.initialBudget, null);

  // Monstro com ações fixas definidas respeita o valor fixo sem escalar pela cascata
  const pureMonsterFixed = rules.computeTurnActionBudget({
    combatantId: "m-fixed",
    round: 1,
    kind: "bestiary_monster",
    operationalMode: "creature_mode",
    isOfficialMonster: true,
    currentInitiative: 24,
    sheetData: { nome: "Monstro Configurado", acoes_por_turno: 2 }
  });
  assert.equal(pureMonsterFixed.budgetDefined, true);
  assert.equal(pureMonsterFixed.initialBudget, 2);

  // NPC legado mantém modalidade indefinida
  const pureLegacy = rules.computeTurnActionBudget({
    combatantId: "l-pure",
    round: 1,
    kind: "npc_human",
    operationalMode: null,
    currentInitiative: 14,
    sheetData: { nome: "Legado" }
  });
  assert.equal(pureLegacy.budgetDefined, false);
  assert.equal(pureLegacy.pendingReason, "legacy_npc_operational_mode_unset");

  // Cascata pura determinística
  const cascade = rules.computeCascadeInitiatives(
    [
      { token_id: "b1", name: "Bandido #1", modo: "cascata", prioridade: 1 },
      { token_id: "b2", name: "Bandido #2", modo: "cascata", prioridade: 2 },
      { token_id: "boss", name: "Boss", modo: "ficha", iniciativa: 15 }
    ],
    { d20Roll: 12 }
  );
  assert.equal(cascade.cascata_d20, 12);
  assert.equal(cascade.cascata_total, 2);
  assert.deepEqual(
    cascade.ordem.map((x) => [x.token_id, x.iniciativa]),
    [
      ["boss", 15],
      ["b1", 14],
      ["b2", 13]
    ]
  );

  return "PASS pure Node rules check (zero DOM)";
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
    const playerUserId = "22222222-2222-4222-8222-222222222222";
    const roomId = "33333333-3333-4333-8333-333333333333";
    const map1Id = "44444444-4444-4444-8444-444444444444";
    const map2Id = "55555555-5555-4555-8555-555555555555";

    const db = {
      usuarios: [{ id: gmId, email: "gm@darkwest.local", username: "Xerife" }],
      fichas: [],
      mesas: [
        {
          id: roomId,
          mestre_id: gmId,
          nome: "Mesa COM05-06",
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

    function normInt(v) {
      return OS.normalizeMesaInitiative(v);
    }

    function applyAtualizarResumo(stateObj) {
      if (!stateObj) return null;
      const out = clone(stateObj);
      out.ordem = (out.ordem || [])
        .map((item) => {
          const tok = db.mesa_tokens.find(
            (t) => String(t.id) === String(item.token_id) && String(t.mesa_id) === String(roomId) &&
              (!out.mapa_id || String(t.mapa_id) === String(out.mapa_id))
          );
          if (!tok) return null;
          return {
            token_id: tok.id,
            owner_ref: tok.owner_ref,
            owner_type: tok.owner_type,
            name: tok.display_name,
            image_url: tok.image_url || null,
            iniciativa: item.iniciativa_fonte === "ficha" ? normInt(tok.iniciativa) : normInt(item.iniciativa),
            visible_to_players: !!tok.visible_to_players,
            entrou_no_meio: !!item.entrou_no_meio,
            iniciativa_fonte: item.iniciativa_fonte
          };
        })
        .filter(Boolean);
      if (out.turno_atual_idx >= out.ordem.length) out.turno_atual_idx = 0;
      return out;
    }

    function buildCombatPublicSnapshot(isMestreView) {
      const full = applyAtualizarResumo(combat);
      if (!full || isMestreView) {
        return { combate: full, revisao: combatRev };
      }
      const currentTid = full.ordem[full.turno_atual_idx]?.token_id;
      const visibleOrder = full.ordem.filter((c) => {
        const tok = db.mesa_tokens.find((t) => String(t.id) === String(c.token_id));
        return tok && (tok.visible_to_players || tok.owner_user_id === playerUserId);
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

    const matchRow = (row, filters) =>
      filters.every((f) => {
        if (f.op === "eq") return f.v === null ? row[f.k] === null : String(row[f.k]) === String(f.v);
        if (f.op === "is") return f.v === null ? row[f.k] == null : row[f.k] === f.v;
        return true;
      });

    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: gmId, email: "gm@darkwest.local" } }, error: null })
      },
      from(table) {
        let op = "select", payload = null, filters = [], isSingle = false;
        const q = {
          select() { return q; },
          insert(p) { op = "insert"; payload = clone(p); return q; },
          update(p) { op = "update"; payload = clone(p); return q; },
          upsert(p) { op = "upsert"; payload = clone(p); return q; },
          eq(k, v) { filters.push({ op: "eq", k, v }); return q; },
          is(k, v) { filters.push({ op: "is", k, v }); return q; },
          order() { return q; },
          limit() { return q; },
          single() { isSingle = true; return q; },
          then(resolve) {
            const rows = db[table] || (db[table] = []);
            const nowIso = new Date().toISOString();
            let out = [];
            if (op === "insert") {
              const list = Array.isArray(payload) ? payload : [payload];
              for (const item of list) {
                const row = Object.assign({ id: crypto.randomUUID(), created_at: nowIso, updated_at: nowIso }, clone(item));
                rows.push(row);
                out.push(clone(row));
              }
            } else if (op === "update" || op === "upsert") {
              for (const row of rows) {
                if (matchRow(row, filters)) {
                  Object.assign(row, clone(payload), { updated_at: nowIso });
                  out.push(clone(row));
                }
              }
            } else {
              out = rows.filter((r) => matchRow(r, filters)).map(clone);
            }
            if (isSingle) {
              return resolve({ data: out[0] || null, error: out[0] ? null : { message: "Not found" } });
            }
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
          return { data: buildCombatPublicSnapshot(OS.activeMesaState.isMestre), error: null };
        }
        if (name === "listar_mesas_acessiveis") {
          return { data: clone(db.mesas), error: null };
        }
        if (name === "gerenciar_combate") {
          if (!OS.activeMesaState.isMestre) {
            return { error: { code: "42501", message: "Apenas o Mestre pode controlar o combate" } };
          }
          if (args.p_acao === "iniciar") {
            const participants = args.p_participantes || [];
            const mapped = participants.map((p) => {
              const tok = db.mesa_tokens.find((t) => String(t.id) === String(p.token_id));
              if (!tok) throw Error("Token não encontrado: " + p.token_id);
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
            const mapSet = new Set(mapped.map((m) => m.mapa_id));
            if (mapSet.size !== 1) return { error: { code: "22023", message: "Mistura de mapas" } };
            const cascaded = OS.computeCascadeInitiatives(mapped, { d20Roll: nextD20Roll });
            combat = {
              id: crypto.randomUUID(),
              ativo: true,
              mapa_id: mapped[0].mapa_id,
              round: 1,
              turno_atual_idx: 0,
              versao: 1,
              cascata_d20: cascaded.cascata_d20,
              cascata_total: cascaded.cascata_total,
              ordem: cascaded.ordem.map((item) => ({
                token_id: item.token_id,
                owner_ref: item.owner_ref,
                owner_type: item.owner_type,
                name: item.name,
                image_url: item.image_url,
                iniciativa: item.iniciativa,
                visible_to_players: item.visible_to_players,
                entrou_no_meio: false,
                iniciativa_fonte: item.iniciativa_fonte
              }))
            };
          } else if (args.p_acao === "proximo") {
            combat = applyAtualizarResumo(combat);
            combat.turno_atual_idx += 1;
            if (combat.turno_atual_idx >= combat.ordem.length) {
              combat.turno_atual_idx = 0;
              combat.round += 1;
              combat.ordem = combat.ordem
                .map((c) => Object.assign({}, c, { entrou_no_meio: false }))
                .sort((a, b) => {
                  const af = a.iniciativa_fonte === "fixa" ? 1 : 0;
                  const bf = b.iniciativa_fonte === "fixa" ? 1 : 0;
                  if (af !== bf) return af - bf;
                  if (b.iniciativa !== a.iniciativa) return b.iniciativa - a.iniciativa;
                  const na = String(a.name || ""), nb = String(b.name || "");
                  if (na !== nb) return na < nb ? -1 : 1;
                  return String(a.token_id).localeCompare(String(b.token_id));
                });
            }
            combat.versao += 1;
          } else if (args.p_acao === "adicionar") {
            combat = applyAtualizarResumo(combat);
            const tok = db.mesa_tokens.find((t) => String(t.id) === String(args.p_token_id));
            if (!tok || String(tok.mapa_id) !== String(combat.mapa_id)) {
              return { error: { code: "22023", message: "Token fora do mapa" } };
            }
            combat.ordem.push({
              token_id: tok.id,
              owner_ref: tok.owner_ref,
              owner_type: tok.owner_type,
              name: tok.display_name,
              image_url: tok.image_url || null,
              iniciativa: tok.owner_type === "player" ? normInt(tok.iniciativa) : 0,
              visible_to_players: !!tok.visible_to_players,
              entrou_no_meio: true,
              iniciativa_fonte: tok.owner_type === "player" ? "ficha" : "fixa"
            });
            combat.versao += 1;
          } else if (args.p_acao === "encerrar") {
            combat = null;
          }
          combatRev += 1;
          db.mesas[0].combate_ativo = clone(combat);
          return { data: buildCombatPublicSnapshot(true), error: null };
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
      mesaTokens: [],
      pendingLocalTokenUpdates: {},
      maps: [
        { id: map1Id, nome: "Saloon", grid_cols: 20, grid_rows: 15 },
        { id: map2Id, nome: "Cânion", grid_cols: 20, grid_rows: 15 }
      ]
    });

    OS.loadMesaTokens = async () => OS.activeMesaState.mesaTokens;
    await OS.loadOfficialBestiary();

    /* ─── T1: Jogadores com iniciativas 0, 4, 5, 9, 10 (e -3) ─── */
    for (const [initVal, expectedAct] of [[-3, 1], [0, 1], [4, 1], [5, 2], [9, 2], [10, 3]]) {
      const pid = "p-" + initVal;
      const sheetObj = {
        id: pid,
        usuario_id: playerUserId,
        dados: { nome: "Pistoleiro " + initVal, tipo_ficha: "jogador", freeEdit: false, iniciativa: String(initVal), inventoryItems: [] }
      };
      const bud = OS.computeCombatantTurnBudget(sheetObj, 1);
      check(bud.budgetDefined && bud.initialBudget === expectedAct, `T1 jogador init=${initVal} => ${expectedAct} ações`);
    }

    /* ─── T2: NPC avançado usando 6B individual ─── */
    const advTemplate = {
      key: "custom:adv-template",
      id: "adv-template",
      sourceType: "custom",
      name: "Boss Salazar",
      category: "NPC",
      data: {
        nome: "Boss Salazar",
        tipo_ficha: "npc",
        freeEdit: true,
        isBestiaryCustom: true,
        isCriatura: false,
        "is-criatura": false,
        operationalMode: "full_sheet",
        defesa: "17",
        "config-6b": "4d6",
        "chamber-0": "4",
        "chamber-1": "5",
        "chamber-2": "3",
        "chamber-3": "2",
        inventoryItems: []
      }
    };
    const mesaAdv = await OS.addBestiarioEntryToMesa(advTemplate);
    const resAdv = await OS.addNpcMesaToScene(mesaAdv.mesaNpcId);
    const tokAdv = resAdv.token;
    OS.activeMesaState.mesaTokens = db.mesa_tokens;
    check(
      resAdv.instance.data.iniciativa === "12" &&
        tokAdv.iniciativa === 12 &&
        OS.getCombatTokenMode(tokAdv) === "ficha" &&
        OS.computeCombatantTurnBudget(tokAdv, 1).initialBudget === 3,
      "T2a: NPC avançado deriva iniciativa individual 12 do 6B [4,5,3], usa modo ficha e 3 ações"
    );
    OS.rollSceneCreature6B(resAdv.instance.instanceId, [6, 5, 4, 1]);
    check(
      resAdv.instance.data.iniciativa === "15" &&
        OS.computeCombatantTurnBudget(resAdv.instance, 1).initialBudget === 4,
      "T2b: rolagem 6B [6,5,4] atualiza iniciativa individual para 15 e 4 ações"
    );

    /* ─── T3: NPC Criatura utilizando cascata D20 real ─── */
    const criaturaTemplate = {
      key: "custom:bandido-criatura",
      id: "bandido-criatura",
      sourceType: "custom",
      name: "Bandido do Cânion",
      category: "NPC",
      data: {
        nome: "Bandido do Cânion",
        tipo_ficha: "npc",
        freeEdit: true,
        isBestiaryCustom: true,
        isCriatura: true,
        "is-criatura": true,
        operationalMode: "creature_mode",
        defesa: "12",
        iniciativa: "19",
        "config-6b": "2d6"
      }
    };
    const mesaBandido = await OS.addBestiarioEntryToMesa(criaturaTemplate);
    const resBandidoSingle = await OS.addNpcMesaToScene(mesaBandido.mesaNpcId);
    check(
      OS.getCombatTokenMode(resBandidoSingle.token) === "cascata" &&
        OS.computeCombatantTurnBudget(resBandidoSingle.token, 1).initialBudget === 1,
      "T3: NPC Criatura resolve modo 'cascata' e orçamento fixo de 1 ação (mesmo com init 19)"
    );

    /* ─── T4: Monstros oficiais preservando cascata e ações fixas oficiais ─── */
    const expectedOfficialActions = {
      inebriados: 2,
      gosma_eterna: 2,
      cao_das_sombras: 3,
      verme_do_carvao: 3
    };
    for (const mid of Object.keys(expectedOfficialActions)) {
      const expectedAct = expectedOfficialActions[mid];
      const mEntry = OS.getOfficialBestiaryEntry(mid);
      const mMesa = await OS.addBestiarioEntryToMesa(mEntry);
      const mRes = await OS.addNpcMesaToScene(mMesa.mesaNpcId);
      const mMode = OS.getCombatTokenMode(mRes.token);
      const mBudOfficial = OS.computeCombatantTurnBudget(mRes.token, 1, { currentInitiative: 25 });
      const mDataSemAcoes = clone(mEntry.data);
      delete mDataSemAcoes.acoes_por_turno;
      const mBudLegacyNoField = OS.computeTurnActionBudget({
        combatantId: mRes.token.id,
        round: 1,
        kind: "bestiary_monster",
        operationalMode: "creature_mode",
        isOfficialMonster: true,
        currentInitiative: 25,
        sheetData: mDataSemAcoes
      });
      check(
        mMode === "cascata" &&
          mBudOfficial.budgetDefined === true &&
          mBudOfficial.initialBudget === expectedAct &&
          mBudOfficial.bonusActionsRaw === 0 &&
          mBudLegacyNoField.budgetDefined === false &&
          mBudLegacyNoField.pendingReason === "bestiary_monster_fixed_actions_undefined",
        "T4 monstro oficial " + mid + " preserva cascata, ações fixas (" + expectedAct + ") e trata ausência sem inventar"
      );
    }

    /* ─── T5: NPC legado preservando iniciativa anterior e modalidade indefinida ─── */
    const jebEntry = OS.getOfficialBestiaryEntry("jebediah_jeb_cale");
    const jebMesa = await OS.addBestiarioEntryToMesa(jebEntry);
    const jebRes = await OS.addNpcMesaToScene(jebMesa.mesaNpcId);
    const legacyNpcTemplate = {
      key: "custom:legacy-npc",
      id: "legacy-npc",
      sourceType: "custom",
      name: "Pistoleiro Legado",
      category: "NPC",
      data: { nome: "Pistoleiro Legado", defesa: "12", iniciativa: "11", freeEdit: true, isBestiaryCustom: true }
    };
    const legacyMesa = await OS.addBestiarioEntryToMesa(legacyNpcTemplate);
    const legacyRes = await OS.addNpcMesaToScene(legacyMesa.mesaNpcId);
    const jebBud = OS.computeCombatantTurnBudget(jebRes.token, 1);
    const legBud = OS.computeCombatantTurnBudget(legacyRes.token, 1);
    check(
      OS.getCombatTokenMode(jebRes.token) === "ficha" &&
        OS.getCombatTokenMode(legacyRes.token) === "ficha" &&
        jebBud.budgetDefined === false &&
        jebBud.pendingReason === "legacy_npc_operational_mode_unset" &&
        legBud.budgetDefined === false &&
        legBud.pendingReason === "legacy_npc_operational_mode_unset" &&
        legacyRes.instance.operationalMode === null &&
        !("operationalMode" in legacyRes.instance.data),
      "T5: NPC legado e Jeb preservam modo 'ficha' sem conversão silenciosa nem orçamento inventado"
    );

    /* ─── T6: Sobrecarga em jogador e NPC avançado (vs Criatura imune) ─── */
    const looseItems = [
      { id: "i1", name: "Cantil", qty: 1, storageLocation: "solto" },
      { id: "i2", name: "Corda", qty: 1, storageLocation: "solto" },
      { id: "i3", name: "Lanterna", qty: 1, storageLocation: "solto" },
      { id: "i4", name: "Dinamite", qty: 1, storageLocation: "solto" }
    ];
    const overloadedPlayer = OS.computeCombatantTurnBudget(
      {
        id: "p-over",
        dados: { nome: "Sobrecarregado", tipo_ficha: "jogador", freeEdit: false, iniciativa: "16", inventoryItems: looseItems }
      },
      1
    );
    const overloadedMinOne = OS.computeCombatantTurnBudget(
      {
        id: "p-over-min",
        dados: { nome: "Sobrecarregado Minimo", tipo_ficha: "jogador", freeEdit: false, iniciativa: "6", inventoryItems: looseItems }
      },
      1
    );
    check(
      overloadedPlayer.isOverloaded === true &&
        overloadedPlayer.bonusActionsRaw === 3 &&
        overloadedPlayer.bonusActionsLostOverload === 2 &&
        overloadedPlayer.initialBudget === 2 &&
        overloadedMinOne.initialBudget === 1,
      "T6: sobrecarga desconta 2 ações bônus respeitando mínimo de 1 ação padrão"
    );

    /* ─── T7: Condições que modificam ações (Atordoado, Paralisado, Inconsciente, Cobertura Total) ─── */
    const bAtordoado = OS.computeTurnActionBudget({
      kind: "player",
      operationalMode: "full_sheet",
      currentInitiative: 16,
      conditions: [{ nome: "Atordoado", grau: 2 }]
    });
    const bAtordoadoMin = OS.computeTurnActionBudget({
      kind: "player",
      operationalMode: "full_sheet",
      currentInitiative: 10,
      conditions: [{ nome: "Atordoado", grau: 5 }]
    });
    const bParalisado = OS.computeTurnActionBudget({
      kind: "npc_human",
      operationalMode: "creature_mode",
      currentInitiative: 20,
      conditions: [{ nome: "Paralisado" }]
    });
    const bInconsciente = OS.computeTurnActionBudget({
      kind: "player",
      operationalMode: "full_sheet",
      currentInitiative: 15,
      conditions: [{ nome: "Inconsciente" }]
    });
    const bCoberturaTotal = OS.computeTurnActionBudget({
      kind: "npc_veteran",
      operationalMode: "full_sheet",
      currentInitiative: 15,
      inTotalCover: true
    });
    check(
      bAtordoado.initialBudget === 2 &&
        bAtordoadoMin.initialBudget === 1 &&
        bParalisado.initialBudget === 0 &&
        bInconsciente.initialBudget === 0 &&
        bCoberturaTotal.initialBudget === 0,
      "T7: Atordoado reduz ações bônus (mín 1) e Paralisado/Inconsciente/Cobertura Total zeram ações"
    );

    /* ─── Reset limpo da cena para T8, T9, T10, T11, T12, T13, T14, T15, T16 ─── */
    combat = null;
    combatRev = 0;
    db.mesas[0].npcs_mesa = [];
    db.mesas[0].cena_ativa = [];
    db.mesa_tokens = [];
    OS.activeMesaState.npcsMesa = [];
    OS.activeMesaState.sceneCreatures = [];
    OS.activeMesaState.mesaTokens = [];
    OS.resetMesaCombat();

    // Cria 2 jogadores, 1 NPC Avançado Boss e 8 Bandidos Criatura na mesma cena
    const pAId = "aaaa1111-1111-4111-8111-111111111111";
    const pBId = "bbbb2222-2222-4222-8222-222222222222";
    const pLateId = "cccc3333-3333-4333-8333-333333333333";

    const rowPA = {
      id: pAId,
      usuario_id: "u-a",
      nome_personagem: "Heroi A",
      dados: { nome: "Heroi A", tipo_ficha: "jogador", freeEdit: false, iniciativa: "18", "config-6b": "4d6", inventoryItems: [], activeConditions: [] }
    };
    const rowPB = {
      id: pBId,
      usuario_id: playerUserId,
      nome_personagem: "Heroi B",
      dados: { nome: "Heroi B", tipo_ficha: "jogador", freeEdit: false, iniciativa: "6", "config-6b": "6d6", inventoryItems: [], activeConditions: [] }
    };
    const rowPLate = {
      id: pLateId,
      usuario_id: "u-late",
      nome_personagem: "Xerife Aliado",
      dados: { nome: "Xerife Aliado", tipo_ficha: "jogador", freeEdit: false, iniciativa: "25", "config-6b": "6d6", inventoryItems: [], activeConditions: [] }
    };
    OS.activeMesaState.playerSheets = [rowPA, rowPB, rowPLate];
    db.fichas.push(clone(rowPA), clone(rowPB), clone(rowPLate));

    const tokPA = {
      id: "tok-pa",
      mesa_id: roomId,
      mapa_id: map1Id,
      owner_type: "player",
      owner_ref: pAId,
      owner_user_id: "u-a",
      display_name: "Heroi A",
      iniciativa: 18,
      visible_to_players: true
    };
    const tokPB = {
      id: "tok-pb",
      mesa_id: roomId,
      mapa_id: map1Id,
      owner_type: "player",
      owner_ref: pBId,
      owner_user_id: playerUserId,
      display_name: "Heroi B",
      iniciativa: 6,
      visible_to_players: true
    };
    const tokPLate = {
      id: "tok-plate",
      mesa_id: roomId,
      mapa_id: map1Id,
      owner_type: "player",
      owner_ref: pLateId,
      owner_user_id: "u-late",
      display_name: "Xerife Aliado",
      iniciativa: 25,
      visible_to_players: true
    };
    const tokOffMap = {
      id: "tok-offmap",
      mesa_id: roomId,
      mapa_id: map2Id,
      owner_type: "player",
      owner_ref: "off-sheet",
      owner_user_id: "u-off",
      display_name: "Viajante Outro Mapa",
      iniciativa: 30,
      visible_to_players: true
    };
    db.mesa_tokens.push(tokPA, tokPB, tokPLate, tokOffMap);
    OS.activeMesaState.mesaTokens = db.mesa_tokens;

    /* ─── T8, T9 & T10: Recalcular iniciativa mid-round, promover na virada e entrada tardia ─── */
    // Inicia combate com Heroi A (18), Heroi B (6) e entrada tardia com Heroi Late (25) e Bandido Tardio
    const lateNpcMesa = await OS.addBestiarioEntryToMesa(criaturaTemplate);
    const lateNpcRes = await OS.addNpcMesaToScene(lateNpcMesa.mesaNpcId);
    lateNpcRes.token.visible_to_players = false; // também valida sigilo em T16

    await OS.runMesaCombatAction("iniciar", {
      p_participantes: [
        { token_id: tokPA.id, modo: "ficha", prioridade: 1 },
        { token_id: tokPB.id, modo: "ficha", prioridade: 2 }
      ]
    });

    check(
      OS.activeMesaState.combateAtivo.round === 1 &&
        OS.activeMesaState.combateAtivo.ordem.map((c) => c.token_id).join(",") === "tok-pa,tok-pb" &&
        OS.getCombatantInitiativeState("tok-pb").currentInitiative === 6 &&
        OS.getCombatantInitiativeState("tok-pb").nextRoundInitiative === null &&
        OS.getCombatantActionBudget("tok-pa").initialBudget === 4 &&
        OS.getCombatantActionBudget("tok-pb").initialBudget === 2,
      "T8a: rodada 1 inicia com iniciativas vigentes 18 (4 ações) e 6 (2 ações)"
    );

    // Recalcula iniciativa de Heroi B durante o Round 1: 6 -> 22 e simula atualização do resumo no servidor
    tokPB.iniciativa = 22;
    OS.updatePlayerSheetStats(pBId, { iniciativa: "22" });
    await OS.loadMesaCombat(); // servidor retorna item.iniciativa = 22 via atualizar_resumo_combate!
    const stateMid = OS.getCombatantInitiativeState("tok-pb");
    const budMid = OS.getCombatantActionBudget("tok-pb");
    const domScoreMid = document.querySelector('#mesa-tracker-order [data-token-id="tok-pb"] .mesa-tracker-score').textContent;
    check(
      stateMid.currentInitiative === 6 &&
        stateMid.nextRoundInitiative === 22 &&
        OS.activeMesaState.combateAtivo.ordem.map((c) => c.token_id).join(",") === "tok-pa,tok-pb" &&
        budMid.initialBudget === 2 &&
        domScoreMid === "6",
      "T8b: recalcular para 22 no meio da rodada mantém currentInitiative=6, ordem R1 e orçamento=2"
    );

    // Também verifica que a rolagem física de tambor (#ficha + #defense-confirm) durante o combate
    // grava nextRoundInitiative sem alterar currentInitiative ou ordem da rodada atual.
    OS.activeMesaState.playerFichaId = pAId;
    OS.applyState(clone(rowPA.dados));
    OS.hasPerformedInitialReload = true;
    OS.usedChambers = [0, 1, 2, 3, 4, 5];
    OS.rollCylinderDice([6, 6, 5, 2, 2, 2]);
    // Seleciona as 3 últimas câmaras (2,2,2 -> Defesa 6) clicando nos botões reais do modal e sobram [6,6,5] -> Iniciativa 17
    for (const pillIdx of [3, 4, 5]) {
      const pillBtn = document.querySelector('#defense-roll-grid .roll-pill[data-index="' + pillIdx + '"]');
      if (pillBtn) pillBtn.click();
    }
    OS.$("defense-confirm").click();
    const stateHeroA = OS.getCombatantInitiativeState("tok-pa");
    check(
      OS.$("iniciativa").value === "17" &&
        stateHeroA.currentInitiative === 18 &&
        stateHeroA.nextRoundInitiative === 17 &&
        OS.getCombatantActionBudget("tok-pa").initialBudget === 4,
      "T8c: confirmar #defense-modal no meio do round grava nextRoundInitiative=17 mantendo 18 e 4 ações"
    );
    tokPA.iniciativa = 17;
    OS.activeMesaState.playerFichaId = null;

    // T10: Entradas tardias via OS.appendCombatJoinButton (tokPLate e criatura oculta) + checa filtro de outro mapa (T16)
    const joinHost = document.createElement("div");
    const offMapHost = document.createElement("div");
    OS.appendCombatJoinButton(joinHost, tokPLate);
    OS.appendCombatJoinButton(offMapHost, tokOffMap);
    check(
      joinHost.querySelectorAll(".combat-join").length === 1 && offMapHost.querySelectorAll(".combat-join").length === 0,
      "T10a/T16a: botão de entrada tardia aparece só para o mapa ativo do combate"
    );
    joinHost.querySelector(".combat-join").click();
    await tick(20);
    await OS.runMesaCombatAction("adicionar", { p_token_id: lateNpcRes.token.id });
    check(
      OS.activeMesaState.combateAtivo.ordem.map((c) => c.token_id).join(",") === "tok-pa,tok-pb,tok-plate," + lateNpcRes.token.id &&
        OS.activeMesaState.combateAtivo.ordem[2].entrou_no_meio === true &&
        OS.activeMesaState.combateAtivo.ordem[3].iniciativa === 0 &&
        OS.activeMesaState.combateAtivo.ordem[3].iniciativa_fonte === "fixa",
      "T10b: entradas tardias entram no fim da rodada 1 sem reordenar antes da virada"
    );

    // T9: Avança até virar do Round 1 -> Round 2 (4 participantes no round 1)
    await OS.runMesaCombatAction("proximo"); // idx 1
    await OS.runMesaCombatAction("proximo"); // idx 2
    await OS.runMesaCombatAction("proximo"); // idx 3
    check(OS.activeMesaState.combateAtivo.round === 1, "T9a: permanece no round 1 até o último turno");
    await OS.runMesaCombatAction("proximo"); // vira para round 2!
    const stateR2PB = OS.getCombatantInitiativeState("tok-pb");
    const budR2PB = OS.getCombatantActionBudget("tok-pb");
    const stateR2PA = OS.getCombatantInitiativeState("tok-pa");
    check(
      OS.activeMesaState.combateAtivo.round === 2 &&
        OS.activeMesaState.combateAtivo.ordem.map((c) => c.token_id).join(",") ===
          "tok-plate,tok-pb,tok-pa," + lateNpcRes.token.id &&
        stateR2PB.currentInitiative === 22 &&
        stateR2PB.nextRoundInitiative === null &&
        budR2PB.initialBudget === 5 &&
        stateR2PA.currentInitiative === 17 &&
        OS.getCombatantActionBudget("tok-pa").initialBudget === 4,
      "T9b: virada para round 2 promove iniciativas preparadas (22->5 ações, 17->4 ações), sobe tardio ficha e mantém tardio criatura por último"
    );

    // T16b: Sigilo de ocultos e bloqueio de jogador no Turn Tracker
    const prevIsMestre = OS.activeMesaState.isMestre;
    OS.activeMesaState.isMestre = false;
    OS.activeMesaState.playerFichaId = pBId;
    await OS.loadMesaCombat();
    const deniedPlayerNext = await OS.runMesaCombatAction("proximo");
    const liAllyPA = document.querySelector('#mesa-tracker-order [data-token-id="tok-pa"]');
    const liOwnPB = document.querySelector('#mesa-tracker-order [data-token-id="tok-pb"]');
    check(
      deniedPlayerNext === false &&
        !OS.activeMesaState.combateAtivo.ordem.some((c) => c.token_id === lateNpcRes.token.id) &&
        OS.$("btn-tracker-end").hidden === true &&
        OS.$("mesa-tracker-footer").hidden === true &&
        !document.querySelector('#mesa-tracker-order [data-token-id="' + lateNpcRes.token.id + '"]') &&
        !!liOwnPB &&
        liOwnPB.dataset.actionBudget === "5" &&
        !!liAllyPA &&
        liAllyPA.dataset.actionBudget === undefined,
      "T16b: jogador não aciona proximo, vê apenas seu próprio orçamento e não vê entidade oculta"
    );
    OS.activeMesaState.playerFichaId = null;
    OS.activeMesaState.isMestre = prevIsMestre;
    await OS.runMesaCombatAction("encerrar");

    /* ─── T11, T12, T13, T14, T15: Simulação de 8 bandidos Criatura + 1 Boss Avançado ─── */
    // Limpa tokens da cena anterior mantendo mesa e mapa1
    combat = null;
    db.mesas[0].npcs_mesa = [];
    db.mesas[0].cena_ativa = [];
    db.mesa_tokens = [];
    OS.activeMesaState.npcsMesa = [];
    OS.activeMesaState.sceneCreatures = [];
    OS.activeMesaState.mesaTokens = [];
    OS.resetMesaCombat();

    const mesaBandidos = await OS.addBestiarioEntryToMesa(criaturaTemplate);
    const mesaBoss = await OS.addBestiarioEntryToMesa(advTemplate);
    const bandidosRes = [];
    for (let i = 0; i < 8; i++) {
      bandidosRes.push(await OS.addNpcMesaToScene(mesaBandidos.mesaNpcId));
    }
    const bossRes1 = await OS.addNpcMesaToScene(mesaBoss.mesaNpcId);
    const bossRes2 = await OS.addNpcMesaToScene(mesaBoss.mesaNpcId);
    // Boss #1 rola 6B [5, 6, 4] -> iniciativa 15 (4 ações)
    OS.rollSceneCreature6B(bossRes1.instance.instanceId, [5, 6, 4, 2]);
    // Prepara cópia #2 com sobrecarga no inventário (T14 isolamento entre tokens idênticos)
    bossRes2.instance.data.inventoryItems = clone(looseItems);
    OS.activeMesaState.mesaTokens = db.mesa_tokens;

    await OS.openCombatSetup();
    const setupRows = Array.from(document.querySelectorAll("#combat-setup-list .combat-setup-row"));
    // Desmarca bossRes2 no setup principal (usaremos para validar T14 depois) e mantém 8 bandidos + bossRes1
    const boss2Row = setupRows.find((r) => r.dataset.tokenId === bossRes2.token.id);
    if (boss2Row) boss2Row.querySelector(".combat-include").checked = false;

    const allBandidosCascadeSelected = bandidosRes.every((br) => {
      const r = setupRows.find((el) => el.dataset.tokenId === br.token.id);
      return r && r.querySelector(".combat-mode").value === "cascata";
    });
    const boss1SetupMode = setupRows
      .find((el) => el.dataset.tokenId === bossRes1.token.id)
      .querySelector(".combat-mode").value;
    check(
      allBandidosCascadeSelected && boss1SetupMode === "ficha",
      "T11a: setup pré-classifica 8 Bandidos Criatura como cascata e Boss Avançado como ficha"
    );

    // Atribui prioridades 1..8 aos bandidos explicitamente e inicia com d20 determinístico = 12
    bandidosRes.forEach((br, idx) => {
      const r = setupRows.find((el) => el.dataset.tokenId === br.token.id);
      r.querySelector(".combat-priority").value = String(idx + 1);
    });
    nextD20Roll = 12;
    OS.$("form-setup-combate").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await tick(30);

    const ordemSim = OS.activeMesaState.combateAtivo.ordem;
    const bandidoOrders = bandidosRes.map((br) => {
      const item = ordemSim.find((c) => c.token_id === br.token.id);
      return item ? item.iniciativa : null;
    });
    const bossSimItem = ordemSim.find((c) => c.token_id === bossRes1.token.id);

    check(
      ordemSim.length === 9 &&
        new Set(ordemSim.map((c) => c.token_id)).size === 9 &&
        bandidoOrders.join(",") === "20,19,18,17,16,15,14,13" &&
        bossSimItem.iniciativa === 15 &&
        bossSimItem.iniciativa_fonte === "ficha",
      "T11b/T12/T13: 8 bandidos recebem cascata decrescente (20..13), Boss mantém 15 ficha e há 9 turnos individuais"
    );

    const bandidosAllOneAction = bandidosRes.every((br) => {
      const b = OS.getCombatantActionBudget(br.token.id);
      return b && b.budgetDefined === true && b.initialBudget === 1 && b.bonusActionsRaw === 0;
    });
    const bossBudget = OS.getCombatantActionBudget(bossRes1.token.id);
    check(
      bandidosAllOneAction && bossBudget && bossBudget.initialBudget === 4,
      "T11c/T15: todos os 8 bandidos (até o de iniciativa 20) têm 1 ação; Boss Avançado (init 15) tem 4 ações"
    );

    /* ─── T14: Dois tokens do mesmo NPC possuem identidades e orçamentos independentes ─── */
    // Aplica Paralisado apenas ao Bandido #1 e checa Bandido #2 intacto
    OS.updateSceneCreatureStats(bandidosRes[0].instance.instanceId, { addCondition: "Paralisado" });
    const budBandido1 = OS.getCombatantActionBudget(bandidosRes[0].token.id);
    const budBandido2 = OS.getCombatantActionBudget(bandidosRes[1].token.id);
    OS.rollSceneCreature6B(bossRes2.instance.instanceId, [5, 6, 4, 2]);
    // Compara Boss #1 (sem sobrecarga, init 15 -> 4 ações) vs Boss #2 (cópia com mesmo 6B e sobrecarga -> 2 ações)
    const budBoss1 = OS.computeCombatantTurnBudget(bossRes1.instance, 1);
    const budBoss2 = OS.computeCombatantTurnBudget(bossRes2.instance, 1);
    check(
      bandidosRes[0].instance.instanceId !== bandidosRes[1].instance.instanceId &&
        bandidosRes[0].token.id !== bandidosRes[1].token.id &&
        budBandido1.initialBudget === 0 &&
        budBandido2.initialBudget === 1 &&
        budBoss1.initialBudget === 4 &&
        budBoss2.initialBudget === 2,
      "T14: alterações em instância/token #1 (Paralisado ou sobrecarga) mantêm #2 com orçamento independente"
    );

    await OS.runMesaCombatAction("encerrar");

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
    const pureMsg = await runPureNodeRulesChecks();
    console.log(pureMsg);

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
        path.join(temp, "com05-com06.png")
      );
      console.log(result);
      if (!result.startsWith("PASS:")) process.exitCode = 1;
      console.log("Screenshot: " + path.join(temp, "com05-com06.png"));
    } finally {
      server.close();
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
