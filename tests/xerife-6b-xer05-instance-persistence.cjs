const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "os-xer05-instance-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const test = async () => {
  const results = [];
  const check = (cond, label, detail) => {
    if (!cond) throw new Error(label + (detail ? " :: " + detail : ""));
    results.push(label);
  };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  try {
    try { localStorage.clear(); } catch {}

    const modules = [
      "config", "state", "ui", "dice", "modal", "cylinder", "skills", "combat",
      "storage", "equipment", "equipCatalog", "gameData", "catalogModal",
      "inventoryUI", "magiasUI", "characterManager", "homeScreen", "mesaScreen",
      "mesaMaps", "turnTracker", "mesaTokenStatus", "mesaDeliveries", "mesaNotes",
      "mesaXerife6B"
    ];
    for (const name of modules) {
      await import("/js/" + name + ".js");
    }

    const OS = window.OS;
    check(!!OS, "OS inicializado");
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
    const roomA = "00000000-0000-4000-8000-0000000000a1";
    const roomB = "00000000-0000-4000-8000-0000000000b2";
    const map1 = "00000000-0000-4000-8000-000000000011";
    const map2 = "00000000-0000-4000-8000-000000000022";

    // Banco autoritativo simulado para validar o protocolo completo RPC + Realtime
    const db = {
      mesas: [
        {
          id: roomA,
          nome: "Mesa A (XER-05)",
          mestre_id: gmId,
          codigo_convite: "XER05A",
          npcs_mesa: [],
          cena_ativa: [],
          combate_ativo: { ativo: false },
          mapas: [
            { id: map1, nome: "Saloon", ordem: 1, grid_cols: 20 },
            { id: map2, nome: "Mina", ordem: 2, grid_cols: 20 }
          ],
          mapa_ativo_jogadores_id: map1
        }
      ],
      fichas: [],
      mesa_tokens: [],
      mesa_6b_instancia: {},
      mesa_6b_xerife: {
        aberto: { mesa_id: roomA, tipo: "aberto", versao: 1, dados: [6, 6, 6, 6, 6, 6], resultados: [6, 5, 4, 3, 2, 1], usados: [] },
        secreto: { mesa_id: roomA, tipo: "secreto", versao: 1, dados: [8, 8], resultados: [7, 6], usados: [] }
      }
    };

    const channels = [];
    const matchRow = (row, filters) =>
      filters.every((f) => {
        if (f.type === "eq") return String(row[f.col] ?? "") === String(f.val ?? "");
        if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        return true;
      });

    const client = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "jwt-gm", user: { id: gmId } } }, error: null }),
        getUser: async () => ({ data: { user: { id: gmId } }, error: null })
      },
      realtime: { setAuth: async () => {} },
      from(table) {
        const filters = [];
        let op = "select";
        let payload = null;
        let isSingle = false;
        const q = {
          select() { return q; },
          insert(d) { op = "insert"; payload = d; return q; },
          update(d) { op = "update"; payload = d; return q; },
          delete() { op = "delete"; return q; },
          eq(col, val) { filters.push({ type: "eq", col, val }); return q; },
          is(col, val) { filters.push({ type: "is", col, val }); return q; },
          order() { return q; },
          limit() { return q; },
          single() { isSingle = true; return q; },
          maybeSingle() { isSingle = true; return q; },
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
            }
            if (isSingle) return resolve({ data: out[0] || null, error: out.length ? null : { message: "Not found" } });
            return resolve({ data: out, error: null });
          }
        };
        return q;
      },
      channel(name) {
        const ch = {
          topic: name,
          handlers: [],
          on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
          subscribe(cb) { ch.onStatus = cb; if (cb) setTimeout(() => cb("SUBSCRIBED"), 5); return ch; }
        };
        channels.push(ch);
        return ch;
      },
      removeChannel: async () => {},
      rpc: async (name, args) => {
        if (name === "ler_6b_xerife") {
          return { data: clone(db.mesa_6b_xerife[args.p_tipo] || null), error: null };
        }
        if (name === "inicializar_6b_instancia") {
          const key = args.p_mesa + ":" + args.p_instance;
          if (!db.mesa_6b_instancia[key]) {
            db.mesa_6b_instancia[key] = OS.createOwn6BInstanceStateContract(
              { schemaVersion: 1, enabled: true, totalDice: args.p_dados.length, diceSides: args.p_dados },
              {
                mesaId: args.p_mesa,
                mapaId: args.p_mapa,
                instanceId: args.p_instance,
                tokenId: args.p_token,
                sourceId: args.p_source_id,
                sourceType: args.p_source_type,
                fadiga: args.p_fadiga || 0
              }
            );
          }
          return { data: clone(db.mesa_6b_instancia[key]), error: null };
        }
        if (name === "ler_6b_instancia") {
          if (args.p_instance) {
            const key = args.p_mesa + ":" + args.p_instance;
            return { data: clone(db.mesa_6b_instancia[key] || null), error: null };
          }
          const list = Object.values(db.mesa_6b_instancia)
            .filter((s) => s.mesaId === args.p_mesa)
            .map(clone);
          return { data: list, error: null };
        }
        if (name === "remover_6b_instancia") {
          const key = args.p_mesa + ":" + args.p_instance;
          delete db.mesa_6b_instancia[key];
          return { data: true, error: null };
        }
        if (["rolar_6b_instancia", "consumir_6b_instancia", "aplicar_dano_6b_instancia", "ajustar_fadiga_6b_instancia", "renovar_6b_instancia"].includes(name)) {
          const key = args.p_mesa + ":" + args.p_instance;
          const cur = db.mesa_6b_instancia[key];
          if (!cur) return { data: null, error: { code: "55000", message: "Not found" } };
          let cmd = null;
          if (name === "rolar_6b_instancia") {
            cmd = { type: "ROLL_INITIAL", expectedVersion: args.p_versao, opId: args.p_op_id, rolls: cur.dados.map((d) => d) };
          } else if (name === "consumir_6b_instancia") {
            cmd = { type: "CONSUME", expectedVersion: args.p_versao, opId: args.p_op_id, indices: args.p_indices };
          } else if (name === "aplicar_dano_6b_instancia") {
            cmd = { type: "APPLY_DAMAGE", expectedVersion: args.p_versao, opId: args.p_op_id, damagePoints: args.p_dano, chosenIndices: args.p_indices_escolhidos };
          } else if (name === "ajustar_fadiga_6b_instancia") {
            cmd = { type: "SET_FATIGUE", expectedVersion: args.p_versao, opId: args.p_op_id, fatigue: args.p_nova_fadiga };
          } else if (name === "renovar_6b_instancia") {
            cmd = { type: "RENEW", expectedVersion: args.p_versao, opId: args.p_op_id, rolls: cur.dados.map((d) => d), applyFatigue: args.p_aplicar_fadiga };
          }
          const proj = OS.validateAndProjectOwn6BInstanceCommand(cur, cmd);
          if (!proj.ok) {
            return { data: null, error: { code: proj.errorCode, reason: proj.reason, message: proj.reason } };
          }
          db.mesa_6b_instancia[key] = clone(proj.state);
          return {
            data: Object.assign(clone(proj.state), {
              idempotentReplay: !!proj.idempotentReplay,
              consumedIndices: proj.consumedIndices || [],
              consumedValues: proj.consumedValues || [],
              consumedBonus: proj.consumedBonus || 0
            }),
            error: null
          };
        }
        return { data: [], error: null };
      }
    };

    OS.getSupabaseClient = () => client;
    OS.authSession = { userId: gmId, email: "gm@darkwest.local", username: "Xerife" };

    Object.assign(OS.activeMesaState, {
      mesaId: roomA,
      activeMapId: map1,
      isMestre: true,
      currentUserId: gmId,
      mesa: db.mesas[0],
      npcsMesa: [],
      sceneCreatures: [],
      playerSheets: [],
      mesaTokens: [],
      instance6BStates: {},
      instance6BSelected: {},
      instance6BFeedback: {},
      instance6BBusy: {}
    });

    await OS.loadOfficialBestiary();
    await OS.loadCustomNpcs();
    await OS.initXerife6B();
    OS.subscribeMesaRealtimeChannel(roomA, { isReconnect: false });

    /* ─── 1 & 9: Criar molde de Boss com 15 dados e verificar que molde guarda só configuração ─── */
    OS.startCreateCustomNpc();
    OS.$("nome").value = "Boss Colosso";
    OS.$("defesa").value = "17";
    OS.$("iniciativa").value = "20";
    OS.setOwn6BComposition({ d4: 1, d6: 2, d8: 4, d10: 4, d12: 4 });
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    await OS.loadCustomNpcs();
    const bossTemplate = OS.bestiaryCatalog.custom.find((e) => e.name === "Boss Colosso");
    const mesaBoss = await OS.addBestiarioEntryToMesa(bossTemplate);

    check(
      !!bossTemplate &&
        bossTemplate.data.own6B.totalDice === 15 &&
        !("own6BInstance" in bossTemplate.data) &&
        !("own6BInstance" in mesaBoss.data),
      "XER05-1: molde no catálogo e em npcs_mesa mantém apenas a configuração de 15 dados sem estado de instância"
    );

    /* ─── 2 & 3: Dois Bosses do mesmo molde em cena com identidades e estados independentes ─── */
    const spawn1 = await OS.addNpcMesaToScene(mesaBoss.mesaNpcId);
    const spawn2 = await OS.addNpcMesaToScene(mesaBoss.mesaNpcId);
    const boss1 = spawn1.instance;
    const boss2 = spawn2.instance;

    const st1Initial = OS.getInstanceOwn6BState(boss1.instanceId);
    const st2Initial = OS.getInstanceOwn6BState(boss2.instanceId);

    check(
      boss1.instanceId !== boss2.instanceId &&
        boss1.name === "Boss Colosso #1" &&
        boss2.name === "Boss Colosso #2" &&
        st1Initial.dados.length === 15 &&
        st2Initial.dados.length === 15 &&
        st1Initial.versao === 0 &&
        st2Initial.versao === 0,
      "XER05-2: dois Bosses do mesmo molde recebem instanceIds distintos e 15 dados cada"
    );

    // Rolar, consumir, aplicar dano e fadiga apenas no Boss #1
    await OS.rollInstanceOwn6B(boss1.instanceId, { opId: "roll-b1" });
    await OS.consumeInstanceOwn6B(boss1.instanceId, [0, 1], { opId: "cons-b1" });
    await OS.applyDamageInstanceOwn6B(boss1.instanceId, 2, [2, 3], { opId: "dmg-b1" });
    await OS.setFatigueInstanceOwn6B(boss1.instanceId, 2, { opId: "fat-b1" });

    const st1After = OS.getInstanceOwn6BState(boss1.instanceId);
    const st2After = OS.getInstanceOwn6BState(boss2.instanceId);

    check(
      st1After.versao === 4 &&
        st1After.consumidos.join(",") === "0,1" &&
        st1After.bloqueados.join(",") === "2,3" &&
        st1After.fadiga === 2 &&
        st2After.versao === 0 &&
        st2After.resultados.length === 0 &&
        st2After.consumidos.length === 0 &&
        st2After.bloqueados.length === 0 &&
        st2After.fadiga === 0,
      "XER05-3: consumo, resultados, bloqueios e fadiga pertencem exclusivamente ao Boss #1 sem afetar Boss #2"
    );

    /* ─── 4: Edição do molde não sobrescreve instâncias vivas em cena ─── */
    await OS.editSelectedBestiarioEntry(bossTemplate);
    OS.setOwn6BComposition("6d6");
    await OS.saveActiveGmEditedSheet();
    await OS.closeMesaSheetEditor();

    const st1AfterTemplateEdit = OS.getInstanceOwn6BState(boss1.instanceId);
    check(
      st1AfterTemplateEdit.dados.length === 15 &&
        st1AfterTemplateEdit.versao === 4 &&
        st1AfterTemplateEdit.consumidos.join(",") === "0,1" &&
        st1AfterTemplateEdit.bloqueados.join(",") === "2,3",
      "XER05-4: editar o molde para 6d6 não sobrescreve o estado vivo de 15 dados do Boss #1 em cena"
    );

    /* ─── 5: Reconexão recupera o estado autoritativo ─── */
    // Simular perda/corrupção do cache em memória antes de reconectar
    OS.activeMesaState.instance6BStates = {};
    boss1.data["chamber-0"] = "0";
    await OS.refreshInstanceOwn6B();
    const st1Reconnected = OS.getInstanceOwn6BState(boss1.instanceId);

    check(
      !!st1Reconnected &&
        st1Reconnected.versao === 4 &&
        st1Reconnected.consumidos.join(",") === "0,1" &&
        st1Reconnected.bloqueados.join(",") === "2,3" &&
        st1Reconnected.fadiga === 2 &&
        boss1.data.damagedChambers.join(",") === "2,3",
      "XER05-5: reconexão (refreshInstanceOwn6B) recupera o estado autoritativo completo do servidor"
    );

    /* ─── 6: Duas sessões simultâneas e Isolamento entre mesas ─── */
    // Simular evento Realtime vindo de outra sessão do Mestre na mesma mesa (roomA) para Boss #2
    const remoteBoss2State = Object.assign(clone(st2After), {
      versao: 1,
      resultadosOriginais: st2After.dados.slice(),
      resultados: st2After.dados.slice(),
      usados: []
    });
    db.mesa_6b_instancia[roomA + ":" + boss2.instanceId] = clone(remoteBoss2State);
    OS.handleRealtimeInstance6BChange({ new: remoteBoss2State });

    // Simular evento Realtime de OUTRA mesa (roomB) tentando poluir Boss #1
    const foreignPayload = Object.assign(clone(st1Reconnected), {
      mesaId: roomB,
      versao: 99,
      fadiga: 39
    });
    OS.handleRealtimeInstance6BChange({ new: foreignPayload });

    const st2Synced = OS.getInstanceOwn6BState(boss2.instanceId);
    const st1Protected = OS.getInstanceOwn6BState(boss1.instanceId);
    check(
      st2Synced.versao === 1 &&
        st2Synced.resultados.length === 15 &&
        st1Protected.versao === 4 &&
        st1Protected.fadiga === 2,
      "XER05-6: sincroniza evento Realtime da própria mesa (2ª sessão) e bloqueia eventos de outra mesa"
    );

    /* ─── 7: Mudança de mapa preserva identidade e estado da instância ─── */
    OS.activeMesaState.activeMapId = map2;
    const tokBoss1 = db.mesa_tokens.find((t) => t.owner_ref === boss1.instanceId);
    tokBoss1.mapa_id = map2;
    OS.activeMesaState.mesaTokens = [clone(tokBoss1)];
    const st1OnMap2 = OS.ensureInstanceOwn6BState(boss1);
    check(
      st1OnMap2.instanceId === boss1.instanceId &&
        st1OnMap2.mapaId === map2 &&
        st1OnMap2.versao === 4 &&
        st1OnMap2.bloqueados.join(",") === "2,3",
      "XER05-7: mudança de mapa atualiza vínculo de mapa preservando identidade e estado do 6B"
    );

    /* ─── 8: Exclusão de token remove apenas a instância excluída sem afetar Boss #2 ou molde ─── */
    OS.activeMesaState.activeMapId = map2;
    const removed1 = await OS.removeCreatureFromScene(boss1.instanceId, tokBoss1.id);
    const st1Deleted = OS.getInstanceOwn6BState(boss1.instanceId);
    const st2StillAlive = OS.getInstanceOwn6BState(boss2.instanceId);
    const mesaNpcStillIntact = OS.getMesaNpcById(mesaBoss.mesaNpcId);

    check(
      removed1 === true &&
        st1Deleted === null &&
        !!st2StillAlive &&
        st2StillAlive.versao === 1 &&
        st2StillAlive.dados.length === 15 &&
        !!mesaNpcStillIntact &&
        mesaNpcStillIntact.data.own6B.totalDice === 15,
      "XER05-8: excluir token do Boss #1 limpa apenas Boss #1, preservando Boss #2 e o molde"
    );

    /* ─── 9 & 10: Preservação do 6B compartilhado do Xerife e retrocompatibilidade ─── */
    const xerifeSnap = OS.getXerife6BSnapshot("aberto");
    const legacyCreature = OS.addCreatureToScene({
      id: "leg-bandido",
      name: "Bandido Legado",
      sourceType: "custom",
      data: { nome: "Bandido Legado", defesa: "11", "config-6b": "2d6", freeEdit: true }
    });
    const xerifeForLegacy = OS.getXerife6BForNpc(legacyCreature.instanceId);
    const xerifeForBoss2 = OS.getXerife6BForNpc(boss2.instanceId);

    check(
      !!xerifeSnap &&
        xerifeSnap.resultados.join(",") === "6,5,4,3,2,1" &&
        !!xerifeForLegacy &&
        xerifeForBoss2 === null,
      "XER05-9/10: 6B compartilhado do Xerife e NPCs legados continuam funcionando sem interferência"
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
      path.join(temp, "xerife-6b-xer05-instance-persistence.png")
    );
    console.log(result);
    if (!result.startsWith("PASS:")) process.exitCode = 1;
    console.log("Screenshot: " + path.join(temp, "xerife-6b-xer05-instance-persistence.png"));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
