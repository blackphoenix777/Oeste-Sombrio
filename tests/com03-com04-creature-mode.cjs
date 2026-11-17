const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "darkwest-com03-com04-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const test = async function () {
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
    if (OS.bindMesaScreenEvents) OS.bindMesaScreenEvents();
    OS.initCylinder();

    const gmId = "11111111-1111-4111-8111-111111111111";
    const roomId = "22222222-2222-4222-8222-222222222222";
    const mapId = "33333333-3333-4333-8333-333333333333";
    const legacyId = "44444444-4444-4444-8444-444444444444";
    const legacyUnsetMesaId = "55555555-5555-4555-8555-555555555555";

    const db = {
      usuarios: [{ id: gmId, email: "gm@darkwest.local", username: "Xerife" }],
      fichas: [
        {
          id: legacyId,
          usuario_id: gmId,
          mesa_id: null,
          nome_personagem: "Bandido Antigo",
          nivel: 2,
          classe: "npc",
          dados: {
            nome: "Bandido Antigo",
            nivel: "2",
            defesa: "12",
            freeEdit: true,
            isBestiaryCustom: true
          },
          updated_at: "2026-01-01T10:00:00.000Z"
        },
        {
          id: legacyUnsetMesaId,
          usuario_id: gmId,
          mesa_id: null,
          nome_personagem: "Matuto Legado",
          nivel: 1,
          classe: "npc",
          dados: {
            nome: "Matuto Legado",
            nivel: "1",
            defesa: "10",
            freeEdit: true,
            isBestiaryCustom: true
          },
          updated_at: "2026-01-01T09:00:00.000Z"
        }
      ],
      mesas: [
        {
          id: roomId,
          mestre_id: gmId,
          nome: "Mesa Teste COM03-04",
          npcs_mesa: [],
          cena_ativa: [],
          combate_ativo: null
        }
      ],
      mesa_tokens: []
    };

    const matchRow = (row, filters) =>
      filters.every((f) => {
        if (f.op === "eq") {
          if (f.v === null) return row[f.k] === null;
          return String(row[f.k]) === String(f.v);
        }
        if (f.op === "is") return f.v === null ? row[f.k] == null : row[f.k] === f.v;
        if (f.op === "neq") return String(row[f.k]) !== String(f.v);
        if (f.op === "in") return Array.isArray(f.v) && f.v.some((item) => String(item) === String(row[f.k]));
        return true;
      });

    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: gmId, email: "gm@darkwest.local" } }, error: null })
      },
      from(table) {
        let op = "select";
        let payload = null;
        let filters = [];
        let isSingle = false;
        let orderSpec = null;
        let limitN = null;

        const q = {
          select() { return q; },
          insert(p) { op = "insert"; payload = clone(p); return q; },
          update(p) { op = "update"; payload = clone(p); return q; },
          upsert(p) { op = "upsert"; payload = clone(p); return q; },
          delete() { op = "delete"; return q; },
          eq(k, v) { filters.push({ op: "eq", k, v }); return q; },
          is(k, v) { filters.push({ op: "is", k, v }); return q; },
          neq(k, v) { filters.push({ op: "neq", k, v }); return q; },
          in(k, v) { filters.push({ op: "in", k, v }); return q; },
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
              } else if (op === "upsert") {
                const list = Array.isArray(payload) ? payload : [payload];
                for (const item of list) {
                  const idx = rows.findIndex((r) => String(r.id) === String(item.id));
                  if (idx >= 0) {
                    Object.assign(rows[idx], clone(item), { updated_at: nowIso });
                    out.push(clone(rows[idx]));
                  } else {
                    const row = Object.assign({ id: item.id || crypto.randomUUID(), created_at: nowIso, updated_at: nowIso }, clone(item));
                    rows.push(row);
                    out.push(clone(row));
                  }
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
                    if (av < bv) return orderSpec.ascending ? -1 : 1;
                    if (av > bv) return orderSpec.ascending ? 1 : -1;
                    return 0;
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
      rpc: async (name) => {
        if (name === "listar_mesas_acessiveis") return { data: clone(db.mesas), error: null };
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
      maps: [{ id: mapId, nome: "Saloon", grid_cols: 20, grid_rows: 15 }]
    });

    await OS.loadOfficialBestiary();
    await OS.loadCustomNpcs();

    /* ─── 1. Criar e salvar NPC Criatura ─── */
    OS.startCreateCustomNpc();
    const cbCriatura = OS.$("is-criatura");
    const wrapCriatura = OS.$("criatura-toggle-wrap");
    const badgeCriatura = OS.$("criatura-mode-badge");
    const fichaEl = OS.$("ficha");
    check(
      wrapCriatura && !wrapCriatura.hidden && cbCriatura && !cbCriatura.checked && !cbCriatura.indeterminate,
      "T1a: editor de novo NPC inicia visível em Ficha Completa"
    );
    OS.$("nome").value = "Pistonete Pistoleiro";
    OS.$("defesa").value = "14";
    cbCriatura.checked = true;
    cbCriatura.dispatchEvent(new Event("change", { bubbles: true }));
    check(
      badgeCriatura.textContent === "Modo Criatura" && fichaEl.dataset.operationalMode === "creature_mode",
      "T1b: marcar checkbox Criatura atualiza badge e dataset para creature_mode"
    );
    const savedPistonete = await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();
    const rowPistonete = db.fichas.find((r) => r.nome_personagem === "Pistonete Pistoleiro");
    check(
      !!savedPistonete &&
        !!rowPistonete &&
        rowPistonete.dados.isCriatura === true &&
        rowPistonete.dados["is-criatura"] === true &&
        rowPistonete.dados.operationalMode === "creature_mode" &&
        rowPistonete.dados.freeEdit === true &&
        rowPistonete.dados.tipo_ficha === "npc",
      "T1c: NPC Criatura persistido em fichas.dados com operationalMode creature_mode"
    );

    /* ─── 2. Criar e salvar NPC Avançado ─── */
    OS.startCreateCustomNpc();
    OS.$("nome").value = "Coronel Vane";
    OS.$("defesa").value = "16";
    const cbVet = OS.$("is-veterano");
    cbVet.checked = true;
    cbVet.dispatchEvent(new Event("change", { bubbles: true }));
    check(
      OS.$("is-criatura").checked === false && !OS.$("is-criatura").indeterminate && OS.isVeterano === true,
      "T2a: NPC Avançado Veterano mantém Criatura desmarcado explicitamente"
    );
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();
    const rowVane = db.fichas.find((r) => r.nome_personagem === "Coronel Vane");
    check(
      !!rowVane &&
        rowVane.dados.isCriatura === false &&
        rowVane.dados["is-criatura"] === false &&
        rowVane.dados.operationalMode === "full_sheet" &&
        rowVane.dados.isVeterano === true,
      "T2b: NPC Avançado persistido com operationalMode full_sheet e isVeterano true"
    );

    /* ─── 3. Reabrir e restaurar a escolha ─── */
    await OS.loadCustomNpcs();
    const entryPistonete = OS.bestiaryCatalog.custom.find((e) => e.name === "Pistonete Pistoleiro");
    const entryVane = OS.bestiaryCatalog.custom.find((e) => e.name === "Coronel Vane");
    await OS.editSelectedBestiarioEntry(entryPistonete);
    check(
      OS.$("is-criatura").checked === true &&
        !OS.$("is-criatura").indeterminate &&
        badgeCriatura.textContent === "Modo Criatura" &&
        fichaEl.dataset.operationalMode === "creature_mode",
      "T3a: reabrir NPC Criatura restaura marcado e creature_mode"
    );
    await OS.editSelectedBestiarioEntry(entryVane);
    check(
      OS.$("is-criatura").checked === false &&
        !OS.$("is-criatura").indeterminate &&
        badgeCriatura.textContent === "Ficha Completa" &&
        fichaEl.dataset.operationalMode === "full_sheet" &&
        OS.isVeterano === true,
      "T3b: reabrir NPC Avançado restaura desmarcado, full_sheet e isVeterano"
    );
    await OS.openBestiarioModal({ tab: "custom" });
    const modalBtnPistonete = document.querySelector('#bestiario-list [data-entry-key="' + entryPistonete.key + '"]');
    if (modalBtnPistonete) modalBtnPistonete.click();
    await tick();
    check(
      OS.$("bestiario-detail").textContent.includes("Modo Criatura"),
      "T3c: modal do Bestiário exibe badge Modo Criatura"
    );
    OS.closeBestiarioModal();

    /* ─── 4. Alterar modalidade sem apagar 6B (nem habilidades/inventário/condições) ─── */
    OS.$("config-6b").value = "4d6";
    OS.$("config-6b").dispatchEvent(new Event("change", { bubbles: true }));
    OS.$("chamber-0").value = "4";
    OS.$("chamber-1").value = "6";
    OS.$("chamber-2").value = "5";
    OS.$("chamber-3").value = "3";
    OS.usedChambers = [0, 2];
    OS.damagedChambers = [1];
    const pontariaCb = document.querySelector("input[name^='combate-pontaria']");
    if (pontariaCb) {
      pontariaCb.checked = true;
      pontariaCb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    OS.inventoryItems = [{ id: "inv-colt", name: "Colt .45", qty: 1, slots: 1 }];
    OS.activeConditions = [{ nome: "Sangrando", grau: 1 }];
    await OS.saveActiveGmEditedSheet();

    // full_sheet -> creature_mode -> save -> full_sheet -> save
    cbCriatura.checked = true;
    cbCriatura.dispatchEvent(new Event("change", { bubbles: true }));
    await OS.saveActiveGmEditedSheet();
    cbCriatura.checked = false;
    cbCriatura.dispatchEvent(new Event("change", { bubbles: true }));
    await OS.saveActiveGmEditedSheet();

    const vaneUpdated = db.fichas.find((r) => r.id === rowVane.id);
    check(
      vaneUpdated.dados["config-6b"] === "4d6" &&
        vaneUpdated.dados["chamber-0"] === "4" &&
        vaneUpdated.dados["chamber-1"] === "6" &&
        vaneUpdated.dados.usedChambers.join(",") === "0,2" &&
        vaneUpdated.dados.damagedChambers.join(",") === "1" &&
        vaneUpdated.dados.inventoryItems[0].id === "inv-colt" &&
        vaneUpdated.dados.inventoryItems[0].name === "Colt .45" &&
        vaneUpdated.dados.activeConditions[0].nome === "Sangrando" &&
        vaneUpdated.dados.isVeterano === true &&
        vaneUpdated.dados.operationalMode === "full_sheet" &&
        (!pontariaCb || vaneUpdated.dados[pontariaCb.name] === true),
      "T4: alternar modalidade preserva 6B, câmaras, inventário, perícias, condições e Veterano"
    );
    await OS.closeMesaSheetEditor();

    /* ─── 5. Carregar NPC legado sem tipo_ficha ─── */
    const entryLegacy = OS.bestiaryCatalog.custom.find((e) => e.id === legacyId);
    const normLegacy = OS.normalizeLegacyNpcDataReadOnly(entryLegacy);
    check(
      !!entryLegacy &&
        entryLegacy.data.tipo_ficha === undefined &&
        normLegacy.hasExplicitTipoFicha === false &&
        normLegacy.tipoFichaEfetivo === "npc" &&
        normLegacy.operationalInfo.isLegacyUnset === true &&
        normLegacy.operationalInfo.operationalMode === null &&
        normLegacy.operationalInfo.statusLabel === "Modo não definido",
      "T5a: normalização não destrutiva identifica legado sem tipo_ficha nem modalidade"
    );
    await OS.editSelectedBestiarioEntry(entryLegacy);
    check(
      OS.isCriatura === null &&
        OS.$("is-criatura").indeterminate === true &&
        OS.$("is-criatura").checked === false &&
        badgeCriatura.textContent === "Não definido" &&
        fichaEl.dataset.operationalMode === "unset",
      "T5b: editor exibe estado indeterminado e 'Não definido' ao abrir NPC legado"
    );
    await OS.openBestiarioModal({ tab: "custom" });
    const modalBtnLegacy = document.querySelector('#bestiario-list [data-entry-key="' + entryLegacy.key + '"]');
    if (modalBtnLegacy) modalBtnLegacy.click();
    await tick();
    check(
      OS.$("bestiario-detail").textContent.includes("Modo não definido"),
      "T5c: modal do Bestiário exibe 'Modo não definido' para NPC legado"
    );
    OS.closeBestiarioModal();

    /* ─── 6. Carregar NPC com damagedChambers ou inventoryItems ausentes ─── */
    const rawLegacyMissingFields = {
      nome: "Capanga Velho",
      defesa: "11",
      "config-6b": "6d6",
      equipamentos: "⚙ Pistola Antiga — Perícia d8 + Dano d6\n⚙ Adaga — Dano d4",
      markedChambers: [0, 1],
      originalChambers: ["1", "5", "4", "4", "4", "4"],
      activeConditions: [{ nome: "Fatigado", grau: 2 }],
      freeEdit: true,
      isBestiaryCustom: true
    };
    const normMissing = OS.normalizeLegacyNpcDataReadOnly(rawLegacyMissingFields);
    check(
      !("damagedChambers" in rawLegacyMissingFields) &&
        !("inventoryItems" in rawLegacyMissingFields) &&
        !("tipo_ficha" in rawLegacyMissingFields) &&
        normMissing.hasExplicitDamagedChambers === false &&
        normMissing.damagedChambers.join(",") === "1" &&
        normMissing.hasExplicitInventoryItems === false &&
        Array.isArray(normMissing.inventoryItems) &&
        normMissing.inventoryItems.length === 0 &&
        normMissing.attacks.length === 2 &&
        normMissing.sixBInfo.count === 6 &&
        OS.normalizeLegacyNpcDataReadOnly({ nome: "Legado Mínimo" }).sixBInfo.count === 1,
      "T6: leitura legada sem damagedChambers/inventoryItems não muta origem e computa danos/ataques"
    );

    /* ─── 7. Editar atributo de ficha legada sem mudar sua modalidade ─── */
    OS.$("defesa").value = "15";
    OS.$("defesa").dispatchEvent(new Event("input", { bubbles: true }));
    OS.$("nome").value = "Bandido Antigo Editado";
    await OS.saveActiveGmEditedSheet();
    const rowLegacyAfterAttr = db.fichas.find((r) => r.id === legacyId);
    check(
      rowLegacyAfterAttr.dados.defesa === "15" &&
        rowLegacyAfterAttr.dados.nome === "Bandido Antigo Editado" &&
        OS.extractCreatureModeChoice(rowLegacyAfterAttr.dados) === null &&
        rowLegacyAfterAttr.dados.operationalMode == null &&
        !("tipo_ficha" in rowLegacyAfterAttr.dados),
      "T7a: salvar edição de atributo em ficha legada não define operationalMode nem grava tipo_ficha"
    );
    // Agora o usuário configura explicitamente o modo legado
    OS.setCriaturaMode(true, true);
    await OS.saveActiveGmEditedSheet();
    const rowLegacyConfigured = db.fichas.find((r) => r.id === legacyId);
    check(
      rowLegacyConfigured.dados.isCriatura === true &&
        rowLegacyConfigured.dados.operationalMode === "creature_mode" &&
        !OS.$("is-criatura").indeterminate,
      "T7b: usuário consegue configurar explicitamente a modalidade de um NPC legado"
    );
    await OS.closeMesaSheetEditor();

    /* ─── 8. Copiar NPC para mesa preservando o modo ─── */
    await OS.loadCustomNpcs();
    const copyPistonete = OS.bestiaryCatalog.custom.find((e) => e.id === rowPistonete.id);
    const copyVane = OS.bestiaryCatalog.custom.find((e) => e.id === rowVane.id);
    const copyUnset = OS.bestiaryCatalog.custom.find((e) => e.id === legacyUnsetMesaId);

    const npcMesaPistonete = await OS.addBestiarioEntryToMesa(copyPistonete);
    const npcMesaVane = await OS.addBestiarioEntryToMesa(copyVane);
    const npcMesaUnset = await OS.addBestiarioEntryToMesa(copyUnset);

    const savedMesasRow = db.mesas[0];
    check(
      npcMesaPistonete.operationalMode === "creature_mode" &&
        npcMesaPistonete.isCriatura === true &&
        npcMesaVane.operationalMode === "full_sheet" &&
        npcMesaVane.isCriatura === false &&
        npcMesaVane.data.isVeterano === true &&
        npcMesaUnset.operationalMode === null &&
        npcMesaUnset.isCriatura === null &&
        !("tipo_ficha" in npcMesaUnset.data) &&
        savedMesasRow.npcs_mesa.length === 3,
      "T8a: copiar NPCs para npcs_mesa preserva creature_mode, full_sheet (+Veterano) e legado unset"
    );
    OS.renderMesaNpcsList();
    const mesaNpcBadges = Array.from(document.querySelectorAll("#mesa-npcs-mesa-list .mesa-mode-badge")).map((el) => el.textContent);
    check(
      mesaNpcBadges.includes("Modo Criatura") &&
        mesaNpcBadges.includes("Ficha Completa") &&
        mesaNpcBadges.includes("Modo não definido"),
      "T8b: lista NPCs da Mesa renderiza badges das três modalidades"
    );

    /* ─── 9. Instanciar múltiplas cópias sem confundir identidades ─── */
    const res1 = await OS.addNpcMesaToScene(npcMesaPistonete.mesaNpcId);
    const res2 = await OS.addNpcMesaToScene(npcMesaPistonete.mesaNpcId);
    const inst1 = res1 && res1.instance;
    const inst2 = res2 && res2.instance;
    check(
      !!inst1 &&
        !!inst2 &&
        inst1.instanceId !== inst2.instanceId &&
        inst1.operationalMode === "creature_mode" &&
        inst2.operationalMode === "creature_mode" &&
        db.mesa_tokens.some((t) => t.owner_ref === inst1.instanceId) &&
        db.mesa_tokens.some((t) => t.owner_ref === inst2.instanceId),
      "T9a: instanciar duas cópias cria instanceIds, tokens e modalidades distintas"
    );

    OS.updateSceneCreatureStats(inst1.instanceId, { isCriatura: false, defesa: "19" });
    OS.openSceneCreatureFullSheet(inst1.instanceId);
    OS.$("defesa").value = "20";
    OS.$("defesa").dispatchEvent(new Event("input", { bubbles: true }));
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const inst1After = OS.getSceneCreatureById(inst1.instanceId);
    const inst2After = OS.getSceneCreatureById(inst2.instanceId);
    const mesaNpcAfter = OS.getMesaNpcById(npcMesaPistonete.mesaNpcId);
    const catalogRowAfter = db.fichas.find((r) => r.id === rowPistonete.id);

    check(
      inst1After.operationalMode === "full_sheet" &&
        inst1After.isCriatura === false &&
        inst1After.data.defesa === "20" &&
        inst2After.operationalMode === "creature_mode" &&
        inst2After.isCriatura === true &&
        inst2After.data.defesa === "14" &&
        mesaNpcAfter.operationalMode === "creature_mode" &&
        mesaNpcAfter.data.defesa === "14" &&
        catalogRowAfter.dados.operationalMode === "creature_mode" &&
        catalogRowAfter.dados.defesa === "14",
      "T9b: alterar instância #1 preserva #2, cópia da mesa e ficha original do catálogo"
    );
    OS.renderMesaSceneCards();
    const sceneBadges = Array.from(document.querySelectorAll("#mesa-em-cena-list .mesa-mode-badge")).map((el) => el.textContent);
    check(
      sceneBadges.includes("Ficha Completa") && sceneBadges.includes("Modo Criatura"),
      "T9c: cartões Em Cena exibem badges independentes para #1 e #2"
    );

    /* ─── 10. Sem regressões: jogador, monstro oficial, Veterano oficial e Turn Tracker ─── */
    OS.clearForm();
    OS.setFreeEditMode(false);
    OS.applyState({
      nome: "Clara Jogadora",
      tipo_ficha: "jogador",
      freeEdit: false,
      nivel: "3",
      defesa: "13",
      "config-6b": "4d6",
      "chamber-0": "5",
      "chamber-1": "4",
      "chamber-2": "3",
      "chamber-3": "6",
      "rem-total": "8"
    });
    const playerCollected = OS.collectState();
    check(
      OS.freeEdit === false &&
        OS.$("criatura-toggle-wrap").hidden === true &&
        playerCollected.isCriatura === undefined &&
        playerCollected["is-criatura"] === undefined &&
        playerCollected.operationalMode === undefined &&
        playerCollected.tipo_ficha === "jogador",
      "T10a: ficha de jogador mantém Criatura oculta e não injeta operationalMode"
    );

    const officialMonster = OS.getOfficialBestiaryEntry("inebriados");
    const officialVeteran = OS.getOfficialBestiaryEntry("jebediah_jeb_cale");
    const mesaIneb = await OS.addBestiarioEntryToMesa(officialMonster);
    const mesaJeb = await OS.addBestiarioEntryToMesa(officialVeteran);
    const resIneb = await OS.addNpcMesaToScene(mesaIneb.mesaNpcId);
    const resJeb = await OS.addNpcMesaToScene(mesaJeb.mesaNpcId);
    const instIneb = resIneb && resIneb.instance;
    const instJeb = resJeb && resJeb.instance;

    const opIneb = OS.resolveCombatantOperationalInfo(instIneb);
    const opJeb = OS.resolveCombatantOperationalInfo(instJeb);
    check(
      opIneb.kind === "bestiary_monster" &&
        opIneb.operationalMode === "creature_mode" &&
        opIneb.isOfficialMonster === true &&
        opJeb.kind === "npc_veteran" &&
        opJeb.isVeterano === true &&
        OS.getCombatTokenMode({ owner_type: "creature", owner_ref: instIneb.instanceId }) === "cascata" &&
        OS.getCombatTokenMode({ owner_type: "creature", owner_ref: instJeb.instanceId }) === "ficha" &&
        OS.getCombatTokenMode({ owner_type: "player", owner_ref: "p1" }) === "ficha",
      "T10b: monstro oficial, Veterano oficial e Turn Tracker (getCombatTokenMode) sem regressões"
    );

    /* ─── 11. Controle de acesso e não dependência de owner_type === 'creature' ─── */
    const opTokenOnly = OS.resolveCombatantOperationalInfo({ owner_type: "creature", owner_ref: "nao-existe" });
    check(
      opTokenOnly.operationalMode === null && opTokenOnly.isExplicit === false,
      "T11a: owner_type='creature' isolado não define modo operationalMode"
    );

    const inst2BeforeAuth = inst2After.operationalMode;
    const npcBeforeAuth = mesaNpcAfter.operationalMode;
    const fichasCountBeforeAuth = db.fichas.length;

    OS.activeMesaState.isMestre = false;
    OS.openSheetInGmWorkspace(clone(inst2After.data), { mode: "scene", instanceId: inst2After.instanceId });
    check(!OS.activeMesaState.gmEditingSheet, "T11b: jogador não abre editor GM");
    const deniedSaveCustom = await OS.saveCustomNpcToSupabase({ nome: "Intruso" }, null, "npc");
    OS.updateSceneCreatureStats(inst2After.instanceId, { isCriatura: false });
    OS.updateMesaNpcStats(mesaNpcAfter.mesaNpcId, { isCriatura: false });
    const deniedRemove = await OS.removeMesaNpc(mesaNpcAfter.mesaNpcId);

    // Mesmo se gmEditingSheet estivesse aberto antes, saveActiveGmEditedSheet deve bloquear quando !isMestre
    OS.activeMesaState.gmEditingSheet = { mode: "mesa-npc", mesaNpcId: mesaNpcAfter.mesaNpcId };
    const deniedGmSave = await OS.saveActiveGmEditedSheet({ nome: "Forçado", isCriatura: false });
    OS.activeMesaState.gmEditingSheet = null;

    // Também verifica bloqueio de toggle em readOnlyMode e jogador em setCriaturaMode
    OS.setFreeEditMode(true);
    OS.isCriatura = true;
    const deniedToggleAsPlayer = OS.setCriaturaMode(false);
    OS.activeMesaState.isMestre = true;
    if (OS.setReadOnlyMode) OS.setReadOnlyMode(true);
    const deniedToggleReadOnly = OS.setCriaturaMode(false);
    if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
    OS.setFreeEditMode(false);

    check(
      deniedSaveCustom === null &&
        db.fichas.length === fichasCountBeforeAuth &&
        OS.getSceneCreatureById(inst2After.instanceId).operationalMode === inst2BeforeAuth &&
        OS.getMesaNpcById(mesaNpcAfter.mesaNpcId).operationalMode === npcBeforeAuth &&
        deniedRemove == null &&
        deniedGmSave === null &&
        deniedToggleAsPlayer === true &&
        deniedToggleReadOnly === true,
      "T11c: bloqueio de edição para não-Mestre e modo somente leitura preserva dados"
    );

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
      path.join(temp, "com03-com04.png")
    );
    console.log(result);
    if (!result.startsWith("PASS:")) process.exitCode = 1;
    console.log("Screenshot: " + path.join(temp, "com03-com04.png"));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
