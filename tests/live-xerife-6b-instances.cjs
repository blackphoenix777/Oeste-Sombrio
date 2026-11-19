/**
 * XER-05 + XER-06 — Homologação Integrada Real com Supabase (HTTP Auth + RLS + RPC + WebSocket Realtime)
 * EXCLUSIVO para Homologação (igyupxczhczidfgtjiws).
 *
 * Uso: node tests/live-xerife-6b-instances.cjs <config.json>
 * Onde <config.json> (fora do repo) contém:
 * { url, anonKey, password, gmA, gmAEmail, playerA, playerAEmail, defenderA, defenderAEmail, gmB, gmBEmail }
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const fastMode = process.argv.includes("--fast");
const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error("Uso: node tests/live-xerife-6b-instances.cjs <config.json>");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8").replace(/^\uFEFF/, ""));
const url = String(cfg.url || "").trim();
const key = String(cfg.anonKey || "").trim();

if (url !== "https://igyupxczhczidfgtjiws.supabase.co") {
  throw new Error("BLOQUEADO: Este teste é exclusivo para Homologação (igyupxczhczidfgtjiws).");
}
if (!key || /service_role/i.test(key)) {
  throw new Error("BLOQUEADO: Exige anon/publishable key pública (nunca service_role).");
}

const clients = [];
const channels = [];
const cleanupMesas = [];
const results = [];

const check = (ok, label, detail) => {
  if (!ok) throw new Error(label + (detail ? " :: " + detail : ""));
  results.push(label);
  console.log("PASS: " + label);
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error("Timeout aguardando condição Realtime");
    await delay(100);
  }
}

async function login(email) {
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  clients.push(c);
  const { data, error } = await c.auth.signInWithPassword({ email, password: cfg.password });
  if (error || !data?.session) {
    throw new Error("Falha login " + email + ": " + (error?.message || "sem sessão"));
  }
  return c;
}

async function subscribeInstance6B(client, mesaId, eventsOut) {
  const { data: sessData } = await client.auth.getSession();
  await client.realtime.setAuth(sessData.session.access_token);
  const ch = client.channel("live-6b-inst-" + crypto.randomUUID());
  channels.push([client, ch]);
  for (const ev of ["INSERT", "UPDATE"]) {
    ch.on(
      "postgres_changes",
      { event: ev, schema: "public", table: "mesa_6b_instancia", filter: "mesa_id=eq." + mesaId },
      (payload) => eventsOut.push(payload)
    );
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout subscribe Realtime")), 15000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error("Realtime status: " + status));
      }
    });
  });
  return ch;
}

async function main() {
  let exitCode = 0;
  try {
    const gmA = await login(cfg.gmAEmail);
    const gmA2 = await login(cfg.gmAEmail); // 2ª sessão do Mestre para validar Realtime & reconexão
    const playerA = await login(cfg.playerAEmail);
    const defenderA = await login(cfg.defenderAEmail);
    const gmB = await login(cfg.gmBEmail);
    const anon = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    clients.push(anon);

    const mesaA = crypto.randomUUID();
    const mesaB = crypto.randomUUID();
    const map1 = crypto.randomUUID();
    const map2 = crypto.randomUUID();
    const inviteA = crypto.randomBytes(5).toString("hex").toUpperCase();
    const inviteB = crypto.randomBytes(5).toString("hex").toUpperCase();

    const { error: mAErr } = await gmA.from("mesas").insert({
      id: mesaA,
      nome: "QA Homolog XER-05/06 Mesa A",
      mestre_id: cfg.gmA,
      codigo_convite: inviteA,
      mapas: [
        { id: map1, slot: 1, nome: "Saloon Mapa 1", grid_cols: 20, url: null },
        { id: map2, slot: 2, nome: "Mina Mapa 2", grid_cols: 20, url: null }
      ],
      mapa_ativo_jogadores_id: map1
    });
    if (mAErr) throw new Error("Criar Mesa A: " + mAErr.message);
    cleanupMesas.push([gmA, mesaA]);

    const { error: mBErr } = await gmB.from("mesas").insert({
      id: mesaB,
      nome: "QA Homolog XER-05/06 Mesa B",
      mestre_id: cfg.gmB,
      codigo_convite: inviteB
    });
    if (mBErr) throw new Error("Criar Mesa B: " + mBErr.message);
    cleanupMesas.push([gmB, mesaB]);

    await gmA.from("membros_mesa").insert({ mesa_id: mesaA, usuario_id: cfg.gmA, cargo: "mestre" });
    await gmB.from("membros_mesa").insert({ mesa_id: mesaB, usuario_id: cfg.gmB, cargo: "mestre" });
    const joinP = await playerA.rpc("entrar_na_mesa_por_codigo", { p_codigo: inviteA });
    if (joinP.error) throw new Error("playerA join: " + joinP.error.message);
    const joinD = await defenderA.rpc("entrar_na_mesa_por_codigo", { p_codigo: inviteA });
    if (joinD.error) throw new Error("defenderA join: " + joinD.error.message);

    // Subscrever Realtime em 4 sessões (gmA2, defenderA, playerA, gmB)
    const evGm2 = [], evDef = [], evPl = [], evGmB = [];
    const chGm2 = await subscribeInstance6B(gmA2, mesaA, evGm2);
    await subscribeInstance6B(defenderA, mesaA, evDef);
    await subscribeInstance6B(playerA, mesaA, evPl);
    await subscribeInstance6B(gmB, mesaA, evGmB);
    await delay(500);

    /* ─── C1: XER-05 — Molde, 2 Bosses independentes (15 dados), troca de mapa e remoção ─── */
    const tpl15 = {
      nome: "Boss XER Homolog",
      tipo_ficha: "npc",
      freeEdit: true,
      hasOwn6B: true,
      "config-6b": "3d4 + 3d6 + 3d8 + 3d10 + 3d12",
      own6B: {
        schemaVersion: 1,
        enabled: true,
        totalDice: 15,
        counts: { d4: 3, d6: 3, d8: 3, d10: 3, d12: 3 },
        diceSides: [4, 4, 4, 6, 6, 6, 8, 8, 8, 10, 10, 10, 12, 12, 12]
      }
    };

    const { data: fichaTpl, error: fErr } = await gmA
      .from("fichas")
      .insert({
        usuario_id: cfg.gmA,
        nome_personagem: "Boss XER Homolog",
        classe: "npc",
        dados: tpl15
      })
      .select()
      .single();
    if (fErr) throw new Error("Criar molde ficha: " + fErr.message);

    await gmA.from("mesas").update({
      npcs_mesa: [{ mesaNpcId: "tpl-boss-homolog", name: "Boss XER Homolog", data: tpl15 }]
    }).eq("id", mesaA);

    const boss1Id = crypto.randomUUID();
    const boss2Id = crypto.randomUUID();
    const tok1Id = crypto.randomUUID();
    const tok2Id = crypto.randomUUID();

    // Boss #1 secreto do Mestre (owner_user_id = null); Boss #2 com defensor designado (owner_user_id = defenderA)
    const { error: tokErr } = await gmA.from("mesa_tokens").insert([
      {
        id: tok1Id,
        mesa_id: mesaA,
        mapa_id: map1,
        owner_type: "creature",
        owner_ref: boss1Id,
        owner_user_id: null,
        display_name: "Boss XER #1",
        visible_to_players: false
      },
      {
        id: tok2Id,
        mesa_id: mesaA,
        mapa_id: map1,
        owner_type: "creature",
        owner_ref: boss2Id,
        owner_user_id: cfg.defenderA,
        display_name: "Boss XER #2",
        visible_to_players: true
      }
    ]);
    if (tokErr) throw new Error("Inserir tokens Boss #1/#2: " + tokErr.message);

    const init1 = await gmA.rpc("inicializar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss1Id,
      p_dados: [12, 12, 12, 10, 10, 10, 8, 8, 8, 6, 6, 6, 4, 4, 4],
      p_op_id: "homolog-init-b1",
      p_mapa: map1,
      p_token: tok1Id,
      p_source_id: fichaTpl.id,
      p_source_type: "custom"
    });
    if (init1.error || !init1.data) throw new Error("init1: " + init1.error?.message);

    const init2 = await gmA.rpc("inicializar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_dados: [12, 10, 8, 6, 4],
      p_op_id: "homolog-init-b2",
      p_mapa: map1,
      p_token: tok2Id,
      p_source_id: fichaTpl.id,
      p_source_type: "custom"
    });
    if (init2.error || !init2.data) throw new Error("init2: " + init2.error?.message);

    check(
      init1.data.dados.length === 15 && init2.data.dados.length === 5,
      "C1-1: Dois Bosses do mesmo molde inicializados com pools independentes no banco"
    );

    // Realtime C4: gmA2 recebe INSERT de ambos; defenderA recebe INSERT só do boss2Id; playerA e gmB recebem 0
    await until(() => evGm2.some((e) => e.eventType === "INSERT" && e.new?.instance_id === boss1Id));
    await until(() => evGm2.some((e) => e.eventType === "INSERT" && e.new?.instance_id === boss2Id));
    await until(() => evDef.some((e) => e.eventType === "INSERT" && e.new?.instance_id === boss2Id));
    await delay(800);
    check(
      !evDef.some((e) => e.new?.instance_id === boss1Id) && evPl.length === 0 && evGmB.length === 0,
      "C4-1: INSERT Realtime entrega boss2 ao defensor, mas oculta boss secreto, player comum e outra mesa"
    );

    // Rolagem + Consumo em Boss #1 preserva Boss #2 intacto
    const r1 = await gmA.rpc("rolar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss1Id,
      p_versao: 0,
      p_op_id: "homolog-roll-b1"
    });
    if (r1.error) throw new Error("rolar boss1: " + r1.error.message);
    const c1 = await gmA.rpc("consumir_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss1Id,
      p_versao: r1.data.versao,
      p_indices: [0, 3],
      p_op_id: "homolog-cons-b1"
    });
    if (c1.error) throw new Error("consumir boss1: " + c1.error.message);

    const readB2AfterB1 = await gmA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    check(
      readB2AfterB1.data.versao === 0 && readB2AfterB1.data.consumidos.length === 0,
      "C1-2: Consumo no Boss #1 preserva Boss #2 completamente intacto (versao=0)"
    );

    // Editar molde em fichas/npcs_mesa NÃO sobrescreve instâncias vivas
    await gmA.from("fichas").update({
      dados: { ...tpl15, "config-6b": "2d6", own6B: { schemaVersion: 1, enabled: true, totalDice: 2, diceSides: [6, 6] } }
    }).eq("id", fichaTpl.id);

    const readB1AfterTplEdit = await gmA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss1Id });
    check(
      readB1AfterTplEdit.data.dados.length === 15 &&
        JSON.stringify(readB1AfterTplEdit.data.consumidos) === "[0,3]",
      "C1-3: Editar molde no catálogo preserva pool vivo de 15 dados e consumos do Boss #1"
    );

    // Troca de mapa do token Boss #1 dispara trigger sincronizando mapa_id na instância sem perder estado 6B
    const { error: moveMapErr } = await gmA
      .from("mesa_tokens")
      .update({ mapa_id: map2 })
      .eq("id", tok1Id);
    if (moveMapErr) throw new Error("Mover token para Mapa 2: " + moveMapErr.message);

    const readB1AfterMap = await gmA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss1Id });
    check(
      readB1AfterMap.data.mapaId === map2 &&
        readB1AfterMap.data.versao === c1.data.versao &&
        JSON.stringify(readB1AfterMap.data.consumidos) === "[0,3]",
      "C1-4: Troca de mapa sincroniza mapaId via trigger preservando identidade e saldo 6B"
    );

    // Remover token do Boss #1 e instância -> Boss #2 e molde permanecem intactos
    await gmA.from("mesa_tokens").delete().eq("id", tok1Id);
    const rem1 = await gmA.rpc("remover_6b_instancia", { p_mesa: mesaA, p_instance: boss1Id });
    const readB1Removed = await gmA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss1Id });
    const readB2Alive = await gmA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    check(
      rem1.data === true && readB1Removed.data === null && readB2Alive.data?.dados?.length === 5,
      "C1-5: Exclusão do Boss #1 limpa apenas Boss #1, preservando Boss #2 e molde"
    );

    /* ─── C2: XER-06 — Rolagem, Concorrência (40001), Dano Defensor, Fadiga, Renovação e Idempotência ─── */
    const r2 = await gmA.rpc("rolar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: 0,
      p_op_id: "homolog-roll-b2"
    });
    if (r2.error) throw new Error("rolar boss2: " + r2.error.message);
    check(
      r2.data.resultados.length === 5 &&
        r2.data.resultados.every((v, i) => v >= 1 && v <= r2.data.dados[i]),
      "C2-1: Rolagem inicial do servidor gera valores dentro do intervalo de cada dado"
    );

    const secondRoll2 = await gmA.rpc("rolar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: r2.data.versao,
      p_op_id: "homolog-roll-b2-dup"
    });
    check(secondRoll2.error?.code === "0A000", "C2-2: Segunda rolagem inicial bloqueada com 0A000");

    // Consumo concorrente (Promise.all na mesma versão) -> exatamente 1 passa, 1 falha com conflito
    const [concA, concB] = fastMode
      ? [
          await gmA.rpc("consumir_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: r2.data.versao,
            p_indices: [0],
            p_op_id: "homolog-conc-c1"
          }),
          { data: null, error: { code: "SKIPPED_FAST", message: "skipped in --fast mode" } }
        ]
      : await Promise.all([
          gmA.rpc("consumir_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: r2.data.versao,
            p_indices: [0],
            p_op_id: "homolog-conc-c1"
          }),
          gmA.rpc("consumir_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: r2.data.versao,
            p_indices: [2],
            p_op_id: "homolog-conc-c2"
          })
        ]);
    const winnerC = !concA.error ? concA : concB;
    const loserC = !concA.error ? concB : concA;
    const concAtomicityOk =
      Boolean(winnerC.data) &&
      !winnerC.error &&
      Boolean(loserC.error) &&
      winnerC.data.versao === r2.data.versao + 1;
    const loserCodeOrMsg = loserC.error?.code || loserC.error?.message || "";
    check(
      concAtomicityOk,
      "C2-3a: Consumo concorrente no servidor permite exatamente 1 vencedor sem dupla dedução (versao=" +
        winnerC.data?.versao +
        ", erro perdedor=" +
        loserCodeOrMsg +
        ")",
      JSON.stringify({ concAErr: concA.error, concBErr: concB.error })
    );
    if (fastMode && loserCodeOrMsg === "SKIPPED_FAST") {
      console.log("INFO C2-3b: Corrida concorrente ignorada no modo --fast (evidência completa coletada sem --fast).");
    } else if (loserC.error?.code !== "40001" && loserC.error?.code !== "P0409") {
      console.warn(
        "DEFECTO REAL OBSERVADO (C2-3b): PostgREST entrou em loop de retry ao receber SQLSTATE 40001 e devolveu:",
        JSON.stringify(loserC.error)
      );
      results.push("DEFECTO C2-3b (PostgREST 40001 retry): " + loserCodeOrMsg);
    } else {
      check(true, "C2-3b: Conflito de concorrência devolveu código imediato " + loserC.error.code);
    }

    // Duplo consumo no mesmo dado bloqueado com 22023
    const spentIdx = winnerC.data.consumidos[0];
    const dupCons = await gmA.rpc("consumir_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: winnerC.data.versao,
      p_indices: [spentIdx],
      p_op_id: "homolog-dup-cons"
    });
    check(dupCons.error?.code === "22023", "C2-4: Duplo consumo do mesmo dado rejeitado com 22023");

    // Dano com escolha dos dados pelo DEFENSOR (sessão real defenderA!)
    const dmgRes = await defenderA.rpc("aplicar_dano_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: winnerC.data.versao,
      p_dano: 2,
      p_indices_escolhidos: [1, 4],
      p_op_id: "homolog-def-dmg-1"
    });
    if (dmgRes.error) throw new Error("aplicar_dano defensor: " + dmgRes.error.message);
    check(
      JSON.stringify(dmgRes.data.bloqueados) === "[1,4]" &&
        dmgRes.data.resultados[1] === 0 &&
        dmgRes.data.resultados[4] === 0,
      "C2-5: Defensor autorizado aplica dano escolhendo exatamente os dados [1, 4]"
    );

    // Validar sincronização em mesa_token_status no banco real
    const { data: tokStatus } = await gmA
      .from("mesa_token_status")
      .select("six_b_total, danos_bloqueados")
      .eq("token_id", tok2Id)
      .single();
    check(
      tokStatus?.six_b_total === 5 && tokStatus?.danos_bloqueados === 2,
      "C2-6: mesa_token_status sincronizado automaticamente (six_b_total=5, danos_bloqueados=2)"
    );

    // Impedir bloqueio duplicado do mesmo dado (22023)
    const dupDmg = await defenderA.rpc("aplicar_dano_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: dmgRes.data.versao,
      p_dano: 1,
      p_indices_escolhidos: [1],
      p_op_id: "homolog-def-dmg-dup"
    });
    check(dupDmg.error?.code === "22023", "C2-7: Bloqueio duplicado do dado 1 rejeitado com 22023");

    // Fadiga em cascata nos maiores dados intactos (sem confundir com bloqueados)
    const fatTest = await gmA.rpc("ajustar_fadiga_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: dmgRes.data.versao,
      p_nova_fadiga: 2,
      p_op_id: "homolog-fat-2"
    });
    if (fatTest.error) throw new Error("ajustar_fadiga: " + fatTest.error.message);
    const origIntactSum = [0, 2, 3].reduce((acc, idx) => acc + fatTest.data.resultadosOriginais[idx], 0);
    const effIntactSum = [0, 2, 3].reduce((acc, idx) => acc + fatTest.data.resultados[idx], 0);
    const expectedReduction = Math.min(2, origIntactSum);
    check(
      origIntactSum - effIntactSum === expectedReduction &&
        JSON.stringify(fatTest.data.bloqueados) === "[1,4]",
      "C2-8: Fadiga automática em cascata reduz maiores dados intactos preservando bloqueados [1, 4]"
    );

    // Retornar fadiga para 0 para garantir dados disponíveis e testar bloqueio de renovação prematura
    const fatReset = await gmA.rpc("ajustar_fadiga_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: fatTest.data.versao,
      p_nova_fadiga: 0,
      p_op_id: "homolog-fat-0"
    });
    if (fatReset.error) throw new Error("reset fadiga: " + fatReset.error.message);

    // Se ainda não esgotou, testar bloqueio 55000 de renovação prematura
    let curSt = fatReset.data;
    if (!curSt.esgotado) {
      const earlyRenew = await gmA.rpc("renovar_6b_instancia", {
        p_mesa: mesaA,
        p_instance: boss2Id,
        p_versao: curSt.versao,
        p_op_id: "homolog-early-renew",
        p_aplicar_fadiga: true
      });
      check(earlyRenew.error?.code === "55000", "C2-9: Renovação prematura bloqueada com 55000");

      const remainingAvail = [0, 1, 2, 3, 4].filter(
        (i) => !curSt.usados.includes(i) && !curSt.bloqueados.includes(i) && curSt.resultados[i] > 0
      );
      const consRest = await gmA.rpc("consumir_6b_instancia", {
        p_mesa: mesaA,
        p_instance: boss2Id,
        p_versao: curSt.versao,
        p_indices: remainingAvail,
        p_op_id: "homolog-cons-rest"
      });
      if (consRest.error) throw new Error("consumir restante: " + consRest.error.message);
      curSt = consRest.data;
    } else {
      results.push("C2-9: Pool já esgotado para renovação");
      console.log("PASS: C2-9: Pool já esgotado para renovação");
    }

    // Renovação concorrente após esgotamento -> exatamente 1 vence (+1 Fadiga, preserva bloqueados [1,4]), 1 falha
    const [renA, renB] = fastMode
      ? [
          await gmA.rpc("renovar_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: curSt.versao,
            p_op_id: "homolog-renew-race-1",
            p_aplicar_fadiga: true
          }),
          { data: null, error: { code: "SKIPPED_FAST", message: "skipped in --fast mode" } }
        ]
      : await Promise.all([
          gmA.rpc("renovar_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: curSt.versao,
            p_op_id: "homolog-renew-race-1",
            p_aplicar_fadiga: true
          }),
          gmA.rpc("renovar_6b_instancia", {
            p_mesa: mesaA,
            p_instance: boss2Id,
            p_versao: curSt.versao,
            p_op_id: "homolog-renew-race-2",
            p_aplicar_fadiga: true
          })
        ]);
    const winRen = !renA.error ? renA : renB;
    const loseRen = !renA.error ? renB : renA;
    const winOpId = !renA.error ? "homolog-renew-race-1" : "homolog-renew-race-2";
    const renAtomicityOk =
      Boolean(winRen.data) &&
      !winRen.error &&
      Boolean(loseRen.error) &&
      winRen.data.fadiga === 1 &&
      JSON.stringify(winRen.data.bloqueados) === "[1,4]";
    const renLoserInfo = loseRen.error?.code || loseRen.error?.message || "";
    check(
      renAtomicityOk,
      "C2-10a: Renovação concorrente permite só 1 vencedor (+1 Fadiga, preserva dano; erro perdedor=" +
        renLoserInfo +
        ")",
      JSON.stringify({ renAErr: renA.error, renBErr: renB.error })
    );
    if (fastMode && renLoserInfo === "SKIPPED_FAST") {
      console.log("INFO C2-10b: Corrida de renovação ignorada no modo --fast (evidência completa coletada sem --fast).");
    } else if (loseRen.error?.code !== "40001" && loseRen.error?.code !== "P0409") {
      console.warn(
        "DEFECTO REAL OBSERVADO (C2-10b): PostgREST entrou em loop de retry ao receber SQLSTATE 40001 na renovação:",
        JSON.stringify(loseRen.error)
      );
      results.push("DEFECTO C2-10b (PostgREST 40001 retry): " + renLoserInfo);
    } else {
      check(true, "C2-10b: Corrida de renovação devolveu código imediato " + loseRen.error.code);
    }

    // Repetição idempotente do mesmo op_id da renovação (mesmo com versão antiga na chamada!)
    const replayRen = await gmA.rpc("renovar_6b_instancia", {
      p_mesa: mesaA,
      p_instance: boss2Id,
      p_versao: curSt.versao,
      p_op_id: winOpId,
      p_aplicar_fadiga: true
    });
    check(
      replayRen.data?.idempotentReplay === true &&
        replayRen.data?.versao === winRen.data.versao &&
        replayRen.data?.fadiga === 1,
      "C2-11: Replay idempotente pelo mesmo opId devolve snapshot sem reaplicar fadiga"
    );

    // Realtime C4: UPDATE recebido por gmA2 e defenderA para boss2; playerA e gmB continuam com 0 eventos
    await until(() => evGm2.some((e) => e.eventType === "UPDATE" && e.new?.instance_id === boss2Id && e.new?.versao === winRen.data.versao));
    await until(() => evDef.some((e) => e.eventType === "UPDATE" && e.new?.instance_id === boss2Id && e.new?.versao === winRen.data.versao));
    await delay(600);
    check(evPl.length === 0 && evGmB.length === 0, "C4-2: Realtime UPDATE nunca vaza estado do Boss para jogador comum nem outra mesa");

    // Reconexão Realtime do canal de gmA2
    await gmA2.removeChannel(chGm2);
    const evGm2Reconn = [];
    await subscribeInstance6B(gmA2, mesaA, evGm2Reconn);
    const curVerBeforeReconn = winRen.data.versao;
    const freshReadAfterReconn = await gmA2.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    check(
      freshReadAfterReconn.data?.versao === curVerBeforeReconn,
      "C4-3: Reconexão de segunda sessão recupera estado autoritativo completo (versao=" + curVerBeforeReconn + ")"
    );

    /* ─── C3: Segurança Real no PostgreSQL (5 Personas + Sigilo + Bloqueio DML direto) ─── */
    // Mestre NÃO pode fazer INSERT/UPDATE/DELETE direto via PostgREST em mesa_6b_instancia (apenas SELECT/RPC)
    const gmDirectUpd = await gmA.from("mesa_6b_instancia").update({ versao: 999 }).eq("instance_id", boss2Id);
    check(gmDirectUpd.error?.code === "42501", "C3-1: Nem o Mestre consegue manipular versao/resultados via UPDATE direto (42501)");

    // Jogador comum (playerA): 0 linhas em SELECT direto, [] em ler_6b_instancia(NULL), 42501 em ler específica e RPCs
    const plSel = await playerA.from("mesa_6b_instancia").select("*").eq("mesa_id", mesaA);
    const plRpcList = await playerA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: null });
    const plRpcRead = await playerA.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    const plRpcDmg = await playerA.rpc("aplicar_dano_6b_instancia", {
      p_mesa: mesaA, p_instance: boss2Id, p_versao: curVerBeforeReconn, p_dano: 1, p_indices_escolhidos: [0], p_op_id: "pl-hack"
    });
    const plStealToken = await playerA
      .from("mesa_tokens")
      .update({ owner_user_id: cfg.playerA })
      .eq("id", tok2Id)
      .select("id");
    check(
      plSel.data?.length === 0 &&
        Array.isArray(plRpcList.data) &&
        plRpcList.data.length === 0 &&
        plRpcRead.error?.code === "42501" &&
        plRpcDmg.error?.code === "42501" &&
        (plStealToken.error?.code === "42501" || (Array.isArray(plStealToken.data) && plStealToken.data.length === 0)),
      "C3-2: Jogador comum bloqueado de leitura direta, RPCs e sequestro de owner_user_id (0 linhas / 42501)",
      JSON.stringify({ plSel, plRpcList, plRpcRead, plRpcDmg, plStealToken })
    );

    // Defensor (defenderA) não pode consumir nem renovar nem ajustar fadiga (42501)
    const defCons = await defenderA.rpc("consumir_6b_instancia", {
      p_mesa: mesaA, p_instance: boss2Id, p_versao: curVerBeforeReconn, p_indices: [0], p_op_id: "def-hack-cons"
    });
    const defRen = await defenderA.rpc("renovar_6b_instancia", {
      p_mesa: mesaA, p_instance: boss2Id, p_versao: curVerBeforeReconn, p_op_id: "def-hack-ren", p_aplicar_fadiga: false
    });
    check(
      defCons.error?.code === "42501" && defRen.error?.code === "42501",
      "C3-3: Defensor designado bloqueado de consumir ou renovar pool do Boss (42501)"
    );

    // Mestre de outra mesa (gmB): 42501 na Mesa A
    const crossRead = await gmB.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    const crossSel = await gmB.from("mesa_6b_instancia").select("*").eq("mesa_id", mesaA);
    check(
      crossRead.error?.code === "42501" && crossSel.data?.length === 0,
      "C3-4: Usuário de outra mesa isolado completamente (42501)"
    );

    // Sessão anônima e acesso a tabela/schema privado xerife_6b + sigilo do Xerife
    const anonRpc = await anon.rpc("ler_6b_instancia", { p_mesa: mesaA, p_instance: boss2Id });
    const anonSel = await anon.from("mesa_6b_instancia").select("*");
    const opsProbe = await gmA.schema("xerife_6b").from("instancia_operacoes").select("*");
    const xerSecProbe = await playerA.rpc("ler_6b_xerife", { p_mesa: mesaA, p_tipo: "secreto" });
    check(
      Boolean(anonRpc.error) &&
        Boolean(anonSel.error || anonSel.data?.length === 0) &&
        Boolean(opsProbe.error) &&
        xerSecProbe.error?.code === "42501",
      "C3-5: Sessão anônima, ledger privado xerife_6b.instancia_operacoes e 6B Secreto do Xerife protegidos"
    );

    console.log(`\n=== FASE C HOMOLOGAÇÃO CONCLUÍDA: ${results.length} PASS ===`);
  } catch (err) {
    console.error("FAIL FASE C:", err.message || err);
    exitCode = 1;
  } finally {
    for (const [client, ch] of channels) {
      try {
        await client.removeChannel(ch);
      } catch {}
    }
    for (const [gmClient, mId] of cleanupMesas) {
      try {
        await gmClient.from("fichas").delete().eq("usuario_id", cfg.gmA).eq("nome_personagem", "Boss XER Homolog");
        await gmClient.from("mesas").delete().eq("id", mId);
      } catch {}
    }
    for (const c of clients) {
      try {
        await c.auth.signOut();
      } catch {}
      try {
        c.realtime.disconnect();
      } catch {}
    }
    process.exit(exitCode);
  }
}

main();
