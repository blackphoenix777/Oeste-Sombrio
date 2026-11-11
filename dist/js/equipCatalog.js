/**
 * Catálogo de equipamentos — carrega JSON de dist/data/equip
 * Não altera inventário nem regras; apenas leitura do catálogo.
 * A pasta serviços é excluída via catalog-index.json.
 */
import { OS } from "./app.js";

OS.equipCatalog = {
  loaded: false,
  loading: null,
  index: null,
  byId: {},
  byPath: {},
  byGroup: {},
  errors: []
};

OS.getEquipCatalogBaseUrl = function () {
  try {
    return new URL("../data/equip/", import.meta.url);
  } catch (err) {
    return new URL("data/equip/", window.location.href);
  }
};

/* baseUrl opcional: permite ler JSON de outras pastas de dist/data (ex.: magias/, progressao/) */
OS.resolveEquipCatalogUrl = function (relativePath, baseUrl) {
  var base = baseUrl || OS.getEquipCatalogBaseUrl();
  var parts = String(relativePath || "").split("/");
  var encoded = parts
    .map(function (part) {
      return encodeURIComponent(part);
    })
    .join("/");
  return new URL(encoded, base).href;
};

OS.fetchEquipJson = async function (relativePath, baseUrl) {
  var url = OS.resolveEquipCatalogUrl(relativePath, baseUrl);
  var response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      "Falha ao carregar catálogo (" + response.status + "): " + relativePath
    );
  }
  return response.json();
};

/**
 * Carrega o índice e todos os JSON listados (exceto serviços).
 * Retorna o objeto de catálogo com dados brutos preservados.
 */
OS.loadEquipCatalog = async function (forceReload) {
  if (OS.equipCatalog.loaded && !forceReload) {
    return OS.equipCatalog;
  }
  if (OS.equipCatalog.loading && !forceReload) {
    return OS.equipCatalog.loading;
  }

  OS.equipCatalog.loading = (async function () {
    OS.equipCatalog.errors = [];
    OS.equipCatalog.byId = {};
    OS.equipCatalog.byPath = {};
    OS.equipCatalog.byGroup = {};

    var index = await OS.fetchEquipJson("catalog-index.json");
    OS.equipCatalog.index = index;

    var files = (index && index.files) || [];
    for (var i = 0; i < files.length; i++) {
      var entry = files[i];
      if (!entry || !entry.path) continue;

      // Segurança: nunca carregar serviços nesta etapa
      if (String(entry.path).indexOf("serviços/") === 0) continue;
      if (String(entry.group || "") === "serviços") continue;

      try {
        var data = await OS.fetchEquipJson(entry.path);
        var record = {
          id: entry.id,
          group: entry.group,
          path: entry.path,
          data: data
        };
        OS.equipCatalog.byId[entry.id] = record;
        OS.equipCatalog.byPath[entry.path] = record;
        if (!OS.equipCatalog.byGroup[entry.group]) {
          OS.equipCatalog.byGroup[entry.group] = [];
        }
        OS.equipCatalog.byGroup[entry.group].push(record);
      } catch (err) {
        OS.equipCatalog.errors.push({
          path: entry.path,
          message: String(err && err.message ? err.message : err)
        });
        console.error("[equipCatalog]", err);
      }
    }

    OS.equipCatalog.loaded = true;
    OS.equipCatalog.loading = null;
    if (OS.renderInventory) {
      OS.renderInventory();
    } else if (OS.renderFichaEquippedItems) {
      OS.renderFichaEquippedItems();
    }
    return OS.equipCatalog;
  })();

  return OS.equipCatalog.loading;
};

OS.getEquipCatalogEntry = function (idOrPath) {
  if (!idOrPath) return null;
  return (
    OS.equipCatalog.byId[idOrPath] ||
    OS.equipCatalog.byPath[idOrPath] ||
    null
  );
};

OS.getEquipCatalogGroup = function (groupName) {
  return OS.equipCatalog.byGroup[groupName] || [];
};
