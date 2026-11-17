/**
 * Rolagem, cálculos e integração com bônus do tambor
 */
import { OS } from "./app.js";
import {
  generateDiceResult,
  rollSelectedDice,
  rollSelectedDiceDetailed,
  hasAnyExplosion,
  getHighestRoll,
  calculateRollTotal,
  calculateFinalRoll,
  calculateChamberBonus
} from "./rules/index.js";

OS.rollModalState = {
  title: "Rolagem",
  subtitle: "",
  dice: [],
  finalResults: [],
  rollDetails: []
};

OS.lastSkillRollContext = null;

OS.getSelectedDice = function (rowEl) {
  if (!rowEl) return [];
  var inputs = rowEl.querySelectorAll("input.die-checkbox:checked");
  var dice = [];
  inputs.forEach(function (i) {
    dice.push(i.value);
  });
  return dice;
};

OS.generateDiceResult = generateDiceResult;
OS.rollSelectedDice = rollSelectedDice;
OS.rollSelectedDiceDetailed = rollSelectedDiceDetailed;
OS.hasAnyExplosion = hasAnyExplosion;
OS.getHighestRoll = getHighestRoll;
OS.calculateRollTotal = calculateRollTotal;

OS.chamberValueAt = function (index) {
  var inp = OS.$("chamber-" + index);
  if (!inp) return 0;
  var n = parseInt(String(inp.value || ""), 10);
  return isNaN(n) ? 0 : n;
};

OS.calculateChamberBonus = calculateChamberBonus;
OS.calculateFinalRoll = calculateFinalRoll;

OS.formatRoll = function (dice, results, total) {
  var parts = [];
  for (var i = 0; i < dice.length; i++) {
    parts.push(dice[i] + "(" + results[i] + ")");
  }
  return parts.join(" + ") + " = " + total;
};

OS.formatSkillRollSummary = function (dice, results, highest, bonus, total, buffBonus) {
  var parts = [];
  for (var i = 0; i < dice.length; i++) {
    parts.push(dice[i] + "(" + results[i] + ")");
  }
  var text = parts.join(" · ") + " — Base " + highest;
  if (bonus > 0) text += " +" + bonus + " tambor";
  if (buffBonus) text += " +" + buffBonus + " buffs";
  text += " = " + total;
  return text;
};

OS.finishSkillRoll = function (baseResult, chosenDetail) {
  var st = OS.chamberSelectionState || {};
  var selected = st.selectedChambers || [];
  var dice = st.dice || OS.rollModalState.dice || [];
  var final = (st.results && st.results.length ? st.results : OS.rollModalState.finalResults) || [];
  var isXerife = !!st.xerifePoolMode;
  var bonus = isXerife ? (Number(st.consumedBonus) || 0) : OS.calculateChamberBonus(selected);
  var skillKey = (st.rowEl && st.rowEl.getAttribute("data-skill-key")) || "";
  var skillName = st.skillName || "Perícia";
  var buffEval = OS.evaluateSkillRollBuffs
    ? OS.evaluateSkillRollBuffs(skillKey, skillName)
    : { total: 0, items: [] };
  var buffBonus = buffEval.total || 0;
  var total = (baseResult || 0) + bonus + buffBonus;
  var chamberValues = [];
  if (isXerife) {
    chamberValues = Array.isArray(st.consumedValues) ? st.consumedValues.slice() : [];
  } else {
    for (var c = 0; c < selected.length; c++) {
      chamberValues.push(OS.chamberValueAt(selected[c]));
    }
  }

  if (!isXerife && selected.length) OS.consumeCylinderChambers(selected);
  OS.updateReloadButtonState();

  var outEl = st.outEl;
  if (outEl) {
    var text = OS.formatSkillRollSummary(
      dice,
      final,
      baseResult,
      bonus,
      total,
      buffBonus
    );
    if (chosenDetail && chosenDetail.exploded && chosenDetail.parts) {
      text +=
        " | " +
        chosenDetail.die +
        " explodiu: " +
        chosenDetail.parts.join(" + ") +
        " = " +
        chosenDetail.total;
    }
    outEl.textContent = text;
    outEl.classList.add("rolled");
  }

  OS.lastSkillRollContext = {
    rowEl: st.rowEl || null,
    outEl: outEl || null,
    skillKey: skillKey,
    skillName: skillName,
    dice: (dice || []).slice(),
    results: (final || []).slice(),
    baseResult: baseResult || 0,
    bonus: bonus || 0,
    buffBonus: buffBonus,
    buffItems: buffEval.items || [],
    total: total || 0
  };

  var rollMeta = {
    exploded: !!(chosenDetail && chosenDetail.exploded),
    naturalOne:
      chosenDetail && Array.isArray(chosenDetail.parts) && chosenDetail.parts.length > 0
        ? chosenDetail.parts[0] === 1
        : baseResult === 1,
    naturalRoll:
      chosenDetail && Array.isArray(chosenDetail.parts) && chosenDetail.parts.length > 0
        ? chosenDetail.parts[0]
        : baseResult,
    baseResult: baseResult || 0,
    detail: chosenDetail || null
  };

  if (OS.evaluateTestResult) {
    OS.evaluateTestResult(total, skillName, undefined, rollMeta);
  }

  OS.scheduleSave();
  if (OS.closeExplosionChoiceModal) OS.closeExplosionChoiceModal();
  if (OS.openFinalRollResultModal) {
    OS.openFinalRollResultModal(baseResult, chamberValues, bonus, total, buffEval.items);
  } else {
    OS.closeRollModal();
  }
};

OS.clearRollVisualState = function () {
  var ficha = document.getElementById("ficha");
  var scope = ficha || document;
  scope.querySelectorAll(".roll-result").forEach(function (el) {
    el.textContent = "";
    el.classList.remove("rolled");
    if (el.id && el.id.indexOf("combate-") === 0) {
      el.hidden = true;
      el.setAttribute("hidden", "");
    }
  });

  if (Array.isArray(OS.inventoryItems)) {
    OS.inventoryItems.forEach(function (item) {
      if (!item) return;
      delete item.lastWeaponRoll;
      delete item.lastSkillRollPart;
      delete item.lastDamageRollPart;
      delete item.lastChamberBonusPart;
      delete item.lastBuffBonusPart;
      item.lastWeaponRollText = "";
      item.lastMeleeRollText = "";
      item.lastRangedRollText = "";
    });
  }

  if (OS.unarmedPseudoWeapon) {
    delete OS.unarmedPseudoWeapon.lastWeaponRoll;
    delete OS.unarmedPseudoWeapon.lastSkillRollPart;
    delete OS.unarmedPseudoWeapon.lastDamageRollPart;
    delete OS.unarmedPseudoWeapon.lastChamberBonusPart;
    delete OS.unarmedPseudoWeapon.lastBuffBonusPart;
    OS.unarmedPseudoWeapon.lastWeaponRollText = "";
    OS.unarmedPseudoWeapon.lastMeleeRollText = "";
    OS.unarmedPseudoWeapon.lastRangedRollText = "";
  }

  OS.naturalAttackRollResults = {};

  scope.querySelectorAll(".weapon-roll-result").forEach(function (el) {
    el.textContent = "";
    el.classList.remove("rolled");
    el.hidden = true;
    el.setAttribute("hidden", "");
  });

  if (OS.renderFichaEquippedItems) {
    OS.renderFichaEquippedItems();
  }

  OS.lastSkillRollContext = null;
  OS.rollModalState.dice = [];
  OS.rollModalState.finalResults = [];
  OS.rollModalState.rollDetails = [];

  if (OS.chamberSelectionState) {
    OS.chamberSelectionState.baseTotal = 0;
    OS.chamberSelectionState.dice = [];
    OS.chamberSelectionState.results = [];
    OS.chamberSelectionState.selectedChambers = [];
    OS.chamberSelectionState.rowEl = null;
    OS.chamberSelectionState.outEl = null;
    OS.chamberSelectionState.preRoll = false;
    OS.chamberSelectionState.isWeaponRoll = false;
    OS.chamberSelectionState.requireMinOneChamber = false;
    OS.chamberSelectionState.weaponInvId = null;
    OS.chamberSelectionState.weaponSlotCategory = null;
  }

  if (OS.explosionChoiceState) {
    OS.explosionChoiceState.details = [];
    OS.explosionChoiceState.selectedIndex = null;
  }

  if (OS.closeRollModal) OS.closeRollModal();
  if (OS.closeChamberModal) OS.closeChamberModal();
  if (OS.closeExplosionChoiceModal) OS.closeExplosionChoiceModal();
};

/**
 * Limpa exclusivamente os resultados da última rolagem de cada perícia da ficha atual,
 * mantendo todos os demais dados (perícias, inventário, dinheiro, nível, 6B, Fichas do Destino, magias, etc.) intactos.
 */
OS.clearRollResultsOnly = function () {
  if (OS.clearRollVisualState) {
    OS.clearRollVisualState();
  } else {
    var ficha = document.getElementById("ficha");
    var scope = ficha || document;
    scope.querySelectorAll(".roll-result").forEach(function (el) {
      el.textContent = "";
      el.classList.remove("rolled");
    });
  }
  if (OS.saveToStorage) {
    OS.saveToStorage();
  }
  if (OS.setStatus) {
    OS.setStatus("Rolagens limpas", true);
  }
};

OS.applyCylinderBonuses = async function () {
  var st = OS.chamberSelectionState || {};
  var selected = st.selectedChambers || [];

  // Regra obrigatória para rolagem de armas equipadas: exige pelo menos 1 valor do 6B
  if (st.requireMinOneChamber && (!selected || selected.length < 1)) {
    var hint = OS.$("chamber-modal-hint");
    if (hint) {
      hint.textContent = "Selecione pelo menos 1 valor do 6B para confirmar a rolagem da arma.";
    }
    return false;
  }

  if (st.xerifePoolMode) {
    if (st._consumingXerife) return false;
    var snap = OS.getXerife6BSnapshot ? OS.getXerife6BSnapshot("aberto") : null;
    var resultados = (snap && Array.isArray(snap.resultados)) ? snap.resultados : [];
    var chosenXerife = selected.slice();
    var consumedValues = chosenXerife.map(function (idx) {
      var v = Number(resultados[idx]);
      return Number.isFinite(v) ? v : 0;
    });
    var consumedBonus = consumedValues.reduce(function (acc, v) { return acc + v; }, 0);

    if (chosenXerife.length > 0) {
      st._consumingXerife = true;
      if (OS.updateChamberModalUi) OS.updateChamberModalUi();
      var ok = false;
      try {
        ok = OS.consumeXerife6B ? await OS.consumeXerife6B("aberto", chosenXerife) : false;
      } finally {
        st._consumingXerife = false;
      }
      if (!ok) {
        var hintErr = OS.$("chamber-modal-hint");
        if (hintErr) {
          hintErr.textContent = "Não foi possível consumir o 6B Aberto. Atualize os dados disponíveis.";
        }
        if (OS.renderChamberGrid) OS.renderChamberGrid();
        if (OS.updateChamberModalUi) OS.updateChamberModalUi();
        return false;
      }
    }

    st.consumedValues = consumedValues;
    st.consumedBonus = consumedBonus;

    if (st.isCreaturePopupAttack && typeof st.creatureAttackCallback === "function") {
      var cb = st.creatureAttackCallback;
      st.creatureAttackCallback = null;
      OS.closeChamberModal();
      return cb(chosenXerife, consumedValues, consumedBonus);
    }
  }

  if (st.isWeaponRoll) {
    var invId = st.weaponInvId;
    var slotCat = st.weaponSlotCategory;
    var chosen = selected.slice();
    OS.closeChamberModal();
    if (OS.executeConfirmedWeaponRoll) {
      return OS.executeConfirmedWeaponRoll(invId, slotCat, chosen);
    }
    return null;
  }

  if (st.preRoll) {
    var dice = st.dice || [];
    var title = st.skillName || "Rolagem";
    var subtitle = st.subtitle || "Rolagem";

    OS.closeChamberModal();
    OS.openRollModal(title, subtitle, dice);

    var attempts = 0;
    function waitAndResolveRoll() {
      var final = OS.rollModalState.finalResults || [];
      if (!final.length) {
        if (attempts < 12) {
          attempts += 1;
          window.setTimeout(waitAndResolveRoll, 70);
        }
        return;
      }

      var details = OS.rollModalState.rollDetails || [];
      if (OS.hasAnyExplosion(details)) {
        OS.openExplosionChoiceModal(details);
        return;
      }

      var highest = OS.getHighestRoll(final);
      var bestDetail = null;
      for (var dIdx = 0; dIdx < details.length; dIdx++) {
        if (details[dIdx] && details[dIdx].total === highest) {
          bestDetail = details[dIdx];
          break;
        }
      }
      OS.finishSkillRoll(highest, bestDetail);
    }

    window.setTimeout(waitAndResolveRoll, 620);
  } else {
    var isXerifeElse = !!st.xerifePoolMode;
    var bonus = isXerifeElse ? (Number(st.consumedBonus) || 0) : OS.calculateChamberBonus(selected);
    var highest = st.baseTotal || 0;
    var legacySkillKey = (st.rowEl && st.rowEl.getAttribute("data-skill-key")) || "";
    var legacySkillName = st.skillName || "Perícia";
    var legacyBuffEval = OS.evaluateSkillRollBuffs
      ? OS.evaluateSkillRollBuffs(legacySkillKey, legacySkillName)
      : { total: 0, items: [] };
    var legacyBuffBonus = legacyBuffEval.total || 0;
    var total = highest + bonus + legacyBuffBonus;

    if (!isXerifeElse && selected.length && OS.consumeCylinderChambers) {
      OS.consumeCylinderChambers(selected);
    }
    OS.updateReloadButtonState();

    var outEl = st.outEl;
    var diceLegacy = st.dice;
    var results = st.results;

    if (outEl) {
      outEl.textContent = OS.formatSkillRollSummary(
        diceLegacy,
        results,
        highest,
        bonus,
        total,
        legacyBuffBonus
      );
      outEl.classList.add("rolled");
    }

    OS.lastSkillRollContext = {
      rowEl: st.rowEl || null,
      outEl: outEl || null,
      skillKey: legacySkillKey,
      skillName: legacySkillName,
      dice: (diceLegacy || []).slice(),
      results: (results || []).slice(),
      baseResult: highest || 0,
      bonus: bonus || 0,
      buffBonus: legacyBuffBonus,
      buffItems: legacyBuffEval.items || [],
      total: total || 0
    };

    if (OS.evaluateTestResult) {
      OS.evaluateTestResult(total, st.skillName || "Perícia", undefined, {
        exploded: false,
        naturalOne: highest === 1,
        naturalRoll: highest,
        baseResult: highest
      });
    }

    OS.scheduleSave();
    OS.closeChamberModal();
    OS.closeRollModal();
  }
};

OS.rollRowDice = function (rowEl, subtitle) {
  var dice = OS.getSelectedDice(rowEl);
  var btn = rowEl.querySelector(".roll-btn");
  var out = rowEl.querySelector(".roll-result");
  if (!out) return;

  if (!dice.length) {
    out.classList.remove("rolled");
    out.textContent = "Selecione pelo menos 1 dado";
    return;
  }

  if (btn) {
    btn.classList.remove("rolling");
    void btn.offsetWidth;
    btn.classList.add("rolling");
  }

  var labelEl = rowEl.querySelector(".skill-title");
  var title = labelEl ? labelEl.textContent : "Rolagem";

  OS.openChamberSelectionModal(
    null,
    dice,
    null,
    rowEl,
    out,
    title,
    subtitle || "Rolagem"
  );
};

OS.createDieCell = function (groupName, die) {
  var label = document.createElement("label");
  label.className = "die-label die-" + die;
  label.title = die;

  var input = document.createElement("input");
  input.type = "checkbox";
  input.className = "die-checkbox";
  input.name = groupName + "-" + die;
  input.id = groupName + "-" + die;
  input.value = die;

  var shape = document.createElement("span");
  shape.className = "die-shape";
  shape.setAttribute("aria-hidden", "true");

  label.appendChild(input);
  label.appendChild(shape);
  return label;
};
