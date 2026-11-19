const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "os-xer04-own-6b-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const test = async () => {
  const results = [];
  const check = (cond, name, detail) => {
    if (!cond) {
      throw new Error(name + (detail ? " :: " + detail : ""));
    }
    results.push(name);
  };
  const tick = (ms = 35) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

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
      "mesaScreen",
      "mesaMaps",
      "turnTracker",
      "mesaTokenStatus",
      "mesaDeliveries",
      "mesaNotes",
      "mesaXerife6B"
    ];
    for (const name of modules) {
      await import("/js/" + name + ".js");
    }

    const OS = window.OS;
    check(!!OS, "OS global carregado");
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
    if (OS.bindMesaScreenEvents) OS.bindMesaScreenEvents();
    OS.initCylinder();

    const gmId = "00000000-0000-4000-8000-000000000001";
    const roomId = "00000000-0000-4000-8000-000000000099";
    const mapId = "00000000-0000-4000-8000-000000000088";
    const legacyId = "00000000-0000-4000-8000-000000000077";

    const db = {
      mesas: [
        {
          id: roomId,
          nome: "Mesa XER-04",
          mestre_id: gmId,
          codigo_convite: "XER04A",
          npcs_mesa: [],
          cena_ativa: [],
          combate_ativo: { ativo: false }
        }
      ],
      fichas: [
        {
          id: legacyId,
          usuario_id: gmId,
          mesa_id: null,
          nome_personagem: "Pistoleiro Legado",
          nivel: 1,
          classe: "npc",
          updated_at: "2026-01-01T00:00:00.000Z",
          dados: {
            nome: "Pistoleiro Legado",
            defesa: "12",
            iniciativa: "14",
            "config-6b": "2d6",
            "chamber-0": "4",
            "chamber-1": "5",
            equipamentos: "⚙ Revólver Velho — Perícia d8 + Dano d6",
            freeEdit: true,
            isBestiaryCustom: true
          }
        }
      ],
      mesa_tokens: [],
      mesa_6b_xerife: [
        {
          id: "00000000-0000-4000-8000-0000000006b1",
          mesa_id: roomId,
          tipo: "aberto",
          dados: [6, 6, 6, 6, 6, 6],
          resultados: [6, 5, 4, 3, 2, 1],
          usados: [],
          versao: 1
        },
        {
          id: "00000000-0000-4000-8000-0000000006b2",
          mesa_id: roomId,
          tipo: "secreto",
          dados: [6, 6, 6, 6, 6, 6],
          resultados: [5, 5, 4, 4, 3, 2],
          usados: [],
          versao: 1
        }
      ]
    };

    const matchRow = (row, filters) =>
      filters.every((f) => {
        if (f.type === "eq") return String(row[f.col] ?? "") === String(f.val ?? "");
        if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        return true;
      });

    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: gmId } } }, error: null }),
        getUser: async () => ({ data: { user: { id: gmId } }, error: null })
      },
      from(table) {
        const filters = [];
        let op = "select";
        let payload = null;
        let isSingle = false;
        let orderSpec = null;
        let limitN = null;

        const q = {
          select() { return q; },
          insert(data) { op = "insert"; payload = data; return q; },
          upsert(data) { op = "upsert"; payload = data; return q; },
          update(data) { op = "update"; payload = data; return q; },
          delete() { op = "delete"; return q; },
          eq(col, val) { filters.push({ type: "eq", col, val }); return q; },
          is(col, val) { filters.push({ type: "is", col, val }); return q; },
          order(col, opts) { orderSpec = { col, ascending: !opts || opts.ascending !== false }; return q; },
          limit(n) { limitN = n; return q; },
          single() { isSingle = true; return q; },
          maybeSingle() { isSingle = true; return q; },
          then(resolve, reject) {
            try {
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
              } else if (op === "update") {
                for (const row of rows) {
                  if (matchRow(row, filters)) {
                    Object.assign(row, clone(payload), { updated_at: nowIso });
                    out.push(clone(row));
                  }
                }
              } else if (op === "delete") {
                const kept = [];
                for (const row of rows) {
                  if (matchRow(row, filters)) out.push(clone(row));
                  else kept.push(row);
                }
                db[table] = kept;
              } else {
                out = rows.filter((r) => matchRow(r, filters)).map(clone);
                if (orderSpec) {
                  out.sort((a, b) => {
                    const av = a[orderSpec.col] || "";
                    const bv = b[orderSpec.col] || "";
                    return av < bv ? (orderSpec.ascending ? -1 : 1) : av > bv ? (orderSpec.ascending ? 1 : -1) : 0;
                  });
                }
                if (limitN != null) out = out.slice(0, limitN);
              }
              if (isSingle) {
                if (!out.length) return resolve({ data: null, error: { message: "Row not found" } });
                return resolve({ data: out[0], error: null });
              }
              return resolve({ data: out, error: null });
            } catch (err) {
              if (reject) return reject(err);
              throw err;
            }
          }
        };
        return q;
      },
      channel() {
        return { on() { return this; }, subscribe() { return this; } };
      },
      removeChannel() {},
      rpc: async (name, args) => {
        if (name === "listar_mesas_acessiveis") return { data: clone(db.mesas), error: null };
        if (name === "ler_6b_xerife") {
          const found = db.mesa_6b_xerife.find((r) => r.mesa_id === args.p_mesa && r.tipo === args.p_tipo);
          return { data: clone(found || null), error: null };
        }
        return { data: [], error: null };
      }
    };

    OS.getSupabaseClient = () => client;
    OS.authSession = { userId: gmId, email: "gm@darkwest.local", username: "Xerife" };

    Object.assign(OS.activeMesaState, {
      mesaId: roomId,
      activeMapId: mapId,
      isMestre: true,
      currentUserId: gmId,
      mesa: db.mesas[0],
      npcsMesa: [],
      sceneCreatures: [],
      playerSheets: [],
      mesaTokens: [],
      pendingLocalTokenUpdates: {},
      maps: [{ id: mapId, nome: "Desfiladeiro", grid_cols: 20, grid_rows: 15 }]
    });

    await OS.loadOfficialBestiary();
    await OS.loadCustomNpcs();
    if (OS.initXerife6B) {
      await OS.initXerife6B();
    }

    /* ─── CENÁRIO 1: Criar NPC sem 6B próprio ─── */
    OS.startCreateCustomNpc();
    const toggleWrap = OS.$("own-6b-toggle-wrap");
    const cbOwn6B = OS.$("has-own-6b");
    const badgeOwn6B = OS.$("own-6b-mode-badge");
    const editorPanel = OS.$("npc-own-6b-editor");
    const counterEl = OS.$("own-6b-dice-counter");
    const summaryEl = OS.$("own-6b-composition-summary");
    const feedbackEl = OS.$("own-6b-validation-feedback");

    check(
      toggleWrap && !toggleWrap.hidden && editorPanel && !editorPanel.hidden && cbOwn6B && cbOwn6B.checked === false,
      "C1a: editor de 6B próprio aparece no freeEdit e inicia desmarcado"
    );

    OS.$("nome").value = "Capanga Sem 6B";
    OS.$("defesa").value = "11";
    OS.$("iniciativa").value = "13";
    OS.setOwn6BEnabled(false);

    check(
      OS.hasOwn6B === false &&
        OS._own6BExplicit === true &&
        cbOwn6B.checked === false &&
        badgeOwn6B.textContent === "DESATIVADO" &&
        counterEl.textContent === "0 / 15 dados" &&
        OS.$("config-6b").value === "" &&
        OS.get6BDiceArray().length === 0,
      "C1b: desativar 6B próprio limpa config-6b e define 0 / 15 dados"
    );

    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const rowSem6B = db.fichas.find((r) => r.nome_personagem === "Capanga Sem 6B");
    check(
      !!rowSem6B &&
        rowSem6B.dados.hasOwn6B === false &&
        rowSem6B.dados["has-own-6b"] === false &&
        rowSem6B.dados.own6B &&
        rowSem6B.dados.own6B.enabled === false &&
        rowSem6B.dados.own6B.totalDice === 0 &&
        rowSem6B.dados["config-6b"] === "" &&
        Object.keys(rowSem6B.dados.config6B || {}).length === 0,
      "C1c: NPC sem 6B próprio é salvo com hasOwn6B=false e own6B.enabled=false"
    );

    /* ─── CENÁRIO 2: Ativar 6B próprio com 6 dados ─── */
    OS.startCreateCustomNpc();
    OS.$("nome").value = "Tenente Com 6B";
    OS.$("defesa").value = "14";
    OS.$("iniciativa").value = "16";

    cbOwn6B.checked = true;
    cbOwn6B.dispatchEvent(new Event("change", { bubbles: true }));

    check(
      OS.hasOwn6B === true &&
        OS._own6BExplicit === true &&
        cbOwn6B.checked === true &&
        OS.$("config-6b").value === "6d6" &&
        counterEl.textContent === "6 / 15 dados" &&
        summaryEl.textContent === "6d6" &&
        document.querySelectorAll("#own-6b-preview-pills .own-6b-die-pill").length === 6,
      "C2a: ativar 6B próprio aplica composição padrão de 6 dados (6d6) e renderiza 6 pílulas"
    );

    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const row6Dados = db.fichas.find((r) => r.nome_personagem === "Tenente Com 6B");
    check(
      !!row6Dados &&
        row6Dados.dados.hasOwn6B === true &&
        row6Dados.dados.own6B &&
        row6Dados.dados.own6B.enabled === true &&
        row6Dados.dados.own6B.totalDice === 6 &&
        row6Dados.dados.own6B.counts.d6 === 6 &&
        row6Dados.dados["config-6b"] === "6d6",
      "C2b: NPC com 6 dados é persistido com own6B.totalDice=6 e config-6b='6d6'"
    );

    /* ─── CENÁRIO 3: Configurar Boss com 15 dados ─── */
    OS.startCreateCustomNpc();
    OS.$("nome").value = "General Boss 15 Dados";
    OS.$("defesa").value = "18";
    OS.$("iniciativa").value = "21";

    const resBoss15 = OS.setOwn6BComposition({
      d4: 1,
      d6: 2,
      d8: 4,
      d10: 4,
      d12: 4
    });

    check(
      resBoss15.valid === true &&
        resBoss15.totalDice === 15 &&
        OS.hasOwn6B === true &&
        counterEl.textContent === "15 / 15 dados" &&
        counterEl.classList.contains("is-max") &&
        OS.$("config-6b").value === "1d4 + 2d6 + 4d8 + 4d10 + 4d12" &&
        OS.get6BDiceArray().length === 15 &&
        document.querySelectorAll("#own-6b-preview-pills .own-6b-die-pill").length === 15,
      "C3a: Boss suporta composição mista com exatamente 15 dados (d4..d12)"
    );

    const plusD12Btn = document.querySelector('button[data-own6b-die="d12"][data-own6b-step="1"]');
    check(
      plusD12Btn && plusD12Btn.disabled === true,
      "C3b: botões '+' ficam desabilitados ao atingir o limite máximo de 15 dados"
    );

    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const rowBoss15 = db.fichas.find((r) => r.nome_personagem === "General Boss 15 Dados");
    check(
      !!rowBoss15 &&
        rowBoss15.dados.hasOwn6B === true &&
        rowBoss15.dados.own6B &&
        rowBoss15.dados.own6B.enabled === true &&
        rowBoss15.dados.own6B.totalDice === 15 &&
        rowBoss15.dados.own6B.diceTypes.length === 15 &&
        rowBoss15.dados.own6B.diceSides.length === 15 &&
        rowBoss15.dados["config-6b"] === "1d4 + 2d6 + 4d8 + 4d10 + 4d12" &&
        rowBoss15.dados["chamber-14"] !== undefined,
      "C3c: Boss com 15 dados persiste own6B completo (15 dados) e câmaras até chamber-14"
    );

    /* ─── CENÁRIO 4: Rejeitar 0 dados quando ativado ─── */
    OS.startCreateCustomNpc();
    OS.setOwn6BComposition({ d4: 1, d6: 0, d8: 0, d10: 0, d12: 0 });
    const resZeroObj = OS.setOwn6BComposition({ d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 });
    check(
      resZeroObj.valid === false &&
        resZeroObj.errorCode === "EMPTY_COMPOSITION" &&
        !feedbackEl.hidden &&
        feedbackEl.textContent.includes("1 dado") &&
        OS.own6BCounts.d4 === 1,
      "C4a: rejeita 0 dados quando ativado via objeto de contagens e preserva última composição válida"
    );

    const resZeroStep = OS.adjustOwn6BDieCount("d4", -1);
    check(
      resZeroStep.valid === false &&
        resZeroStep.errorCode === "EMPTY_COMPOSITION" &&
        OS.own6BCounts.d4 === 1,
      "C4b: rejeita zerar o último dado ativo via stepper"
    );

    const resEmptyStr = OS.validateOwn6BComposition("", { enabled: true });
    check(
      resEmptyStr.valid === false && resEmptyStr.errorCode === "EMPTY_COMPOSITION",
      "C4c: validateOwn6BComposition rejeita string vazia quando enabled=true"
    );
    await OS.closeMesaSheetEditor();

    /* ─── CENÁRIO 5: Rejeitar 16 ou mais dados ─── */
    OS.startCreateCustomNpc();
    OS.setOwn6BComposition("15d6");
    const res16Obj = OS.setOwn6BComposition({ d4: 0, d6: 16, d8: 0, d10: 0, d12: 0 });
    const res16Str = OS.setOwn6BComposition("8d8 + 8d10");
    const res20Step = OS.adjustOwn6BDieCount("d6", 1);

    check(
      res16Obj.valid === false &&
        res16Obj.errorCode === "MAX_DICE_EXCEEDED" &&
        res16Str.valid === false &&
        res16Str.errorCode === "MAX_DICE_EXCEEDED" &&
        res20Step.valid === false &&
        res20Step.errorCode === "MAX_DICE_EXCEEDED" &&
        !feedbackEl.hidden &&
        feedbackEl.textContent.includes("15 dados") &&
        OS.$("config-6b").value === "15d6",
      "C5: rejeita 16 ou mais dados (objeto, string composta e incremento) sem corromper 15d6"
    );
    await OS.closeMesaSheetEditor();

    /* ─── CENÁRIO 6: Rejeitar tipos inválidos de dado ─── */
    OS.startCreateCustomNpc();
    OS.setOwn6BComposition("3d8");
    const resBadD20 = OS.setOwn6BComposition("2d20");
    const resBadD7 = OS.validateOwn6BComposition({ d7: 2 }, { enabled: true });
    const resBadSides = OS.validateOwn6BComposition([6, 6, 20], { enabled: true });
    const resBadDieMethod = OS.setOwn6BDieCount("d20", 2);

    check(
      resBadD20.valid === false &&
        resBadD20.errorCode === "INVALID_DIE_TYPE" &&
        resBadD7.valid === false &&
        resBadD7.errorCode === "INVALID_DIE_TYPE" &&
        resBadSides.valid === false &&
        resBadSides.errorCode === "INVALID_DIE_TYPE" &&
        resBadDieMethod.valid === false &&
        resBadDieMethod.errorCode === "INVALID_DIE_TYPE" &&
        !feedbackEl.hidden &&
        OS.$("config-6b").value === "3d8",
      "C6: rejeita tipos inválidos de dado (d20, d7, face 20) mantendo apenas d4, d6, d8, d10, d12"
    );
    await OS.closeMesaSheetEditor();

    /* ─── CENÁRIO 7: Salvar e reabrir template preservando a configuração ─── */
    await OS.loadCustomNpcs();
    const entrySem6B = OS.bestiaryCatalog.custom.find((e) => e.name === "Capanga Sem 6B");
    const entryBoss15 = OS.bestiaryCatalog.custom.find((e) => e.name === "General Boss 15 Dados");

    await OS.editSelectedBestiarioEntry(entrySem6B);
    check(
      OS.hasOwn6B === false &&
        OS._own6BExplicit === true &&
        cbOwn6B.checked === false &&
        OS.$("config-6b").value === "" &&
        counterEl.textContent === "0 / 15 dados",
      "C7a: reabrir template sem 6B próprio restaura estado desativado"
    );
    await OS.closeMesaSheetEditor();

    await OS.editSelectedBestiarioEntry(entryBoss15);
    check(
      OS.hasOwn6B === true &&
        OS._own6BExplicit === true &&
        cbOwn6B.checked === true &&
        OS.$("config-6b").value === "1d4 + 2d6 + 4d8 + 4d10 + 4d12" &&
        OS.$("own-6b-count-d4").value === "1" &&
        OS.$("own-6b-count-d6").value === "2" &&
        OS.$("own-6b-count-d8").value === "4" &&
        OS.$("own-6b-count-d10").value === "4" &&
        OS.$("own-6b-count-d12").value === "4" &&
        counterEl.textContent === "15 / 15 dados",
      "C7b: reabrir Boss com 15 dados restaura todas as quantidades por tipo de dado"
    );

    // Modificar para 9 dados (3d8 + 3d10 + 3d12), salvar e reabrir
    OS.setOwn6BComposition({ d4: 0, d6: 0, d8: 3, d10: 3, d12: 3 });
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    await OS.loadCustomNpcs();
    const entryBossReopened = OS.bestiaryCatalog.custom.find((e) => e.name === "General Boss 15 Dados");
    await OS.editSelectedBestiarioEntry(entryBossReopened);
    check(
      OS.hasOwn6B === true &&
        OS.$("config-6b").value === "3d8 + 3d10 + 3d12" &&
        counterEl.textContent === "9 / 15 dados",
      "C7c: editar composição, salvar e reabrir preserva '3d8 + 3d10 + 3d12' (9 dados)"
    );
    // Restaurar para 15 dados para os próximos cenários
    OS.setOwn6BComposition({ d4: 1, d6: 2, d8: 4, d10: 4, d12: 4 });
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    /* ─── CENÁRIO 8: Abrir NPC legado sem regressão ─── */
    await OS.loadCustomNpcs();
    const entryLegacy = OS.bestiaryCatalog.custom.find((e) => e.id === legacyId);
    const normLegacy = OS.normalizeLegacyNpcDataReadOnly(entryLegacy);
    check(
      !!entryLegacy &&
        normLegacy.sixBInfo.count === 2 &&
        normLegacy.sixBInfo.cfgText === "2d6" &&
        !("hasOwn6B" in entryLegacy.data) &&
        !("own6B" in entryLegacy.data),
      "C8a: normalizeLegacyNpcDataReadOnly lê NPC legado sem mutar origem"
    );

    await OS.editSelectedBestiarioEntry(entryLegacy);
    check(
      OS._own6BExplicit === false &&
        OS.$("config-6b").value === "2d6" &&
        OS.$("own-6b-count-d6").value === "2",
      "C8b: abrir NPC legado exibe '2d6' no editor sem marcar _own6BExplicit involuntariamente"
    );

    OS.$("defesa").value = "13";
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const legacyRowAfterDef = db.fichas.find((r) => r.id === legacyId);
    check(
      legacyRowAfterDef.dados.defesa === "13" &&
        legacyRowAfterDef.dados["config-6b"] === "2d6" &&
        !("hasOwn6B" in legacyRowAfterDef.dados) &&
        !("own6B" in legacyRowAfterDef.dados),
      "C8c: salvar atributo de NPC legado sem tocar no editor 6B não injeta hasOwn6B/own6B"
    );

    /* ─── CENÁRIO 9: Confirmar que NPC com 6B próprio NÃO vira Criatura e NÃO ganha iniciativa/ações extras ─── */
    await OS.loadCustomNpcs();
    const bossCatalogEntry = OS.bestiaryCatalog.custom.find((e) => e.name === "General Boss 15 Dados");
    await OS.editSelectedBestiarioEntry(bossCatalogEntry);

    const initBefore = OS.$("iniciativa").value;
    const actionsBefore = OS.calculateActionsPerTurn();
    const breakdownBefore = OS.calculateInitiativeActionsBreakdown();

    // Alterar 6B próprio de 1 dado (1d4) até 15 dados (15d12) e verificar que Criatura, Iniciativa e Ações NÃO mudam
    OS.setOwn6BComposition("1d4");
    const initAt1 = OS.$("iniciativa").value;
    const actionsAt1 = OS.calculateActionsPerTurn();

    OS.setOwn6BComposition("15d12");
    const initAt15 = OS.$("iniciativa").value;
    const actionsAt15 = OS.calculateActionsPerTurn();
    const breakdownAt15 = OS.calculateInitiativeActionsBreakdown();

    check(
      OS.isCriatura === false &&
        OS.$("is-criatura").checked === false &&
        !OS.$("is-criatura").indeterminate &&
        OS.$("ficha").dataset.operationalMode === "full_sheet" &&
        initAt1 === initBefore &&
        initAt15 === initBefore &&
        actionsAt1 === actionsBefore &&
        actionsAt15 === actionsBefore &&
        breakdownAt15.totalActions === breakdownBefore.totalActions,
      "C9a: ter 6B próprio (mesmo com 15d12) NÃO torna o NPC Criatura e NÃO altera iniciativa nem ações por turno"
    );

    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    await OS.loadCustomNpcs();
    const bossUpdatedEntry = OS.bestiaryCatalog.custom.find((e) => e.name === "General Boss 15 Dados");
    const capangaSem6BEntry = OS.bestiaryCatalog.custom.find((e) => e.name === "Capanga Sem 6B");

    const mesaNpcBoss = await OS.addBestiarioEntryToMesa(bossUpdatedEntry);
    const mesaNpcSem6B = await OS.addBestiarioEntryToMesa(capangaSem6BEntry);
    const sceneResBoss = await OS.addNpcMesaToScene(mesaNpcBoss.mesaNpcId);
    const sceneResSem6B = await OS.addNpcMesaToScene(mesaNpcSem6B.mesaNpcId);
    const instBoss = sceneResBoss && sceneResBoss.instance;
    const instSem6B = sceneResSem6B && sceneResSem6B.instance;

    const opBoss = OS.resolveCombatantOperationalInfo(instBoss);
    const budgetBoss = OS.computeCombatantTurnBudget(instBoss, 1);

    check(
      opBoss.kind === "npc_human" &&
        opBoss.operationalMode === "full_sheet" &&
        opBoss.isOfficialMonster === false &&
        instBoss.isCriatura === false &&
        instBoss.operationalMode === "full_sheet" &&
        budgetBoss.operationalMode === "full_sheet" &&
        OS.getCombatTokenMode({ owner_type: "creature", owner_ref: instBoss.instanceId }) === "ficha",
      "C9b: Boss com 15 dados em cena mantém kind='npc_human', operationalMode='full_sheet' e modo de token 'ficha'"
    );

    /* ─── CENÁRIO 10: Confirmar que o 6B compartilhado do Xerife não é afetado ─── */
    const xerifeSnapBefore = OS.getXerife6BSnapshot("aberto");
    const xerifeForNpcSem6B = OS.getXerife6BForNpc(instSem6B.instanceId);
    const xerifeForBossOwn6B = OS.getXerife6BForNpc(instBoss.instanceId);

    check(
      !!xerifeSnapBefore &&
        xerifeSnapBefore.resultados.length === 6 &&
        !!xerifeForNpcSem6B &&
        xerifeForNpcSem6B.resultados.join(",") === "6,5,4,3,2,1" &&
        xerifeForBossOwn6B === null,
      "C10a: getXerife6BForNpc retorna pool compartilhada para NPC sem 6B próprio e null para Boss com 6B próprio"
    );

    // Atacar com Boss de 6B próprio não deve abrir modal do 6B do Xerife nem consumir índices do Xerife
    instBoss.data.equipamentos = "⚙ Rifle Pesado — Perícia d10 + Dano d10";
    instBoss.data["chamber-0"] = "8";
    const bossAttackRoll = OS.rollSceneCreatureAttack(instBoss.instanceId, 0);
    const xerifeSnapAfter = OS.getXerife6BSnapshot("aberto");

    check(
      !!bossAttackRoll &&
        instBoss.data.usedChambers.includes(0) &&
        xerifeSnapAfter.usados.length === 0 &&
        xerifeSnapAfter.versao === xerifeSnapBefore.versao,
      "C10b: ataque de Boss com 6B próprio consome câmara própria e mantém 6B compartilhado do Xerife intacto"
    );

    /* ─── CONTRATOS PUROS XER-05 e XER-06 (Isolamento de Instâncias e Transições Atômicas) ─── */
    const contractInst1 = OS.createOwn6BInstanceStateContract(instBoss, { instanceId: "inst-boss-1", mesaId: roomId });
    const contractInst2 = OS.createOwn6BInstanceStateContract(instBoss, { instanceId: "inst-boss-2", mesaId: roomId });

    check(
      contractInst1.enabled === true &&
        contractInst1.dados.length === 15 &&
        contractInst1.instanceId === "inst-boss-1" &&
        contractInst2.instanceId === "inst-boss-2" &&
        contractInst1.dados !== contractInst2.dados,
      "XER05-Contract: createOwn6BInstanceStateContract cria estados isolados por instância para 15 dados"
    );

    const rollTx = OS.validateAndProjectOwn6BInstanceCommand(contractInst1, {
      type: "ROLL_INITIAL",
      expectedVersion: 0,
      opId: "op-roll-1",
      rolls: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 12, 10, 8]
    });
    check(
      rollTx.ok === true &&
        rollTx.state.versao === 1 &&
        rollTx.state.resultados.length === 15 &&
        rollTx.state.esgotado === false &&
        contractInst2.resultados.length === 0,
      "XER05/06-Contract-Roll: ROLL_INITIAL projeta 15 dados na instância #1 sem afetar a instância #2"
    );

    // Idempotência pelo mesmo opId
    const dupRollTx = OS.validateAndProjectOwn6BInstanceCommand(rollTx.state, {
      type: "ROLL_INITIAL",
      expectedVersion: 0,
      opId: "op-roll-1"
    });
    check(
      dupRollTx.ok === true && dupRollTx.idempotentReplay === true && dupRollTx.state.versao === 1,
      "XER06-Contract-Idempotency: comando repetido com mesmo opId é tratado de forma idempotente"
    );

    // Conflito de versão (40001)
    const staleTx = OS.validateAndProjectOwn6BInstanceCommand(rollTx.state, {
      type: "CONSUME",
      expectedVersion: 0,
      indices: [0]
    });
    check(
      staleTx.ok === false && staleTx.errorCode === "40001" && staleTx.reason === "VERSION_CONFLICT",
      "XER06-Contract-Concurrency: divergência de expectedVersion retorna conflito 40001 VERSION_CONFLICT"
    );

    // Consumo válido + bloqueio de saldo negativo (reconsumir mesmo índice)
    const consumeTx = OS.validateAndProjectOwn6BInstanceCommand(rollTx.state, {
      type: "CONSUME",
      expectedVersion: 1,
      opId: "op-consume-1",
      indices: [0, 1]
    });
    const doubleConsumeTx = OS.validateAndProjectOwn6BInstanceCommand(consumeTx.state, {
      type: "CONSUME",
      expectedVersion: 2,
      opId: "op-consume-2",
      indices: [0]
    });
    check(
      consumeTx.ok === true &&
        consumeTx.state.usados.includes(0) &&
        consumeTx.state.usados.includes(1) &&
        doubleConsumeTx.ok === false &&
        doubleConsumeTx.reason === "CHAMBER_ALREADY_SPENT_OR_BLOCKED",
      "XER06-Contract-Consume: consumo abate saldo e impede saldo negativo / duplo consumo do mesmo dado"
    );

    // Dano com escolha pelo defensor (APPLY_DAMAGE)
    const damageTx = OS.validateAndProjectOwn6BInstanceCommand(consumeTx.state, {
      type: "APPLY_DAMAGE",
      expectedVersion: 2,
      opId: "op-dmg-1",
      damagePoints: 2,
      chosenIndices: [2, 3]
    });
    check(
      damageTx.ok === true &&
        damageTx.state.bloqueados.join(",") === "2,3" &&
        damageTx.state.resultados[2] === 0 &&
        damageTx.state.resultados[3] === 0,
      "XER06-Contract-Damage: APPLY_DAMAGE aplica dano nos dados escolhidos pelo defensor"
    );

    // Renovação bloqueada enquanto ainda há dados disponíveis, e permitida com +1 Fadiga quando esgotados
    const prematureRenew = OS.validateAndProjectOwn6BInstanceCommand(damageTx.state, {
      type: "RENEW",
      expectedVersion: 3,
      opId: "op-renew-early",
      rolls: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
    });
    const consumeRemaining = OS.validateAndProjectOwn6BInstanceCommand(damageTx.state, {
      type: "CONSUME",
      expectedVersion: 3,
      opId: "op-consume-rest",
      indices: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    });
    const renewTx = OS.validateAndProjectOwn6BInstanceCommand(consumeRemaining.state, {
      type: "RENEW",
      expectedVersion: 4,
      opId: "op-renew-ok",
      rolls: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
    });
    check(
      prematureRenew.ok === false &&
        prematureRenew.reason === "POOL_NOT_EXHAUSTED" &&
        consumeRemaining.ok === true &&
        consumeRemaining.state.esgotado === true &&
        renewTx.ok === true &&
        renewTx.state.fadiga === 1 &&
        renewTx.state.bloqueados.join(",") === "2,3" &&
        renewTx.state.esgotado === false,
      "XER06-Contract-Renew: RENEW exige esgotamento dos dados intactos, preserva danos e incrementa +1 Fadiga"
    );

    document.getElementById("result").textContent =
      "PASS: " + results.length + " verificações | " + results.join(" | ");
  } catch (e) {
    document.getElementById("result").textContent =
      "FAIL: " + (e && e.stack ? e.stack : String(e));
  }
};

const html = read("dist/index.html")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(
    "</body>",
    '<pre id="result" style="position:fixed;inset:0 auto auto 0;background:#17120f;color:white;z-index:99999;max-width:100%;white-space:pre-wrap;font:11px monospace">Executando…</pre><script type="module">(' +
      test.toString() +
      ")();</script></body>"
  );

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

server.listen(0, "127.0.0.1", async () => {
  try {
    const result = await require("./browser-harness.cjs")(
      "http://127.0.0.1:" + server.address().port + "/test",
      temp,
      path.join(temp, "xerife-6b-xer04-own-editor.png")
    );
    console.log(result);
    if (!result.startsWith("PASS:")) process.exitCode = 1;
    console.log("Screenshot: " + path.join(temp, "xerife-6b-xer04-own-editor.png"));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
