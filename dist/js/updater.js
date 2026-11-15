/**
 * Oeste Sombrio - Auto-updater helper (Tauri v2)
 */
import { OS } from "./app.js";

/**
 * Verifica se há atualizações disponíveis no GitHub Releases.
 * @param {Object} [options]
 * @param {boolean} [options.silent=false] Se true, não exibe alertas caso já esteja atualizado ou ocorra erro de rede.
 */
OS.checkForUpdates = async function (options = { silent: false }) {
  const silent = !!(options && options.silent);
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;

  if (!tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
    if (!silent) {
      console.log("[Updater] O auto-updater só está disponível no aplicativo Desktop (Tauri).");
      if (typeof OS.showToast === "function") {
        OS.showToast("Auto-updater disponível apenas no aplicativo Desktop.", "info");
      }
    }
    return null;
  }

  let currentVersion = "desconhecida";
  try {
    if (tauri.app && typeof tauri.app.getVersion === "function") {
      currentVersion = await tauri.app.getVersion();
    }
  } catch (verErr) {
    console.warn("[Updater] Não foi possível obter a versão atual via app.getVersion():", verErr);
  }

  console.log(`[Updater] Iniciando verificação de atualizações (versão atual: v${currentVersion}, silent: ${silent})...`);

  let updateObj = null;

  try {
    const updaterPlugin = tauri.updater;
    const invoke = tauri.core.invoke;

    if (updaterPlugin && typeof updaterPlugin.check === "function") {
      updateObj = await updaterPlugin.check();
    } else {
      // Fallback caso o objeto global window.__TAURI__.updater não esteja exposto
      const metadata = await invoke("plugin:updater|check", {});
      if (metadata && metadata.version) {
        updateObj = {
          rid: metadata.rid,
          available: true,
          currentVersion: metadata.currentVersion || currentVersion,
          version: metadata.version,
          date: metadata.date,
          body: metadata.body,
          rawJson: metadata.rawJson,
          async downloadAndInstall(onEvent) {
            if (typeof tauri.core.Channel !== "function") {
              throw new Error("Canal IPC (Channel) do Tauri não disponível para download_and_install.");
            }
            const channel = new tauri.core.Channel();
            if (typeof onEvent === "function") {
              channel.onmessage = onEvent;
            }
            await invoke("plugin:updater|download_and_install", {
              onEvent: channel,
              rid: metadata.rid
            });
          },
          async close() {
            await invoke("plugin:resources|close", { rid: metadata.rid }).catch(() => {});
          }
        };
      }
    }

    if (!updateObj || !updateObj.version) {
      console.log("[Updater] Nenhuma atualização disponível.");
      if (!silent && typeof OS.showToast === "function") {
        OS.showToast(`O Dark West já está na versão mais recente (v${currentVersion}).`, "info");
      }
      return null;
    }

    const detectedCurrent = updateObj.currentVersion || currentVersion;
    const notesBlock = updateObj.body && String(updateObj.body).trim()
      ? `\n\nNovidades:\n${String(updateObj.body).trim()}`
      : "";

    console.log(`[Updater] Nova atualização encontrada: v${updateObj.version} (atual: v${detectedCurrent}).`);

    const confirmUpdate = window.confirm(
      `Nova versão disponível: v${updateObj.version}!\nVersão atual: v${detectedCurrent}${notesBlock}\n\nDeseja baixar e instalar a atualização agora?`
    );

    if (!confirmUpdate) {
      console.log("[Updater] Atualização adiada pelo usuário.");
      if (typeof updateObj.close === "function") {
        await updateObj.close().catch(() => {});
      }
      return null;
    }

    if (typeof OS.showToast === "function") {
      OS.showToast(`Baixando atualização v${updateObj.version}...`, "info");
    }

    let contentLength = 0;
    let downloaded = 0;
    let lastLoggedPct = -1;

    await updateObj.downloadAndInstall((event) => {
      if (!event || !event.event) return;
      switch (event.event) {
        case "Started":
          contentLength = (event.data && event.data.contentLength) || 0;
          downloaded = 0;
          console.log(`[Updater] Download iniciado (tamanho total: ${contentLength ? contentLength + " bytes" : "desconhecido"}).`);
          break;
        case "Progress":
          downloaded += (event.data && event.data.chunkLength) || 0;
          if (contentLength > 0) {
            const pct = Math.min(100, Math.floor((downloaded / contentLength) * 100));
            if (pct >= lastLoggedPct + 20 || pct === 100) {
              lastLoggedPct = pct;
              console.log(`[Updater] Progresso do download: ${pct}% (${downloaded}/${contentLength} bytes).`);
            }
          } else {
            console.log(`[Updater] Baixando... ${downloaded} bytes recebidos.`);
          }
          break;
        case "Finished":
          console.log("[Updater] Download concluído. Iniciando instalação...");
          if (typeof OS.showToast === "function") {
            OS.showToast("Download concluído! Instalando atualização...", "info");
          }
          break;
      }
    });

    console.log("[Updater] Atualização baixada e instalação iniciada com sucesso.");
    alert("Atualização instalada com sucesso! O aplicativo será reiniciado para aplicar a nova versão.");
    return updateObj;
  } catch (err) {
    console.warn("[Updater] Falha ao verificar/instalar atualização:", err);
    if (updateObj && typeof updateObj.close === "function") {
      await updateObj.close().catch(() => {});
    }
    if (!silent && typeof OS.showToast === "function") {
      const errMsg = String((err && err.message) || err || "");
      const lower = errMsg.toLowerCase();
      let friendlyMsg;
      if (
        lower.includes("404") ||
        lower.includes("not found") ||
        lower.includes("valid release") ||
        lower.includes("could not fetch a valid release")
      ) {
        friendlyMsg = "Nenhuma release publicada encontrada no GitHub (latest.json ausente / 404).";
      } else if (
        lower.includes("network") ||
        lower.includes("timeout") ||
        lower.includes("dns") ||
        lower.includes("connect") ||
        lower.includes("reqwest")
      ) {
        friendlyMsg = "Não foi possível conectar ao servidor de atualizações. Verifique sua conexão.";
      } else {
        friendlyMsg = "Falha ao checar atualizações: " + errMsg;
      }
      OS.showToast(friendlyMsg, "error");
    }
    return null;
  }
};
