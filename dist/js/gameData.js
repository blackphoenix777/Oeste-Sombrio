/**
 * Dados de regras (magias e progressão) — carrega JSON de dist/data/magias e dist/data/progressao.
 * Reutiliza o leitor do catálogo de equipamentos (OS.fetchEquipJson), apenas com outra pasta base.
 * Os arquivos são listados em data/game-data-index.json (mesmo padrão do catalog-index.json).
 *
 * Os JSON são guardados exatamente como vieram (sem normalização):
 *  - lista_magias: magias agrupadas por caminho (magias_por_caminho)
 *  - caminhos_magia: descrições textuais dos caminhos
 *  - reservatorio_energia_mistica, progressao_6b, pontos_pericia: tabelas de regras
 * Somente leitura: não altera ficha, regras, inventário nem UI.
 */
import { OS } from "./app.js";

OS.gameData = {
  loaded: false,
  loading: null,
  index: null,
  byId: {},
  errors: []
};

OS.rulesData = {
  loaded: false,
  loading: null,
  byId: {},
  errors: []
};

var EXTRA_RULE_FILES = [
  { id: "magias_buffs", group: "magias", path: "magias/magias_buffs.json" },
  { id: "fichas_do_destino", group: "regras", path: "regras/fichas_do_destino.json" },
  { id: "itens_e_equipamentos", group: "regras", path: "regras/itens_e_equipamentos.json" },
  { id: "regras_combate", group: "regras", path: "regras/regras_combate.json" },
  { id: "sistema_de_testes", group: "regras", path: "regras/sistema_de_testes.json" },
  { id: "tempo_livre", group: "regras", path: "regras/tempo_livre.json" },
  { id: "veteranos", group: "regras", path: "regras/veteranos.json" }
];

OS.getGameDataBaseUrl = function () {
  try {
    return new URL("../data/", import.meta.url);
  } catch (err) {
    return new URL("data/", window.location.href);
  }
};

OS.loadRulesData = async function (forceReload) {
  if (OS.rulesData.loaded && !forceReload) return OS.rulesData;
  if (OS.rulesData.loading && !forceReload) return OS.rulesData.loading;

  OS.rulesData.loading = (async function () {
    var base = OS.getGameDataBaseUrl();
    OS.rulesData.errors = [];
    OS.rulesData.byId = {};

    for (var i = 0; i < EXTRA_RULE_FILES.length; i++) {
      var entry = EXTRA_RULE_FILES[i];
      try {
        OS.rulesData.byId[entry.id] = {
          id: entry.id,
          group: entry.group,
          path: entry.path,
          data: await OS.fetchEquipJson(entry.path, base)
        };
      } catch (err) {
        OS.rulesData.errors.push({
          path: entry.path,
          message: String(err && err.message ? err.message : err)
        });
      }
    }

    OS.rulesData.loaded = true;
    OS.rulesData.loading = null;
    return OS.rulesData;
  })();

  return OS.rulesData.loading;
};

/** Carrega o índice e todos os JSON listados; retorna OS.gameData. */
OS.loadGameData = async function (forceReload) {
  if (OS.gameData.loaded && !forceReload) return OS.gameData;
  if (OS.gameData.loading && !forceReload) return OS.gameData.loading;

  OS.gameData.loading = (async function () {
    var base = OS.getGameDataBaseUrl();
    OS.gameData.errors = [];
    OS.gameData.byId = {};

    var index = await OS.fetchEquipJson("game-data-index.json", base);
    OS.gameData.index = index;

    var files = (index && index.files) || [];
    for (var i = 0; i < files.length; i++) {
      var entry = files[i];
      if (!entry || !entry.id || !entry.path) continue;
      try {
        OS.gameData.byId[entry.id] = {
          id: entry.id,
          group: entry.group,
          path: entry.path,
          data: await OS.fetchEquipJson(entry.path, base)
        };
      } catch (err) {
        OS.gameData.errors.push({
          path: entry.path,
          message: String(err && err.message ? err.message : err)
        });
        console.error("[gameData]", err);
      }
    }

    await OS.loadRulesData(forceReload);

    OS.gameData.loaded = true;
    OS.gameData.loading = null;
    return OS.gameData;
  })();

  return OS.gameData.loading;
};

/** Retorna o conteúdo bruto de um JSON pelo id do índice (ex.: "lista_magias"), ou null. */
OS.getGameData = function (id) {
  var record = OS.gameData.byId[id] || (OS.rulesData && OS.rulesData.byId[id]);
  return record ? record.data : null;
};

/* ─── Arquivos compartilhados de Itens e Magias Criados ──────── */
OS.customItems = [];
OS.customSpells = [];

function mergeByKey(listA, listB, keyFn) {
  var seen = {};
  var out = [];
  (listA || []).concat(listB || []).forEach(function (entry) {
    if (!entry || typeof entry !== "object") return;
    var k = keyFn(entry);
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push(entry);
  });
  return out;
}

OS.loadCustomItems = async function () {
  var fromFile = [];
  try {
    var url = OS.resolveEquipCatalogUrl("itens_criados.json");
    var res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      var parsed = await res.json();
      if (Array.isArray(parsed)) fromFile = parsed;
      else if (parsed && Array.isArray(parsed.itens)) fromFile = parsed.itens;
    }
  } catch (e) {
    /* ignore */
  }

  var fromLocal = [];
  try {
    var raw =
      localStorage.getItem("itens_criados.json") ||
      localStorage.getItem("oesteSombrio_itens_criados_v1");
    if (raw) {
      var pLoc = JSON.parse(raw);
      if (Array.isArray(pLoc)) fromLocal = pLoc;
      else if (pLoc && Array.isArray(pLoc.itens)) fromLocal = pLoc.itens;
    }
  } catch (e) {
    /* ignore */
  }

  if (OS.isTauri && OS.isTauri()) {
    try {
      var tRaw = await OS.invokeTauri("load_character", { filename: "itens_criados.json" });
      if (tRaw) {
        var pTauri = JSON.parse(tRaw);
        var arrT = Array.isArray(pTauri) ? pTauri : (pTauri && pTauri.itens) || [];
        fromLocal = mergeByKey(fromLocal, arrT, function (x) {
          return String(x.id || x.nome || "").trim().toLowerCase();
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  OS.customItems = mergeByKey(fromFile, fromLocal, function (x) {
    return String(x.id || x.nome || "").trim().toLowerCase();
  });

  try {
    var jsonStr = JSON.stringify({ itens: OS.customItems }, null, 2);
    localStorage.setItem("itens_criados.json", jsonStr);
    localStorage.setItem("oesteSombrio_itens_criados_v1", jsonStr);
  } catch (e) {
    /* ignore */
  }

  return OS.customItems;
};

OS.saveCustomItems = async function () {
  var payload = { itens: OS.customItems || [] };
  var jsonStr = JSON.stringify(payload, null, 2);
  try {
    localStorage.setItem("itens_criados.json", jsonStr);
    localStorage.setItem("oesteSombrio_itens_criados_v1", jsonStr);
  } catch (e) {
    /* ignore */
  }
  if (OS.isTauri && OS.isTauri()) {
    try {
      await OS.invokeTauri("save_character", { filename: "itens_criados.json", data: jsonStr });
    } catch (e) {
      /* ignore */
    }
  }
  try {
    await fetch(OS.resolveEquipCatalogUrl("itens_criados.json"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonStr
    });
    await fetch(OS.resolveEquipCatalogUrl("itens_criados.json", OS.getGameDataBaseUrl()), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonStr
    });
  } catch (e) {
    /* ignore */
  }
  return payload;
};

OS.loadCustomSpells = async function () {
  var fromFile = [];
  try {
    var url = OS.resolveEquipCatalogUrl("magias/magias_criadas.json", OS.getGameDataBaseUrl());
    var res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      var parsed = await res.json();
      if (Array.isArray(parsed)) fromFile = parsed;
      else if (parsed && Array.isArray(parsed.magias)) fromFile = parsed.magias;
    }
  } catch (e) {
    /* ignore */
  }

  var fromLocal = [];
  try {
    var raw =
      localStorage.getItem("magias_criadas.json") ||
      localStorage.getItem("oesteSombrio_magias_criadas_v1");
    if (raw) {
      var pLoc = JSON.parse(raw);
      if (Array.isArray(pLoc)) fromLocal = pLoc;
      else if (pLoc && Array.isArray(pLoc.magias)) fromLocal = pLoc.magias;
    }
  } catch (e) {
    /* ignore */
  }

  if (OS.isTauri && OS.isTauri()) {
    try {
      var tRaw = await OS.invokeTauri("load_character", { filename: "magias_criadas.json" });
      if (tRaw) {
        var pTauri = JSON.parse(tRaw);
        var arrT = Array.isArray(pTauri) ? pTauri : (pTauri && pTauri.magias) || [];
        fromLocal = mergeByKey(fromLocal, arrT, function (x) {
          return String(x.id || x.nome || "").trim().toLowerCase();
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  OS.customSpells = mergeByKey(fromFile, fromLocal, function (x) {
    return String(x.id || x.nome || "").trim().toLowerCase();
  });

  try {
    var jsonStr = JSON.stringify({ magias: OS.customSpells }, null, 2);
    localStorage.setItem("magias_criadas.json", jsonStr);
    localStorage.setItem("oesteSombrio_magias_criadas_v1", jsonStr);
  } catch (e) {
    /* ignore */
  }

  return OS.customSpells;
};

OS.saveCustomSpells = async function () {
  var payload = { magias: OS.customSpells || [] };
  var jsonStr = JSON.stringify(payload, null, 2);
  try {
    localStorage.setItem("magias_criadas.json", jsonStr);
    localStorage.setItem("oesteSombrio_magias_criadas_v1", jsonStr);
  } catch (e) {
    /* ignore */
  }
  if (OS.isTauri && OS.isTauri()) {
    try {
      await OS.invokeTauri("save_character", { filename: "magias_criadas.json", data: jsonStr });
    } catch (e) {
      /* ignore */
    }
  }
  try {
    await fetch(OS.resolveEquipCatalogUrl("magias/magias_criadas.json", OS.getGameDataBaseUrl()), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonStr
    });
    await fetch(OS.resolveEquipCatalogUrl("magias_criadas.json", OS.getGameDataBaseUrl()), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: jsonStr
    });
  } catch (e) {
    /* ignore */
  }
  return payload;
};
