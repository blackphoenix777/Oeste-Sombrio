const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "os-xer06-combat-"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const test = async () => {
  const results = [];
  const check = (cond, label, detail) => {
    if (!cond) throw new Error(label + (detail ? " :: " + detail : ""));
    results.push(label);
  };

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
    const own6BRules = await import("/js/rules/own6BRules.js");

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

    /* ─── 1. Regra Oficial de Fadiga em Cascata ─── */
    const cascade1 = own6BRules.applyFatigueCascadeToInstanceRoll([6, 4, 2, 5, 1, 3], [], 1);
    check(
      JSON.stringify(cascade1.values) === JSON.stringify([5, 4, 2, 5, 1, 3]) &&
        cascade1.zeroedByFatigue.length === 0,
      "XER06-1a: Fadiga 1 reduz em 1 apenas o maior dado disponível (6 -> 5)"
    );

    const cascadeTie = own6BRules.applyFatigueCascadeToInstanceRoll([5, 5, 2], [], 1);
    check(
      JSON.stringify(cascadeTie.values) === JSON.stringify([4, 5, 2]),
      "XER06-1b: Empate no maior valor desempata na ordem horária (índice 0 reduzido primeiro)"
    );

    const cascadeSpillover = own6BRules.applyFatigueCascadeToInstanceRoll([2, 1, 0], [2], 3);
    check(
      JSON.stringify(cascadeSpillover.values) === JSON.stringify([0, 0, 0]) &&
        JSON.stringify(cascadeSpillover.zeroedByFatigue) === JSON.stringify([0, 1]) &&
        !cascadeSpillover.zeroedByFatigue.includes(2),
      "XER06-1c: Transbordo zera dados intactos em cascata e registra zeradosPorFadiga separado de bloqueados"
    );

    /* ─── 2. Rolagem Inicial, Consumo Válido e Bloqueio de Consumo Inválido ─── */
    const gmId = "00000000-0000-4000-8000-000000000001";
    const playerId = "00000000-0000-4000-8000-000000000099";
    const mesaId = "11111111-1111-4111-8111-111111111111";
    const map1 = "00000000-0000-4000-8000-000000000011";

    OS.getSupabaseClient = () => null;
    OS.authSession = { userId: gmId, email: "gm@xer06.local" };

    OS.activeMesaState = {
      mesaId: mesaId,
      isMestre: true,
      currentUserId: gmId,
      activeMapId: map1,
      mesaRow: { id: mesaId, mestre_id: gmId, nome: "Mesa XER-06" },
      npcsMesa: [],
      sceneCreatures: [],
      mesaTokens: [],
      tokenStatus: {},
      instance6BStates: {},
      instance6BSelected: {},
      instance6BFeedback: {},
      instance6BBusy: {}
    };

    const bossTemplateData = {
      nome: "Matriarca Abissal",
      defesa: "16",
      hasOwn6B: true,
      "config-6b": "1d4 + 1d6 + 1d8 + 1d10 + 1d12",
      own6B: {
        schemaVersion: 1,
        enabled: true,
        poolSource: "own_6b",
        totalDice: 5,
        counts: { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1 },
        compactCounts: { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1 },
        diceTypes: ["d12", "d10", "d8", "d6", "d4"],
        diceSides: [12, 10, 8, 6, 4],
        formatted: "1d4 + 1d6 + 1d8 + 1d10 + 1d12"
      },
      freeEdit: true
    };

    const bossA = OS.addCreatureToScene({
      id: "tpl_boss_1",
      name: "Matriarca Abissal",
      sourceType: "custom",
      data: JSON.parse(JSON.stringify(bossTemplateData))
    });
    const bossB = OS.addCreatureToScene({
      id: "tpl_boss_1",
      name: "Matriarca Abissal",
      sourceType: "custom",
      data: JSON.parse(JSON.stringify(bossTemplateData))
    });

    const bossAId = bossA.instanceId;
    const bossBId = bossB.instanceId;

    const rollA1 = await OS.rollInstanceOwn6B(bossAId, {
      opId: "op-roll-a1",
      rolls: [11, 9, 7, 5, 3]
    });
    check(
      rollA1.ok === true &&
        JSON.stringify(rollA1.state.resultados) === JSON.stringify([11, 9, 7, 5, 3]),
      "XER06-2a: Rolagem inicial gera valores válidos por tipo de dado ([11, 9, 7, 5, 3])"
    );

    const secondRollA = await OS.rollInstanceOwn6B(bossAId, { opId: "op-roll-a2" });
    check(
      secondRollA.ok === false && secondRollA.errorCode === "0A000",
      "XER06-2b: Segunda rolagem inicial na mesma instância é rejeitada com 0A000"
    );

    const consumeA1 = await OS.consumeInstanceOwn6B(bossAId, [0, 2], { opId: "op-consume-a1" });
    check(
      consumeA1.ok === true &&
        consumeA1.consumedBonus === 18 &&
        JSON.stringify(consumeA1.state.consumidos) === JSON.stringify([0, 2]),
      "XER06-2c: Consumo válido de câmaras [0, 2] soma bônus 18 e marca [0, 2] como consumidos"
    );

    const dupConsumeA = await OS.consumeInstanceOwn6B(bossAId, [0], { opId: "op-consume-dup" });
    check(
      dupConsumeA.ok === false && dupConsumeA.errorCode === "22023",
      "XER06-2d: Consumo duplicado da câmara 0 já consumida é rejeitado com 22023"
    );

    /* ─── 3. Dano com Escolha do Defensor (Modal UI + Bloqueio de Dados) ─── */
    const openedModal = OS.openDefenderDamageModal(bossAId, 2);
    const modal = document.getElementById("defender-damage-modal");
    check(
      openedModal === true && !!modal && modal.classList.contains("open"),
      "XER06-3a: Modal #defender-damage-modal abre para escolha do defensor (2 pontos de dano)"
    );

    const choiceBtns = modal.querySelectorAll(".defender-die-choice-btn");
    check(
      choiceBtns.length === 5 && !choiceBtns[0].disabled && !choiceBtns[1].disabled,
      "XER06-3b: Modal exibe as 5 câmaras da criatura para escolha do defensor"
    );

    choiceBtns[1].click();
    choiceBtns[4].click();

    const confirmBtn = document.getElementById("defender-damage-confirm");
    const hintEl = document.getElementById("defender-damage-modal-hint");
    check(
      !!confirmBtn &&
        !confirmBtn.disabled &&
        !!hintEl &&
        hintEl.textContent.includes("2 / 2"),
      "XER06-3c: Seleção de 2 dados habilita botão de confirmação com contagem exata (2 / 2)"
    );

    const confirmRes = await OS.confirmDefenderDamageModal();
    const stateAfterDamage = OS.getInstanceOwn6BState(bossAId);
    check(
      !!confirmRes &&
        confirmRes.ok === true &&
        !modal.classList.contains("open") &&
        JSON.stringify(stateAfterDamage.bloqueados) === JSON.stringify([1, 4]) &&
        stateAfterDamage.resultados[1] === 0 &&
        stateAfterDamage.resultados[4] === 0,
      "XER06-3d: Confirmação do modal aplica dano físico nos dados escolhidos ([1, 4]) e zera seus resultados"
    );

    const dupDamage = await OS.applyDamageInstanceOwn6B(bossAId, 1, [1], { opId: "op-dmg-dup" });
    check(
      dupDamage.ok === false && dupDamage.errorCode === "22023",
      "XER06-3e: Tentativa de bloquear novamente o dado 1 já bloqueado por dano é rejeitada com 22023"
    );

    const consumeBlocked = await OS.consumeInstanceOwn6B(bossAId, [1], { opId: "op-consume-blocked" });
    check(
      consumeBlocked.ok === false && consumeBlocked.errorCode === "22023",
      "XER06-3f: Tentativa de consumir dado bloqueado por dano físico é rejeitada com 22023"
    );

    const stateBossB = OS.getInstanceOwn6BState(bossBId);
    check(
      stateBossB.bloqueados.length === 0 && stateBossB.consumidos.length === 0,
      "XER06-3g: Dano e consumo no Boss #1 não afetam o Boss #2"
    );

    /* ─── 4. Fadiga Automática em Cascata e Distinção entre Dano e Fadiga ─── */
    const fatRes = await OS.setFatigueInstanceOwn6B(bossAId, 11, { opId: "op-fat-11" });
    check(
      fatRes.ok === true &&
        fatRes.state.fadiga === 11 &&
        fatRes.state.resultados[0] === 0 &&
        fatRes.state.zeradosPorFadiga.includes(0) &&
        JSON.stringify(fatRes.state.bloqueados) === JSON.stringify([1, 4]),
      "XER06-4: Fadiga 11 zera o maior dado intacto (câmara 0: 11 -> 0) em zeradosPorFadiga sem alterar bloqueados ([1, 4])"
    );

    await OS.setFatigueInstanceOwn6B(bossAId, 0, { opId: "op-fat-0" });

    /* ─── 5. Renovação do Pool (Exige Esgotamento + Preserva Dano + Incrementa Fadiga) ─── */
    const earlyRenew = await OS.renewInstanceOwn6B(bossAId, { opId: "op-renew-early" });
    check(
      earlyRenew.ok === false && earlyRenew.errorCode === "55000",
      "XER06-5a: Renovação antes de esgotar todos os dados intactos disponíveis é bloqueada com 55000"
    );

    const consumeLast = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-consume-last" });
    check(
      consumeLast.ok === true && consumeLast.state.esgotado === true,
      "XER06-5b: Consumo do último dado disponível marca a instância como esgotada"
    );

    const renewOk = await OS.renewInstanceOwn6B(bossAId, {
      opId: "op-renew-ok",
      rolls: [10, 1, 8, 6, 1]
    });
    const origIntactSum =
      renewOk.state.resultadosOriginais[0] +
      renewOk.state.resultadosOriginais[2] +
      renewOk.state.resultadosOriginais[3];
    const effIntactSum =
      renewOk.state.resultados[0] +
      renewOk.state.resultados[2] +
      renewOk.state.resultados[3];

    check(
      renewOk.ok === true &&
        renewOk.state.fadiga === 1 &&
        JSON.stringify(renewOk.state.bloqueados) === JSON.stringify([1, 4]) &&
        renewOk.state.consumidos.length === 0 &&
        renewOk.state.resultados[1] === 0 &&
        renewOk.state.resultados[4] === 0 &&
        renewOk.state.resultadosOriginais[0] === 10 &&
        renewOk.state.resultados[0] === 9 &&
        origIntactSum - effIntactSum === 1,
      "XER06-5c: Renovação preserva bloqueados ([1, 4]), limpa consumidos, incrementa fadiga (+1) e desconta do maior dado intacto (10 -> 9)"
    );

    const dupRenew = await OS.renewInstanceOwn6B(bossAId, { opId: "op-renew-dup-new" });
    check(
      dupRenew.ok === false && dupRenew.errorCode === "55000",
      "XER06-5d: Segunda renovação consecutiva sem esgotar o novo pool é bloqueada com 55000"
    );

    /* ─── 6. Idempotência por opId e Retenção Limitada do Ledger (64 operações) ─── */
    const verBeforeReplay = OS.getInstanceOwn6BState(bossAId).versao;
    const replayRenew = await OS.renewInstanceOwn6B(bossAId, { opId: "op-renew-ok" });
    check(
      replayRenew.ok === true &&
        replayRenew.idempotentReplay === true &&
        replayRenew.state.versao === verBeforeReplay,
      "XER06-6a: Replay do mesmo opId ('op-renew-ok') retorna idempotentReplay: true sem incrementar versão"
    );

    let capState = OS.activeMesaState.instance6BStates[bossAId];
    for (let i = 0; i < 80; i++) {
      const res = own6BRules.validateAndProjectOwn6BInstanceCommand(capState, {
        type: "SET_FATIGUE",
        fatigue: i % 3,
        opId: `op-cap-${i}`,
        expectedVersion: capState.versao
      });
      capState = res.state;
    }
    check(
      capState.opOrder.length === own6BRules.MAX_OP_LEDGER_ENTRIES &&
        Object.keys(capState.opLedger).length === own6BRules.MAX_OP_LEDGER_ENTRIES &&
        !capState.opLedger["op-cap-0"] &&
        Boolean(capState.opLedger["op-cap-79"]),
      `XER06-6b: Ledger de idempotência respeita limite máximo de ${own6BRules.MAX_OP_LEDGER_ENTRIES} entradas`
    );

    /* ─── 7. Concorrência (40001), Permissão (42501), Visibilidade Secreta e Combate Simultâneo ─── */
    const staleRes = own6BRules.validateAndProjectOwn6BInstanceCommand(capState, {
      type: "SET_FATIGUE",
      fatigue: 1,
      opId: "op-stale-ver",
      expectedVersion: 1
    });
    check(
      staleRes.ok === false && staleRes.errorCode === "40001",
      "XER06-7a: Conflito de concorrência otimista retorna SQLSTATE 40001 (VERSION_CONFLICT)"
    );

    const rollB = await OS.rollInstanceOwn6B(bossBId, {
      opId: "op-roll-b1",
      rolls: [12, 10, 8, 6, 4]
    });
    const consumeB = await OS.consumeInstanceOwn6B(bossBId, [0, 1], { opId: "op-consume-b1" });
    check(
      rollB.ok === true &&
        consumeB.ok === true &&
        JSON.stringify(OS.getInstanceOwn6BState(bossBId).consumidos) === JSON.stringify([0, 1]) &&
        OS.getInstanceOwn6BState(bossAId).consumidos.length === 0,
      "XER06-7b: Dois Bosses atacando simultaneamente mantêm consumos, versões e pools independentes"
    );

    // Simular visão de jogador comum (não é mestre nem owner_user_id do token da criatura)
    OS.activeMesaState.isMestre = false;
    OS.activeMesaState.currentUserId = playerId;

    const secretReadByPlayer = OS.getInstanceOwn6BState(bossAId);
    check(
      secretReadByPlayer === null,
      "XER06-7c: Jogador comum não consegue ler o estado 6B de Boss secreto via OS.getInstanceOwn6BState"
    );

    const unauthorizedConsume = await OS.consumeInstanceOwn6B(bossAId, [0], { opId: "op-unauth-1" });
    check(
      unauthorizedConsume.ok === false && unauthorizedConsume.errorCode === "42501",
      "XER06-7d: Jogador comum tentando consumir 6B de Boss sem permissão recebe erro 42501"
    );

    // Restaurar sessão do Mestre e testar reconexão durante operação
    OS.activeMesaState.isMestre = true;
    OS.activeMesaState.currentUserId = gmId;
    OS.getSupabaseClient = () => ({
      rpc: async (fnName, params) => {
        if (fnName === "ler_6b_instancia") {
          return {
            data: {
              instanceId: params.p_instance,
              mesaId: params.p_mesa,
              dados: [12, 10, 8, 6, 4],
              resultadosOriginais: [12, 10, 8, 6, 4],
              resultados: [11, 0, 8, 6, 0],
              consumidos: [2],
              bloqueados: [1, 4],
              zeradosPorFadiga: [],
              usados: [1, 2, 4],
              fadiga: 1,
              esgotado: false,
              versao: 25
            },
            error: null
          };
        }
        return { data: null, error: null };
      }
    });

    const reconnectedState = await OS.refreshInstanceOwn6B(bossAId);
    check(
      !!reconnectedState &&
        reconnectedState.versao === 25 &&
        JSON.stringify(reconnectedState.consumidos) === JSON.stringify([2]) &&
        JSON.stringify(reconnectedState.bloqueados) === JSON.stringify([1, 4]),
      "XER06-7e: Reconexão durante operação recupera estado autoritativo da instância (versao: 25)"
    );

    /* ─── 8. Conflito Otimista (PT409 / HTTP 409) e Timeout 504 no Frontend (Pacote 5.1) ─── */
    let remoteVersion = 25;
    let consumeCalls = 0;
    let refreshCalls = 0;
    let mockScenario = "pt409";
    OS.getSupabaseClient = () => ({
      rpc: async (fnName, params) => {
        if (fnName === "ler_6b_instancia") {
          refreshCalls += 1;
          return {
            data: {
              instanceId: params.p_instance,
              mesaId: params.p_mesa,
              dados: [12, 10, 8, 6, 4],
              resultadosOriginais: [12, 10, 8, 6, 4],
              resultados: [11, 0, 8, 6, 0],
              consumidos: [2],
              bloqueados: [1, 4],
              zeradosPorFadiga: [],
              usados: [1, 2, 4],
              fadiga: 1,
              esgotado: false,
              versao: remoteVersion
            },
            error: null
          };
        }
        if (fnName === "consumir_6b_instancia") {
          consumeCalls += 1;
          if (mockScenario === "pt409") {
            remoteVersion = 26;
            return {
              data: null,
              status: 409,
              error: {
                code: "PT409",
                message: "Conflito de versão: instância atualizada por outra ação.",
                details: "expected=25 actual=26"
              }
            };
          }
          if (mockScenario === "http409_no_code") {
            remoteVersion = 27;
            return {
              data: null,
              status: 409,
              error: {
                message: "Conflict"
              }
            };
          }
          if (mockScenario === "hist_40001") {
            return {
              data: null,
              error: {
                code: "40001",
                message: "Conflito de versão legado"
              }
            };
          }
          if (mockScenario === "hist_P0409") {
            return {
              data: null,
              error: {
                code: "P0409",
                message: "Conflito P0409 legado"
              }
            };
          }
          if (mockScenario === "http504") {
            remoteVersion = 28;
            return {
              data: null,
              status: 504,
              error: {
                message: "upstream request timeout"
              }
            };
          }
          if (mockScenario === "retry_ok") {
            remoteVersion = Number(params.p_versao_esperada || remoteVersion) + 1;
            return {
              data: {
                instanceId: params.p_instance,
                mesaId: params.p_mesa,
                dados: [12, 10, 8, 6, 4],
                resultadosOriginais: [12, 10, 8, 6, 4],
                resultados: [11, 0, 8, 0, 0],
                consumidos: [2, 3],
                bloqueados: [1, 4],
                zeradosPorFadiga: [],
                usados: [1, 2, 3, 4],
                fadiga: 1,
                esgotado: false,
                versao: remoteVersion
              },
              error: null
            };
          }
        }
        return { data: null, error: null };
      }
    });

    consumeCalls = 0;
    refreshCalls = 0;
    mockScenario = "pt409";
    const pt409Res = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-pt409-1" });
    check(
      pt409Res.ok === false &&
        pt409Res.isConflict === true &&
        pt409Res.isGatewayTimeout === false &&
        pt409Res.httpStatus === 409 &&
        pt409Res.errorCode === "PT409" &&
        consumeCalls === 1 &&
        refreshCalls === 1 &&
        OS.getInstanceOwn6BState(bossAId)?.versao === 26,
      "XER06-8a: PT409/HTTP 409 falha sem retry automático (1 RPC), recarrega estado autoritativo (versao 26)"
    );

    consumeCalls = 0;
    refreshCalls = 0;
    mockScenario = "http409_no_code";
    const http409NoCodeRes = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-http409-nocode" });
    check(
      http409NoCodeRes.ok === false &&
        http409NoCodeRes.isConflict === true &&
        http409NoCodeRes.isGatewayTimeout === false &&
        http409NoCodeRes.httpStatus === 409 &&
        consumeCalls === 1 &&
        refreshCalls === 1 &&
        OS.getInstanceOwn6BState(bossAId)?.versao === 27,
      "XER06-8b: HTTP 409 sem SQLSTATE explícito classifica como conflito e sincroniza versão (27)"
    );

    mockScenario = "hist_40001";
    const hist40001Res = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-40001" });
    mockScenario = "hist_P0409";
    const histP0409Res = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-P0409" });
    check(
      hist40001Res.isConflict === true &&
        hist40001Res.isGatewayTimeout === false &&
        histP0409Res.isConflict === true &&
        histP0409Res.isGatewayTimeout === false,
      "XER06-8c: Códigos históricos 40001 e P0409 seguem tratados como conflito para compatibilidade"
    );

    consumeCalls = 0;
    refreshCalls = 0;
    mockScenario = "http504";
    const timeoutRes = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-504" });
    check(
      timeoutRes.ok === false &&
        timeoutRes.isGatewayTimeout === true &&
        timeoutRes.isConflict === false &&
        timeoutRes.httpStatus === 504 &&
        consumeCalls === 1 &&
        refreshCalls === 1 &&
        OS.getInstanceOwn6BState(bossAId)?.versao === 28 &&
        timeoutRes.errorMessage !== pt409Res.errorMessage,
      "XER06-8d: HTTP 504 / upstream request timeout distingue-se de conflito, recarrega estado (versao 28) e não faz retry automático"
    );

    consumeCalls = 0;
    mockScenario = "retry_ok";
    const manualRetryRes = await OS.consumeInstanceOwn6B(bossAId, [3], { opId: "op-manual-retry" });
    check(
      manualRetryRes.ok === true &&
        consumeCalls === 1 &&
        manualRetryRes.state?.versao === 29 &&
        manualRetryRes.state?.consumidos.includes(3),
      "XER06-8e: Retry manual explícito após sincronização aplica a operação na versão atualizada (versao 29)"
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
      path.join(temp, "xerife-6b-xer06-instance-combat.png")
    );
    console.log(result);
    if (!result.startsWith("PASS:")) process.exitCode = 1;
    console.log("Screenshot: " + path.join(temp, "xerife-6b-xer06-instance-combat.png"));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
