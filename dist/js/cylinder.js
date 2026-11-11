/**
 * Tambor do revólver — câmaras, consumo, recarga e stats
 */
import { OS } from "./app.js";
import {
  canReloadCylinder,
  isCylinderEmpty,
  getUpdatedUsedChambers,
  sanitizeChamberValue,
  calculateDefense,
  calculateInitiative,
  calculateActionsFromInitiative,
  calculateMovementPerAction,
  BASE_MOVEMENT_METERS,
  applyShortRest,
  applyLongRest,
  calculateFatiguePenalty,
  applyFatigueTo6BRoll,
  getMisticismoLevel,
  calculateRemMax,
  levelToDice,
  diceToLevel
} from "./rules/index.js";

OS.usedChambers = [];
OS.damagedChambers = [];
OS.restoreRealDamageVisuals = function () {
  (OS.damagedChambers || []).forEach(function (i) {
    if (OS.usedChambers.indexOf(i) < 0) OS.usedChambers.push(i);
    var cb = OS.$("chamber-" + i + "-mark"), cell = OS.getChamberElement(i);
    if (cb) { cb.checked = true; cb.dataset.manualDamageBlocked = "1"; }
    if (cell) cell.classList.add("used", "marked", "damaged");
  });
};
OS.fatigueZeroedChambers = [];
OS.fatigueZeroAddedUsed = [];

  var cylinderEventsBound = false;

  OS.getChamberElement = function (index) {
    var byStyle = document.querySelector('.chamber[style*="--i:' + index + '"]');
    if (byStyle) return byStyle;
    var chambers = document.querySelectorAll("#cylinder .chamber");
    return chambers[index] || null;
  };

  OS.isChamberControlKey = function (key) {
    return (
      key === "Backspace" ||
      key === "Delete" ||
      key === "Tab" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Home" ||
      key === "End"
    );
  };

  OS.sanitizeChamberValue = sanitizeChamberValue;

  OS.toIntOrZero = function (value) {
    var n = parseInt(String(value || ""), 10);
    return isNaN(n) ? 0 : n;
  };

  OS.applyChamberValue = function (input) {
    var clean = OS.sanitizeChamberValue(input.value);
    if (input.value !== clean) {
      input.value = clean;
    }
  };

  OS.getChamberBaseValue = function (index) {
    var input = OS.$("chamber-" + index);
    if (!input) return 0;
    var originalVal = input.getAttribute("data-original-val");
    if (originalVal !== null && originalVal !== "") {
      return OS.toIntOrZero(originalVal);
    }
    return OS.toIntOrZero(input.value);
  };

  OS.calculateBaseDefense = function () {
    var vals = [];
    for (var i = 0; i < 6; i++) {
      vals.push(OS.getChamberBaseValue(i));
    }
    return calculateDefense(vals);
  };

  OS.calculateDefense = function () {
    var baseDefesa = OS.calculateBaseDefense();
    var isVet = !!(OS.isVeterano || (OS.$("is-veterano") && OS.$("is-veterano").checked));
    var effectiveDefesa = (isVet && OS.getSceneTerrorLevel)
      ? Math.max(baseDefesa, OS.getSceneTerrorLevel())
      : baseDefesa;
    var buffBonus = OS.getActiveBuffDefenseBonus ? OS.getActiveBuffDefenseBonus() : 0;
    var overloadPenalty =
      (OS.getOverloadPenalties && OS.getOverloadPenalties().defensePenalty) || 0;
    return effectiveDefesa + buffBonus - overloadPenalty;
  };

  OS.calculateInitiative = function () {
    var vals = [];
    for (var i = 0; i < 6; i++) {
      vals.push(OS.getChamberBaseValue(i));
    }
    var baseInit = calculateInitiative(vals);
    var buffBonus = OS.getActiveBuffInitiativeBonus ? OS.getActiveBuffInitiativeBonus() : 0;
    return baseInit + buffBonus;
  };

  OS.BASE_MOVEMENT_METERS = BASE_MOVEMENT_METERS;

  OS.calculateInitiativeActionsBreakdown = function () {
    var initScore = OS.calculateInitiative();
    var ov = OS.getOverloadPenalties ? OS.getOverloadPenalties() : { overloaded: false, bonusActionsLost: 2 };
    return calculateActionsFromInitiative(initScore, !!ov.overloaded, ov.bonusActionsLost);
  };

  OS.calculateActionsPerTurn = function () {
    return OS.calculateInitiativeActionsBreakdown().totalActions;
  };

  OS.calculateMovementBreakdown = function () {
    var ov = OS.getOverloadPenalties ? OS.getOverloadPenalties() : { overloaded: false, movementPenaltyMeters: 3 };
    return calculateMovementPerAction(OS.BASE_MOVEMENT_METERS, !!ov.overloaded, ov.movementPenaltyMeters);
  };

  OS.calculateMovementPerAction = function () {
    return OS.calculateMovementBreakdown().effectiveMeters;
  };

  OS.updateStatsFields = function (animate) {
    var defesaEl = OS.$("defesa");
    var iniciativaEl = OS.$("iniciativa");
    if (!defesaEl || !iniciativaEl) return;

    var allChambersZero = true;
    for (var ci = 0; ci < 6; ci++) {
      if (OS.getChamberBaseValue(ci) !== 0) {
        allChambersZero = false;
        break;
      }
    }
    var hasManualDef =
      String(defesaEl.value || "").trim() !== "" && OS.toIntOrZero(defesaEl.value) > 0;
    var preserveManualStats = !!OS.freeEdit || (allChambersZero && hasManualDef);

    if (!preserveManualStats) {
      var defesa = OS.calculateDefense();
      var iniciativa = OS.calculateInitiative();

      defesaEl.value = String(defesa);
      iniciativaEl.value = String(iniciativa);
    }

    var actInfo = OS.calculateInitiativeActionsBreakdown();
    var movInfo = OS.calculateMovementBreakdown();
    var ov = OS.getOverloadPenalties
      ? OS.getOverloadPenalties()
      : { overloaded: false, looseCount: 0, capacity: 2, defensePenalty: 0, bonusActionsLost: 0, movementPenaltyMeters: 0 };

    var acoesEl = OS.$("acoes-turno-display");
    if (acoesEl) {
      acoesEl.textContent = ov.overloaded
        ? actInfo.totalActions + " (-" + ov.bonusActionsLost + " bônus)"
        : String(actInfo.totalActions);
      acoesEl.classList.toggle("over-limit", !!ov.overloaded);
    }

    var movEl = OS.$("movimento-acao-display");
    if (movEl) {
      movEl.textContent = ov.overloaded
        ? movInfo.effectiveMeters + "m (-" + ov.movementPenaltyMeters + "m)"
        : movInfo.effectiveMeters + "m";
      movEl.classList.toggle("over-limit", !!ov.overloaded);
    }

    var fichaLoadEl = OS.$("ficha-carga-solta-display");
    if (fichaLoadEl) {
      fichaLoadEl.textContent = ov.looseCount + " / " + ov.capacity + " itens";
      fichaLoadEl.classList.toggle("over-limit", !!ov.overloaded);
    }

    var fichaOvAlert = OS.$("ficha-overload-alert");
    if (fichaOvAlert) {
      if (ov.overloaded) {
        fichaOvAlert.textContent =
          "Sobrecarregado (" +
          ov.looseCount +
          "/" +
          ov.capacity +
          " itens soltos): -" +
          ov.defensePenalty +
          " na Defesa, -" +
          ov.bonusActionsLost +
          " ações bônus de Iniciativa e -" +
          ov.movementPenaltyMeters +
          "m de movimento por ação.";
        fichaOvAlert.removeAttribute("hidden");
      } else {
        fichaOvAlert.textContent = "";
        fichaOvAlert.setAttribute("hidden", "");
      }
    }

    if (OS.updateStorageStatusBars) {
      OS.updateStorageStatusBars();
    }

    if (animate) {
      OS.flashField(defesaEl);
      OS.flashField(iniciativaEl);
    }
  };

  OS.isCylinderEmpty = function () {
    return isCylinderEmpty(OS.usedChambers);
  };

  OS.updateReloadButtonState = function () {
  var btn = OS.$("btn-roll");
  if (!btn) return;

  if (OS.hasPerformedInitialReload === false) {
    btn.classList.add("empty");
    btn.classList.remove("locked");
    btn.disabled = false;
    btn.textContent = "Rolar 6 Bullets";
    btn.setAttribute("aria-label", "Rolar 6 Bullets no tambor — carga inicial");
    return;
  }

  // Se o jogador usou as 6 câmaras (array cheio com os índices de 0 a 5), o tambor está VAZIO.
  if (canReloadCylinder(OS.usedChambers)) {
    btn.classList.add("empty");
    btn.classList.remove("locked");
    btn.disabled = false;
    btn.textContent = "Recarregar Tambor";
    btn.setAttribute("aria-label", "Recarregar tambor — gera 6 novos bullets");
  } else {
    // Se usou entre 0 e 5 câmaras, significa que ainda existem balas utilizáveis (ou o tambor acabou de ser recarregado/iniciado).
    // O botão fica completamente TRAVADO, impedindo spam de recarga e acúmulo infinito de fadiga.
    btn.classList.remove("empty");
    btn.classList.add("locked");
    btn.disabled = true;
    btn.textContent = "Tambor Cheio";
    btn.setAttribute("aria-label", "Tambor possui munição — gaste todas as câmaras para poder recarregar");
  }
};

  OS.getMarkedChambers = function () {
    var marked = [];
    for (var i = 0; i < 6; i++) {
      var cb = OS.$("chamber-" + i + "-mark");
      if (cb && cb.checked) marked.push(i);
    }
    return marked;
  };

  OS.setMarkedChambers = function (indices) {
    for (var i = 0; i < 6; i++) {
      var cb = OS.$("chamber-" + i + "-mark");
      if (!cb) continue;
      cb.checked = !!(indices && indices.indexOf(i) >= 0);
    }
    OS.syncMarkedChambersVisual();
  };

  OS.syncMarkedChambersVisual = function () {
    for (var i = 0; i < 6; i++) {
      var chamberEl = OS.getChamberElement(i);
      var cb = OS.$("chamber-" + i + "-mark");
      if (!chamberEl || !cb) continue;
      chamberEl.classList.toggle("marked", cb.checked);
    }
  };

  OS.syncUsedChambersVisual = function (skipAnimation) {
    var activeLimit = 6;
    if (OS.freeEdit && typeof OS.get6BDiceArray === "function") {
      activeLimit = Math.max(1, Math.min(6, OS.get6BDiceArray().length || 1));
    }
    for (var i = 0; i < 6; i++) {
      var chamberEl = OS.getChamberElement(i);
      var isExcess = !!(OS.freeEdit && i >= activeLimit);
      var isUsed = isExcess || OS.usedChambers.indexOf(i) >= 0;
      if (chamberEl) {
        chamberEl.classList.toggle("used", isUsed);
        chamberEl.classList.toggle("chamber-excess-slot", isExcess);
      }
      var inp = OS.$("chamber-" + i);
      var cb = OS.$("chamber-" + i + "-mark");
      if (isExcess) {
        if (inp) {
          inp.value = "0";
          inp.removeAttribute("data-original-val");
          inp.disabled = true;
        }
        if (cb) {
          cb.checked = false;
          cb.disabled = true;
        }
      } else if (!OS.isReadOnlySheet) {
        if (inp && inp.getAttribute("data-ro-disabled") !== "1") {
          inp.disabled = false;
        }
        if (cb && cb.getAttribute("data-ro-disabled") !== "1") {
          cb.disabled = false;
        }
      }
    }
  };

  OS.markChambersAsUsed = function (indices, skipAnimation) {
    if (!indices || !indices.length) return;
    OS.usedChambers = getUpdatedUsedChambers(OS.usedChambers, indices);

    indices.forEach(function (idx) {
      var chamberEl = OS.getChamberElement(idx);
      if (!chamberEl) return;

      chamberEl.classList.add("used");
      if (!skipAnimation) {
        chamberEl.classList.add("consuming");
        window.setTimeout(function (el) {
          el.classList.remove("consuming");
        }, 480, chamberEl);
      }
    });
  };

  OS.consumeCylinderChambers = function (selectedIndices) {
    OS.markChambersAsUsed(selectedIndices, false);
  };

  OS.resetCylinderState = function () {
    OS.usedChambers = [];
    OS.fatigueZeroedChambers = [];
    OS.fatigueZeroAddedUsed = [];
    for (var i = 0; i < 6; i++) {
      var chamberEl = OS.getChamberElement(i);
      if (chamberEl) {
        chamberEl.classList.remove(
          "used",
          "consuming",
          "damaged",
          "fatigue-damaged",
          "marked"
        );
      }
    }
    OS.updateReloadButtonState();
  };

  /**
   * Sincroniza checkbox + classes CSS de câmaras zeradas por fadiga
   * no mesmo ciclo de render (sem depender de clique externo).
   */
  OS.syncFatigueZeroVisuals = function (zeroedIndices) {
    var nextZeroed = (zeroedIndices || []).slice();
    var prevZeroed = OS.fatigueZeroedChambers || [];
    var addedUsed = OS.fatigueZeroAddedUsed || [];

    for (var p = 0; p < prevZeroed.length; p++) {
      var prevIdx = prevZeroed[p];
      if (nextZeroed.indexOf(prevIdx) !== -1) continue;

      var prevEl = OS.getChamberElement(prevIdx);
      var prevCb = OS.$("chamber-" + prevIdx + "-mark");
      if (prevCb) prevCb.checked = false;
      if (prevEl) {
        prevEl.classList.remove("fatigue-damaged", "damaged", "marked");
      }
      if (addedUsed.indexOf(prevIdx) !== -1) {
        var upos = OS.usedChambers.indexOf(prevIdx);
        if (upos !== -1) OS.usedChambers.splice(upos, 1);
        if (prevEl) prevEl.classList.remove("used");
      }
    }

    OS.fatigueZeroAddedUsed = addedUsed.filter(function (idx) {
      return nextZeroed.indexOf(idx) !== -1;
    });

    for (var i = 0; i < nextZeroed.length; i++) {
      var zi = nextZeroed[i];
      var el = OS.getChamberElement(zi);
      var cb = OS.$("chamber-" + zi + "-mark");

      if (cb) cb.checked = true;
      if (el) {
        el.classList.add("marked", "used", "damaged", "fatigue-damaged");
        void el.offsetWidth;
      }
      if (OS.usedChambers.indexOf(zi) === -1) {
        OS.usedChambers.push(zi);
        if (OS.fatigueZeroAddedUsed.indexOf(zi) === -1) {
          OS.fatigueZeroAddedUsed.push(zi);
        }
      }
    }

    OS.fatigueZeroedChambers = nextZeroed;
    OS.restoreRealDamageVisuals();
    OS.syncMarkedChambersVisual();
    OS.syncUsedChambersVisual(true);
    OS.updateReloadButtonState();
  };

  OS.markFatigueZeroChambers = function () {
    var zeroIndices = [];
    var activeLimit = 6;
    if (OS.freeEdit && typeof OS.get6BDiceArray === "function") {
      activeLimit = Math.max(1, Math.min(6, OS.get6BDiceArray().length || 1));
    }
    for (var i = 0; i < activeLimit; i++) {
      var input = OS.$("chamber-" + i);
      if (!input || !input.hasAttribute("data-original-val")) continue;
      if (OS.toIntOrZero(input.value) > 0) continue;
      if (OS.freeEdit && OS.toIntOrZero(input.getAttribute("data-original-val")) <= 0) continue;
      zeroIndices.push(i);
    }
    OS.syncFatigueZeroVisuals(zeroIndices);
  };

  OS.saveCylinderState = function () {
  var activeLimit = 6;
  if (OS.freeEdit && typeof OS.get6BDiceArray === "function") {
    activeLimit = Math.max(1, Math.min(6, OS.get6BDiceArray().length || 1));
  }
  var originalChambers = [];
  for (var i = 0; i < 6; i++) {
    if (OS.freeEdit && i >= activeLimit) {
      originalChambers.push("0");
      continue;
    }
    var inp = OS.$("chamber-" + i);
    originalChambers.push(inp ? (inp.getAttribute("data-original-val") || inp.value) : "0");
  }
  var cleanUsed = OS.usedChambers.slice(0, 6);
  if (OS.freeEdit) {
    cleanUsed = cleanUsed.filter(function (idx) {
      return idx >= 0 && idx < activeLimit;
    });
  }
  return {
    usedChambers: cleanUsed,
    markedChambers: OS.getMarkedChambers(),
    damagedChambers: (OS.damagedChambers || []).slice(),
    originalChambers: originalChambers // Salva os valores sem penalidade
  };
};

  OS.loadCylinderState = function (state) {
  if (!state || typeof state !== "object") return;
  OS.damagedChambers = OS.getRealDamagedChambers ? OS.getRealDamagedChambers(state, 6) : (state.damagedChambers || []).slice();
  document.querySelectorAll(".chamber-mark").forEach(function (cb) { delete cb.dataset.manualDamageBlocked; });

  var activeLimit = 6;
  if (OS.freeEdit && typeof OS.get6BDiceArray === "function") {
    activeLimit = Math.max(1, Math.min(6, OS.get6BDiceArray().length || 1));
  }

  if (state.usedChambers && Array.isArray(state.usedChambers)) {
    OS.usedChambers = state.usedChambers.slice(0, 6);
    if (OS.freeEdit) {
      OS.usedChambers = OS.usedChambers.filter(function (idx) {
        return idx >= 0 && idx < activeLimit;
      });
    }
    OS.syncUsedChambersVisual(true);
  } else {
    OS.resetCylinderState();
    if (OS.freeEdit) {
      OS.syncUsedChambersVisual(true);
    }
  }

  if (state.markedChambers && Array.isArray(state.markedChambers)) {
    var cleanMarked = state.markedChambers;
    if (OS.freeEdit) {
      cleanMarked = cleanMarked.filter(function (idx) {
        return idx >= 0 && idx < activeLimit;
      });
    }
    OS.setMarkedChambers(cleanMarked);
  }

  // Restaura os caches originais do localStorage
  if (state.originalChambers && Array.isArray(state.originalChambers)) {
    for (var i = 0; i < 6; i++) {
      var inp = OS.$("chamber-" + i);
      if (inp) {
        if (OS.freeEdit && i >= activeLimit) {
          inp.value = "0";
          inp.removeAttribute("data-original-val");
        } else {
          var origVal = state.originalChambers[i] || inp.value || "0";
          if (OS.freeEdit && OS.toIntOrZero(origVal) <= 0 && OS.toIntOrZero(inp.value) <= 0) {
            inp.removeAttribute("data-original-val");
          } else {
            inp.setAttribute("data-original-val", origVal);
          }
        }
      }
    }
  }

  OS.updateReloadButtonState();
  if (typeof OS.markFatigueZeroChambers === "function") {
    OS.markFatigueZeroChambers();
    // Após load, zeros atuais são tratados como fadiga para restore atômico
    OS.fatigueZeroAddedUsed = (OS.fatigueZeroedChambers || []).slice();
  }
};

  function rand1to6() {
    return ((Math.random() * 6) | 0) + 1;
  }

  OS.reloadCylinder = function () {
    var cylinder = OS.$("cylinder");
    var btn = OS.$("btn-roll");

    if (btn) {
      btn.disabled = true;
      btn.classList.add("rolling");
    }
    if (cylinder) cylinder.classList.add("reloading");

    window.setTimeout(function () {
      OS.resetCylinderState();

      for (var i = 0; i < 6; i++) {
        var input = OS.$("chamber-" + i);
        if (!input) continue;

        var rolled = rand1to6();
        var parsed = parseInt(rolled, 10);
        if (isNaN(parsed)) parsed = 0;

        input.value = String(parsed);
        input.setAttribute("data-original-val", String(parsed)); // Registra cache limpo
      OS.applyChamberValue(input);
  
  // Código subsequente de feedback visual de reload...
      var chamberEl = OS.getChamberElement(i);
      if (!chamberEl) continue;
      chamberEl.classList.remove("used", "consuming");
      var body = chamberEl.querySelector(".chamber-body");
      var inp = chamberEl.querySelector(".chamber-input");
      if (body) {
        body.classList.remove("reload-flash");
        void body.offsetWidth;
        body.classList.add("reload-flash");
      }
      if (inp) {
        inp.classList.remove("reload-flash");
        void inp.offsetWidth;
        inp.classList.add("reload-flash");
      }

        var chamberEl = OS.getChamberElement(i);
        if (!chamberEl) continue;
        chamberEl.classList.remove("used", "consuming");
        var body = chamberEl.querySelector(".chamber-body");
        var inp = chamberEl.querySelector(".chamber-input");
        if (body) {
          body.classList.remove("reload-flash");
          void body.offsetWidth;
          body.classList.add("reload-flash");
        }
        if (inp) {
          inp.classList.remove("reload-flash");
          void inp.offsetWidth;
          inp.classList.add("reload-flash");
        }
      }

      OS.updateStatsFields(true);

      if (cylinder) cylinder.classList.remove("reloading");
      if (btn) {
        btn.classList.remove("rolling");
        btn.disabled = false;
      }
      OS.updateReloadButtonState();
      OS.scheduleSave();
    }, 560);
  };

 OS.rollCylinderDice = function (forcedValues) {
  var isInitialReload = OS.hasPerformedInitialReload === false;
  var isFree = !!OS.freeEdit;

  if (!isInitialReload && !canReloadCylinder(OS.usedChambers)) {
    return;
  }

  // 1. GATILHO DA FADIGA (somente após a carga inicial)
  var hadSpentChambers = isFree
    ? (OS.usedChambers || []).length > 0 && canReloadCylinder(OS.usedChambers)
    : (OS.usedChambers || []).length === 6;
  if (!isInitialReload && hadSpentChambers) {
    if (typeof OS.incrementFadiga === "function") {
      OS.incrementFadiga();
    }
  }

  // 2. RESET DE ESTADO CRÍTICO: Esvazia o array e remove as classes .used e .consuming do DOM
  if (typeof OS.resetCylinderState === "function") {
    OS.resetCylinderState();
  } else {
    OS.usedChambers = [];
  }

  // 3. DESMARCAR CHECKBOXES: Garante que as seleções físicas voltem ao normal
  document.querySelectorAll(".chamber-mark").forEach(function (cb) {
    cb.checked = false;
  });

  if (typeof OS.syncMarkedChambersVisual === "function") {
    OS.syncMarkedChambersVisual();
  }

  // 4. MOTOR DE ROLAGEM: Sorteia novos dados e preenche as câmaras
  var inputs = document.querySelectorAll(".chamber-input");
  var novosResultadosDoTambor = [];
  var customRoll =
    Array.isArray(forcedValues) && forcedValues.length > 0
      ? forcedValues
      : Array.isArray(OS._next6BRollValues) && OS._next6BRollValues.length > 0
      ? OS._next6BRollValues
      : null;
  OS._next6BRollValues = null;
  var dicePool = OS.get6BDiceArray
    ? OS.get6BDiceArray()
    : isFree
    ? ["d6"]
    : ["d6", "d6", "d6", "d6", "d6", "d6"];
  var activeLimit = isFree
    ? Math.max(1, Math.min(inputs.length, dicePool.length || 1))
    : inputs.length;

  inputs.forEach(function (input, idx) {
    if (isFree && idx >= activeLimit) {
      novosResultadosDoTambor.push(0);
      return;
    }
    var resultadoDado =
      customRoll && idx < customRoll.length
        ? customRoll[idx]
        : OS.generateDiceResult(dicePool[idx] || "d6");
    var parsed = parseInt(resultadoDado, 10);
    if (isNaN(parsed)) parsed = 0;
    novosResultadosDoTambor.push(parsed);
  });

  var next6BBonus = OS.consumeNext6BRollBuffs ? OS.consumeNext6BRollBuffs() : 0;
  if (next6BBonus) {
    for (var bIdx = 0; bIdx < activeLimit; bIdx++) {
      novosResultadosDoTambor[bIdx] += next6BBonus;
    }
  }

  if (!isFree && typeof OS.evaluate6BSpecialPlay === "function") {
    OS.evaluate6BSpecialPlay(novosResultadosDoTambor, isInitialReload);
  }

  var fatigueLevel = OS.getTotalCumulative6BPenalty
    ? OS.getTotalCumulative6BPenalty()
    : (OS.getConditionDegree ? OS.getConditionDegree("Fatigado") : 0);

  var resultadosAposFadiga = [];
  var zeroedIndices = [];
  if (isFree) {
    var activeRollSlice = novosResultadosDoTambor.slice(0, activeLimit);
    var freeFatigueResult = applyFatigueTo6BRoll(activeRollSlice, fatigueLevel);
    var activeValuesAfterFatigue = freeFatigueResult.values || [];
    zeroedIndices = (freeFatigueResult.zeroedIndices || []).filter(function (zi) {
      return zi >= 0 && zi < activeLimit;
    });
    for (var fi = 0; fi < inputs.length; fi++) {
      resultadosAposFadiga.push(
        fi < activeLimit ? activeValuesAfterFatigue[fi] || 0 : 0
      );
    }
  } else {
    var fatigueResult = applyFatigueTo6BRoll(
      novosResultadosDoTambor,
      fatigueLevel
    );
    resultadosAposFadiga = fatigueResult.values || [];
    zeroedIndices = fatigueResult.zeroedIndices || [];
  }

  inputs.forEach(function (input, index) {
    if (isFree && index >= activeLimit) {
      input.value = "0";
      input.removeAttribute("data-original-val");
      input.disabled = true;
      OS.applyChamberValue(input);
      return;
    }
    var parsed = resultadosAposFadiga[index] || 0;
    input.value = String(parsed);
    input.setAttribute(
      "data-original-val",
      String(novosResultadosDoTambor[index] || 0)
    );
    OS.applyChamberValue(input);
  });

  OS.syncFatigueZeroVisuals(zeroedIndices);
  OS.syncUsedChambersVisual(true);

  if (isFree) {
    if (isInitialReload) {
      OS.hasPerformedInitialReload = true;
    }
    OS.updateStatsFields(false);
    OS.updateReloadButtonState();
    OS.scheduleSave();
    return;
  }

  // 5. ATUALIZAÇÃO DO ESTADO INTERNO DO MODAL
  if (OS.defenseRollState) {
    OS.defenseRollState.originalRoll = novosResultadosDoTambor;
    OS.defenseRollState.roll = resultadosAposFadiga;
    OS.defenseRollState.selected = [];
  }

  // 6. INTERFACE OBRIGATÓRIA: Dispara o modal de defesa
  if (typeof OS.openDefenseModal === "function") {
    OS.openDefenseModal(resultadosAposFadiga);
  }

  // 7. SUBSISTEMA DE DEFESA INTEGRADO
  var btnConfirm = OS.$("defense-confirm");
  if (btnConfirm) {
    var novoClique = function () {
      if ((OS.defenseRollState.selected || []).length !== 3) {
        if (typeof OS.updateDefenseModalUi === "function") {
          OS.updateDefenseModalUi("Selecione exatamente 3 resultados para confirmar.");
        }
        return;
      }
      
      // Aplica os resultados matemáticos da defesa nas câmaras corretas
      if (typeof OS.applyCylinderResults === "function") {
        OS.applyCylinderResults();
      }

      document.querySelectorAll(".chamber-mark").forEach(function (cb) {
        cb.checked = false;
      });
      if (typeof OS.syncMarkedChambersVisual === "function") {
        OS.syncMarkedChambersVisual();
      }

      if (typeof OS.closeDefenseModal === "function") {
        OS.closeDefenseModal();
      }
      
      // Atualiza e salva o estado limpo
      OS.updateStatsFields(true);
      OS.updateReloadButtonState();
      OS.scheduleSave();
      
      btnConfirm.removeEventListener("click", novoClique);
    };
    
    btnConfirm.addEventListener("click", novoClique);
  }

  // 8. ATUALIZAÇÃO FINAL
  if (isInitialReload) {
    OS.hasPerformedInitialReload = true;
  }
  OS.updateStatsFields(true);
  OS.updateReloadButtonState();
  OS.scheduleSave();
};

  OS.applyCylinderResults = function () {
    var roll = OS.defenseRollState.roll || [];
    var originalRoll = OS.defenseRollState.originalRoll || roll;
    var selectedIdx = OS.defenseRollState.selected || [];
    if (roll.length !== 6 || selectedIdx.length !== 3) return false;

    var selVals = selectedIdx.map(function (i) {
      return roll[i];
    });
    var selOriginals = selectedIdx.map(function (i) {
      return originalRoll[i];
    });
    var remaining = [];
    var remainingOriginals = [];
    for (var i = 0; i < 6; i++) {
      if (selectedIdx.indexOf(i) === -1) {
        remaining.push(roll[i]);
        remainingOriginals.push(originalRoll[i]);
      }
    }

    var map = [
      { id: "chamber-5", val: selVals[0], original: selOriginals[0] },
      { id: "chamber-4", val: selVals[1], original: selOriginals[1] },
      { id: "chamber-3", val: selVals[2], original: selOriginals[2] },
      { id: "chamber-0", val: remaining[0], original: remainingOriginals[0] },
      { id: "chamber-1", val: remaining[1], original: remainingOriginals[1] },
      { id: "chamber-2", val: remaining[2], original: remainingOriginals[2] }
    ];

    map.forEach(function (m) {
      var input = OS.$(m.id);
      if (!input) return;

      var parsedVal = parseInt(m.val, 10);
      if (isNaN(parsedVal)) parsedVal = 0;
      var parsedOriginal = parseInt(m.original, 10);
      if (isNaN(parsedOriginal)) parsedOriginal = parsedVal;

      // Pool ativo = valor efetivo (com fadiga); base = original (Init/Defesa)
      input.value = String(parsedVal);
      input.setAttribute("data-original-val", String(parsedOriginal));
      OS.applyChamberValue(input);
  
      input.classList.remove("rolling-pulse");
      void input.offsetWidth;
      input.classList.add("rolling-pulse");
    });

    OS.usedChambers = [];
    OS.fatigueZeroedChambers = [];
    OS.fatigueZeroAddedUsed = [];
    for (var zi = 0; zi < 6; zi++) {
      var zEl = OS.getChamberElement(zi);
      if (zEl) {
        zEl.classList.remove(
          "used",
          "consuming",
          "damaged",
          "fatigue-damaged",
          "marked"
        );
      }
    }
    OS.markFatigueZeroChambers();
    OS.updateStatsFields(true);

    // Ao encerrar combate: REM Atual = min(REM Atual, REM Máximo)
    var remAtualEl = OS.$("rem-atual");
    var nivelEl = OS.$("nivel");
    if (remAtualEl && nivelEl) {
      var nivelEnd = parseInt(String(nivelEl.value || 0), 10);
      if (isNaN(nivelEnd)) nivelEnd = 0;
      var remMaxEnd = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivelEnd) : calculateRemMax(nivelEnd);
      var remAtualEnd = parseInt(String(remAtualEl.value || 0), 10);
      if (isNaN(remAtualEnd)) remAtualEnd = 0;
      if (remAtualEnd > remMaxEnd) {
        remAtualEl.value = String(remMaxEnd);
      }
    }

    OS.scheduleSave();
    return true;
  };

  OS.bindChambers = function () {
    var inputs = document.querySelectorAll(".chamber-input");
    inputs.forEach(function (input) {
      input.addEventListener("input", function () {
        OS.applyChamberValue(input);

        // Coerção ativa para o cache quando o jogador digita
        var rawVal = parseInt(input.value, 10);
        var cleanVal = isNaN(rawVal) ? 0 : rawVal;
        input.setAttribute("data-original-val", String(cleanVal));

        OS.updateStatsFields(false);
      });


      input.addEventListener("keydown", function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (OS.isChamberControlKey(e.key)) return;

        if (e.key.length === 1 && !/^\d$/.test(e.key)) {
          e.preventDefault();
          return;
        }

        if (/^\d$/.test(e.key)) {
          var start = input.selectionStart;
          var end = input.selectionEnd;
          var val = input.value;
          var replacing =
            start !== end ||
            val.length < 2 ||
            (start !== null && start < val.length);
          if (!replacing && val.length >= 2) {
            e.preventDefault();
          }
        }
      });

      input.addEventListener("paste", function (e) {
        e.preventDefault();
        var pasted = "";
        if (e.clipboardData) {
        pasted = e.clipboardData.getData("text");
        }
       var digits = OS.sanitizeChamberValue(pasted);
        if (!digits) return;

        var start = input.selectionStart || 0;
        var end = input.selectionEnd || 0;
        var merged = input.value.slice(0, start) + digits + input.value.slice(end);
        var cleanString = OS.sanitizeChamberValue(merged);
  
        var parsed = parseInt(cleanString, 10);
        var cleanVal = isNaN(parsed) ? 0 : parsed;

        input.value = String(cleanVal);
        input.setAttribute("data-original-val", String(cleanVal)); // Grava o cache do novo valor numérico puro

        var pos = Math.min(String(cleanVal).length, 2);
        input.setSelectionRange(pos, pos);
        OS.updateStatsFields(false);
        OS.scheduleSave();
      });
      
      input.addEventListener("blur", function () {
        OS.applyChamberValue(input);
        OS.updateStatsFields(false);
      });
    });

    document.querySelectorAll(".chamber-mark").forEach(function (markCb, markIdx) {
      markCb.addEventListener("change", function () {
        OS.syncMarkedChambersVisual();
        if (OS._suppressDamageHook) return;
        var chamberEl = OS.getChamberElement(markIdx);
        if (markCb.checked) {
          if (OS.damagedChambers.indexOf(markIdx) < 0) OS.damagedChambers.push(markIdx);
          markCb.dataset.manualDamageBlocked = "1";
          if (OS.usedChambers.indexOf(markIdx) === -1) {
            OS.usedChambers.push(markIdx);
            markCb.dataset.manualDamageBlocked = "1";
          }
          if (chamberEl) chamberEl.classList.add("used", "damaged");
          OS.syncUsedChambersVisual(true);
          OS.updateReloadButtonState();
          if (OS.onCharacterDamageSuffered) {
            OS.onCharacterDamageSuffered(1);
          }
        } else {
          OS.damagedChambers = OS.damagedChambers.filter(function (i) { return i !== markIdx; });
          if (chamberEl) chamberEl.classList.remove("damaged");
          if (markCb.dataset.manualDamageBlocked === "1") {
            delete markCb.dataset.manualDamageBlocked;
            var pos = OS.usedChambers.indexOf(markIdx);
            if (pos >= 0) OS.usedChambers.splice(pos, 1);
            OS.syncUsedChambersVisual(true);
            OS.updateReloadButtonState();
          }
        }
        OS.scheduleSave();
      });
    });
  };

 OS.bindCylinderEvents = function () {
  if (cylinderEventsBound) return;
  cylinderEventsBound = true;

  OS.bindChambers();

  var btnRoll = OS.$("btn-roll");
  if (btnRoll) {
    btnRoll.addEventListener("click", function () {
      // Removida a verificação e incremento manual daqui! 
      // Agora o processamento é executado inteiramente dentro de OS.rollCylinderDice.
      OS.rollCylinderDice();
    });
  }
  // Configuração dos botões de descanso
  var btnCurto = OS.$("btn-descanso-curto");
  var btnLongo = OS.$("btn-descanso-longo");

  OS.performShortRest = function () {
    var changed = false;
    var currentFatigue = OS.getConditionDegree ? OS.getConditionDegree("Fatigado") : 0;
    if (currentFatigue > 0) {
      var newFatigue = applyShortRest(currentFatigue);
      if (newFatigue <= 0) {
        OS.removeCondition("Fatigado");
      } else {
        OS.addOrUpdateCondition("Fatigado", newFatigue, { replaceDegree: true });
      }
      changed = true;
    }

    // Regra de Veterano (veteranos.json → resistencia_e_poder.poderes_reforcados.regra_recuperacao_descanso_curto):
    // "Após cada descanso curto, um Veterano recupera um valor de energia mística igual ao seu nível de Misticismo"
    var isVet = !!(OS.isVeterano || (OS.$("is-veterano") && OS.$("is-veterano").checked));
    if (isVet) {
      var remAtualEl = OS.$("rem-atual");
      var remTotalEl = OS.$("rem-total");
      var nivelEl = OS.$("nivel");
      var rawNivel = nivelEl ? String(nivelEl.value || "").trim() : "";
      var nivel = rawNivel === "" ? 0 : parseInt(rawNivel, 10);
      if (isNaN(nivel) || nivel < 0) nivel = 0;

      var misticismo = getMisticismoLevel();
      var remMax = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivel) : calculateRemMax(nivel);
      var remAtual = remAtualEl ? parseInt(String(remAtualEl.value || 0), 10) : 0;
      if (isNaN(remAtual)) remAtual = 0;

      var novoRem = Math.min(remMax, remAtual + misticismo);
      OS.remSpent = Math.max(0, remMax - novoRem);

      if (remTotalEl) remTotalEl.value = String(remMax);
      if (remAtualEl) {
        remAtualEl.value = String(novoRem);
        if (OS.flashField) OS.flashField(remAtualEl);
      }
      if (OS.updateMagiasStatusBar) {
        OS.updateMagiasStatusBar();
      }
      var fb = OS.$("magias-use-feedback");
      if (fb) {
        fb.textContent =
          "Descanso Curto (Veterano): +" +
          misticismo +
          " REM recuperado (" +
          novoRem +
          "/" +
          remMax +
          ").";
      }
      changed = true;
    }

    if (changed) {
      OS.scheduleSave();
    }
  };

  if (btnCurto) {
    btnCurto.addEventListener("click", function () {
      OS.performShortRest();
    });
  }

  if (btnLongo) {
    btnLongo.addEventListener("click", function () {
      if (OS.performLongRest) {
        OS.performLongRest();
        return;
      }
      if (OS.getConditionDegree && OS.getConditionDegree("Fatigado") > 0) {
        OS.removeCondition("Fatigado");
      }
      var remAtualEl = OS.$("rem-atual");
      var nivelEl = OS.$("nivel");
      if (remAtualEl && nivelEl) {
        var misticismo = getMisticismoLevel();
        var nivel = parseInt(String(nivelEl.value || 0), 10);
        if (isNaN(nivel)) nivel = 0;
        var remMax = calculateRemMax(nivel);
        var remAtual = parseInt(String(remAtualEl.value || 0), 10);
        if (isNaN(remAtual)) remAtual = 0;
        var novoRem = Math.min(remMax, remAtual + misticismo);
        remAtualEl.value = String(novoRem);
      }
      OS.scheduleSave();
    });
  }
};

  OS.initCylinder = function () {
    document.querySelectorAll(".chamber-input").forEach(OS.applyChamberValue);
    OS.syncMarkedChambersVisual();
    OS.markFatigueZeroChambers();
    OS.updateStatsFields(false);
    OS.updateReloadButtonState();
  };

  OS.syncFadigaVisual = function () {};

  OS.applyFatiguePenalty = function () {
    // 1. Restaura câmaras aos valores base (nunca altera data-original-val aqui)
    var chamberValues = [];
    for (var i = 0; i < 6; i++) {
      var input = OS.$("chamber-" + i);
      if (!input) {
        chamberValues.push(0);
        continue;
      }

      var cachedAttr = input.getAttribute("data-original-val");
      var parsedOriginal = parseInt(cachedAttr, 10);

      if (isNaN(parsedOriginal)) {
        parsedOriginal = parseInt(input.value, 10);
        if (isNaN(parsedOriginal)) parsedOriginal = 0;
        input.setAttribute("data-original-val", String(parsedOriginal));
      }

      input.value = String(parsedOriginal);
      input.title = "Valor bruto: " + parsedOriginal;
      chamberValues.push(parsedOriginal);
    }

    var totalPenalty = OS.getTotalCumulative6BPenalty
      ? OS.getTotalCumulative6BPenalty()
      : (OS.getConditionDegree ? OS.getConditionDegree("Fatigado") : 0);

    // 2. Sem penalidade: pool = base; limpa visual de inutilizado
    if (totalPenalty <= 0) {
      for (var r = 0; r < 6; r++) {
        var restoreInput = OS.$("chamber-" + r);
        if (restoreInput) OS.applyChamberValue(restoreInput);
      }
      OS.syncFatigueZeroVisuals([]);
      if (OS.renderPenaltySummary) OS.renderPenaltySummary(chamberValues, chamberValues, 0);
      if (OS.renderActiveConditions) OS.renderActiveConditions();
      // Init/Defesa usam base — valores não devem mudar com fadiga
      OS.updateStatsFields(false);
      return;
    }

    // 3. Cascata horário nos maiores dados (regra pura: Fatigado + Envenenado + Doente cumulativos)
    var fatigueResult = applyFatigueTo6BRoll(chamberValues, totalPenalty);
    var resultValues = fatigueResult.values || [];
    var zeroedIndices = fatigueResult.zeroedIndices || [];

    // 4. Pool ativo recebe valores efetivos; base permanece em data-original-val
    for (var j = 0; j < 6; j++) {
      var outInput = OS.$("chamber-" + j);
      if (outInput) {
        outInput.value = String(resultValues[j]);
        var origV = chamberValues[j] || 0;
        var effV = resultValues[j] || 0;
        if (origV !== effV) {
          outInput.title = "Bruto: " + origV + " → Efetivo: " + effV + " (-" + (origV - effV) + ")";
        } else {
          outInput.title = "Valor bruto: " + origV;
        }
        OS.applyChamberValue(outInput);
      }
    }

    // 5. Checkbox + classes vermelhas no mesmo ciclo (quando dado chega a 0, bloqueia 1 valor do 6B = 1 ponto de dano)
    OS.syncFatigueZeroVisuals(zeroedIndices);

    if (OS.renderPenaltySummary) OS.renderPenaltySummary(chamberValues, resultValues, totalPenalty);
    if (OS.renderActiveConditions) OS.renderActiveConditions();

    // Init/Defesa continuam lendo data-original-val (inalterado)
    OS.updateStatsFields(false);
  };

  OS.incrementFadiga = function () {
    OS.addOrUpdateCondition("Fatigado", 1);
  };

  /* ─── Sistema de Fichas do Destino e Nova Sessão (fichas_do_destino.json) ─── */

  OS.fateTokens = {
    vermelha: 0,
    azul: 0,
    verde: 0,
    preta: 0
  };

  OS.fatePool = {
    vermelha: 20,
    azul: 10,
    verde: 5,
    preta: 1
  };

  OS.lastDrawnFateToken = null;
  OS.lastSpecial6BPlay = null;

  var DEFAULT_POOL_BASE = {
    vermelha: 20,
    azul: 10,
    verde: 5,
    preta: 1
  };

  var DEFAULT_LEVEL_PROGRESSION = [
    { nivel: 2, cor: "preta" },
    { nivel: 3, cor: "verde" },
    { nivel: 4, cor: "preta" },
    { nivel: 5, cor: "azul" },
    { nivel: 6, cor: "preta" },
    { nivel: 7, cor: "vermelha" },
    { nivel: 8, cor: "preta" },
    { nivel: 9, cor: "verde" },
    { nivel: 10, cor: "preta" }
  ];

  var DEFAULT_POST_10_CYCLE = ["azul", "vermelha", "verde", "preta"];

  var DEFAULT_REWARDS_TABLE = [
    { combinacao: "Trinca", condicao: "3 números iguais", fichas_recebidas: 1, fichas_devolvidas: 0, fichas_liquidas: 1 },
    { combinacao: "Quadra", condicao: "4 números iguais", fichas_recebidas: 2, fichas_devolvidas: 0, fichas_liquidas: 2 },
    { combinacao: "Sequência Menor", condicao: "5 valores consecutivos", fichas_recebidas: 3, fichas_devolvidas: 1, fichas_liquidas: 2 },
    { combinacao: "Quina", condicao: "5 números iguais", fichas_recebidas: 5, fichas_devolvidas: 3, fichas_liquidas: 2 },
    { combinacao: "Sequência Maior", condicao: "6 valores consecutivos", fichas_recebidas: 6, fichas_devolvidas: 3, fichas_liquidas: 3 },
    { combinacao: "Seis números iguais", condicao: "6 números iguais", fichas_recebidas: 4, fichas_devolvidas: 0, fichas_liquidas: 4 }
  ];

  OS.calculateFatePoolForLevel = function (level) {
    var lv = parseInt(
      String(level !== undefined ? level : (OS.getCurrentLevel ? OS.getCurrentLevel() : 1)),
      10
    );
    if (isNaN(lv) || lv < 1) lv = 1;

    var fdData = OS.getGameData ? OS.getGameData("fichas_do_destino") : null;
    var poolRule = (fdData && fdData.pool_por_nivel) || {};
    var base = Object.assign({}, DEFAULT_POOL_BASE, poolRule.pool_base_nivel_1 || {});
    var pool = {
      vermelha: parseInt(base.vermelha, 10) || 20,
      azul: parseInt(base.azul, 10) || 10,
      verde: parseInt(base.verde, 10) || 5,
      preta: parseInt(base.preta, 10) || 1
    };

    if (lv <= 1) return pool;

    var tabela = Array.isArray(poolRule.tabela_progressao) && poolRule.tabela_progressao.length
      ? poolRule.tabela_progressao
      : DEFAULT_LEVEL_PROGRESSION;
    var maxPretasAte10 = parseInt(poolRule.max_pretas_ate_nivel_10, 10) || 5;
    var cycle = Array.isArray(poolRule.ciclo_repeticao_apos_nivel_10) && poolRule.ciclo_repeticao_apos_nivel_10.length
      ? poolRule.ciclo_repeticao_apos_nivel_10
      : DEFAULT_POST_10_CYCLE;

    var limit10 = Math.min(lv, 10);
    for (var n = 2; n <= limit10; n++) {
      var entry = null;
      for (var i = 0; i < tabela.length; i++) {
        if (parseInt(tabela[i].nivel, 10) === n) {
          entry = tabela[i];
          break;
        }
      }
      var cor = entry ? entry.cor : null;
      if (cor && cor in pool) {
        pool[cor] += 1;
      }
    }
    if (pool.preta > maxPretasAte10) {
      pool.preta = maxPretasAte10;
    }

    for (var m = 11; m <= lv; m++) {
      var c = cycle[(m - 11) % cycle.length];
      if (c && c in pool) {
        pool[c] += 1;
      }
    }

    return pool;
  };

  OS.getCurrentFatePool = function () {
    var lv = OS.getCurrentLevel ? OS.getCurrentLevel() : 1;
    OS.fatePool = OS.calculateFatePoolForLevel(lv);
    return Object.assign({}, OS.fatePool);
  };

  OS.drawFateTokenFromPool = function (customPool) {
    var pool = customPool || OS.getCurrentFatePool();
    var colors = ["vermelha", "azul", "verde", "preta"];
    var total = 0;
    colors.forEach(function (c) {
      total += Math.max(0, parseInt(pool[c], 10) || 0);
    });
    if (total <= 0) return "vermelha";

    var roll = Math.random() * total;
    var acc = 0;
    for (var i = 0; i < colors.length; i++) {
      var c = colors[i];
      acc += Math.max(0, parseInt(pool[c], 10) || 0);
      if (roll < acc) {
        return c;
      }
    }
    return "vermelha";
  };

  OS.get6BDiceArray = function () {
    var cfg = OS.config6B || { d6: 6 };
    if (OS.freeEdit && typeof OS.$ === "function" && typeof OS.parse6BConfigString === "function") {
      var cfgEl = OS.$("config-6b");
      if (cfgEl && String(cfgEl.value || "").trim()) {
        var parsedFromInput = OS.parse6BConfigString(cfgEl.value);
        if (Object.keys(parsedFromInput).length) {
          cfg = parsedFromInput;
          OS.config6B = Object.assign({}, parsedFromInput);
        }
      }
    }
    var order = ["d12", "d10", "d8", "d6", "d4"];
    var pool = [];
    order.forEach(function (die) {
      var n = parseInt(cfg[die], 10) || 0;
      for (var i = 0; i < n; i++) pool.push(die);
    });
    if (OS.freeEdit) {
      if (!pool.length) pool.push("d6");
      return pool;
    }
    while (pool.length < 6) pool.push("d6");
    return pool.slice(0, 6);
  };

  OS.getTotalFateTokens = function () {
    var ft = OS.fateTokens || {};
    return (
      (parseInt(ft.vermelha, 10) || 0) +
      (parseInt(ft.azul, 10) || 0) +
      (parseInt(ft.verde, 10) || 0) +
      (parseInt(ft.preta, 10) || 0)
    );
  };

  OS.detect6BSpecialPlay = function (values) {
    var nums = (values || [])
      .map(function (v) { return parseInt(v, 10); })
      .filter(function (v) { return !isNaN(v) && v > 0; });
    if (nums.length < 3) return null;

    var counts = {};
    var maxSame = 0;
    nums.forEach(function (n) {
      counts[n] = (counts[n] || 0) + 1;
      if (counts[n] > maxSame) maxSame = counts[n];
    });

    var uniq = Object.keys(counts)
      .map(function (k) { return parseInt(k, 10); })
      .sort(function (a, b) { return a - b; });

    var maxConsec = uniq.length ? 1 : 0;
    var curConsec = uniq.length ? 1 : 0;
    for (var i = 1; i < uniq.length; i++) {
      if (uniq[i] === uniq[i - 1] + 1) {
        curConsec++;
        if (curConsec > maxConsec) maxConsec = curConsec;
      } else {
        curConsec = 1;
      }
    }

    var combName = null;
    if (maxSame >= 6) combName = "Seis números iguais";
    else if (maxConsec >= 6) combName = "Sequência Maior";
    else if (maxSame === 5) combName = "Quina";
    else if (maxConsec === 5) combName = "Sequência Menor";
    else if (maxSame === 4) combName = "Quadra";
    else if (maxSame === 3) combName = "Trinca";

    if (!combName) return null;

    var fdData = OS.getGameData ? OS.getGameData("fichas_do_destino") : null;
    var table =
      (fdData && Array.isArray(fdData.combinacoes_e_recompensas) && fdData.combinacoes_e_recompensas) ||
      DEFAULT_REWARDS_TABLE;

    var entry = null;
    for (var j = 0; j < table.length; j++) {
      if (table[j].combinacao === combName) {
        entry = table[j];
        break;
      }
    }
    if (!entry) {
      entry = DEFAULT_REWARDS_TABLE.find(function (r) { return r.combinacao === combName; });
    }
    return Object.assign({}, entry);
  };

  OS.creditFateTokens = function (amount, color) {
    var c = color && (color in OS.fateTokens) ? color : "vermelha";
    var n = Math.max(0, parseInt(amount, 10) || 0);
    if (n <= 0) return;
    OS.fateTokens[c] = Math.max(0, (OS.fateTokens[c] || 0) + n);
    OS.renderFateTokens();
  };

  OS.evaluate6BSpecialPlay = function (values, isInitialSessionRoll) {
    var play = OS.detect6BSpecialPlay(values);
    var fb = OS.$("destino-feedback");

    if (!play) {
      OS.lastSpecial6BPlay = null;
      return null;
    }

    var recebidas = isInitialSessionRoll ? play.fichas_recebidas : 1;
    var devolvidas = isInitialSessionRoll ? play.fichas_devolvidas : 0;
    var liquidas = isInitialSessionRoll
      ? (play.fichas_liquidas !== undefined ? play.fichas_liquidas : Math.max(0, recebidas - devolvidas))
      : 1;

    OS.creditFateTokens(liquidas, "vermelha");

    OS.lastSpecial6BPlay = {
      combinacao: play.combinacao,
      condicao: play.condicao,
      isInitial: !!isInitialSessionRoll,
      fichas_recebidas: recebidas,
      fichas_devolvidas: devolvidas,
      fichas_liquidas: liquidas,
      values: (values || []).slice()
    };

    if (fb) {
      if (isInitialSessionRoll) {
        fb.textContent =
          "★ Jogada Especial Inicial (" +
          play.combinacao +
          "): " +
          recebidas +
          " recebida(s), " +
          devolvidas +
          " devolvida(s) → +" +
          liquidas +
          " Ficha(s) do Destino creditada(s)!";
      } else {
        fb.textContent =
          "★ Jogada Especial (" +
          play.combinacao +
          " fora da rolagem inicial): +1 Ficha do Destino adicional creditada!";
      }
    }

    OS.renderFateTokens();
    return OS.lastSpecial6BPlay;
  };

  OS.recoverUserFatigue = function (amount) {
    var n = Math.max(0, parseInt(amount, 10) || 0);
    var currentFatigue = OS.getConditionDegree ? OS.getConditionDegree("Fatigado") : 0;
    var newFatigue = Math.max(0, currentFatigue - n);
    if (currentFatigue > 0) {
      if (newFatigue <= 0) {
        OS.removeCondition("Fatigado");
      } else {
        OS.addOrUpdateCondition("Fatigado", newFatigue, { replaceDegree: true });
      }
    } else {
      OS.applyFatiguePenalty();
    }
    return { before: currentFatigue, after: newFatigue, recovered: currentFatigue - newFatigue };
  };

  OS.adjustFateToken = function (color, delta) {
    if (!color || !(color in OS.fateTokens)) return;
    var next = Math.max(0, (parseInt(OS.fateTokens[color], 10) || 0) + delta);
    OS.fateTokens[color] = next;
    OS.renderFateTokens();
    OS.scheduleSave();
  };

  function findFallbackSkillContext() {
    if (OS.lastSkillRollContext && OS.lastSkillRollContext.outEl) {
      return OS.lastSkillRollContext;
    }
    var rows = document.querySelectorAll("#ficha .skill-row");
    for (var i = 0; i < rows.length; i++) {
      var dice = OS.getSelectedDice ? OS.getSelectedDice(rows[i]) : [];
      if (dice.length > 0) {
        var titleEl = rows[i].querySelector(".skill-title");
        return {
          rowEl: rows[i],
          outEl: rows[i].querySelector(".roll-result"),
          skillKey: rows[i].getAttribute("data-skill-key") || "",
          skillName: titleEl ? titleEl.textContent : "Perícia",
          dice: dice,
          results: [],
          baseResult: 0,
          bonus: 0,
          total: 0
        };
      }
    }
    var firstRow = rows[0] || null;
    return {
      rowEl: firstRow,
      outEl: firstRow ? firstRow.querySelector(".roll-result") : null,
      skillKey: firstRow ? firstRow.getAttribute("data-skill-key") || "" : "",
      skillName: "Perícia",
      dice: ["d6"],
      results: [],
      baseResult: 0,
      bonus: 0,
      total: 0
    };
  }

  OS.useFateToken = function (color, effectId) {
    if (!color || !(color in OS.fateTokens)) return false;
    var current = parseInt(OS.fateTokens[color], 10) || 0;
    var fb = OS.$("destino-feedback");
    if (current <= 0) {
      if (fb) fb.textContent = "Sem fichas da cor " + color + " disponíveis.";
      return false;
    }

    // Desconta 1 ficha da cor
    OS.fateTokens[color] = current - 1;
    var msg = "";

    if (effectId === "fadiga_usuario_1") {
      var r1 = OS.recoverUserFatigue(1);
      msg = "Ficha Vermelha usada: Recuperou 1 ponto de fadiga do usuário (Fadiga: " + r1.before + " → " + r1.after + ").";
    } else if (effectId === "rerolar_pericia") {
      var ctxV = findFallbackSkillContext();
      var diceV = (ctxV.dice && ctxV.dice.length) ? ctxV.dice : ["d6"];
      var resV = OS.rollSelectedDice(diceV);
      var highV = OS.getHighestRoll(resV);
      var totalV = highV + (ctxV.bonus || 0);
      var summaryV = OS.formatSkillRollSummary(diceV, resV, highV, ctxV.bonus || 0, totalV) + " [2º resultado obrigatório]";
      if (ctxV.outEl) {
        ctxV.outEl.textContent = summaryV;
        ctxV.outEl.classList.add("rolled");
      }
      OS.lastSkillRollContext = Object.assign({}, ctxV, {
        dice: diceV,
        results: resV,
        baseResult: highV,
        total: totalV
      });
      msg = "Ficha Vermelha usada: Rerolou dado de perícia (" + ctxV.skillName + ") → Novo resultado obrigatório: " + totalV + ".";
    } else if (effectId === "fadiga_usuario_2") {
      var r2 = OS.recoverUserFatigue(2);
      msg = "Ficha Azul usada: Recuperou 2 pontos de fadiga do usuário (Fadiga: " + r2.before + " → " + r2.after + ").";
    } else if (effectId === "fadiga_aliado_1") {
      msg = "Ficha Azul usada: Recupera 1 ponto de fadiga de um aliado.";
    } else if (effectId === "rerolar_grupo") {
      var ctxA = findFallbackSkillContext();
      var diceA = (ctxA.dice && ctxA.dice.length) ? ctxA.dice : ["d6"];
      var resA = OS.rollSelectedDice(diceA);
      var highA = OS.getHighestRoll(resA);
      var totalA = highA + (ctxA.bonus || 0);
      var summaryA = OS.formatSkillRollSummary(diceA, resA, highA, ctxA.bonus || 0, totalA) + " [Rerolagem Grupo]";
      if (ctxA.outEl) {
        ctxA.outEl.textContent = summaryA;
        ctxA.outEl.classList.add("rolled");
      }
      OS.lastSkillRollContext = Object.assign({}, ctxA, {
        dice: diceA,
        results: resA,
        baseResult: highA,
        total: totalA
      });
      msg = "Ficha Azul usada: Rerolou dado de perícia do grupo → Novo resultado obrigatório: " + totalA + ".";
    } else if (effectId === "fadiga_usuario_3") {
      var r3 = OS.recoverUserFatigue(3);
      msg = "Ficha Verde usada: Recuperou 3 pontos de fadiga do usuário (Fadiga: " + r3.before + " → " + r3.after + ").";
    } else if (effectId === "fadiga_aliados_1") {
      msg = "Ficha Verde usada: Recupera 1 ponto de fadiga de todos os aliados.";
    } else if (effectId === "dado_adicional") {
      var ctxG = findFallbackSkillContext();
      var diceG = (ctxG.dice && ctxG.dice.length) ? ctxG.dice : ["d6"];
      var extraDie = diceG[diceG.length - 1] || "d6";
      var extraVal = OS.generateDiceResult(extraDie);
      var prevTotal = ctxG.total || ctxG.baseResult || 0;
      var newTotalG = prevTotal + extraVal;
      if (ctxG.outEl) {
        var prevTxt = ctxG.outEl.textContent || ("Base " + prevTotal);
        ctxG.outEl.textContent = prevTxt + " + Dado Adicional 1" + extraDie + "(" + extraVal + ") = " + newTotalG;
        ctxG.outEl.classList.add("rolled");
      }
      OS.lastSkillRollContext = Object.assign({}, ctxG, {
        total: newTotalG
      });
      msg = "Ficha Verde usada: Rolou dado de perícia adicional (1" + extraDie + " = +" + extraVal + ") → Total: " + newTotalG + ".";
    } else if (effectId === "fadiga_usuario_total") {
      var rAll = OS.recoverUserFatigue(40);
      msg = "Ficha Preta usada: Recuperou todos os pontos de fadiga do usuário (Fadiga: " + rAll.before + " → 0).";
    } else if (effectId === "fadiga_aliados_3") {
      msg = "Ficha Preta usada: Recupera 3 pontos de fadiga de todos os aliados.";
    } else if (effectId === "sucesso_automatico") {
      var ctxP = findFallbackSkillContext();
      if (ctxP.outEl) {
        ctxP.outEl.textContent = "Sucesso Automático (Ficha Preta — sem gastar 6B)";
        ctxP.outEl.classList.add("rolled");
      }
      msg = "Ficha Preta usada: Concedeu Sucesso Automático no teste sem gastar valores do 6B.";
    }

    if (fb && msg) {
      fb.textContent = msg;
    }

    OS.renderFateTokens();
    OS.scheduleSave();
    return true;
  };

  OS.syncFateTooltipsFromData = function () {
    var fdData = OS.getGameData ? OS.getGameData("fichas_do_destino") : null;
    var cores = (fdData && fdData.funcao_geral && Array.isArray(fdData.funcao_geral.cores))
      ? fdData.funcao_geral.cores
      : [];
    if (!cores.length) return;

    cores.forEach(function (entry) {
      var rawCor = String(entry.cor || "").trim().toLowerCase();
      if (!rawCor) return;
      var opcoes = Array.isArray(entry.opcoes) ? entry.opcoes : [];
      var lines = opcoes.map(function (op) {
        return op.efeito + (op.regra_adicional ? " (" + op.regra_adicional + ")" : "");
      });

      var miniCard = document.querySelector('.destino-mini-card[data-color="' + rawCor + '"]');
      if (miniCard && lines.length) {
        miniCard.setAttribute("title", entry.cor + ": • " + lines.join(" • "));
      }

      var tooltipEl = OS.$("destino-tooltip-" + rawCor);
      if (tooltipEl && lines.length) {
        var html = "<strong>" + entry.cor + "</strong><ul>";
        lines.forEach(function (ln) {
          html += "<li>" + ln + "</li>";
        });
        html += "</ul>";
        tooltipEl.innerHTML = html;
      }
    });
  };

  OS.renderFateTokens = function () {
    var colors = ["vermelha", "azul", "verde", "preta"];
    colors.forEach(function (c) {
      var count = Math.max(0, parseInt((OS.fateTokens && OS.fateTokens[c]) || 0, 10) || 0);
      var countEl = OS.$("destino-count-" + c);
      if (countEl) countEl.textContent = String(count);

      var headerCountEl = OS.$("header-destino-count-" + c);
      if (headerCountEl) headerCountEl.textContent = String(count);

      var minusBtn = OS.$("btn-destino-minus-" + c);
      if (minusBtn) minusBtn.disabled = count <= 0;

      document
        .querySelectorAll('.btn-destino-use[data-color="' + c + '"]')
        .forEach(function (btn) {
          btn.disabled = count <= 0;
        });
    });

    var pool = OS.getCurrentFatePool ? OS.getCurrentFatePool() : OS.fatePool;
    var poolEl = OS.$("destino-pool-summary");
    if (poolEl && pool) {
      var lv = OS.getCurrentLevel ? OS.getCurrentLevel() : 1;
      poolEl.textContent =
        "Pool atual (Nível " +
        lv +
        "): " +
        pool.vermelha +
        " Vermelhas · " +
        pool.azul +
        " Azuis · " +
        pool.verde +
        " Verdes · " +
        pool.preta +
        " Preta(s)";
    }

    if (OS.syncFateTooltipsFromData) {
      OS.syncFateTooltipsFromData();
    }
  };

  OS.openDestinoModal = function () {
    var modal = OS.$("destino-modal");
    if (!modal) return;
    OS.renderFateTokens();
    modal.classList.add("open");
  };

  OS.closeDestinoModal = function () {
    var modal = OS.$("destino-modal");
    if (!modal) return;
    modal.classList.remove("open");
  };

  /**
   * Inicia uma Nova Sessão:
   * - Zera todas as Fichas do Destino não usadas.
   * - Sorteia 1 Ficha do Destino proporcionalmente à pool atual do personagem (pool base + bônus de nível) e credita ao jogador.
   * - Reseta o 6B para o estado de rolagem inicial da sessão (sem gerar fadiga na próxima rolagem e avaliando Jogadas Especiais iniciais).
   */
  OS.startNewSession = function () {
    OS.fateTokens = {
      vermelha: 0,
      azul: 0,
      verde: 0,
      preta: 0
    };
    OS.lastSpecial6BPlay = null;
    OS.hasPerformedInitialReload = false;
    OS.resetCylinderState();

    for (var i = 0; i < 6; i++) {
      var inp = OS.$("chamber-" + i);
      if (inp) {
        inp.value = "";
        inp.removeAttribute("data-original-val");
      }
      var cb = OS.$("chamber-" + i + "-mark");
      if (cb) cb.checked = false;
    }
    OS.syncMarkedChambersVisual();

    if (OS.update6BForLevel) {
      OS.update6BForLevel(OS.getCurrentLevel ? OS.getCurrentLevel() : 1);
    }

    var drawnColor = OS.drawFateTokenFromPool ? OS.drawFateTokenFromPool() : "vermelha";
    OS.lastDrawnFateToken = drawnColor;
    OS.creditFateTokens(1, drawnColor);

    OS.updateStatsFields(false);
    OS.updateReloadButtonState();
    OS.renderFateTokens();

    var colorNames = {
      vermelha: "Vermelha",
      azul: "Azul",
      verde: "Verde",
      preta: "Preta"
    };
    var fb = OS.$("destino-feedback");
    if (fb) {
      fb.textContent =
        "Nova sessão iniciada: Fichas anteriores zeradas, +1 Ficha " +
        (colorNames[drawnColor] || drawnColor) +
        " sorteada da pool e 6B pronto para a rolagem inicial (sem gerar fadiga).";
    }

    OS.scheduleSave();
    return drawnColor;
  };

  OS.bindFateTokensEvents = function () {
    var btnNovaSessao = OS.$("btn-nova-sessao");
    if (btnNovaSessao && !btnNovaSessao._bound) {
      btnNovaSessao._bound = true;
      btnNovaSessao.addEventListener("click", function () {
        OS.startNewSession();
      });
    }

    var btnGastarDestino = OS.$("btn-gastar-destino");
    if (btnGastarDestino && !btnGastarDestino._bound) {
      btnGastarDestino._bound = true;
      btnGastarDestino.addEventListener("click", function () {
        OS.openDestinoModal();
      });
    }

    var btnCloseDestino = OS.$("destino-modal-close");
    if (btnCloseDestino && !btnCloseDestino._bound) {
      btnCloseDestino._bound = true;
      btnCloseDestino.addEventListener("click", function () {
        OS.closeDestinoModal();
      });
    }

    var destinoModal = OS.$("destino-modal");
    if (destinoModal && !destinoModal._bound) {
      destinoModal._bound = true;
      destinoModal.addEventListener("click", function (e) {
        if (e.target === destinoModal) {
          OS.closeDestinoModal();
        }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var dm = OS.$("destino-modal");
        if (dm && dm.classList.contains("open")) {
          OS.closeDestinoModal();
        }
      }
    });

    document.querySelectorAll(".btn-destino-plus").forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function () {
        OS.adjustFateToken(btn.getAttribute("data-color"), 1);
      });
    });

    document.querySelectorAll(".btn-destino-minus").forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function () {
        OS.adjustFateToken(btn.getAttribute("data-color"), -1);
      });
    });

    document.querySelectorAll(".btn-destino-use").forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function () {
        OS.useFateToken(
          btn.getAttribute("data-color"),
          btn.getAttribute("data-effect")
        );
      });
    });

    OS.renderFateTokens();
    if (OS.bindRound7MechanicsEvents) {
      OS.bindRound7MechanicsEvents();
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * ITEM 3: Nível de Terror da Cena e Regras de Veteranos (veteranos.json)
   * ═══════════════════════════════════════════════════════════════════════════ */

  OS.sceneTerrorLevel = 0;
  OS.isVeterano = false;

  OS.getSceneTerrorLevel = function () {
    var inp = OS.$("scene-terror-input") || OS.$("scene-terror-slider");
    var val = inp ? parseInt(String(inp.value || 0), 10) : OS.sceneTerrorLevel;
    if (isNaN(val)) val = 0;
    return Math.max(0, Math.min(6, val));
  };

  OS.setSceneTerrorLevel = function (val, skipSave) {
    var clean = Math.max(0, Math.min(6, parseInt(String(val || 0), 10) || 0));
    OS.sceneTerrorLevel = clean;

    var slider = OS.$("scene-terror-slider");
    var numInp = OS.$("scene-terror-input");
    var calcTerror = OS.$("test-calc-terror");

    if (slider) slider.value = String(clean);
    if (numInp) numInp.value = String(clean);
    if (calcTerror) calcTerror.value = String(clean);

    OS.syncTerrorAndVeteranoUI();
    if (!skipSave) OS.scheduleSave();
    return clean;
  };

  OS.setVeterano = function (isVet, skipSave) {
    var flag = !!isVet;
    OS.isVeterano = flag;
    var cb = OS.$("is-veterano");
    if (cb) cb.checked = flag;

    OS.syncTerrorAndVeteranoUI();
    if (!skipSave) OS.scheduleSave();
    return flag;
  };

  OS.syncTerrorAndVeteranoUI = function () {
    var cb = OS.$("is-veterano");
    if (cb) OS.isVeterano = !!cb.checked;

    var terror = OS.getSceneTerrorLevel();
    OS.sceneTerrorLevel = terror;

    var noteEl = OS.$("terror-veterano-note");
    if (noteEl) {
      if (OS.isVeterano) {
        noteEl.textContent =
          "Veterano ativo: Defesa mínima = " +
          terror +
          " | REM máximo = REM base +" +
          terror +
          ".";
        noteEl.classList.add("veterano-active");
      } else {
        noteEl.textContent =
          "Personagem vivo: Nível de Terror (" +
          terror +
          ") soma apenas na Dificuldade de Testes.";
        noteEl.classList.remove("veterano-active");
      }
    }

    // Atualiza Defesa em tempo real (para Veteranos, nunca menor que Terror)
    OS.updateStatsFields(false);

    // Atualiza REM máximo em tempo real (para Veteranos, REM base + Terror)
    if (OS.recalcRem) {
      OS.recalcRem();
    }

    // Atualiza Calculadora de Dificuldade e modais dependentes
    if (OS.updateTestCalculatorUI) {
      OS.updateTestCalculatorUI();
    }
    if (OS.updateUpgradeDiffDisplay) {
      var upgModal = OS.$("upgrade-item-modal");
      if (upgModal && upgModal.classList.contains("open")) {
        OS.updateUpgradeDiffDisplay();
      }
    }
    if (OS.updateCraftSummaryUI) {
      OS.updateCraftSummaryUI();
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * ITEM 4: Sistema Genérico de Cálculo de Dificuldade de Teste (sistema_de_testes.json)
   * ═══════════════════════════════════════════════════════════════════════════ */

  OS.lastTestEvaluation = null;

  OS.getTestDifficultyState = function (customDb, customMod) {
    var dbEl = OS.$("test-calc-db");
    var modEl = OS.$("test-calc-mod");
    var db = customDb !== undefined && customDb !== null
      ? parseInt(String(customDb), 10)
      : (dbEl ? parseInt(String(dbEl.value || 6), 10) : 6);
    if (isNaN(db)) db = 6;

    var mod = customMod !== undefined && customMod !== null
      ? parseInt(String(customMod), 10)
      : (modEl ? parseInt(String(modEl.value || 0), 10) : 0);
    if (isNaN(mod)) mod = 0;

    var terror = OS.getSceneTerrorLevel();
    var total = db + terror + mod;

    return {
      db: db,
      terror: terror,
      mod: mod,
      total: total
    };
  };

  OS.calculateTestDifficulty = function (db, mod) {
    return OS.getTestDifficultyState(db, mod).total;
  };

  OS.resetTestCalcResultBadge = function () {
    OS.lastTestEvaluation = null;
    var badge = OS.$("test-calc-result-badge");
    if (badge) {
      badge.classList.remove(
        "test-result-pass",
        "test-result-fail",
        "test-result-crit-pass",
        "test-result-crit-fail"
      );
      badge.textContent = "Aguardando rolagem...";
    }
  };

  OS.syncTestCalcModalPlacement = function (targetSlotId, isVisible) {
    var box = OS.$("test-calc-box");
    if (!box) return;
    if (!isVisible) {
      box.hidden = true;
      box.setAttribute("hidden", "");
      return;
    }
    var slot = targetSlotId ? OS.$(targetSlotId) : null;
    if (slot && box.parentNode !== slot) {
      slot.appendChild(box);
    }
    box.hidden = false;
    box.removeAttribute("hidden");
    if (OS.updateTestCalculatorUI) {
      OS.updateTestCalculatorUI();
    }
  };

  OS.updateTestCalculatorUI = function () {
    var st = OS.getTestDifficultyState();
    var terrorEl = OS.$("test-calc-terror");
    var totalEl = OS.$("test-calc-total");
    if (terrorEl) terrorEl.value = String(st.terror);
    if (totalEl) totalEl.textContent = String(st.total);

    // Se já houve uma rolagem avaliada anteriormente, reavalia contra a nova dificuldade
    if (OS.lastTestEvaluation && typeof OS.lastTestEvaluation.rollTotal === "number") {
      OS.evaluateTestResult(
        OS.lastTestEvaluation.rollTotal,
        OS.lastTestEvaluation.label,
        st.total,
        OS.lastTestEvaluation.rollMeta
      );
    }
    return st.total;
  };

  OS.evaluateTestResult = function (rollTotal, label, customDiffTotal, rollMeta) {
    var diffTotal =
      typeof customDiffTotal === "number" && !isNaN(customDiffTotal)
        ? customDiffTotal
        : OS.getTestDifficultyState().total;
    var numRoll = parseInt(String(rollTotal || 0), 10);
    if (isNaN(numRoll)) numRoll = 0;

    var meta = rollMeta || null;
    var exploded = !!(meta && meta.exploded);
    var naturalOne = !!(meta && meta.naturalOne);

    // Regras de sistema_de_testes.json → falhas_e_sucessos_criticos:
    // - Sucesso Crítico: dado de perícia explode E resultado final supera a Dificuldade Total em 10 ou mais.
    // - Falha Crítica: dado de perícia mostra 1 E resultado final fica 10 ou mais abaixo da Dificuldade Total.
    var isCriticalSuccess = exploded && (numRoll - diffTotal >= 10);
    var isCriticalFailure = !isCriticalSuccess && naturalOne && (diffTotal - numRoll >= 10);
    var passed = isCriticalSuccess || (!isCriticalFailure && numRoll >= diffTotal);

    var outcome = "Falha";
    var badgePrefix = "✗ FALHA";
    var badgeClass = "test-result-fail";

    if (isCriticalSuccess) {
      outcome = "Sucesso Crítico";
      badgePrefix = "★ SUCESSO CRÍTICO";
      badgeClass = "test-result-crit-pass";
    } else if (isCriticalFailure) {
      outcome = "Falha Crítica";
      badgePrefix = "☠ FALHA CRÍTICA";
      badgeClass = "test-result-crit-fail";
    } else if (passed) {
      outcome = "Sucesso";
      badgePrefix = "✓ SUCESSO";
      badgeClass = "test-result-pass";
    }

    OS.lastTestEvaluation = {
      rollTotal: numRoll,
      difficultyTotal: diffTotal,
      passed: passed,
      isCriticalSuccess: isCriticalSuccess,
      isCriticalFailure: isCriticalFailure,
      outcome: outcome,
      rollMeta: meta,
      label: label || "Teste"
    };

    var badge = OS.$("test-calc-result-badge");
    if (badge) {
      badge.classList.remove(
        "test-result-pass",
        "test-result-fail",
        "test-result-crit-pass",
        "test-result-crit-fail"
      );
      badge.classList.add(badgeClass);
      badge.textContent =
        badgePrefix +
        " — " +
        (label ? label + ": " : "") +
        numRoll +
        " vs Dif. " +
        diffTotal;
    }

    return OS.lastTestEvaluation;
  };

  /**
   * Retorna o maior valor disponível atual do 6B (câmaras não gastas em OS.usedChambers).
   */
  OS.getHighestAvailable6BValue = function () {
    var maxVal = 0;
    for (var i = 0; i < 6; i++) {
      if (OS.usedChambers && OS.usedChambers.indexOf(i) >= 0) continue;
      var v = OS.chamberValueAt ? OS.chamberValueAt(i) : 0;
      if (v > maxVal) maxVal = v;
    }
    return maxVal;
  };

  /**
   * Realiza um Teste Passivo conforme sistema_de_testes.json:
   * Maior resultado atual disponível do 6B + rolagem da perícia apropriada
   * (ou 1d4 - 2 se a perícia não tiver dados marcados).
   */
  OS.performPassiveSkillTest = function (skillId, forcedSkillRoll) {
    var cleanId = String(skillId || "")
      .replace(/^pericia-/, "")
      .replace(/^combate-/, "");
    var rowEl =
      document.querySelector('.skill-row[data-skill-key="pericia-' + cleanId + '"]') ||
      document.querySelector('.skill-row[data-skill-key="combate-' + cleanId + '"]');
    var titleEl = rowEl ? rowEl.querySelector(".skill-title") : null;
    var skillLabel = titleEl ? titleEl.textContent : cleanId;
    var dice = rowEl && OS.getSelectedDice ? OS.getSelectedDice(rowEl) : [];

    var max6B = OS.getHighestAvailable6BValue();
    var skillRollVal = 0;
    var rollDesc = "";

    if (typeof forcedSkillRoll === "number" && !isNaN(forcedSkillRoll)) {
      skillRollVal = forcedSkillRoll;
      rollDesc = "Perícia(" + skillRollVal + ")";
    } else if (dice.length > 0) {
      var rolled = OS.rollSelectedDiceDetailed
        ? OS.rollSelectedDiceDetailed(dice)
        : { results: OS.rollSelectedDice(dice), details: [] };
      skillRollVal = OS.getHighestRoll(rolled.results);
      rollDesc = dice.join("·") + "(" + skillRollVal + ")";
    } else {
      // Perícia não treinada: 1d4 - 2 (sem explosão) conforme sistema_de_testes.json
      var d4 = OS.generateDiceResult ? OS.generateDiceResult("d4") : (((Math.random() * 4) | 0) + 1);
      skillRollVal = d4 - 2;
      rollDesc = "1d4(" + d4 + ")-2 = " + skillRollVal;
    }

    var buffRes = OS.evaluateSkillRollBuffs
      ? OS.evaluateSkillRollBuffs("pericia-" + cleanId, skillLabel)
      : { total: 0, items: [] };
    var buffTxt = buffRes.items && buffRes.items.length
      ? " + Buffs[+" + buffRes.total + "]"
      : "";

    var total = max6B + skillRollVal + (buffRes.total || 0);
    if (rowEl) {
      var outEl = rowEl.querySelector(".roll-result");
      if (outEl) {
        outEl.textContent = "Passivo: Maior 6B(" + max6B + ") + " + rollDesc + buffTxt + " = " + total;
        outEl.classList.add("rolled");
      }
    }

    return {
      total: total,
      max6B: max6B,
      skillRoll: skillRollVal,
      buffBonus: buffRes.total || 0,
      skillId: cleanId,
      skillLabel: skillLabel,
      detailText: "Maior 6B (" + max6B + ") + " + skillLabel + " (" + rollDesc + ")" + buffTxt + " = " + total
    };
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * ITEM 2: Condições Aplicadas na Ficha (regras_combate.json)
   * ═══════════════════════════════════════════════════════════════════════════ */

  OS.activeConditions = [];
  OS.lastConfusoResolution = null;

  var DEFAULT_CONDITIONS_CATALOG = [
    { nome: "Abalado", possui_grau: false, cumulativo: false, efeito: "Não realiza reações nem ações de movimento; ao sofrer novamente fica Apavorado." },
    { nome: "Apavorado", possui_grau: false, cumulativo: false, efeito: "Usa o movimento para fugir da fonte de medo; se não puder fugir, não realiza nenhuma ação." },
    { nome: "Atordoado", possui_grau: false, cumulativo: false, efeito: "Não pode realizar ações e perde toda a sua Defesa." },
    { nome: "Caído", possui_grau: false, cumulativo: false, efeito: "Metade do movimento; desvantagem em ataques corpo a corpo; levantar custa 1 movimento." },
    { nome: "Cego", possui_grau: false, cumulativo: false, efeito: "Perde metade da Defesa, metade do movimento e tem desvantagem em todos os testes de ataque." },
    { nome: "Confuso", possui_grau: false, cumulativo: false, efeito: "Role 1d4 no início do turno: 1=ataca a si mesmo (1 dano no 6B e encerra); 2=ataca criatura mais próxima; 3=perde turno e remove; 4=age normalmente e remove." },
    { nome: "Envenenado", possui_grau: true, cumulativo: true, efeito: "Reduz o maior dado do 6B em valor igual ao grau de Envenenamento (cumulativo com Doente e Fatigado)." },
    { nome: "Doente", possui_grau: true, cumulativo: true, efeito: "Reduz o maior dado do 6B em valor igual ao grau da Doença (cumulativo com Envenenado e Fatigado)." },
    { nome: "Fatigado", possui_grau: true, cumulativo: true, efeito: "Reduz o maior dado do 6B em 1 para cada nível de Fadiga (cumulativo com Envenenado e Doente)." },
    { nome: "Inconsciente", possui_grau: false, cumulativo: false, efeito: "Incapaz de realizar ações ou reações, cai no chão e perde toda a Defesa." },
    { nome: "Imobilizado", possui_grau: false, cumulativo: false, efeito: "Perde o deslocamento e sofre desvantagem em ataques." },
    { nome: "Paralisado", possui_grau: false, cumulativo: false, efeito: "Incapaz de se mover ou agir e perde toda a Defesa." },
    { nome: "Sangrando", possui_grau: false, cumulativo: false, efeito: "No início do turno perde 1 ponto de vida (1 valor do 6B) até ser estancado." },
    { nome: "Surdo", possui_grau: false, cumulativo: false, efeito: "Falha automática em testes de audição e desvantagem na Iniciativa." },
    { nome: "Em Chamas", possui_grau: false, cumulativo: false, efeito: "Sofre 1 ponto de dano no início de cada turno até apagar o fogo (1 ação)." }
  ];

  OS.getConditionsCatalog = function () {
    var rc = OS.getGameData ? OS.getGameData("regras_combate") : null;
    var sec = rc && rc.condicoes_no_oeste_sombrio;
    if (!sec) return DEFAULT_CONDITIONS_CATALOG.slice();

    var list = [];
    var seen = {};
    var comuns = Array.isArray(sec.condicoes_comuns) ? sec.condicoes_comuns : [];
    var menosComuns = Array.isArray(sec.condicoes_menos_comuns) ? sec.condicoes_menos_comuns : [];

    comuns.concat(menosComuns).forEach(function (c) {
      if (!c || !c.nome) return;
      var key = String(c.nome).trim().toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      var isCum =
        !!c.possui_grau ||
        key === "envenenado" ||
        key === "doente" ||
        key === "fatigado" ||
        (typeof c.acumulo === "string" && c.acumulo.toLowerCase().indexOf("cumulativo") >= 0);
      list.push({
        nome: c.nome,
        possui_grau: !!c.possui_grau || isCum,
        cumulativo: isCum,
        efeito: c.efeito || "",
        tabela_1d4: c.tabela_1d4 || null
      });
    });

    return list.length ? list : DEFAULT_CONDITIONS_CATALOG.slice();
  };

  OS.getConditionDegree = function (nome) {
    var needle = String(nome || "").trim().toLowerCase();
    if (!needle) return 0;
    var found = (OS.activeConditions || []).find(function (c) {
      return c && String(c.nome || "").trim().toLowerCase() === needle;
    });
    return found ? Math.max(0, parseInt(found.grau, 10) || 1) : 0;
  };

  OS.getTotalCumulative6BPenalty = function () {
    var fatDeg = OS.getConditionDegree("Fatigado");
    var envDeg = OS.getConditionDegree("Envenenado");
    var doeDeg = OS.getConditionDegree("Doente");
    return fatDeg + envDeg + doeDeg;
  };

  OS.renderPenaltySummary = function (rawVals, effVals, totalPenalty) {
    var el = OS.$("condicoes-penalidade-summary");
    if (!el) return;
    if (!totalPenalty || totalPenalty <= 0) {
      el.textContent = "";
      return;
    }
    var fat = OS.getConditionDegree("Fatigado");
    var env = OS.getConditionDegree("Envenenado");
    var doe = OS.getConditionDegree("Doente");
    var parts = [];
    if (fat > 0) parts.push("Fatigado " + fat);
    if (env > 0) parts.push("Envenenado " + env);
    if (doe > 0) parts.push("Doente " + doe);

    var changes = [];
    for (var i = 0; i < 6; i++) {
      var r = (rawVals && rawVals[i]) || 0;
      var e = (effVals && effVals[i]) !== undefined ? effVals[i] : r;
      if (r !== e) {
        changes.push("C" + (i + 1) + ": " + r + " → " + e + (e === 0 ? " (DANO!)" : ""));
      }
    }

    el.textContent =
      "Penalidade cumulativa no 6B: -" +
      totalPenalty +
      " (" +
      parts.join(" + ") +
      ")" +
      (changes.length ? " | Dados afetados: " + changes.join(", ") : "");
  };

  OS.addOrUpdateCondition = function (nome, grauToAdd, options) {
    options = options || {};
    var cleanNome = String(nome || "").trim();
    if (!cleanNome) return null;

    var cat = OS.getConditionsCatalog();
    var meta = cat.find(function (c) {
      return String(c.nome || "").trim().toLowerCase() === cleanNome.toLowerCase();
    }) || {
      nome: cleanNome,
      possui_grau: cleanNome.toLowerCase() === "envenenado" || cleanNome.toLowerCase() === "doente" || cleanNome.toLowerCase() === "fatigado",
      cumulativo: cleanNome.toLowerCase() === "envenenado" || cleanNome.toLowerCase() === "doente" || cleanNome.toLowerCase() === "fatigado",
      efeito: ""
    };

    var delta = Math.max(1, parseInt(String(grauToAdd !== undefined ? grauToAdd : 1), 10) || 1);
    var lower = meta.nome.toLowerCase();

    if (!Array.isArray(OS.activeConditions)) OS.activeConditions = [];
    var existing = OS.activeConditions.find(function (c) {
      return c && String(c.nome || "").trim().toLowerCase() === lower;
    });

    if (existing) {
      if (meta.possui_grau || meta.cumulativo) {
        existing.grau = options.replaceDegree
          ? delta
          : Math.max(1, (parseInt(existing.grau, 10) || 1) + delta);
        existing.possui_grau = true;
      }
    } else {
      existing = {
        nome: meta.nome,
        grau: meta.possui_grau ? delta : 1,
        possui_grau: !!meta.possui_grau,
        cumulativo: !!meta.cumulativo,
        efeito: meta.efeito || ""
      };
      OS.activeConditions.push(existing);
    }

    OS.applyFatiguePenalty();
    OS.renderActiveConditions();
    OS.scheduleSave();
    return existing;
  };

  OS.removeCondition = function (nome) {
    var lower = String(nome || "").trim().toLowerCase();
    if (!lower) return false;

    OS.activeConditions = (OS.activeConditions || []).filter(function (c) {
      return c && String(c.nome || "").trim().toLowerCase() !== lower;
    });

    OS.applyFatiguePenalty();
    OS.renderActiveConditions();
    OS.scheduleSave();
    return true;
  };

  /**
   * Aplica 1 (ou mais) pontos de dano direto no 6B, bloqueando valores disponíveis do 6B
   * (usado por exemplo quando Confuso rola 1 no 1d4 ou quando dado chega a 0).
   */
  OS.apply6BDamage = function (damagePoints) {
    var pts = Math.max(1, parseInt(String(damagePoints || 1), 10) || 1);
    var blockedNow = [];
    var damageLimit = OS.freeEdit && OS.get6BDiceArray ? Math.max(1, Math.min(6, OS.get6BDiceArray().length)) : 6;

    OS._suppressDamageHook = true;
    try {
      for (var p = 0; p < pts; p++) {
        var targetIdx = -1;
        for (var i = 0; i < damageLimit; i++) {
          if (OS.damagedChambers.indexOf(i) === -1) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx === -1) break;

        if (OS.usedChambers.indexOf(targetIdx) < 0) OS.usedChambers.push(targetIdx);
        if (OS.damagedChambers.indexOf(targetIdx) < 0) OS.damagedChambers.push(targetIdx);
        blockedNow.push(targetIdx);
        var chamberEl = OS.getChamberElement(targetIdx);
        var cb = OS.$("chamber-" + targetIdx + "-mark");
        if (cb) { cb.checked = true; cb.dataset.manualDamageBlocked = "1"; }
        if (chamberEl) {
          chamberEl.classList.add("marked", "used", "damaged");
        }
      }
    } finally {
      OS._suppressDamageHook = false;
    }

    OS.syncMarkedChambersVisual();
    OS.syncUsedChambersVisual(true);
    OS.updateReloadButtonState();
    if (OS.onCharacterDamageSuffered) {
      OS.onCharacterDamageSuffered(pts);
    }
    OS.scheduleSave();
    return blockedNow;
  };

  /**
   * Resolve o início do turno de um personagem Confuso rolando 1d4 na tabela_1d4 de regras_combate.json:
   * - 1: Ataca a si mesmo, sofrendo 1 ponto de dano nos seus 6B, encerrando a condição.
   * - 2: Ataca a criatura mais próxima (mantém a condição).
   * - 3: Perde o turno, mas remove a condição.
   * - 4: Age normalmente e remove a condição.
   */
  OS.resolveConfusoCondition = function (forcedD4Roll) {
    var roll =
      typeof forcedD4Roll === "number" && forcedD4Roll >= 1 && forcedD4Roll <= 4
        ? forcedD4Roll
        : (OS.generateDiceResult ? OS.generateDiceResult("d4") : (((Math.random() * 4) | 0) + 1));

    var cat = OS.getConditionsCatalog();
    var confMeta = cat.find(function (c) {
      return String(c.nome || "").toLowerCase() === "confuso";
    });
    var rawTabela = confMeta && confMeta.tabela_1d4;
    var efeitoTexto = "";
    if (Array.isArray(rawTabela)) {
      var foundRow = rawTabela.find(function (r) {
        return r && parseInt(String(r.resultado), 10) === roll;
      });
      efeitoTexto = (foundRow && foundRow.efeito) || "";
    } else if (rawTabela && typeof rawTabela === "object") {
      var val = rawTabela[String(roll)];
      efeitoTexto = typeof val === "object" && val !== null ? (val.efeito || "") : String(val || "");
    }
    if (!efeitoTexto) {
      var fallbackMap = {
        "1": "O alvo ataca a si mesmo, sofrendo 1 ponto de dano nos seus 6B, encerrando a condição.",
        "2": "O alvo ataca a criatura mais próxima.",
        "3": "O alvo perde o turno, mas remove a condição.",
        "4": "O alvo age normalmente e remove a condição."
      };
      efeitoTexto = fallbackMap[String(roll)] || "";
    }
    var damagedChambers = [];
    var removed = false;

    if (roll === 1) {
      damagedChambers = OS.apply6BDamage(1);
      OS.removeCondition("Confuso");
      removed = true;
    } else if (roll === 2) {
      removed = false;
    } else if (roll === 3 || roll === 4) {
      OS.removeCondition("Confuso");
      removed = true;
    }

    OS.lastConfusoResolution = {
      roll: roll,
      effect: efeitoTexto,
      removed: removed,
      damagedChambers: damagedChambers
    };

    var fb = OS.$("condicoes-feedback");
    if (fb) {
      fb.textContent = "Confuso (1d4 = " + roll + "): " + efeitoTexto;
    }

    OS.renderActiveConditions();
    OS.scheduleSave();
    return OS.lastConfusoResolution;
  };

  OS.renderActiveConditions = function () {
    var listEl = OS.$("condicoes-ativas-list");
    if (!listEl) return;

    if (!Array.isArray(OS.activeConditions) || !OS.activeConditions.length) {
      listEl.innerHTML = '<span class="condicoes-empty">Nenhuma condição ativa.</span>';
      return;
    }

    listEl.innerHTML = "";
    OS.activeConditions.forEach(function (cond) {
      if (!cond || !cond.nome) return;
      var badge = document.createElement("div");
      badge.className = "condicao-badge";
      badge.dataset.condicao = cond.nome;
      if (cond.efeito) badge.title = cond.efeito;

      var nameSpan = document.createElement("span");
      nameSpan.className = "condicao-badge-name";
      var label = cond.nome;
      if (cond.possui_grau || (cond.grau && cond.grau > 1)) {
        label += " (Grau " + (cond.grau || 1) + ")";
      }
      nameSpan.textContent = label;
      badge.appendChild(nameSpan);

      if (String(cond.nome).trim().toLowerCase() === "confuso") {
        var confBtn = document.createElement("button");
        confBtn.type = "button";
        confBtn.className = "btn btn-secondary btn-small btn-resolve-confuso";
        confBtn.textContent = "Rolar 1d4";
        confBtn.title = "Rolar 1d4 da condição Confuso e aplicar o efeito";
        confBtn.addEventListener("click", function () {
          OS.resolveConfusoCondition();
        });
        badge.appendChild(confBtn);
      }

      var rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "condicao-remove-btn btn-remove-condicao";
      rmBtn.dataset.condicao = cond.nome;
      rmBtn.textContent = "✕";
      rmBtn.title = "Remover condição " + cond.nome;
      rmBtn.addEventListener("click", function () {
        OS.removeCondition(cond.nome);
      });
      badge.appendChild(rmBtn);

      listEl.appendChild(badge);
    });
  };

  OS.populateConditionSelector = function () {
    var sel = OS.$("condicao-select");
    var grauWrap = OS.$("condicao-grau-wrap");
    var preview = OS.$("condicao-preview-effect");
    if (!sel) return;

    var cat = OS.getConditionsCatalog();
    sel.innerHTML = "";
    cat.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.nome;
      opt.textContent = c.nome + (c.possui_grau ? " (cumulativa / grau)" : "");
      sel.appendChild(opt);
    });

    function updateConditionPreview() {
      var chosen = cat.find(function (c) { return c.nome === sel.value; });
      if (grauWrap) {
        grauWrap.style.display = chosen && chosen.possui_grau ? "inline-flex" : "none";
      }
      if (preview) {
        preview.textContent = chosen ? chosen.efeito : "";
      }
    }

    if (!sel._boundChange) {
      sel._boundChange = true;
      sel.addEventListener("change", updateConditionPreview);
    }
    updateConditionPreview();
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * ITEM 5: Sistema de Tempo Livre (tempo_livre.json)
   * ═══════════════════════════════════════════════════════════════════════════ */

  OS.downtimeWeeks = 0;
  OS.downtimeDays = 0;
  OS._selectedCraftItem = null;

  OS.getAllCharacterSkills = function () {
    var list = [];
    (OS.SKILLS || []).forEach(function (s) {
      list.push({
        key: "pericia-" + s.id,
        id: s.id,
        label: s.name || s.label || s.id,
        type: "general"
      });
    });
    (OS.COMBAT_SKILLS || []).forEach(function (s) {
      list.push({
        key: "combate-" + s.id,
        id: s.id,
        label: (s.name || s.label || s.id) + " (Combate)",
        type: "combat"
      });
    });
    return list;
  };

  OS.getSkillLevelByKey = function (skillKey) {
    var key = String(skillKey || "");
    if (key.indexOf("pericia-") !== 0 && key.indexOf("combate-") !== 0) {
      key = "pericia-" + key;
    }
    var rowEl = document.querySelector('.skill-row[data-skill-key="' + key + '"]');
    if (!rowEl) return 0;
    var dice = OS.getSelectedDice ? OS.getSelectedDice(rowEl) : [];
    return diceToLevel(dice);
  };

  OS.setSkillLevelByKey = function (skillKey, newLevel) {
    var key = String(skillKey || "");
    if (key.indexOf("pericia-") !== 0 && key.indexOf("combate-") !== 0) {
      key = "pericia-" + key;
    }
    var lv = Math.max(0, Math.min(10, parseInt(String(newLevel || 0), 10) || 0));
    var dieTypes = ["d4", "d6", "d8", "d10", "d12"];
    dieTypes.forEach(function (d) {
      var cb = OS.$(key + "-" + d);
      if (cb) cb.checked = false;
    });

    if (lv > 0) {
      var dice = levelToDice(lv);
      dice.forEach(function (d) {
        var cb = OS.$(key + "-" + d);
        if (cb) cb.checked = true;
      });
    }

    if (OS.sync6BAndRemUI) {
      OS.sync6BAndRemUI();
    }
    if (OS.updateStatsFields) {
      OS.updateStatsFields(false);
    }
    return lv;
  };

  OS.addDowntime = function (weeksDelta, daysDelta) {
    var wEl = OS.$("downtime-weeks");
    var dEl = OS.$("downtime-days");
    var curW = wEl ? parseInt(String(wEl.value || 0), 10) || 0 : OS.downtimeWeeks;
    var curD = dEl ? parseInt(String(dEl.value || 0), 10) || 0 : OS.downtimeDays;

    OS.downtimeWeeks = Math.max(0, curW + (parseInt(weeksDelta, 10) || 0));
    OS.downtimeDays = Math.max(0, curD + (parseInt(daysDelta, 10) || 0));

    if (wEl) wEl.value = String(OS.downtimeWeeks);
    if (dEl) dEl.value = String(OS.downtimeDays);
  };

  /**
   * 5.1 Retreinar perícia (1 semana):
   * Remove 1 ponto da perícia de origem (sem ficar abaixo de 0) e adiciona 1 ponto na perícia de destino.
   */
  OS.retrainSkill = function (sourceKey, targetKey) {
    var src = sourceKey || (OS.$("retrain-source-skill") && OS.$("retrain-source-skill").value);
    var tgt = targetKey || (OS.$("retrain-target-skill") && OS.$("retrain-target-skill").value);
    var fb = OS.$("tempo-livre-feedback");

    if (!src || !tgt || src === tgt) {
      if (fb) fb.textContent = "Selecione duas perícias diferentes para retreinar.";
      return false;
    }

    var srcLv = OS.getSkillLevelByKey(src);
    var tgtLv = OS.getSkillLevelByKey(tgt);

    if (srcLv <= 0) {
      if (fb) fb.textContent = "A perícia de origem precisa ter pelo menos nível 1 para perder 1 ponto.";
      return false;
    }
    if (tgtLv >= 10) {
      if (fb) fb.textContent = "A perícia de destino já está no nível máximo.";
      return false;
    }

    OS.setSkillLevelByKey(src, srcLv - 1);
    OS.setSkillLevelByKey(tgt, tgtLv + 1);
    OS.addDowntime(1, 0);

    OS.populateRetrainSelects();
    if (fb) {
      fb.textContent =
        "✓ Retreinamento concluído (1 semana): -1 ponto em " +
        src.replace(/^(pericia-|combate-)/, "") +
        " (" +
        srcLv +
        " → " +
        (srcLv - 1) +
        "), +1 ponto em " +
        tgt.replace(/^(pericia-|combate-)/, "") +
        " (" +
        tgtLv +
        " → " +
        (tgtLv + 1) +
        ").";
    }

    OS.scheduleSave();
    return true;
  };

  /**
   * 5.2 Trabalhar — Profissão (1 semana):
   * Realiza um teste passivo de Profissão (maior valor disponível do 6B + rolagem de Profissão)
   * e credita o valor obtido em $ no campo de dinheiro da ficha.
   */
  OS.workProfession = function (forcedSkillRoll) {
    var testRes = OS.performPassiveSkillTest("profissao", forcedSkillRoll);
    var earned = Math.max(0, testRes.total);
    var beforeMoney = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;
    var afterMoney = Math.round((beforeMoney + earned) * 100) / 100;

    if (OS.setCharacterMoney) {
      OS.setCharacterMoney(afterMoney);
    }
    OS.addDowntime(1, 0);

    var fb = OS.$("tempo-livre-feedback");
    if (fb) {
      fb.textContent =
        "✓ Trabalho concluído (1 semana): " +
        testRes.detailText +
        " → +$" +
        earned +
        " creditados (Saldo: $" +
        beforeMoney +
        " → $" +
        afterMoney +
        ").";
    }

    OS.scheduleSave();
    return {
      earned: earned,
      beforeMoney: beforeMoney,
      afterMoney: afterMoney,
      testResult: testRes
    };
  };

  /**
   * 5.3 Fabricar item (Alquimia / Engenharia):
   * - Custo em materiais = 50% do preço tabelado (0.5 * preco)
   * - Tempo = 1 dia + 1 dia a cada $10 de preço tabelado (1 + Math.floor(preco / 10))
   * - Teste passivo de Alquimia ou Engenharia contra Dificuldade Total (DB + Terror + Mod)
   * - Sucesso: adiciona ao inventário (4 doses quando Alquimia; 1 unidade quando Engenharia).
   * - Falha: não adiciona ao inventário.
   */
  OS.calculateCraftingMetrics = function (rawPreco, skillId) {
    var price = OS.parseItemPrice ? OS.parseItemPrice(rawPreco) : (parseFloat(rawPreco) || 0);
    var materialCost = Math.round(price * 0.5 * 100) / 100;
    var days = 1 + Math.floor(price / 10);
    var isAlquimia = String(skillId || "").toLowerCase().indexOf("alquimia") >= 0;
    var outputQty = isAlquimia ? 4 : 1;
    return {
      tablePrice: price,
      materialCost: materialCost,
      daysRequired: days,
      outputQty: outputQty
    };
  };

  OS.getCraftableCatalogItems = function (skillId) {
    var cat = OS.equipCatalog;
    if (!cat || !cat.loaded || !cat.byGroup) return [];
    var isAlq = String(skillId || "").toLowerCase().indexOf("alquimia") >= 0;
    var groups = isAlq ? ["itens", "equipamentos"] : ["armas", "equipamentos", "vestuario", "itens"];
    var list = [];

    groups.forEach(function (g) {
      var records = cat.byGroup[g] || [];
      records.forEach(function (rec) {
        var data = rec && rec.data;
        var arr = Array.isArray(data) ? data : (data && Array.isArray(data.itens) ? data.itens : []);
        arr.forEach(function (it) {
          if (!it) return;
          if (Array.isArray(it.variantes)) {
            it.variantes.forEach(function (v) {
              if (!v || !v.nome) return;
              list.push({
                name: v.nome,
                item: v,
                parent: it,
                group: g,
                listId: rec.id
              });
            });
          } else {
            var nm = it.nome || it.kit || it.mutagenico;
            if (!nm) return;
            list.push({
              name: nm,
              item: it,
              parent: null,
              group: g,
              listId: rec.id
            });
          }
        });
      });
    });

    return list;
  };

  OS.populateCraftCatalogSelect = function () {
    var skillSel = OS.$("craft-skill-select");
    var itemSel = OS.$("craft-catalog-item-select");
    if (!itemSel) return;

    var skillId = skillSel ? skillSel.value : "alquimia";
    var items = OS.getCraftableCatalogItems(skillId);
    itemSel.innerHTML = "";

    items.forEach(function (entry, idx) {
      var opt = document.createElement("option");
      opt.value = String(idx);
      var p = entry.item.preco !== undefined && entry.item.preco !== null ? " ($" + entry.item.preco + ")" : "";
      opt.textContent = entry.name + p;
      itemSel.appendChild(opt);
    });

    if (OS._selectedCraftItem) {
      var matchIdx = items.findIndex(function (e) {
        return e.name.toLowerCase() === OS._selectedCraftItem.name.toLowerCase();
      });
      if (matchIdx >= 0) {
        itemSel.value = String(matchIdx);
      } else {
        var customOpt = document.createElement("option");
        customOpt.value = "custom";
        customOpt.textContent = OS._selectedCraftItem.name + " ($" + (OS._selectedCraftItem.item.preco || 0) + ")";
        itemSel.appendChild(customOpt);
        itemSel.value = "custom";
      }
    } else if (items.length > 0) {
      OS._selectedCraftItem = items[0];
    }

    OS.updateCraftSummaryUI();
  };

  OS.selectCraftCatalogItem = function (itemObj, group, listId, parentObj) {
    if (!itemObj) return;
    var nm = itemObj.nome || itemObj.kit || itemObj.mutagenico || "(item)";
    OS._selectedCraftItem = {
      name: nm,
      item: itemObj,
      parent: parentObj || null,
      group: group || "itens",
      listId: listId || ""
    };
    var skillSel = OS.$("craft-skill-select");
    if (skillSel) {
      if (group === "itens") skillSel.value = "alquimia";
      else if (group === "armas" || group === "vestuario") skillSel.value = "engenharia";
    }
    OS.populateCraftCatalogSelect();
  };

  OS.updateCraftSummaryUI = function () {
    var skillSel = OS.$("craft-skill-select");
    var itemSel = OS.$("craft-catalog-item-select");
    var summaryBar = OS.$("craft-summary-bar");
    var dbInp = OS.$("craft-db-input");
    var diffPreview = OS.$("craft-diff-preview");

    var skillId = skillSel ? skillSel.value : "alquimia";
    var items = OS.getCraftableCatalogItems(skillId);
    if (itemSel && itemSel.value !== "custom") {
      var idx = parseInt(itemSel.value, 10);
      if (!isNaN(idx) && items[idx]) {
        OS._selectedCraftItem = items[idx];
      }
    }

    var db = dbInp ? parseInt(dbInp.value, 10) : 6;
    if (isNaN(db)) db = 6;
    var diffState = OS.getTestDifficultyState(db);
    if (diffPreview) {
      diffPreview.textContent =
        "Dif. Total: " +
        diffState.total +
        " (DB " +
        diffState.db +
        " + Terror " +
        diffState.terror +
        " + Mod " +
        diffState.mod +
        ")";
    }

    if (!summaryBar) return;
    var sel = OS._selectedCraftItem;
    if (!sel || !sel.item) {
      summaryBar.textContent = "Selecione um item para calcular custo e tempo.";
      return;
    }

    var metrics = OS.calculateCraftingMetrics(sel.item.preco, skillId);
    summaryBar.textContent =
      "Item: " +
      sel.name +
      " | Preço tabelado: $" +
      metrics.tablePrice +
      " | Custo em materiais (50%): $" +
      metrics.materialCost +
      " | Tempo necessário: " +
      metrics.daysRequired +
      " dia(s) | Rendimento: " +
      metrics.outputQty +
      (skillId === "alquimia" ? " doses" : " un.");
  };

  OS.craftCatalogItem = function (options) {
    options = options || {};
    var skillSel = OS.$("craft-skill-select");
    var dbInp = OS.$("craft-db-input");
    var fb = OS.$("tempo-livre-feedback");

    var skillId = options.skillId || (skillSel ? skillSel.value : "alquimia");
    var chosen = options.craftEntry || OS._selectedCraftItem;
    if (!chosen && options.itemName) {
      var allItems = OS.getCraftableCatalogItems("alquimia").concat(OS.getCraftableCatalogItems("engenharia"));
      chosen = allItems.find(function (e) {
        return e.name.toLowerCase() === String(options.itemName).trim().toLowerCase();
      });
    }

    if (!chosen || !chosen.item) {
      if (fb) fb.textContent = "Selecione um item do catálogo para fabricar.";
      return null;
    }

    var metrics = OS.calculateCraftingMetrics(chosen.item.preco, skillId);
    var currentMoney = OS.getCharacterMoney ? OS.getCharacterMoney() : 0;

    if (currentMoney < metrics.materialCost) {
      if (fb) {
        fb.textContent =
          "Saldo insuficiente para os materiais ($" +
          metrics.materialCost +
          " necessários, saldo atual: $" +
          currentMoney +
          ").";
      }
      return {
        success: false,
        reason: "insufficient_funds",
        materialCost: metrics.materialCost,
        daysRequired: metrics.daysRequired
      };
    }

    // Desconta o custo de materiais (50% do preço tabelado) e contabiliza os dias
    var remainingMoney = Math.max(0, Math.round((currentMoney - metrics.materialCost) * 100) / 100);
    if (OS.setCharacterMoney) {
      OS.setCharacterMoney(remainingMoney);
    }
    OS.addDowntime(0, metrics.daysRequired);

    // Sincroniza DB com a calculadora genérica se informado
    var db = options.db !== undefined
      ? parseInt(String(options.db), 10)
      : (dbInp ? parseInt(String(dbInp.value || 6), 10) : 6);
    if (isNaN(db)) db = 6;
    var calcDbEl = OS.$("test-calc-db");
    if (calcDbEl) calcDbEl.value = String(db);

    var diffTotal = OS.calculateTestDifficulty(db, options.mod);
    var testRes = OS.performPassiveSkillTest(skillId, options.forcedSkillRoll);
    var evalRes = OS.evaluateTestResult(
      testRes.total,
      "Fabricar " + chosen.name + " (" + testRes.skillLabel + ")",
      diffTotal
    );

    var addedItem = null;
    if (evalRes.passed) {
      if (OS.addInventoryItem) {
        addedItem = OS.addInventoryItem(
          chosen.item,
          metrics.outputQty,
          chosen.group,
          chosen.listId,
          chosen.parent
        );
      }
      if (fb) {
        fb.textContent =
          "✓ SUCESSO ao fabricar " +
          chosen.name +
          " (" +
          testRes.total +
          " vs Dif. " +
          diffTotal +
          ")! Materiais: -$" +
          metrics.materialCost +
          " | Tempo: +" +
          metrics.daysRequired +
          " dia(s) | Adicionado ao inventário: x" +
          metrics.outputQty +
          ".";
      }
    } else {
      if (fb) {
        fb.textContent =
          "✗ FALHA ao fabricar " +
          chosen.name +
          " (" +
          testRes.total +
          " vs Dif. " +
          diffTotal +
          "). Materiais gastos (-$" +
          metrics.materialCost +
          "), +" +
          metrics.daysRequired +
          " dia(s), nenhum item adicionado.";
      }
    }

    OS.scheduleSave();
    return {
      success: evalRes.passed,
      rollTotal: testRes.total,
      difficultyTotal: diffTotal,
      materialCost: metrics.materialCost,
      daysRequired: metrics.daysRequired,
      outputQty: evalRes.passed ? metrics.outputQty : 0,
      addedItem: addedItem
    };
  };

  OS.populateRetrainSelects = function () {
    var srcSel = OS.$("retrain-source-skill");
    var tgtSel = OS.$("retrain-target-skill");
    if (!srcSel || !tgtSel) return;

    var prevSrc = srcSel.value;
    var prevTgt = tgtSel.value;
    var allSkills = OS.getAllCharacterSkills();

    srcSel.innerHTML = "";
    tgtSel.innerHTML = "";

    allSkills.forEach(function (s) {
      var lv = OS.getSkillLevelByKey(s.key);
      if (lv > 0) {
        var optS = document.createElement("option");
        optS.value = s.key;
        optS.textContent = s.label + " (Nível " + lv + ")";
        srcSel.appendChild(optS);
      }
      if (lv < 10) {
        var optT = document.createElement("option");
        optT.value = s.key;
        optT.textContent = s.label + " (Nível " + lv + ")";
        tgtSel.appendChild(optT);
      }
    });

    if (prevSrc && Array.from(srcSel.options).some(function (o) { return o.value === prevSrc; })) {
      srcSel.value = prevSrc;
    }
    if (prevTgt && Array.from(tgtSel.options).some(function (o) { return o.value === prevTgt; })) {
      tgtSel.value = prevTgt;
    } else if (tgtSel.options.length > 1 && tgtSel.value === srcSel.value) {
      tgtSel.selectedIndex = 1;
    }
  };

  OS.openTempoLivreModal = function () {
    var modal = OS.$("tempo-livre-modal");
    if (!modal) return;

    var calcDb = OS.$("test-calc-db");
    var craftDb = OS.$("craft-db-input");
    if (calcDb && craftDb) craftDb.value = calcDb.value || "6";

    OS.populateRetrainSelects();
    var ensureCat = OS.loadEquipCatalog ? OS.loadEquipCatalog() : Promise.resolve();
    ensureCat.then(function () {
      OS.populateCraftCatalogSelect();
    });

    modal.classList.add("open");
  };

  OS.closeTempoLivreModal = function () {
    var modal = OS.$("tempo-livre-modal");
    if (modal) modal.classList.remove("open");
  };

  /* ─── Bind de todos os eventos das novas mecânicas ──────────── */

  OS.bindRound7MechanicsEvents = function () {
    // 1. Nível de Terror e Veterano
    var slider = OS.$("scene-terror-slider");
    var numInp = OS.$("scene-terror-input");
    var vetCb = OS.$("is-veterano");

    if (slider && !slider._bound) {
      slider._bound = true;
      slider.addEventListener("input", function () {
        OS.setSceneTerrorLevel(slider.value);
      });
      slider.addEventListener("change", function () {
        OS.setSceneTerrorLevel(slider.value);
      });
    }

    if (numInp && !numInp._bound) {
      numInp._bound = true;
      numInp.addEventListener("input", function () {
        OS.setSceneTerrorLevel(numInp.value);
      });
      numInp.addEventListener("change", function () {
        OS.setSceneTerrorLevel(numInp.value);
      });
    }

    if (vetCb && !vetCb._bound) {
      vetCb._bound = true;
      vetCb.addEventListener("change", function () {
        OS.setVeterano(vetCb.checked);
      });
    }

    // 2. Calculadora de Dificuldade de Testes
    var calcDb = OS.$("test-calc-db");
    var calcMod = OS.$("test-calc-mod");
    [calcDb, calcMod].forEach(function (inp) {
      if (inp && !inp._bound) {
        inp._bound = true;
        inp.addEventListener("input", function () {
          OS.updateTestCalculatorUI();
          OS.scheduleSave();
        });
      }
    });

    // 3. Condições Ativas
    var btnAddCond = OS.$("btn-add-condicao");
    var panelCond = OS.$("condicao-selector-panel");
    if (btnAddCond && !btnAddCond._bound) {
      btnAddCond._bound = true;
      btnAddCond.addEventListener("click", function () {
        if (!panelCond) return;
        var isHidden = panelCond.hasAttribute("hidden");
        if (isHidden) {
          OS.populateConditionSelector();
          panelCond.removeAttribute("hidden");
        } else {
          panelCond.setAttribute("hidden", "");
        }
      });
    }

    var btnConfirmCond = OS.$("btn-confirm-add-condicao");
    if (btnConfirmCond && !btnConfirmCond._bound) {
      btnConfirmCond._bound = true;
      btnConfirmCond.addEventListener("click", function () {
        var sel = OS.$("condicao-select");
        var grauInp = OS.$("condicao-grau-input");
        if (!sel || !sel.value) return;
        var grau = grauInp ? parseInt(grauInp.value, 10) || 1 : 1;
        OS.addOrUpdateCondition(sel.value, grau);
        if (panelCond) panelCond.setAttribute("hidden", "");
      });
    }

    // 4. Tempo Livre
    var btnTl = OS.$("btn-tempo-livre");
    if (btnTl && !btnTl._bound) {
      btnTl._bound = true;
      btnTl.addEventListener("click", function () {
        OS.openTempoLivreModal();
      });
    }

    var btnTlClose = OS.$("tempo-livre-close");
    if (btnTlClose && !btnTlClose._bound) {
      btnTlClose._bound = true;
      btnTlClose.addEventListener("click", function () {
        OS.closeTempoLivreModal();
      });
    }

    var tlOverlay = OS.$("tempo-livre-modal");
    if (tlOverlay && !tlOverlay._bound) {
      tlOverlay._bound = true;
      tlOverlay.addEventListener("click", function (e) {
        if (e.target === tlOverlay) OS.closeTempoLivreModal();
      });
    }

    var btnRetrain = OS.$("btn-exec-retreinar");
    if (btnRetrain && !btnRetrain._bound) {
      btnRetrain._bound = true;
      btnRetrain.addEventListener("click", function () {
        OS.retrainSkill();
      });
    }

    var btnWork = OS.$("btn-exec-trabalhar");
    if (btnWork && !btnWork._bound) {
      btnWork._bound = true;
      btnWork.addEventListener("click", function () {
        OS.workProfession();
      });
    }

    var craftSkillSel = OS.$("craft-skill-select");
    if (craftSkillSel && !craftSkillSel._bound) {
      craftSkillSel._bound = true;
      craftSkillSel.addEventListener("change", function () {
        OS._selectedCraftItem = null;
        OS.populateCraftCatalogSelect();
      });
    }

    var craftItemSel = OS.$("craft-catalog-item-select");
    if (craftItemSel && !craftItemSel._bound) {
      craftItemSel._bound = true;
      craftItemSel.addEventListener("change", function () {
        OS.updateCraftSummaryUI();
      });
    }

    var craftDbInp = OS.$("craft-db-input");
    if (craftDbInp && !craftDbInp._bound) {
      craftDbInp._bound = true;
      craftDbInp.addEventListener("input", function () {
        OS.updateCraftSummaryUI();
      });
    }

    var btnCraftPickCat = OS.$("btn-craft-pick-catalog");
    if (btnCraftPickCat && !btnCraftPickCat._bound) {
      btnCraftPickCat._bound = true;
      btnCraftPickCat.addEventListener("click", function () {
        if (OS.openCatalogModal) {
          OS.openCatalogModal("craft");
        }
      });
    }

    var btnExecCraft = OS.$("btn-exec-fabricar");
    if (btnExecCraft && !btnExecCraft._bound) {
      btnExecCraft._bound = true;
      btnExecCraft.addEventListener("click", function () {
        OS.craftCatalogItem();
      });
    }

    OS.populateConditionSelector();
    OS.renderActiveConditions();
    OS.syncTerrorAndVeteranoUI();
    OS.updateTestCalculatorUI();
  };
