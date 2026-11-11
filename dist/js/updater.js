/**
 * Oeste Sombrio - Auto-updater helper (Tauri v2)
 */
import { OS } from "./app.js";

/**
 * Verifica se há atualizações disponíveis no GitHub Releases.
 * @param {Object} [options]
 * @param {boolean} [options.silent=false] Se true, não exibe alertas caso já esteja atualizado.
 */
OS.checkForUpdates = async function (options = { silent: false }) {
  if (typeof window === "undefined" || !window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
    if (!options.silent) {
      console.log("[Updater] O auto-updater só está disponível no aplicativo Desktop (Tauri).");
    }
    return null;
  }

  try {
    const invoke = window.__TAURI__.core.invoke;
    const metadata = await invoke("plugin:updater|check", {});
    if (!metadata || !metadata.version) {
      if (!options.silent && typeof OS.showToast === "function") {
        OS.showToast("O Dark West já está na versão mais recente.", "info");
      }
      return null;
    }

    const confirmUpdate = window.confirm(
      `Nova versão disponível: v${metadata.version}!\nVersão atual: v${metadata.currentVersion || "instalada"}\n\nDeseja baixar e instalar a atualização agora?`
    );

    if (confirmUpdate) {
      if (typeof OS.showToast === "function") {
        OS.showToast(`Baixando atualização v${metadata.version}...`, "info");
      }
      await invoke("plugin:updater|download_and_install", { rid: metadata.rid });
      alert("Atualização instalada com sucesso! Reinicie o aplicativo para aplicar.");
    }
    return metadata;
  } catch (err) {
    console.warn("[Updater] Verificação de atualização:", err);
    if (!options.silent && typeof OS.showToast === "function") {
      OS.showToast("Falha ao checar atualizações: " + (err.message || err), "error");
    }
    return null;
  }
};
