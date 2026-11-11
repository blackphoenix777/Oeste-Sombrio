/**
 * Modal de catálogo de equipamentos.
 * Lê dados via OS.equipCatalog (carregado por equipCatalog.js) e itens criados via OS.loadCustomItems.
 * Suporta:
 *  - Modo compra ("buy" / "creation"): desconta dinheiro, bloqueia saldo insuficiente, aplica 50% no 1º item da criação.
 *  - Modo loot ("loot"): adiciona item sem descontar dinheiro.
 *  - Aba "Criados" e formulário "Criar": salva em itens_criados.json (compartilhado entre todas as fichas).
 */
import { OS } from "./app.js";
import {
  formatVolume,
  getItemVolumeInfo,
  parseVolumeNumber
} from "./rules/index.js";

/* ─── helpers ────────────────────────────────────────────────── */

function getItemsFromRecord(record) {
  var data = record && record.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.itens)) return data.itens;
  return [];
}

function getItemDisplayName(item) {
  return item.nome || item.kit || item.mutagenico || "(sem nome)";
}

function formatPrice(preco) {
  if (preco === null || preco === undefined || preco === "") return null;
  return String(preco);
}

function buildAttrLines(item, listId) {
  var lines = [];

  function add(label, val) {
    if (val === null || val === undefined || val === "" || val === false) return;
    lines.push(label + ": " + val);
  }

  var volProbe = Object.assign({}, item, { listId: listId || item.listId || "" });
  var volInfo = getItemVolumeInfo(volProbe);
  if (!volInfo.isExempt) {
    lines.push(
      "Volume: " + formatVolume(volInfo.volume) + (volInfo.isFallback ? " (padrão)" : "")
    );
  }
  if (
    item.capacidade_volumes !== null &&
    item.capacidade_volumes !== undefined &&
    item.capacidade_volumes !== ""
  ) {
    lines.push("Capacidade: " + formatVolume(item.capacidade_volumes) + " volumes");
  }

  add("Dano", item.dano);
  add("Alcance", item.alcance);
  add("Recarga", item.recarga);
  add("Tambor", item.tambor);
  add("Munição", item.municao);
  add("Modelo", item.modelo);
  add("Duração", item.duracao);
  add("Resistência", item.resistencia);
  add("Proteção", item.protecao);
  add("Vantagem", item.vantagem);
  add("Desvantagem", item.desvantagem);

  if (item.detalhes && item.detalhes !== null) {
    lines.push("Detalhes: " + item.detalhes);
  }
  if (item.descricao && item.descricao !== null) {
    lines.push("Descrição: " + item.descricao);
  }

  add("Efeitos", item.efeitos);
  add("Peso", item.peso);
  add("Capacidade", item.capacidade);

  return lines;
}

/* ─── estado local do modal ──────────────────────────────────── */

var state = {
  mode: "buy",         // "buy" | "loot" | "creation"
  activeGroup: null,   // string: nome do grupo ativo (ou "criados")
  activeListId: null,  // string: id da lista ativa
  activeItem: null,    // objeto item selecionado
  activeVariant: null, // objeto variante selecionada (mutagênicos)
  parentRecord: null,  // record pai do item ativo
  filterText: ""
};

var els = {};

function el(id) {
  return els[id] || (els[id] = document.getElementById(id));
}

var GROUP_ORDER = [
  "armas",
  "equipamentos",
  "vestuario",
  "animais e equipamentos",
  "itens",
  "criados"
];

var GROUP_LABELS = {
  "armas": "Armas",
  "equipamentos": "Equipamentos",
  "vestuario": "Vestuário",
  "animais e equipamentos": "Animais & Montaria",
  "itens": "Itens",
  "criados": "Criados"
};

/* ─── cálculo de preço efetivo e verificação de saldo ────────── */

function isFirstCreationPurchaseDiscountActive() {
  return (
    state.mode !== "loot" &&
    state.mode !== "craft" &&
    !OS.freeEdit &&
    !OS.firstPurchaseDiscountUsed
  );
}

function formatCatalogPriceHtml(rawPreco) {
  var preco = formatPrice(rawPreco);
  if (!preco) return "";
  var isSpecialNonDollar = /¢/.test(preco) || preco.trim().toUpperCase() === "X";
  var unit = !isSpecialNonDollar && OS.parseItemPrice ? OS.parseItemPrice(rawPreco) : 0;
  if (isFirstCreationPurchaseDiscountActive() && unit > 0) {
    var eff = OS.getEffectivePurchaseCost(rawPreco, 1);
    var origWithDollar = preco.trim().indexOf("$") === 0 ? preco.trim() : "$" + preco.trim();
    return "<s>" + esc(origWithDollar) + "</s> <strong>$" + esc(String(eff)) + "</strong>";
  }
  return esc(preco);
}

OS.getEffectivePurchaseCost = function (rawPreco, qty) {
  if (state.mode === "loot") return 0;
  var q = Math.max(1, parseInt(qty, 10) || 1);
  var unit = OS.parseItemPrice ? OS.parseItemPrice(rawPreco) : 0;
  if (unit <= 0) return 0;

  var total;
  if (isFirstCreationPurchaseDiscountActive()) {
    // Primeiro item comprado na criação custa metade do valor tabelado
    total = unit * 0.5 + (q - 1) * unit;
  } else {
    total = unit * q;
  }
  return Math.round(total * 100) / 100;
};

function updateMoneyBadge() {
  var badge = el("catalog-money-display");
  if (!badge) return;
  var money = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;
  if (state.mode === "loot") {
    badge.textContent = "Modo Loot (Grátis) · Saldo: $" + money;
  } else if (isFirstCreationPurchaseDiscountActive()) {
    badge.textContent = "Saldo: $" + money + " (1ª compra: 50% OFF)";
  } else {
    badge.textContent = "Saldo: $" + money;
  }
}

/* ─── renderização das abas de grupo ───────────────────────── */

function renderGroupTabs() {
  var container = el("catalog-group-tabs");
  if (!container) return;
  container.innerHTML = "";

  var catalog = OS.equipCatalog;
  GROUP_ORDER.forEach(function (group) {
    if (group !== "criados" && (!catalog.byGroup || !catalog.byGroup[group])) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-tab-btn" + (state.activeGroup === group ? " active" : "");
    btn.textContent = GROUP_LABELS[group] || group;
    btn.dataset.group = group;
    btn.addEventListener("click", function () {
      selectGroup(group);
    });
    container.appendChild(btn);
  });
}

/* ─── renderização das abas de lista ───────────────────────── */

function renderListTabs() {
  var container = el("catalog-list-tabs");
  if (!container) return;
  container.innerHTML = "";

  if (!state.activeGroup || state.activeGroup === "criados") return;

  var records = OS.getEquipCatalogGroup(state.activeGroup);
  records.forEach(function (record) {
    var label = idToLabel(record.id);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-tab-btn catalog-tab-list" + (state.activeListId === record.id ? " active" : "");
    btn.textContent = label;
    btn.dataset.listId = record.id;
    btn.addEventListener("click", function () {
      selectList(record.id);
    });
    container.appendChild(btn);
  });
}

function idToLabel(id) {
  return (id || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/* ─── seleção de grupo e lista ──────────────────────────────── */

function selectGroup(group) {
  state.activeGroup = group;
  state.activeListId = null;
  state.activeItem = null;
  state.activeVariant = null;
  state.filterText = "";
  var searchEl = el("catalog-search");
  if (searchEl) searchEl.value = "";

  if (group === "criados") {
    state.activeListId = "itens_criados";
  } else {
    var records = OS.getEquipCatalogGroup(group);
    if (records.length) state.activeListId = records[0].id;
  }

  renderGroupTabs();
  renderListTabs();
  renderItemList();
  renderItemDetail();
  updateConfirmButton();
}

function selectList(listId) {
  state.activeListId = listId;
  state.activeItem = null;
  state.activeVariant = null;
  state.filterText = "";
  var searchEl = el("catalog-search");
  if (searchEl) searchEl.value = "";

  renderListTabs();
  renderItemList();
  renderItemDetail();
  updateConfirmButton();
}

/* ─── renderização da lista de itens ───────────────────────── */

function getActiveItems() {
  var raw = [];
  if (state.activeGroup === "criados") {
    raw = Array.isArray(OS.customItems) ? OS.customItems : [];
  } else {
    if (!state.activeListId) return [];
    var record = OS.getEquipCatalogEntry(state.activeListId);
    if (!record) return [];
    raw = getItemsFromRecord(record);
  }

  var filter = state.filterText.toLowerCase().trim();

  var flat = [];
  raw.forEach(function (item) {
    if (Array.isArray(item.variantes)) {
      var parentName = item.mutagenico || item.nome || "(mutagênico)";
      if (!filter || parentName.toLowerCase().indexOf(filter) >= 0) {
        flat.push({ _type: "mutagenico_parent", item: item });
      } else {
        item.variantes.forEach(function (v) {
          if (!filter || v.nome.toLowerCase().indexOf(filter) >= 0) {
            flat.push({ _type: "mutagenico_parent", item: item, _variantMatch: true });
          }
        });
      }
    } else {
      var name = getItemDisplayName(item).toLowerCase();
      if (!filter || name.indexOf(filter) >= 0) {
        flat.push({ _type: "item", item: item });
      }
    }
  });

  var seen = new Set();
  var result = [];
  flat.forEach(function (entry) {
    var key = entry._type === "mutagenico_parent"
      ? "m:" + (entry.item.mutagenico || entry.item.nome)
      : "i:" + getItemDisplayName(entry.item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  });

  return result;
}

function renderItemList() {
  var container = el("catalog-item-list");
  if (!container) return;
  container.innerHTML = "";

  updateMoneyBadge();

  var items = getActiveItems();
  if (!items.length) {
    container.innerHTML = "<p class=\"catalog-empty\">Nenhum item encontrado.</p>";
    return;
  }

  var currentMoney = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;

  items.forEach(function (entry) {
    var item = entry.item;
    var isMut = entry._type === "mutagenico_parent";
    var name = isMut
      ? (item.mutagenico || item.nome || "(mutagênico)")
      : getItemDisplayName(item);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-item-btn";
    if (isMut) btn.classList.add("catalog-item-mutagenico");

    var selected = state.activeItem && state.activeItem === item;
    if (selected) btn.classList.add("active");

    var nameEl = document.createElement("span");
    nameEl.className = "catalog-item-name";
    nameEl.textContent = name;
    btn.appendChild(nameEl);

    if (!isMut) {
      var preco = formatPrice(item.preco);
      if (preco) {
        var priceEl = document.createElement("span");
        priceEl.className = "catalog-item-price";
        var effectiveCost = OS.getEffectivePurchaseCost(item.preco, 1);
        var unaffordable = state.mode !== "gm" && state.mode !== "loot" && effectiveCost > currentMoney;
        if (unaffordable) {
          priceEl.classList.add("price-unaffordable");
          priceEl.style.color = "#e05252";
        }
        priceEl.innerHTML = formatCatalogPriceHtml(item.preco);
        btn.appendChild(priceEl);
      }
    }

    btn.addEventListener("click", function () {
      state.activeItem = item;
      state.activeVariant = null;
      state.parentRecord = state.activeGroup === "criados"
        ? { id: "itens_criados", group: item.group || "equipamentos" }
        : OS.getEquipCatalogEntry(state.activeListId);
      renderItemList();
      renderItemDetail();
      updateConfirmButton();
    });

    container.appendChild(btn);
  });
}

/* ─── renderização do detalhe ──────────────────────────────── */

function renderItemDetail() {
  var container = el("catalog-item-detail");
  if (!container) return;

  if (!state.activeItem) {
    container.innerHTML = "<p class=\"catalog-detail-empty\">Selecione um item para ver os atributos.</p>";
    return;
  }

  var item = state.activeItem;
  var isMut = Array.isArray(item.variantes);
  var currentMoney = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;
  var html = "";

  var title = getItemDisplayName(item);
  html += "<h4 class=\"catalog-detail-title\">" + esc(title) + "</h4>";

  if (isMut && item.descricao) {
    html += "<p class=\"catalog-detail-desc\">" + esc(item.descricao) + "</p>";
  }

  if (!isMut) {
    var preco = formatPrice(item.preco);
    if (preco) {
      var eff = OS.getEffectivePurchaseCost(item.preco, 1);
      var isRed = state.mode !== "loot" && eff > currentMoney;
      var priceStyle = isRed ? ' style="color:#e05252"' : "";
      var priceCls = isRed ? " price-unaffordable" : "";
      var priceDisplay = formatCatalogPriceHtml(item.preco);
      html += "<div class=\"catalog-attr\"><span class=\"catalog-attr-label\">Preço</span> <span class=\"catalog-attr-val" + priceCls + "\"" + priceStyle + ">" + priceDisplay + "</span></div>";
    }
    var attrs = buildAttrLines(item, state.activeListId);
    attrs.forEach(function (line) {
      var sep = line.indexOf(": ");
      if (sep > 0) {
        var label = line.slice(0, sep);
        var val = line.slice(sep + 2);
        html += "<div class=\"catalog-attr\"><span class=\"catalog-attr-label\">" + esc(label) + "</span> <span class=\"catalog-attr-val\">" + esc(val) + "</span></div>";
      } else {
        html += "<div class=\"catalog-attr catalog-attr-full\">" + esc(line) + "</div>";
      }
    });
  }

  if (isMut && item.variantes && item.variantes.length) {
    html += "<div class=\"catalog-variants\"><p class=\"catalog-variants-label\">Selecione uma variante:</p>";
    item.variantes.forEach(function (v, idx) {
      var selectedClass = (state.activeVariant === v) ? " active" : "";
      html += "<button type=\"button\" class=\"catalog-variant-btn" + selectedClass + "\" data-vidx=\"" + idx + "\">";
      html += "<span class=\"catalog-variant-name\">" + esc(v.nome || "Variante " + (idx + 1)) + "</span>";
      var vpreco = formatPrice(v.preco);
      if (vpreco) {
        var vEff = OS.getEffectivePurchaseCost(v.preco, 1);
        var vRed = state.mode !== "loot" && vEff > currentMoney;
        var vCls = "catalog-item-price" + (vRed ? " price-unaffordable" : "");
        var vStyle = vRed ? ' style="color:#e05252"' : "";
        html += " <span class=\"" + vCls + "\"" + vStyle + ">" + formatCatalogPriceHtml(v.preco) + "</span>";
      }
      html += "</button>";

      if (state.activeVariant === v) {
        html += "<div class=\"catalog-variant-detail\">";
        var vVolInfo = getItemVolumeInfo(
          Object.assign({}, v, { listId: state.activeListId || "" })
        );
        if (!vVolInfo.isExempt) {
          var vVolText = formatVolume(vVolInfo.volume) + (vVolInfo.isFallback ? " (padrão)" : "");
          html += "<div class=\"catalog-attr\"><span class=\"catalog-attr-label\">Volume</span> <span class=\"catalog-attr-val\">" + esc(vVolText) + "</span></div>";
        }
        if (v.capacidade_volumes !== undefined && v.capacidade_volumes !== null && v.capacidade_volumes !== "") {
          html += "<div class=\"catalog-attr\"><span class=\"catalog-attr-label\">Capacidade</span> <span class=\"catalog-attr-val\">" + esc(formatVolume(v.capacidade_volumes) + " volumes") + "</span></div>";
        }
        if (v.duracao) html += "<div class=\"catalog-attr\"><span class=\"catalog-attr-label\">Duração</span> <span class=\"catalog-attr-val\">" + esc(v.duracao) + "</span></div>";
        if (v.vantagem) html += "<div class=\"catalog-attr catalog-vantagem\"><span class=\"catalog-attr-label\">Vantagem</span> <span class=\"catalog-attr-val\">" + esc(v.vantagem) + "</span></div>";
        if (v.desvantagem) html += "<div class=\"catalog-attr catalog-desvantagem\"><span class=\"catalog-attr-label\">Desvantagem</span> <span class=\"catalog-attr-val\">" + esc(v.desvantagem) + "</span></div>";
        html += "</div>";
      }
    });
    html += "</div>";
  }

  container.innerHTML = html;

  if (isMut) {
    container.querySelectorAll(".catalog-variant-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var vidx = parseInt(btn.dataset.vidx, 10);
        state.activeVariant = item.variantes[vidx];
        renderItemDetail();
        updateConfirmButton();
      });
    });
  }
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── botão confirmar ───────────────────────────────────────── */

function updateConfirmButton() {
  var btn = el("catalog-confirm");
  if (!btn) return;

  var item = state.activeItem;
  if (!item) { btn.disabled = true; return; }

  var isMut = Array.isArray(item.variantes);
  if (isMut && !state.activeVariant) {
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
}

/* ─── adicionar ao inventário (compra vs loot) ──────────────── */

async function addToInventory() {
  var item = state.activeItem;
  if (!item) return;

  var isMut = Array.isArray(item.variantes);
  var target = isMut ? state.activeVariant : item;
  if (!target) return;

  var resolvedGroup = state.activeGroup === "criados"
    ? (target.group || item.group || "equipamentos")
    : state.activeGroup;
  var resolvedListId = state.activeGroup === "criados"
    ? (target.listId || item.listId || "itens_criados")
    : state.activeListId;

  if (state.mode === "gm") {
    var sendButton = el("catalog-confirm"), sendHint = el("catalog-modal-hint");
    var recipient = el("catalog-recipient").value, amount = Number(el("catalog-qty").value);
    if (!recipient || !Number.isInteger(amount) || amount < 1 || amount > 999) {
      sendHint.textContent = "Selecione o destinatário e uma quantidade entre 1 e 999."; return;
    }
    var payload = Object.assign({}, isMut ? item : {}, target, { group: resolvedGroup, listId: resolvedListId });
    delete payload.variantes;
    var fingerprint = JSON.stringify([recipient, amount, payload]);
    if (!state.pendingDelivery || state.pendingDelivery.fingerprint !== fingerprint) state.pendingDelivery = { fingerprint: fingerprint, id: crypto.randomUUID() };
    sendButton.disabled = true;
    try {
      await OS.sendCatalogItemToPlayer(payload, amount, recipient, state.pendingDelivery.id);
      state.pendingDelivery = null; sendHint.classList.remove("catalog-error"); sendHint.textContent = "✓ Item enviado. O jogador receberá ao abrir a ficha desta mesa.";
    } catch (error) { sendHint.classList.add("catalog-error"); sendHint.textContent = error.message; }
    finally { updateConfirmButton(); }
    return;
  }

  if (state.mode === "craft") {
    if (OS.selectCraftCatalogItem) {
      OS.selectCraftCatalogItem(target, resolvedGroup, resolvedListId, isMut ? item : null);
    }
    closeCatalogModal();
    return;
  }

  var qtyEl = el("catalog-qty");
  var qty = Math.max(1, parseInt((qtyEl && qtyEl.value) || "1", 10));
  if (isNaN(qty)) qty = 1;

  var destEl = document.getElementById("catalog-dest-select");
  var dest = destEl && destEl.value ? destEl.value : "solto";

  var hint = el("catalog-modal-hint");

  // Validação obrigatória de capacidade ANTES de debitar dinheiro quando o destino é mochila ou alforje
  if (dest === "mochila" || dest === "alforge") {
    var probeTarget = Object.assign({}, target, {
      group: resolvedGroup,
      listId: resolvedListId
    });
    if (OS.podeReceberItem && !OS.podeReceberItem(dest, probeTarget, qty)) {
      var capErr = OS.describeCapacityBlock
        ? OS.describeCapacityBlock(dest, probeTarget, qty)
        : "Espaço insuficiente no destino selecionado.";
      if (hint) {
        hint.textContent = capErr;
        hint.classList.add("catalog-error");
      }
      return;
    }
  }

  // Verificação de dinheiro e desconto no modo compra ("buy" / "creation")
  if (state.mode !== "loot") {
    var currentMoney = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;
    var cost = OS.getEffectivePurchaseCost(target.preco, qty);

    if (cost > currentMoney) {
      if (hint) {
        hint.textContent = "Você não tem dinheiro para comprar isso!";
        hint.classList.add("catalog-error");
      }
      return;
    }

    var wasDiscounted = isFirstCreationPurchaseDiscountActive();
    var remaining = Math.max(0, Math.round((currentMoney - cost) * 100) / 100);
    if (OS.setCharacterMoney) {
      OS.setCharacterMoney(remaining);
    }
    if (wasDiscounted) {
      OS.firstPurchaseDiscountUsed = true;
    }
  }

  if (!OS.addInventoryItem) return;

  OS.addInventoryItem(target, qty, resolvedGroup, resolvedListId, isMut ? item : null, dest);

  if (OS.activeCharacterFilename && OS.persistActiveCharacter) {
    OS.persistActiveCharacter().catch(function () {});
  }

  renderItemList();
  renderItemDetail();

  if (hint) {
    hint.classList.remove("catalog-error");
    var destLabel = dest === "mochila" ? "à mochila" : dest === "alforge" ? "ao alforje" : "ao inventário";
    hint.textContent = "✓ " + getItemDisplayName(target) + " adicionado " + destLabel + ".";
    setTimeout(function () {
      if (hint.textContent.startsWith("✓")) hint.textContent = "";
    }, 2000);
  }

  if (qtyEl) qtyEl.value = "1";
}

/* ─── criar novo item (itens_criados.json) ──────────────────── */

function toggleCreateItemForm(show) {
  var form = el("catalog-create-form");
  if (!form) return;
  var shouldShow = show !== undefined ? show : form.hasAttribute("hidden");
  if (shouldShow) {
    form.removeAttribute("hidden");
  } else {
    form.setAttribute("hidden", "");
  }
}

async function handleSaveCreatedItem() {
  var nomeEl = document.getElementById("create-item-nome");
  var nome = nomeEl ? String(nomeEl.value || "").trim() : "";
  var hint = el("catalog-modal-hint");

  if (!nome) {
    if (hint) {
      hint.textContent = "Informe o nome do item para criar.";
      hint.classList.add("catalog-error");
    }
    return;
  }

  var groupEl = document.getElementById("create-item-group");
  var subtipoEl = document.getElementById("create-item-subtipo");
  var precoEl = document.getElementById("create-item-preco");
  var volumeEl = document.getElementById("create-item-volume");
  var danoEl = document.getElementById("create-item-dano");
  var alcanceEl = document.getElementById("create-item-alcance");
  var recargaEl = document.getElementById("create-item-recarga");
  var tamborEl = document.getElementById("create-item-tambor");
  var protecaoEl = document.getElementById("create-item-protecao");
  var duracaoEl = document.getElementById("create-item-duracao");
  var detalhesEl = document.getElementById("create-item-detalhes");
  var descricaoEl = document.getElementById("create-item-descricao");

  var rawPreco = precoEl ? String(precoEl.value || "").trim() : "";
  var parsedNumPreco = rawPreco !== "" && !isNaN(Number(rawPreco)) ? Number(rawPreco) : rawPreco;
  var parsedVol = volumeEl ? parseVolumeNumber(volumeEl.value) : null;

  var groupVal = groupEl ? groupEl.value : "equipamentos";
  var subtipoVal = subtipoEl ? subtipoEl.value : "equipamentos_comuns";
  if (groupVal === "vestuario") subtipoVal = "vestuario";
  if (groupVal === "equipamentos" && subtipoVal !== "equipamentos_comuns") {
    subtipoVal = "itens_criados";
  }

  var newItem = {
    nome: nome,
    group: groupVal,
    listId: groupVal === "equipamentos" ? "itens_criados" : subtipoVal,
    preco: parsedNumPreco === "" ? 0 : parsedNumPreco,
    dano: danoEl ? String(danoEl.value || "").trim() || null : null,
    alcance: alcanceEl ? String(alcanceEl.value || "").trim() || null : null,
    recarga: recargaEl ? String(recargaEl.value || "").trim() || null : null,
    tambor: tamborEl ? String(tamborEl.value || "").trim() || null : null,
    protecao: protecaoEl ? String(protecaoEl.value || "").trim() || null : null,
    duracao: duracaoEl ? String(duracaoEl.value || "").trim() || null : null,
    detalhes: detalhesEl ? String(detalhesEl.value || "").trim() || null : null,
    descricao: descricaoEl ? String(descricaoEl.value || "").trim() || null : null
  };
  if (parsedVol !== null) {
    newItem.volume = parsedVol;
  }

  if (OS.loadCustomItems) {
    await OS.loadCustomItems();
  }
  if (!Array.isArray(OS.customItems)) OS.customItems = [];
  OS.customItems = OS.customItems.filter(function (x) {
    return String(x.nome || "").trim().toLowerCase() !== nome.toLowerCase();
  });
  OS.customItems.push(newItem);

  if (OS.saveCustomItems) {
    await OS.saveCustomItems();
  }

  // Limpar campos do formulário
  [nomeEl, precoEl, volumeEl, danoEl, alcanceEl, recargaEl, tamborEl, protecaoEl, duracaoEl, detalhesEl, descricaoEl].forEach(function (inp) {
    if (inp) inp.value = "";
  });
  if (groupEl) groupEl.value = "equipamentos";
  if (subtipoEl) subtipoEl.value = "equipamentos_comuns";

  toggleCreateItemForm(false);
  selectGroup("criados");
  state.activeItem = newItem;
  renderItemList();
  renderItemDetail();
  updateConfirmButton();

  if (hint) {
    hint.classList.remove("catalog-error");
    hint.textContent = "✓ Item \"" + nome + "\" criado e salvo em itens_criados.json.";
  }
}

/* ─── abrir / fechar modal ──────────────────────────────────── */

function openCatalogModal(mode) {
  var overlay = el("catalog-modal");
  if (!overlay) return;

  if (mode === "gm" && !(OS.activeMesaState && OS.activeMesaState.isMestre)) return;
  state.mode = mode === "gm" ? "gm" : mode === "loot" ? "loot" : mode === "creation" ? "creation" : mode === "craft" ? "craft" : "buy";
  var gmMode = state.mode === "gm";
  el("catalog-money-display").hidden = gmMode;
  el("catalog-recipient-label").hidden = !gmMode;
  el("catalog-dest-select").hidden = gmMode;
  document.querySelector('label[for="catalog-dest-select"]').hidden = gmMode;
  el("catalog-recipient").replaceChildren();
  if (gmMode) {
    var placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Selecionar jogador da mesa"; el("catalog-recipient").appendChild(placeholder);
    (OS.activeMesaState.playerSheets || []).forEach(function (sheet) {
      var opt = document.createElement("option"); opt.value = sheet.id; opt.textContent = sheet.nome_personagem || (sheet.dados || {}).nome || "Personagem"; el("catalog-recipient").appendChild(opt);
    });
  }
  state.activeItem = null;
  state.activeVariant = null;
  state.filterText = "";

  var searchEl = el("catalog-search");
  if (searchEl) searchEl.value = "";

  var hint = el("catalog-modal-hint");
  if (hint) {
    hint.textContent = "";
    hint.classList.remove("catalog-error");
  }

  var titleEl = el("catalog-modal-title");
  var subEl = el("catalog-modal-sub");
  var confirmBtn = el("catalog-confirm");

  if (state.mode === "gm") {
    if (titleEl) titleEl.textContent = "Equipamentos — Mestre";
    if (subEl) subEl.textContent = "Consulte, crie e conceda itens aos jogadores da mesa.";
    if (confirmBtn) confirmBtn.textContent = "🎁 Enviar para Jogador";
  } else if (state.mode === "loot") {
    if (titleEl) titleEl.textContent = "Catálogo — Loot";
    if (subEl) subEl.textContent = "Adicione itens encontrados sem descontar dinheiro.";
    if (confirmBtn) confirmBtn.textContent = "Adicionar (Loot)";
  } else if (state.mode === "creation") {
    if (titleEl) titleEl.textContent = "Compras Iniciais — Criação de Personagem";
    if (subEl) subEl.textContent = "O primeiro item comprado custa metade (50%) do valor tabelado.";
    if (confirmBtn) confirmBtn.textContent = "Comprar item";
  } else if (state.mode === "craft") {
    if (titleEl) titleEl.textContent = "Catálogo — Escolher Receita para Fabricar";
    if (subEl) subEl.textContent = "Selecione um item para fabricar no Tempo Livre (custo de materiais: 50% do valor tabelado).";
    if (confirmBtn) confirmBtn.textContent = "Selecionar para Fabricar";
  } else {
    if (titleEl) titleEl.textContent = "Catálogo";
    if (subEl) subEl.textContent = "Consulte um item e compre para o inventário.";
    if (confirmBtn) confirmBtn.textContent = "Adicionar ao inventário";
  }

  var qtyEl = el("catalog-qty");
  if (qtyEl) qtyEl.value = "1";
  var destEl = document.getElementById("catalog-dest-select");
  if (destEl) destEl.value = "solto";

  toggleCreateItemForm(false);
  updateMoneyBadge();
  updateConfirmButton();

  Promise.all([
    OS.loadEquipCatalog ? OS.loadEquipCatalog() : Promise.resolve(),
    OS.loadCustomItems ? OS.loadCustomItems() : Promise.resolve()
  ])
    .then(function () {
      if (!state.activeGroup) {
        for (var g = 0; g < GROUP_ORDER.length; g++) {
          if (GROUP_ORDER[g] !== "criados" && OS.equipCatalog.byGroup[GROUP_ORDER[g]]) {
            state.activeGroup = GROUP_ORDER[g];
            var records = OS.getEquipCatalogGroup(state.activeGroup);
            if (records.length) state.activeListId = records[0].id;
            break;
          }
        }
      }

      renderGroupTabs();
      renderListTabs();
      renderItemList();
      renderItemDetail();
      updateConfirmButton();
    })
    .catch(function (err) {
      console.error("[catalogModal] erro ao carregar catálogo:", err);
    });

  overlay.classList.add("open");
  overlay.removeAttribute("hidden");
}
OS.openCatalogModal = openCatalogModal;

function closeCatalogModal() {
  var overlay = el("catalog-modal");
  if (!overlay) return;
  overlay.classList.remove("open");
  if (typeof OS._onCreationCatalogClose === "function") {
    var cb = OS._onCreationCatalogClose;
    OS._onCreationCatalogClose = null;
    cb();
  }
}
OS.closeCatalogModal = closeCatalogModal;

/* ─── bind de eventos ───────────────────────────────────────── */

OS.bindCatalogModal = function () {
  var btnOpen = document.getElementById("btn-catalogo");
  if (btnOpen) {
    btnOpen.addEventListener("click", function () {
      openCatalogModal("buy");
    });
  }

  var btnLoot = document.getElementById("btn-loot");
  if (btnLoot) {
    btnLoot.addEventListener("click", function () {
      openCatalogModal("loot");
    });
  }

  var btnCreate = document.getElementById("btn-catalog-create-item");
  if (btnCreate) {
    btnCreate.addEventListener("click", function () {
      toggleCreateItemForm();
    });
  }

  var btnCancelCreate = document.getElementById("btn-cancel-created-item");
  if (btnCancelCreate) {
    btnCancelCreate.addEventListener("click", function () {
      toggleCreateItemForm(false);
    });
  }

  var btnSaveCreate = document.getElementById("btn-save-created-item");
  if (btnSaveCreate) {
    btnSaveCreate.addEventListener("click", function () {
      handleSaveCreatedItem();
    });
  }

  var btnCancel = document.getElementById("catalog-cancel");
  if (btnCancel) {
    btnCancel.addEventListener("click", closeCatalogModal);
  }

  var overlay = document.getElementById("catalog-modal");
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeCatalogModal();
    });
  }

  var btnConfirm = document.getElementById("catalog-confirm");
  if (btnConfirm) {
    btnConfirm.addEventListener("click", addToInventory);
  }

  var searchEl = document.getElementById("catalog-search");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      state.filterText = searchEl.value;
      state.activeItem = null;
      state.activeVariant = null;
      renderItemList();
      renderItemDetail();
      updateConfirmButton();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var over = document.getElementById("catalog-modal");
      if (over && over.classList.contains("open")) closeCatalogModal();
    }
  });
};
