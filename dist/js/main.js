/**
 * Oeste Sombrio 2.0 — ponto de entrada (ES Modules)
 */
import { OS } from "./app.js";
import { getMisticismoLevel, calculateRemMax } from "./rules/index.js";

import "./config.js";
import "./state.js";
import "./ui.js";
import "./dice.js";
import "./modal.js";
import "./cylinder.js";
import "./skills.js";
import "./combat.js";
import "./storage.js";
import "./equipment.js";
import "./equipCatalog.js";
import "./gameData.js";
import "./catalogModal.js";
import "./inventoryUI.js";
import "./magiasUI.js";
import "./characterManager.js";
import "./homeScreen.js";
import "./authUI.js";
import "./mesaScreen.js";
import "./mesaMaps.js";
import "./turnTracker.js";
import "./mesaTokenStatus.js";
import "./mesaDeliveries.js";
import "./mesaNotes.js";
import "./updater.js";

OS.bindEvents = function () {
  var ficha = OS.$("ficha");
  if (!ficha) return;

  OS.bindModalEvents();
  OS.bindCylinderEvents();
  OS.bindEquipamentos();
  OS.bindFichaTabs();
  OS.bindHomeEvents();
  if (OS.bindAuthEvents) OS.bindAuthEvents();
  if (OS.bindCatalogModal) OS.bindCatalogModal();
  if (OS.bindInventoryUI) OS.bindInventoryUI();
  if (OS.bindMagiasUI) OS.bindMagiasUI();
  if (OS.bindFateTokensEvents) OS.bindFateTokensEvents();
  if (OS.bindMesaScreenEvents) OS.bindMesaScreenEvents();
  if (OS.bindTurnTrackerEvents) OS.bindTurnTrackerEvents();
  if (OS.bindPortraitUploadEvents) OS.bindPortraitUploadEvents();

  ficha.addEventListener("input", OS.scheduleSave);
  ficha.addEventListener("change", OS.scheduleSave);

  var btnSave = OS.$("btn-salvar");
  if (btnSave) {
    btnSave.addEventListener("click", function () {
      if (OS.saveTimer) clearTimeout(OS.saveTimer);
      OS.saveToStorage();
    });
  }

  var btnClearRolls = OS.$("btn-limpar-rolagens");
  if (btnClearRolls) {
    btnClearRolls.addEventListener("click", function () {
      if (OS.clearRollResultsOnly) OS.clearRollResultsOnly();
    });
  }

  var btnClear = OS.$("btn-limpar");
  if (btnClear) {
    btnClear.addEventListener("click", OS.confirmClear);
  }

  // Atualizar REM Total quando nível ou misticismo mudar
  var nivelEl = OS.$("nivel");
  var remTotalEl = OS.$("rem-total");
  
  var updateRemTotal = function () {
    if (OS.freeEdit) return;
    if (nivelEl && remTotalEl) {
      var nivel = parseInt(String(nivelEl.value || 0), 10);
      if (isNaN(nivel)) nivel = 0;
      var remMax = calculateRemMax(nivel);
      remTotalEl.value = String(remMax);
    }
  };
  
  if (nivelEl) {
    nivelEl.addEventListener("input", updateRemTotal);
  }
  
  // Listener para checkboxes de misticismo
  var misticismoCheckboxes = document.querySelectorAll("input[name^='pericia-misticismo-']");
  misticismoCheckboxes.forEach(function (cb) {
    cb.addEventListener("change", updateRemTotal);
  });

  // Listener para checkboxes de atletismo (recalcula capacidade de carga solta e penalidades de sobrecarga)
  var atletismoCheckboxes = document.querySelectorAll("input[name^='pericia-atletismo-']");
  atletismoCheckboxes.forEach(function (cb) {
    cb.addEventListener("change", function () {
      if (OS.updateStatsFields) OS.updateStatsFields(false);
    });
  });
};

OS.init = function () {
  OS.saveStatusEl = OS.$("save-status");
  OS.renderSkills();
  OS.renderCombat();
  OS.bindEvents();
  OS.initCylinder();
  if (OS.initAuthGate) {
    OS.initAuthGate();
  } else {
    OS.showHomeScreen();
    OS.renderCharactersList();
  }
  var equipTa = OS.$("equipamentos");
  if (equipTa) {
    equipTa.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // Pré-carrega catálogo JSON (sem alterar inventário/UI nesta etapa)
  if (OS.loadCustomItems) OS.loadCustomItems().catch(function () {});
  if (OS.loadCustomSpells) OS.loadCustomSpells().catch(function () {});
  if (OS.loadEquipCatalog) {
    OS.loadEquipCatalog().catch(function (err) {
      console.error("[equipCatalog] falha no preload", err);
    });
  }
  if (OS.loadGameData) {
    OS.loadGameData()
      .then(function () {
        if (OS.sync6BAndRemUI) OS.sync6BAndRemUI();
        if (OS.updateStatsFields) OS.updateStatsFields(false);
      })
      .catch(function (err) {
        console.error("[gameData] falha no preload", err);
      });
  }
};

/* API pública (console / extensões) */
const w = window;
w.OesteSombrio = OS;
w.rollCylinderDice = OS.rollCylinderDice;
w.openRollModal = OS.openRollModal;
w.closeRollModal = OS.closeRollModal;
w.reloadCylinder = OS.reloadCylinder;
w.consumeCylinderChambers = OS.consumeCylinderChambers;
w.applyCylinderBonuses = OS.applyCylinderBonuses;
w.rollSelectedDice = OS.rollSelectedDice;
w.generateDiceResult = OS.generateDiceResult;
w.markChambersAsUsed = OS.markChambersAsUsed;
w.resetCylinderState = OS.resetCylinderState;
w.isCylinderEmpty = OS.isCylinderEmpty;
w.saveCylinderState = OS.saveCylinderState;
w.loadCylinderState = OS.loadCylinderState;
w.getHighestRoll = OS.getHighestRoll;
w.openCylinderChoiceModal = OS.openCylinderChoiceModal;
w.calculateFinalRoll = OS.calculateFinalRoll;
w.loadEquipCatalog = OS.loadEquipCatalog;
w.getEquipCatalogEntry = OS.getEquipCatalogEntry;
w.getCreature6BDisplayInfo = OS.getCreature6BDisplayInfo;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    OS.init();
    setTimeout(() => {
      if (typeof OS.checkForUpdates === "function") OS.checkForUpdates({ silent: true });
    }, 3000);
  });
} else {
  OS.init();
  setTimeout(() => {
    if (typeof OS.checkForUpdates === "function") OS.checkForUpdates({ silent: true });
  }, 3000);
}

export { OS };
