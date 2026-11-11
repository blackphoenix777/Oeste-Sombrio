/**
 * Área de equipamentos — linhas alinhadas
 */
import { OS } from "./app.js";

OS.bindEquipamentos = function () {
  function bindLinedArea(ta) {
    if (!ta) return;
    var block = ta.closest(".equipamentos-block");

    function getLineMetrics() {
      var styles = window.getComputedStyle(ta);
      var line = parseFloat(styles.getPropertyValue("--equip-line"));
      if (!line || isNaN(line)) {
        line = parseFloat(styles.lineHeight);
      }
      var padTop = parseFloat(styles.paddingTop) || 0;
      var padBottom = parseFloat(styles.paddingBottom) || 0;
      var minRows = 8;
      if (block) {
        var minRowsAttr = parseInt(
          window.getComputedStyle(block).getPropertyValue("--equip-rows"),
          10
        );
        if (!isNaN(minRowsAttr) && minRowsAttr > 0) {
          minRows = minRowsAttr;
        }
      }
      return { line: line, padTop: padTop, padBottom: padBottom, minRows: minRows };
    }

    function snapHeightToGrid() {
      var m = getLineMetrics();
      if (!m.line) return;

      var minHeight = m.padTop + m.padBottom + m.minRows * m.line;
      var contentLines = Math.ceil(
        Math.max(0, ta.scrollHeight - m.padTop - m.padBottom) / m.line
      );
      var rows = Math.max(m.minRows, contentLines);
      var target = m.padTop + m.padBottom + rows * m.line;
      ta.style.height = Math.max(minHeight, target) + "px";
    }

    ta.addEventListener("input", snapHeightToGrid);
    ta.addEventListener("mouseup", function () {
      window.requestAnimationFrame(snapHeightToGrid);
    });
    snapHeightToGrid();
  }

  bindLinedArea(document.getElementById("equipamentos"));
  bindLinedArea(document.getElementById("inventario"));
};
