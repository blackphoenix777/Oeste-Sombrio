/**
 * Modais — abrir/fechar, renderização e animações
 */
import { OS } from "./app.js";
import { getMisticismoLevel, calculateRemMax, levelToDice, diceToLevel } from "./rules/index.js";

var modalEventsBound = false;

  OS.defenseRollState = { roll: null, originalRoll: null, selected: null };
  OS.chamberSelectionState = {
    baseTotal: 0,
    dice: [],
    results: [],
    selectedChambers: [],
    rowEl: null,
    outEl: null
  };

  /* ---- Rolagem (perícias / armas) ---- */

  OS.openRollModal = function (title, subtitle, dice) {
    var modal = OS.$("roll-modal");
    if (!modal) return;
    OS.rollModalState.title = title || "Rolagem";
    OS.rollModalState.subtitle = subtitle || "";
    OS.rollModalState.dice = dice || [];
    OS.rollModalState.finalResults = [];
    OS.rollModalState.rollDetails = [];
    var totalLabel = modal.querySelector(".roll-total-label");
    if (totalLabel) totalLabel.textContent = "Maior Resultado";
    var isWeapon = !!(OS.chamberSelectionState && OS.chamberSelectionState.isWeaponRoll);
    if (OS.syncTestCalcModalPlacement) {
      OS.syncTestCalcModalPlacement("roll-modal-test-calc-slot", !isWeapon);
    }
    modal.classList.add("open");
    OS.animateDiceRoll();
  };

  OS.closeRollModal = function () {
    var modal = OS.$("roll-modal");
    if (!modal) return;
    modal.classList.remove("open");
  };

  OS.renderRollResults = function (dice, results, reveal) {
    var titleEl = OS.$("roll-modal-title");
    var subEl = OS.$("roll-modal-sub");
    var details = OS.$("roll-modal-details");
    var totalEl = OS.$("roll-modal-total");
    var highest = OS.getHighestRoll(results);

var selected =
  (OS.chamberSelectionState &&
   OS.chamberSelectionState.selectedChambers) || [];

var bonus = OS.calculateChamberBonus
  ? OS.calculateChamberBonus(selected)
  : 0;

var finalTotal = highest + bonus;

    if (titleEl) titleEl.textContent = OS.rollModalState.title || "Rolagem";
    if (subEl) {
  if (bonus > 0) {
    subEl.textContent =
      "Maior dado: " +
      highest +
      " | Bônus do tambor: +" +
      bonus +
      " | Final: " +
      finalTotal;
  } else {
    subEl.textContent =
      OS.rollModalState.subtitle ||
      "Maior dado usado como base do teste.";
  }
}

    if (details) {
      details.innerHTML = "";
      for (var i = 0; i < dice.length; i++) {
        var line = document.createElement("div");
        line.className = "roll-line";
        if (reveal && results[i] === highest && highest > 0) {
          line.classList.add("roll-line-best");
        }

        var dieLabel = document.createElement("span");
        dieLabel.className = "roll-die";
        dieLabel.textContent = "1" + dice[i] + " =";

        var value = document.createElement("span");
        value.className = "roll-value" + (reveal ? " reveal" : "");
        value.textContent = String(results[i]);

        line.appendChild(dieLabel);
        line.appendChild(value);
        details.appendChild(line);
      }
    }

    if (totalEl) totalEl.textContent = String(finalTotal);
  };

  OS.animateDiceRoll = function () {
    var dice = OS.rollModalState.dice || [];
    if (!dice.length) return;

    var durationMs = 520;
    var tickMs = 70;
    var start = Date.now();

    function tick() {
      var temp = [];
      for (var i = 0; i < dice.length; i++) {
        temp.push(OS.generateDiceResult(dice[i]));
      }
      OS.renderRollResults(dice, temp, false);

      if (Date.now() - start >= durationMs) {
        var rolled = OS.rollSelectedDiceDetailed
          ? OS.rollSelectedDiceDetailed(dice)
          : { results: OS.rollSelectedDice(dice), details: [] };
        OS.rollModalState.finalResults = rolled.results;
        OS.rollModalState.rollDetails = rolled.details || [];
        OS.renderRollResults(dice, rolled.results, true);
        OS.revealRollModalValues();
        return;
      }

      window.setTimeout(tick, tickMs);
    }

    tick();
  };

  /* ---- Escolha após explosão ---- */

  OS.explosionChoiceState = {
    details: [],
    selectedIndex: null
  };

  OS.openExplosionChoiceModal = function (details) {
    var modal = OS.$("explosion-modal");
    if (!modal) return;
    if (OS.closeRollModal) OS.closeRollModal();
    OS.explosionChoiceState.details = details || [];
    OS.explosionChoiceState.selectedIndex = null;
    OS.renderExplosionChoiceGrid();
    OS.updateExplosionChoiceUi();
    modal.classList.add("open");
  };

  OS.closeExplosionChoiceModal = function () {
    var modal = OS.$("explosion-modal");
    if (!modal) return;
    modal.classList.remove("open");
  };

  OS.renderExplosionChoiceGrid = function () {
    var grid = OS.$("explosion-choice-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var details = OS.explosionChoiceState.details || [];

    details.forEach(function (detail, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "explosion-choice-pill";
      btn.setAttribute("data-index", String(index));
      var label = detail.exploded
        ? detail.die + " (explodiu)"
        : detail.die + " = " + detail.total;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        OS.selectExplosionChoice(index);
      });
      grid.appendChild(btn);
    });
  };

  OS.selectExplosionChoice = function (index) {
    OS.explosionChoiceState.selectedIndex = index;
    OS.updateExplosionChoiceUi();
  };

  OS.updateExplosionChoiceUi = function () {
    var selected = OS.explosionChoiceState.selectedIndex;
    var grid = OS.$("explosion-choice-grid");
    var confirmBtn = OS.$("explosion-confirm");
    var hint = OS.$("explosion-modal-hint");

    if (grid) {
      grid.querySelectorAll(".explosion-choice-pill").forEach(function (pill) {
        var idx = parseInt(pill.getAttribute("data-index"), 10);
        pill.classList.toggle("selected", idx === selected);
      });
    }

    var ready = selected !== null && selected !== undefined;
    if (confirmBtn) confirmBtn.disabled = !ready;
    if (hint) {
      hint.textContent = ready
        ? "Confirme o resultado base escolhido."
        : "Um dado explodiu. Escolha o resultado base do teste.";
    }
  };

  OS.confirmExplosionChoice = function () {
    var idx = OS.explosionChoiceState.selectedIndex;
    var details = OS.explosionChoiceState.details || [];
    if (idx === null || idx === undefined || !details[idx]) return;
    OS.finishSkillRoll(details[idx].total, details[idx]);
  };

  OS.openFinalRollResultModal = function (baseResult, chamberValues, bonus, total, buffItems) {
    var modal = OS.$("roll-modal");
    if (!modal) return;

    var titleEl = OS.$("roll-modal-title");
    var subEl = OS.$("roll-modal-sub");
    var detailsEl = OS.$("roll-modal-details");
    var totalEl = OS.$("roll-modal-total");
    var totalLabel = modal.querySelector(".roll-total-label");
    var st = OS.chamberSelectionState || {};
    var details = OS.rollModalState.rollDetails || [];
    var dice = st.dice || OS.rollModalState.dice || [];
    var results = OS.rollModalState.finalResults || [];

    if (titleEl) {
      titleEl.textContent = st.skillName || OS.rollModalState.title || "Rolagem";
    }
    if (subEl) subEl.textContent = "Resultado final do teste.";
    if (totalLabel) totalLabel.textContent = "Resultado final";
    if (totalEl) totalEl.textContent = String(total || 0);

    if (detailsEl) {
      detailsEl.innerHTML = "";

      function addLine(text, extraClass) {
        var line = document.createElement("div");
        line.className = "roll-line" + (extraClass ? " " + extraClass : "");
        line.textContent = text;
        detailsEl.appendChild(line);
      }

      if (details.length) {
        for (var i = 0; i < details.length; i++) {
          var d = details[i];
          if (d.exploded && d.parts && d.parts.length > 1) {
            addLine(d.die + " -> " + d.parts.join(" + ") + " = " + d.total + " 💥");
          } else {
            addLine(d.die + " -> " + (d.total != null ? d.total : results[i]));
          }
        }
      } else {
        for (var j = 0; j < dice.length; j++) {
          addLine(dice[j] + " -> " + results[j]);
        }
      }

      addLine("Resultado escolhido: " + (baseResult || 0), "roll-line-best");

      var chambers = chamberValues || [];
      if (chambers.length) {
        addLine("Câmaras:");
        for (var c = 0; c < chambers.length; c++) {
          addLine("+" + chambers[c]);
        }
      } else {
        addLine("Câmaras: nenhuma");
      }

      if (Array.isArray(buffItems) && buffItems.length > 0) {
        addLine("Buffs ativos:");
        for (var bIdx = 0; bIdx < buffItems.length; bIdx++) {
          addLine("✦ " + buffItems[bIdx].detail);
        }
      }

      addLine("Resultado final: " + (total || 0), "roll-line-best");
    }

    if (OS.syncTestCalcModalPlacement) {
      OS.syncTestCalcModalPlacement("roll-modal-test-calc-slot", !st.isWeaponRoll);
    }

    modal.classList.add("open");
  };

  OS.revealRollModalValues = function () {
    var details = OS.$("roll-modal-details");
    if (details) {
      var values = details.querySelectorAll(".roll-value");
      values.forEach(function (v) {
        v.classList.remove("reveal");
        void v.offsetWidth;
        v.classList.add("reveal");
      });
    }
    var totalEl = OS.$("roll-modal-total");
    if (totalEl) {
      totalEl.classList.remove("reveal");
      void totalEl.offsetWidth;
      totalEl.classList.add("reveal");
    }
  };

  /* ---- Defesa (6 bullets do tambor) ---- */

  OS.openDefenseModal = function () {
    var modal = OS.$("defense-modal");
    if (!modal) return;
    modal.classList.add("open");
    OS.renderDefenseRollResults();
    OS.updateDefenseModalUi();

    var confirmBtn = OS.$("defense-confirm");
    if (confirmBtn) confirmBtn.focus();
  };

  OS.closeDefenseModal = function () {
    var modal = OS.$("defense-modal");
    if (!modal) return;
    modal.classList.remove("open");
    
    // Ao encerrar combate, limitar REM ao REM Máximo
    var remAtualEl = OS.$("rem-atual");
    var nivelEl = OS.$("nivel");
    if (remAtualEl && nivelEl) {
      var nivel = parseInt(String(nivelEl.value || 0), 10);
      if (isNaN(nivel)) nivel = 0;
      var remMax = OS.getEffectiveRemMax ? OS.getEffectiveRemMax(nivel) : calculateRemMax(nivel);
      
      var remAtual = parseInt(String(remAtualEl.value || 0), 10);
      if (isNaN(remAtual)) remAtual = 0;
      
      if (remAtual > remMax) {
        remAtualEl.value = String(remMax);
      }
    }
  };

  OS.renderDefenseRollResults = function () {
    var grid = OS.$("defense-roll-grid");
    if (!grid) return;
    grid.innerHTML = "";

    var summaryBar = OS.$("defense-roll-summary");
    if (!summaryBar) {
      summaryBar = document.createElement("div");
      summaryBar.id = "defense-roll-summary";
      summaryBar.className = "defense-roll-summary";
      grid.parentNode.insertBefore(summaryBar, grid);
    }

    var originalRoll = OS.defenseRollState.originalRoll || [];
    var roll = OS.defenseRollState.roll || [];

    var hasFatigue = false;
    for (var i = 0; i < 6; i++) {
      if (originalRoll[i] !== undefined && roll[i] !== undefined && originalRoll[i] !== roll[i]) {
        hasFatigue = true;
        break;
      }
    }

    if (hasFatigue) {
      summaryBar.style.display = "flex";
      var items = [];
      for (var i = 0; i < 6; i++) {
        var orig = originalRoll[i] !== undefined ? originalRoll[i] : (roll[i] || 0);
        var eff = roll[i] || 0;
        var diff = orig - eff;
        if (diff > 0) {
          items.push('<span class="summary-item fatigue">' + orig + ' &rarr; ' + eff + ' (-' + diff + ')</span>');
        } else {
          items.push('<span class="summary-item">' + orig + '</span>');
        }
      }
      summaryBar.innerHTML = items.join(" ");
    } else {
      summaryBar.style.display = "none";
      summaryBar.innerHTML = "";
    }

    for (var i = 0; i < 6; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "roll-pill";
      btn.setAttribute("data-index", String(i));
      btn.setAttribute("aria-label", "Resultado " + (i + 1) + ": " + roll[i]);
      btn.textContent = String(roll[i] || "");
      btn.addEventListener("click", function (e) {
        var idx = parseInt(e.currentTarget.getAttribute("data-index"), 10);
        OS.selectDefenseNumber(idx);
      });
      grid.appendChild(btn);
    }
  };

  OS.selectDefenseNumber = function (index) {
    var selected = OS.defenseRollState.selected || [];
    var pos = selected.indexOf(index);
    if (pos >= 0) {
      selected.splice(pos, 1);
      OS.defenseRollState.selected = selected;
      OS.updateDefenseModalUi();
      return;
    }

    if (selected.length >= 3) {
      OS.updateDefenseModalUi("Você já selecionou 3. Desmarque um para trocar.");
      return;
    }

    selected.push(index);
    OS.defenseRollState.selected = selected;
    OS.updateDefenseModalUi();
  };

  OS.updateDefenseModalUi = function (message) {
    var selected = OS.defenseRollState.selected || [];
    var grid = OS.$("defense-roll-grid");
    var confirmBtn = OS.$("defense-confirm");
    var hint = OS.$("defense-modal-hint");

    if (grid) {
      var pills = grid.querySelectorAll(".roll-pill");
      pills.forEach(function (pill) {
        var idx = parseInt(pill.getAttribute("data-index"), 10);
        var isSel = selected.indexOf(idx) >= 0;
        pill.classList.toggle("selected", isSel);
        pill.classList.toggle("disabled", !isSel && selected.length >= 3);
      });
    }

    var canConfirm = selected.length === 3;
    if (confirmBtn) confirmBtn.disabled = !canConfirm;

    if (hint) {
      if (message) {
        hint.textContent = message;
      } else if (canConfirm) {
        hint.textContent =
          "Perfeito. Confirmar aplica no tambor: selecionados → câmaras 6, 5 e 4.";
      } else {
        hint.textContent = "Selecionados: " + selected.length + "/3.";
      }
    }
  };

  /* ---- Seleção de câmaras (pós-rolagem) ---- */

OS.openChamberSelectionModal = function (baseTotal, dice, results, rowEl, outEl, skillName, subtitle) {
  var modal = OS.$("chamber-modal");
  if (!modal) return;

  OS.closeRollModal();

  var preRoll = (baseTotal === null || baseTotal === undefined);

  OS.chamberSelectionState.preRoll   = preRoll;
  OS.chamberSelectionState.baseTotal = baseTotal || 0;
  OS.chamberSelectionState.dice      = dice || [];
  OS.chamberSelectionState.results   = results || [];
  OS.chamberSelectionState.selectedChambers = [];
  OS.chamberSelectionState.rowEl     = rowEl;
  OS.chamberSelectionState.outEl     = outEl;
  OS.chamberSelectionState.skillName = skillName || "Rolagem";
  OS.chamberSelectionState.subtitle  = subtitle  || "Rolagem";
  OS.chamberSelectionState.isWeaponRoll = false;
  OS.chamberSelectionState.requireMinOneChamber = false;
  OS.chamberSelectionState.weaponInvId = null;
  OS.chamberSelectionState.weaponSlotCategory = null;

  var sub = OS.$("chamber-modal-sub");
  if (sub) {
    sub.textContent = preRoll
      ? "Selecione câmaras para adicionar bônus antes de rolar."
      : "Maior resultado: " + baseTotal + ". Selecione câmaras para somar ao teste (opcional).";
  }

  var summary = OS.$("chamber-roll-summary");
  if (summary) {
    if (preRoll) {
      summary.innerHTML = '<div class="chamber-roll-line">Dados: ' + (dice || []).join(" · ") + "</div>";
    } else {
      var html = "";
      for (var k = 0; k < (dice || []).length; k++) {
        html += '<div class="chamber-roll-line">1' + dice[k] + " = <strong>" + results[k] + "</strong></div>";
      }
      html += '<div class="chamber-roll-best">Maior Resultado: <strong>' + baseTotal + "</strong></div>";
      summary.innerHTML = html;
    }
  }

  if (OS.resetTestCalcResultBadge) {
    OS.resetTestCalcResultBadge();
  }
  if (OS.syncTestCalcModalPlacement) {
    OS.syncTestCalcModalPlacement("chamber-modal-test-calc-slot", true);
  }

  modal.classList.add("open");
  OS.renderChamberGrid();
  OS.updateChamberModalUi();
};

OS.openWeaponChamberSelectionModal = function (invItem, slotCategory, skillLabel, skillDice, danoStr) {
  var modal = OS.$("chamber-modal");
  if (!modal || !invItem) return;

  OS.closeRollModal();

  OS.chamberSelectionState.preRoll = true;
  OS.chamberSelectionState.baseTotal = 0;
  OS.chamberSelectionState.dice = (skillDice || []).slice();
  OS.chamberSelectionState.results = [];
  OS.chamberSelectionState.selectedChambers = [];
  OS.chamberSelectionState.rowEl = null;
  OS.chamberSelectionState.outEl = null;
  OS.chamberSelectionState.skillName = invItem.name + " (" + (skillLabel || "Combate") + ")";
  OS.chamberSelectionState.subtitle = "Ataque com " + invItem.name;
  OS.chamberSelectionState.isWeaponRoll = true;
  OS.chamberSelectionState.requireMinOneChamber = true;
  OS.chamberSelectionState.weaponInvId = invItem.id;
  OS.chamberSelectionState.weaponSlotCategory = slotCategory;
  OS.chamberSelectionState.weaponSkillLabel = skillLabel || "Combate";
  OS.chamberSelectionState.weaponDamageStr = danoStr || "d6";

  var sub = OS.$("chamber-modal-sub");
  if (sub) {
    sub.textContent = "Selecione obrigatoriamente pelo menos 1 valor do 6B para rolar " + invItem.name + ".";
  }

  var summary = OS.$("chamber-roll-summary");
  if (summary) {
    var sDiceTxt = (skillDice && skillDice.length) ? skillDice.join(" · ") : "1d4 - 2 (não treinada)";
    summary.innerHTML =
      '<div class="chamber-roll-line">Perícia (' + (skillLabel || "Combate") + '): <strong>' + sDiceTxt + '</strong> + Dano da Arma: <strong>' + (danoStr || "d6") + '</strong> + Valores do 6B</div>';
  }

  if (OS.syncTestCalcModalPlacement) {
    OS.syncTestCalcModalPlacement("chamber-modal-test-calc-slot", false);
  }

  modal.classList.add("open");
  OS.renderChamberGrid();
  OS.updateChamberModalUi();
};

  OS.openCylinderChoiceModal = function (base, dice, results, rowEl, outEl) {
    OS.openChamberSelectionModal(base, dice, results, rowEl, outEl);
  };

  OS.closeChamberModal = function () {
    var modal = OS.$("chamber-modal");
    if (!modal) return;
    modal.classList.remove("open");
  };

  OS.renderChamberGrid = function () {
    var grid = OS.$("chamber-grid");
    if (!grid) return;
    grid.innerHTML = "";

    for (var i = 0; i < 6; i++) {
      var chamberInput = OS.$("chamber-" + i);
      if (!chamberInput) continue;

      var value = OS.chamberValueAt(i);
      var isUsed = OS.usedChambers.indexOf(i) >= 0;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chamber-pill" + (isUsed ? " disabled" : "");
      btn.setAttribute("data-index", String(i));
      btn.setAttribute(
        "aria-label",
        "Câmara " + (i + 1) + (isUsed ? " (já usada)" : ": " + value)
      );
      btn.disabled = isUsed || value === 0;

      var valueSpan = document.createElement("span");
      valueSpan.className = "chamber-pill-value";
      valueSpan.textContent = value > 0 ? String(value) : "0";
      btn.appendChild(valueSpan);

      var labelSpan = document.createElement("span");
      labelSpan.className = "chamber-pill-label";
      labelSpan.textContent = "C" + (i + 1);
      btn.appendChild(labelSpan);

      if (!isUsed && value > 0) {
        btn.addEventListener("click", function (e) {
          var idx = parseInt(e.currentTarget.getAttribute("data-index"), 10);
          OS.toggleChamberSelection(idx);
        });
      }

      grid.appendChild(btn);
    }
  };

  OS.toggleChamberSelection = function (index) {
    var selected = OS.chamberSelectionState.selectedChambers || [];
    var pos = selected.indexOf(index);

    if (pos >= 0) {
      selected.splice(pos, 1);
    } else {
      selected.push(index);
    }

    OS.chamberSelectionState.selectedChambers = selected;
    OS.updateChamberModalUi();
  };

  OS.updateChamberModalUi = function () {
    var st = OS.chamberSelectionState || {};
    var selected = st.selectedChambers || [];
    var grid = OS.$("chamber-grid");
    var hint = OS.$("chamber-modal-hint");
    var confirmBtn = OS.$("chamber-confirm");

    if (grid) {
      var pills = grid.querySelectorAll(".chamber-pill");
      pills.forEach(function (pill) {
        var idx = parseInt(pill.getAttribute("data-index"), 10);
        var isSel = selected.indexOf(idx) >= 0;
        pill.classList.toggle("selected", isSel);
      });
    }

    var bonus = OS.calculateChamberBonus(selected);
    var total = OS.calculateFinalRoll(st.baseTotal, selected);
    var base = st.baseTotal;
    var requireMin = !!st.requireMinOneChamber;

    if (confirmBtn) {
      confirmBtn.disabled = requireMin && selected.length < 1;
    }

    if (hint) {
      if (st.isWeaponRoll) {
        if (selected.length === 0) {
          hint.textContent =
            "Obrigatório selecionar pelo menos 1 valor do 6B para confirmar a rolagem da arma.";
        } else {
          hint.textContent =
            "6B selecionado: +" +
            bonus +
            " (" +
            selected.length +
            " câmara(s)) + Perícia (" +
            (st.weaponSkillLabel || "Combate") +
            ") + Dano (" +
            (st.weaponDamageStr || "d6") +
            ").";
        }
      } else if (selected.length === 0) {
        hint.textContent =
          "Nenhuma câmara. Resultado final: " + base + " (apenas maior dado).";
      } else {
        hint.textContent =
          "Maior: " + base + " | Câmaras: +" + bonus + " | Final: " + total;
      }
    }
  };

  /* ---- Limpar ficha ---- */

  OS.confirmClear = function () {
    var existing = document.getElementById("modal-clear");
    if (existing) {
      existing.classList.add("open");
      return;
    }

    var overlay = document.createElement("div");
    overlay.id = "modal-clear";
    overlay.className = "modal-overlay open";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "modal-clear-title");

    overlay.innerHTML =
      '<div class="modal-box">' +
      '<p id="modal-clear-title">Limpar toda a ficha? Esta ação não pode ser desfeita.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-danger" id="modal-confirm">Limpar ficha inteira</button>' +
      '<button type="button" class="btn btn-secondary" id="modal-clear-rolls">Limpar apenas rolagens</button>' +
      '<button type="button" class="btn btn-secondary" id="modal-cancel">Cancelar</button>' +
      "</div></div>";

    document.body.appendChild(overlay);

    OS.$("modal-confirm").addEventListener("click", function () {
      OS.clearForm();
      overlay.classList.remove("open");
    });

    OS.$("modal-clear-rolls").addEventListener("click", function () {
      if (OS.clearRollResultsOnly) OS.clearRollResultsOnly();
      overlay.classList.remove("open");
    });

    OS.$("modal-cancel").addEventListener("click", function () {
      overlay.classList.remove("open");
    });

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  };

  /* ---- Seleção inicial de 6 perícias ---- */

  OS._initialSkillsSelected = [];
  OS._initialSkillsOnConfirm = null;
  OS._skillPointsState = {
    generalAvailable: 0,
    combatAvailable: 0,
    skillAllocations: {}
  };

  OS.openInitialSkillsModal = function (onConfirm) {
    OS._initialSkillsSelected = [];
    OS._initialSkillsOnConfirm = onConfirm || null;
    OS.renderInitialSkillsGrid();
    OS.updateInitialSkillsUi();
    
    // Configurar listeners para checkboxes de seleção de valores
    var sel1 = OS.$("select-val-1");
    var sel2 = OS.$("select-val-2");
    var sel3 = OS.$("select-val-3");
    
    if (sel1) {
      sel1.checked = false;
      sel1.disabled = false;
      sel1.parentElement.style.opacity = "1";
      sel1.parentElement.querySelector("span")?.remove();
    }
    if (sel2) {
      sel2.checked = false;
      sel2.disabled = false;
      sel2.parentElement.style.opacity = "1";
      sel2.parentElement.querySelector("span")?.remove();
    }
    if (sel3) {
      sel3.checked = false;
      sel3.disabled = false;
      sel3.parentElement.style.opacity = "1";
      sel3.parentElement.querySelector("span")?.remove();
    }
    
    var updateValueSelection = function () {
      var checkboxes = [sel1, sel2, sel3];
      var checkedCount = 0;
      
      checkboxes.forEach(function (cb) {
        if (cb && cb.checked) checkedCount++;
      });
      
      if (checkedCount === 2) {
        checkboxes.forEach(function (cb) {
          if (cb && !cb.checked) {
            cb.disabled = true;
            cb.parentElement.style.opacity = "0.4";
            if (!cb.parentElement.querySelector("span")) {
              var span = document.createElement("span");
              span.textContent = " (Reservado para Combate)";
              span.style.fontSize = "11px";
              span.style.color = "var(--accent-glow)";
              cb.parentElement.appendChild(span);
            }
          }
        });
      } else {
        checkboxes.forEach(function (cb) {
          if (cb) {
            cb.disabled = false;
            cb.parentElement.style.opacity = "1";
            cb.parentElement.querySelector("span")?.remove();
          }
        });
      }
    };
    
    if (sel1) sel1.addEventListener("change", updateValueSelection);
    if (sel2) sel2.addEventListener("change", updateValueSelection);
    if (sel3) sel3.addEventListener("change", updateValueSelection);
    
    var modal = OS.$("initial-skills-modal");
    if (modal) modal.classList.add("open");
  };

  OS.closeInitialSkillsModal = function () {
    var modal = OS.$("initial-skills-modal");
    if (modal) modal.classList.remove("open");
  };

  OS.renderInitialSkillsGrid = function () {
    var grid = OS.$("initial-skills-grid");
    if (!grid) return;
    grid.innerHTML = "";

    function addGroup(title, skills, type) {
      var heading = document.createElement("div");
      heading.className = "initial-skills-group-title";
      heading.textContent = title;
      grid.appendChild(heading);

      skills.forEach(function (skill) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "initial-skill-pill";
        btn.setAttribute("data-id", skill.id);
        btn.setAttribute("data-type", type);
        btn.setAttribute("data-name", skill.name);
        btn.textContent = skill.name;
        btn.addEventListener("click", function () {
          OS.toggleInitialSkill(skill.id, skill.name, type);
        });
        grid.appendChild(btn);
      });
    }

    addGroup("Perícias", OS.SKILLS, "pericia");
    addGroup("Combate", OS.COMBAT_SKILLS, "combat");
  };

  OS.toggleInitialSkill = function (id, name, type) {
    var selected = OS._initialSkillsSelected;
    var idx = -1;
    for (var i = 0; i < selected.length; i++) {
      if (selected[i].id === id && selected[i].type === type) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      if (selected.length >= 6) {
        OS.updateInitialSkillsUi("Máximo de 6 perícias.");
        return;
      }
      selected.push({ id: id, name: name, type: type });
    }
    OS.updateInitialSkillsUi();
  };

  OS.updateInitialSkillsUi = function (message) {
    var selected = OS._initialSkillsSelected || [];
    var grid = OS.$("initial-skills-grid");
    var hint = OS.$("initial-skills-hint");
    var confirmBtn = OS.$("initial-skills-confirm");

    if (grid) {
      grid.querySelectorAll(".initial-skill-pill").forEach(function (pill) {
        var id = pill.getAttribute("data-id");
        var type = pill.getAttribute("data-type");
        var isSel = selected.some(function (s) {
          return s.id === id && s.type === type;
        });
        pill.classList.toggle("selected", isSel);
        pill.classList.toggle("disabled", !isSel && selected.length >= 6);
      });
    }

    var ready = selected.length === 6;
    if (confirmBtn) confirmBtn.disabled = !ready;
    if (hint) {
      hint.textContent = message || "Selecionadas: " + selected.length + "/6";
    }
  };

  OS.applyInitialSkillSelection = function (selected) {
    var list = selected || [];
    OS.initialSkills = list.map(function (s) {
      return { name: s.name, dice: "d4", id: s.id, type: s.type };
    });
    list.forEach(function (s) {
      var prefix = s.type === "combat" ? "combate-" : "pericia-";
      var cb = OS.$(prefix + s.id + "-d4");
      if (cb) cb.checked = true;
    });
  };

  OS.confirmInitialSkills = function () {
    if ((OS._initialSkillsSelected || []).length !== 6) {
      OS.updateInitialSkillsUi("Selecione exatamente 6 perícias.");
      return;
    }
    
    // Validar valores do mestre
    var val1 = parseInt(String(OS.$("master-value-1").value || 0), 10);
    var val2 = parseInt(String(OS.$("master-value-2").value || 0), 10);
    var val3 = parseInt(String(OS.$("master-value-3").value || 0), 10);
    
    if (isNaN(val1) || isNaN(val2) || isNaN(val3) || val1 < 1 || val2 < 1 || val3 < 1) {
      OS.updateInitialSkillsUi("Informe os 3 valores do mestre (mínimo 1).");
      return;
    }
    
    // Validar seleção de 2 valores para perícias gerais
    var sel1 = OS.$("select-val-1");
    var sel2 = OS.$("select-val-2");
    var sel3 = OS.$("select-val-3");
    
    var selectedCount = 0;
    var generalSum = 0;
    var combatValue = 0;
    
    if (sel1 && sel1.checked) { selectedCount++; generalSum += val1; }
    if (sel2 && sel2.checked) { selectedCount++; generalSum += val2; }
    if (sel3 && sel3.checked) { selectedCount++; generalSum += val3; }
    
    if (selectedCount !== 2) {
      OS.updateInitialSkillsUi("Selecione exatamente 2 valores para perícias gerais.");
      return;
    }
    
    if (generalSum < 7) {
      OS.updateInitialSkillsUi("A soma dos valores para perícias gerais deve ser pelo menos 7.");
      return;
    }
    
    // Calcular valor para combate (o não selecionado)
    if (sel1 && !sel1.checked) combatValue = val1;
    else if (sel2 && !sel2.checked) combatValue = val2;
    else if (sel3 && !sel3.checked) combatValue = val3;
    
    OS.closeInitialSkillsModal();
    OS.openSkillPointsModal(generalSum, combatValue);
  };

  OS.openSkillPointsModal = function (generalSum, combatValue) {
    OS._skillPointsState.mode = "initial";
    OS._skillPointsState.generalAvailable = generalSum;
    OS._skillPointsState.combatAvailable = combatValue;
    OS._skillPointsState.totalAvailable = 0;
    OS._skillPointsState.targetLevel = 1;
    OS._skillPointsState.skillAllocations = {};
    
    // Inicializar alocações com 0 para TODAS as perícias
    OS.SKILLS.forEach(function (skill) {
      OS._skillPointsState.skillAllocations[skill.id + "_pericia"] = 0;
    });
    OS.COMBAT_SKILLS.forEach(function (skill) {
      OS._skillPointsState.skillAllocations[skill.id + "_combat"] = 0;
    });

    var titleEl = OS.$("skill-points-title");
    if (titleEl) titleEl.textContent = "Distribuir Pontos de Perícia";
    var subEl = OS.$("skill-points-sub");
    if (subEl) subEl.textContent = "Distribua os pontos entre suas perícias selecionadas.";
    var genLabel = OS.$("points-general-label");
    if (genLabel) genLabel.textContent = "Pontos Gerais:";
    var combatBox = OS.$("points-combat-box");
    if (combatBox) combatBox.style.display = "";
    var backBtn = OS.$("skill-points-back");
    if (backBtn) backBtn.textContent = "Voltar";
    
    OS.renderSkillPointsGrid();
    OS.updateSkillPointsUi();
    
    var modal = OS.$("skill-points-modal");
    if (modal) modal.classList.add("open");
  };

  OS.openLevelUpSkillPointsModal = function (rolledPoints, targetLevel) {
    OS._skillPointsState.mode = "levelup";
    OS._skillPointsState.totalAvailable = rolledPoints;
    OS._skillPointsState.generalAvailable = rolledPoints;
    OS._skillPointsState.combatAvailable = 0;
    OS._skillPointsState.targetLevel = targetLevel || (OS.getCurrentLevel ? OS.getCurrentLevel() + 1 : 2);
    OS._skillPointsState.skillAllocations = {};

    OS.SKILLS.forEach(function (skill) {
      OS._skillPointsState.skillAllocations[skill.id + "_pericia"] = 0;
    });
    OS.COMBAT_SKILLS.forEach(function (skill) {
      OS._skillPointsState.skillAllocations[skill.id + "_combat"] = 0;
    });

    var titleEl = OS.$("skill-points-title");
    if (titleEl) titleEl.textContent = "Distribuir Pontos de Perícia — Nível " + OS._skillPointsState.targetLevel;
    var subEl = OS.$("skill-points-sub");
    if (subEl) subEl.textContent = "Distribua os " + rolledPoints + " ponto(s) obtido(s) na rolagem em perícias à sua escolha.";
    var genLabel = OS.$("points-general-label");
    if (genLabel) genLabel.textContent = "Pontos Disponíveis:";
    var combatBox = OS.$("points-combat-box");
    if (combatBox) combatBox.style.display = "none";
    var backBtn = OS.$("skill-points-back");
    if (backBtn) backBtn.textContent = "Cancelar";

    OS.renderSkillPointsGrid();
    OS.updateSkillPointsUi();

    var modal = OS.$("skill-points-modal");
    if (modal) modal.classList.add("open");
  };

  OS.closeSkillPointsModal = function () {
    var modal = OS.$("skill-points-modal");
    if (modal) modal.classList.remove("open");
  };

  OS.renderSkillPointsGrid = function () {
    var grid = OS.$("skill-points-grid");
    if (!grid) return;
    grid.innerHTML = "";

    function addGroup(title, skills, type) {
      var heading = document.createElement("div");
      heading.className = "initial-skills-group-title";
      heading.textContent = title;
      grid.appendChild(heading);

      skills.forEach(function (skill) {
        var row = document.createElement("div");
        row.className = "skill-points-row";
        
        var nameSpan = document.createElement("span");
        nameSpan.className = "skill-points-name";
        nameSpan.textContent = skill.name;
        row.appendChild(nameSpan);
        
        var controls = document.createElement("div");
        controls.className = "skill-points-controls";
        
        var minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "btn btn-secondary btn-small";
        minusBtn.textContent = "-";
        minusBtn.addEventListener("click", function () {
          OS.adjustSkillPoints(skill.id, type, -1);
        });
        controls.appendChild(minusBtn);
        
        var valueSpan = document.createElement("span");
        valueSpan.className = "skill-points-value";
        valueSpan.id = "skill-points-" + skill.id + "-" + type;
        valueSpan.textContent = "0";
        controls.appendChild(valueSpan);
        
        var plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "btn btn-secondary btn-small";
        plusBtn.textContent = "+";
        plusBtn.addEventListener("click", function () {
          OS.adjustSkillPoints(skill.id, type, 1);
        });
        controls.appendChild(plusBtn);
        
        row.appendChild(controls);
        grid.appendChild(row);
      });
    }

    addGroup("Perícias Gerais", OS.SKILLS, "pericia");
    addGroup("Perícias de Combate", OS.COMBAT_SKILLS, "combat");
  };

  OS.adjustSkillPoints = function (skillId, type, delta) {
    var key = skillId + "_" + type;
    var current = OS._skillPointsState.skillAllocations[key] || 0;
    var newValue = current + delta;
    
    if (newValue < 0) return;
    
    if (OS._skillPointsState.mode === "levelup") {
      var totalUsedAll = OS.getGeneralPointsUsed() + OS.getCombatPointsUsed();
      if (totalUsedAll + delta > OS._skillPointsState.totalAvailable) return;
    } else {
      var available = type === "combat" ? OS._skillPointsState.combatAvailable : OS._skillPointsState.generalAvailable;
      var totalUsed = type === "combat" ? OS.getCombatPointsUsed() : OS.getGeneralPointsUsed();
      if (totalUsed + delta > available) return;
    }
    
    OS._skillPointsState.skillAllocations[key] = newValue;
    
    var valueEl = OS.$("skill-points-" + skillId + "-" + type);
    if (valueEl) valueEl.textContent = String(newValue);
    
    OS.updateSkillPointsUi();
  };

  OS.getGeneralPointsUsed = function () {
    var total = 0;
    OS.SKILLS.forEach(function (skill) {
      total += OS._skillPointsState.skillAllocations[skill.id + "_pericia"] || 0;
    });
    return total;
  };

  OS.getCombatPointsUsed = function () {
    var total = 0;
    OS.COMBAT_SKILLS.forEach(function (skill) {
      total += OS._skillPointsState.skillAllocations[skill.id + "_combat"] || 0;
    });
    return total;
  };

  OS.updateSkillPointsUi = function () {
    var generalUsed = OS.getGeneralPointsUsed();
    var combatUsed = OS.getCombatPointsUsed();
    
    var generalAvailableEl = OS.$("points-general-available");
    var combatAvailableEl = OS.$("points-combat-available");
    var hint = OS.$("skill-points-hint");
    var confirmBtn = OS.$("skill-points-confirm");

    if (OS._skillPointsState.mode === "levelup") {
      var usedAll = generalUsed + combatUsed;
      var availAll = OS._skillPointsState.totalAvailable || 0;
      if (generalAvailableEl) {
        generalAvailableEl.textContent = (availAll - usedAll) + " / " + availAll;
      }
      var allDone = usedAll === availAll;
      if (confirmBtn) confirmBtn.disabled = !allDone;
      if (hint) {
        hint.textContent = allDone ? "Todos os pontos distribuídos." : "Distribua todos os pontos para continuar.";
      }
      return;
    }
    
    if (generalAvailableEl) {
      generalAvailableEl.textContent = (OS._skillPointsState.generalAvailable - generalUsed) + " / " + OS._skillPointsState.generalAvailable;
    }
    
    if (combatAvailableEl) {
      combatAvailableEl.textContent = (OS._skillPointsState.combatAvailable - combatUsed) + " / " + OS._skillPointsState.combatAvailable;
    }
    
    var allPointsUsed = generalUsed === OS._skillPointsState.generalAvailable && combatUsed === OS._skillPointsState.combatAvailable;
    
    if (confirmBtn) confirmBtn.disabled = !allPointsUsed;
    
    if (hint) {
      if (allPointsUsed) {
        hint.textContent = "Todos os pontos distribuídos.";
      } else {
        hint.textContent = "Distribua todos os pontos para continuar.";
      }
    }
  };

  OS.confirmSkillPoints = function () {
    var generalUsed = OS.getGeneralPointsUsed();
    var combatUsed = OS.getCombatPointsUsed();

    if (OS._skillPointsState.mode === "levelup") {
      if (generalUsed + combatUsed !== OS._skillPointsState.totalAvailable) {
        OS.updateSkillPointsUi();
        return;
      }

      function applyLevelUpGroup(skills, type, prefix) {
        skills.forEach(function (skill) {
          var points = OS._skillPointsState.skillAllocations[skill.id + "_" + type] || 0;
          if (points <= 0) return;

          var currentDice = [];
          ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
            var cb = OS.$(prefix + skill.id + "-" + die);
            if (cb && cb.checked) currentDice.push(die);
          });
          var baseLevel = diceToLevel(currentDice);
          var effectiveLevel = baseLevel + points;

          ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
            var cb = OS.$(prefix + skill.id + "-" + die);
            if (cb) cb.checked = false;
          });

          var newDice = levelToDice(effectiveLevel);
          newDice.forEach(function (die) {
            var cb = OS.$(prefix + skill.id + "-" + die);
            if (cb) cb.checked = true;
          });
        });
      }

      applyLevelUpGroup(OS.SKILLS, "pericia", "pericia-");
      applyLevelUpGroup(OS.COMBAT_SKILLS, "combat", "combate-");

      var nivelEl = OS.$("nivel");
      if (nivelEl && OS._skillPointsState.targetLevel) {
        nivelEl.value = String(OS._skillPointsState.targetLevel);
      }

      if (OS.sync6BAndRemUI) OS.sync6BAndRemUI();
      if (OS.updateStatsFields) OS.updateStatsFields(false);

      OS.closeSkillPointsModal();
      OS.scheduleSave();
      return;
    }
    
    if (generalUsed !== OS._skillPointsState.generalAvailable || combatUsed !== OS._skillPointsState.combatAvailable) {
      OS.updateSkillPointsUi();
      return;
    }
    
    // Limpar todos os checkboxes de perícia primeiro
    OS.SKILLS.forEach(function (skill) {
      ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
        var cb = OS.$("pericia-" + skill.id + "-" + die);
        if (cb) cb.checked = false;
      });
    });
    OS.COMBAT_SKILLS.forEach(function (skill) {
      ["d4", "d6", "d8", "d10", "d12"].forEach(function (die) {
        var cb = OS.$("combate-" + skill.id + "-" + die);
        if (cb) cb.checked = false;
      });
    });
    
    // Aplicar pontos usando levelToDice para cada perícia
    OS.SKILLS.forEach(function (skill) {
      var points = OS._skillPointsState.skillAllocations[skill.id + "_pericia"] || 0;
      var wasInitiallySelected = OS._initialSkillsSelected.some(function(s) {
        return s.id === skill.id && s.type === "pericia";
      });
      
      var effectiveLevel = points;
      if (wasInitiallySelected) {
        effectiveLevel += 1; // Base d4 = nível 1
      }
      
      if (effectiveLevel > 0) {
        var dice = levelToDice(effectiveLevel);
        // Contar quantos dados de cada tipo
        var dieCounts = {};
        dice.forEach(function(die) {
          dieCounts[die] = (dieCounts[die] || 0) + 1;
        });
        
        // Marcar checkboxes (para dados duplicados, marcar o mesmo checkbox)
        Object.keys(dieCounts).forEach(function(die) {
          var cb = OS.$("pericia-" + skill.id + "-" + die);
          if (cb) cb.checked = true;
        });
      }
    });
    
    OS.COMBAT_SKILLS.forEach(function (skill) {
      var points = OS._skillPointsState.skillAllocations[skill.id + "_combat"] || 0;
      var wasInitiallySelected = OS._initialSkillsSelected.some(function(s) {
        return s.id === skill.id && s.type === "combat";
      });
      
      var effectiveLevel = points;
      if (wasInitiallySelected) {
        effectiveLevel += 1; // Base d4 = nível 1
      }
      
      if (effectiveLevel > 0) {
        var dice = levelToDice(effectiveLevel);
        // Contar quantos dados de cada tipo
        var dieCounts = {};
        dice.forEach(function(die) {
          dieCounts[die] = (dieCounts[die] || 0) + 1;
        });
        
        // Marcar checkboxes (para dados duplicados, marcar o mesmo checkbox)
        Object.keys(dieCounts).forEach(function(die) {
          var cb = OS.$("combate-" + skill.id + "-" + die);
          if (cb) cb.checked = true;
        });
      }
    });
    
    if (OS.sync6BAndRemUI) OS.sync6BAndRemUI({ resetSpent: true });
    if (OS.updateStatsFields) OS.updateStatsFields(false);

    // Calcular dinheiro inicial pelo nível ($10 no Nível 1, +$5 por nível acima do 1º)
    var initLv = OS.getCurrentLevel ? OS.getCurrentLevel() : 1;
    var initMoney = OS.calculateInitialMoney ? OS.calculateInitialMoney(initLv) : (10 + Math.max(0, initLv - 1) * 5);
    if (OS.setCharacterMoney) OS.setCharacterMoney(initMoney);
    OS.isNewCharacterSession = true;
    OS.firstPurchaseDiscountUsed = false;

    OS.closeSkillPointsModal();

    if (typeof OS._initialSkillsOnConfirm === "function") {
      OS._initialSkillsOnConfirm(OS._initialSkillsSelected.slice());
    }

    // Abrir popup de catálogo para compras iniciais durante a criação (1º item com 50% de desconto)
    if (OS.openCatalogModal) {
      OS._onCreationCatalogClose = function () {
        OS.saveToStorage();
      };
      OS.openCatalogModal("creation");
    }
  };

  OS.backToInitialSkills = function () {
    OS.closeSkillPointsModal();
    if (OS._skillPointsState && OS._skillPointsState.mode === "levelup") {
      return;
    }
    OS.openInitialSkillsModal(OS._initialSkillsOnConfirm);
  };

  /* ---- Eventos (uma vez) ---- */

  OS.bindModalEvents = function () {
    if (modalEventsBound) return;
    modalEventsBound = true;

    var initialConfirm = OS.$("initial-skills-confirm");
    if (initialConfirm) {
      initialConfirm.addEventListener("click", OS.confirmInitialSkills);
    }

    var skillPointsBack = OS.$("skill-points-back");
    if (skillPointsBack) {
      skillPointsBack.addEventListener("click", OS.backToInitialSkills);
    }

    var skillPointsConfirm = OS.$("skill-points-confirm");
    if (skillPointsConfirm) {
      skillPointsConfirm.addEventListener("click", OS.confirmSkillPoints);
    }

    var explosionConfirm = OS.$("explosion-confirm");
    if (explosionConfirm) {
      explosionConfirm.addEventListener("click", OS.confirmExplosionChoice);
    }

    var rollClose = OS.$("roll-close");
    if (rollClose) {
      rollClose.addEventListener("click", OS.closeRollModal);
    }

    var rollModal = OS.$("roll-modal");
    if (rollModal) {
      rollModal.addEventListener("click", function (e) {
        if (e.target === rollModal) OS.closeRollModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      var m = OS.$("roll-modal");
      if (!m || !m.classList.contains("open")) return;
      if (e.key === "Escape") OS.closeRollModal();
    });

    var defenseCancel = OS.$("defense-cancel");
    if (defenseCancel) {
      defenseCancel.addEventListener("click", OS.closeDefenseModal);
    }

    var defenseConfirm = OS.$("defense-confirm");
    if (defenseConfirm) {
      defenseConfirm.addEventListener("click", function () {
        if ((OS.defenseRollState.selected || []).length !== 3) {
          OS.updateDefenseModalUi("Selecione exatamente 3 resultados para confirmar.");
          return;
        }
        OS.applyCylinderResults();
        OS.closeDefenseModal();
        OS.updateReloadButtonState();
        OS.scheduleSave();
      });
    }

    var defenseModal = OS.$("defense-modal");
    if (defenseModal) {
      defenseModal.addEventListener("click", function (e) {
        if (e.target === defenseModal) OS.closeDefenseModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      var dm = OS.$("defense-modal");
      if (!dm || !dm.classList.contains("open")) return;
      if (e.key === "Escape") OS.closeDefenseModal();
    });

    var chamberCancel = OS.$("chamber-cancel");
    if (chamberCancel) {
      chamberCancel.addEventListener("click", OS.closeChamberModal);
    }

    var chamberConfirm = OS.$("chamber-confirm");
    if (chamberConfirm) {
      chamberConfirm.addEventListener("click", OS.applyCylinderBonuses);
    }

    var chamberModal = OS.$("chamber-modal");
    if (chamberModal) {
      chamberModal.addEventListener("click", function (e) {
        if (e.target === chamberModal) OS.closeChamberModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      var cm = OS.$("chamber-modal");
      if (!cm || !cm.classList.contains("open")) return;
      if (e.key === "Escape") OS.closeChamberModal();
    });
  };