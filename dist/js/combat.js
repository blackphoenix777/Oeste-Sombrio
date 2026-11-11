/**
 * Combate — renderização e rolagem de armas
 */
import { OS } from "./app.js";

OS.renderCombat = function () {
    var container = OS.$("combate-skills");
    if (!container) return;
    container.innerHTML = "";
    OS.COMBAT_SKILLS.forEach(function (skill) {
      container.appendChild(OS.buildSkillRow(skill, "combate"));
    });
    if (OS.renderFichaEquippedItems) {
      OS.renderFichaEquippedItems();
    }
  };

  OS.rollCombatDice = function (rowEl) {
    OS.rollRowDice(rowEl, "Arma");
  };