/**
 * Utilitários de DOM e feedback visual
 */
import { OS } from "./app.js";

OS.$ = function (id) {
  return document.getElementById(id);
};

OS.getFormElements = function () {
  return document.querySelectorAll(
    "#ficha input, #ficha textarea, #ficha select"
  );
};

OS.setStatus = function (text, saved) {
  if (!OS.saveStatusEl) return;
  OS.saveStatusEl.textContent = text;
  OS.saveStatusEl.classList.toggle("saved", !!saved);
};

OS.flashField = function (el) {
  if (!el) return;
  el.classList.remove("stat-flash");
  void el.offsetWidth;
  el.classList.add("stat-flash");
};

OS.showFichaTab = function (tabName) {
  var validTabs = ["ficha", "equipamentos", "magias", "historia", "anotacoes"];
  var name = validTabs.indexOf(tabName) >= 0 ? tabName : "ficha";
  var tabs = document.querySelectorAll(".ficha-tab");
  var panels = document.querySelectorAll(".ficha-tab-panel");

  tabs.forEach(function (tab) {
    var active = tab.getAttribute("data-tab") === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach(function (panel) {
    var active = panel.id === "tab-panel-" + name;
    panel.classList.toggle("active", active);
    if (active) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });

  if (name === "equipamentos") {
    var equipTa = OS.$("equipamentos");
    if (equipTa) {
      equipTa.dispatchEvent(new Event("input", { bubbles: true }));
    }
    var invTa = OS.$("inventario");
    if (invTa) {
      invTa.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
};

OS.bindFichaTabs = function () {
  var tabs = document.querySelectorAll(".ficha-tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      OS.showFichaTab(tab.getAttribute("data-tab"));
    });
  });
};
