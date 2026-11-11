/**
 * Perícias — renderização e rolagem
 */
import { OS } from "./app.js";

OS.buildSkillRow = function (skill, prefix) {
    var row = document.createElement("div");
    row.className = prefix === "combate" ? "combate-skill-row" : "skill-row";
    row.setAttribute("data-skill-key", prefix + "-" + skill.id);

    if (prefix === "combate") {
      row.className = "skill-row combate-skill-row";
      var nameEl = document.createElement("div");
      nameEl.className = "skill-name skill-name-wrap";

      var titleEl = document.createElement("span");
      titleEl.className = "skill-title";
      titleEl.textContent = skill.name;
      nameEl.appendChild(titleEl);

      var resultEl = document.createElement("span");
      resultEl.className = "roll-result";
      resultEl.id = "combate-" + skill.id + "-roll-result";
      resultEl.setAttribute("data-roll-key", "combate-" + skill.id);
      resultEl.setAttribute("aria-live", "polite");
      resultEl.hidden = true;
      resultEl.setAttribute("hidden", "");
      resultEl.textContent = "";
      if (typeof MutationObserver !== "undefined") {
        var obs = new MutationObserver(function () {
          var hasTxt = !!(resultEl.textContent && resultEl.textContent.trim());
          if (hasTxt) {
            resultEl.hidden = false;
            resultEl.removeAttribute("hidden");
          } else {
            resultEl.hidden = true;
            resultEl.setAttribute("hidden", "");
          }
        });
        obs.observe(resultEl, { childList: true, characterData: true, subtree: true });
      }
      nameEl.appendChild(resultEl);

      var weaponInput = document.createElement("input");
      weaponInput.type = "hidden";
      weaponInput.className = "weapon-line";
      weaponInput.id = skill.id + "-arma";
      weaponInput.name = skill.id + "-arma";
      weaponInput.setAttribute("autocomplete", "off");

      var left = document.createElement("div");
      left.className = "combat-left";
      left.appendChild(nameEl);
      left.appendChild(weaponInput);
      row.appendChild(left);

      var groupName = "combate-" + skill.id;
      OS.DICE.forEach(function (die) {
        var cell = document.createElement("div");
        cell.className = "die-cell";
        cell.appendChild(OS.createDieCell(groupName, die));
        row.appendChild(cell);
      });

      var equipList = document.createElement("div");
      equipList.className = "inv-item-list ficha-equip-list combat-slot-equip-list";
      equipList.id = "ficha-equip-" + skill.id;
      equipList.setAttribute("data-combat-slot", skill.id);
      row.appendChild(equipList);

      return row;
    }

    var nameWrap = document.createElement("div");
    nameWrap.className =
      "skill-name skill-name-wrap" + (skill.classSkill ? " class-skill" : "");

    var nameSpan = document.createElement("span");
    nameSpan.className = "skill-title";
    nameSpan.textContent = skill.name;
    nameWrap.appendChild(nameSpan);

    var rollBtnSkill = document.createElement("button");
    rollBtnSkill.type = "button";
    rollBtnSkill.className = "roll-btn";
    rollBtnSkill.setAttribute("aria-label", "Rolar dados de " + skill.name);
    rollBtnSkill.addEventListener("click", function () {
      OS.rollSkillDice(row);
    });
    nameWrap.appendChild(rollBtnSkill);

    var resultSkill = document.createElement("span");
    resultSkill.className = "roll-result";
    resultSkill.id = "pericia-" + skill.id + "-roll-result";
    resultSkill.setAttribute("data-roll-key", "pericia-" + skill.id);
    resultSkill.setAttribute("aria-live", "polite");
    resultSkill.textContent = "";
    nameWrap.appendChild(resultSkill);

    row.appendChild(nameWrap);

    var groupName = "pericia-" + skill.id;
    OS.DICE.forEach(function (die) {
      var cell = document.createElement("div");
      cell.className = "die-cell";
      cell.appendChild(OS.createDieCell(groupName, die));
      row.appendChild(cell);
    });

    return row;
  };

  OS.renderSkills = function () {
    var list = OS.$("skills-list");
    if (!list) return;
    list.innerHTML = "";
    OS.SKILLS.forEach(function (skill) {
      list.appendChild(OS.buildSkillRow(skill, "pericia"));
    });
  };

  OS.rollSkillDice = function (rowEl) {
    OS.rollRowDice(rowEl, "Perícia");
  };
