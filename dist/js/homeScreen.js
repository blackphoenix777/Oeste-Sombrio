/**
 * Tela inicial — Navegação em Abas ("Mesas" / "Fichas") e Gerenciador de Personagens
 */
import { OS } from "./app.js";

// Aba ativa da página inicial (rota padrão pós-login: "mesas")
OS.activeHomeTab = "mesas";

/* ─── [PROVISÓRIO / MOCK VISUAL] Dados estéticos para a aba "Mesas" ───
 * Nesta etapa não há criação real de mesa nem backend de campanhas.
 * Remover/substituir por dados reais quando o sistema de mesas for implementado.
 */
var MOCK_GM_TABLES = [
  {
    id: "mock-gm-1",
    nome: "Sombras sobre Nova Jordana",
    papel: "GM",
    jogadores: "4 jogadores",
    terror: "Terror 2",
    status: "Em andamento",
    detalhe: "Última sessão: 18/10 • Ato II"
  },
  {
    id: "mock-gm-2",
    nome: "O Último Trem de Carvão Eterno",
    papel: "GM",
    jogadores: "3 jogadores",
    terror: "Terror 4",
    status: "Em preparo",
    detalhe: "Próxima sessão: Sábado, 20h"
  }
];

var MOCK_PLAYER_TABLES = [
  {
    id: "mock-pl-1",
    nome: "Cânion dos Condenados",
    papel: "Player",
    gm: "GM: Xerife Morgan",
    jogadores: "5 jogadores",
    terror: "Terror 3",
    status: "Convidado",
    detalhe: "Sessões quinzenais"
  },
  {
    id: "mock-pl-2",
    nome: "Vigília em Sangre Dulce",
    papel: "Player",
    gm: "GM: Helena Vance",
    jogadores: "4 jogadores",
    terror: "Terror 1",
    status: "Ativa",
    detalhe: "Última sessão: 24/10"
  }
];

function buildMockMesaCard(entry) {
  var card = document.createElement("article");
  card.className = "mesa-card" + (entry.papel === "GM" ? " mesa-card-gm" : " mesa-card-player");

  var topRow = document.createElement("div");
  topRow.className = "mesa-card-top";

  var title = document.createElement("h3");
  title.className = "mesa-card-title";
  title.textContent = entry.nome;

  var badge = document.createElement("span");
  badge.className = "mesa-role-badge" + (entry.papel === "GM" ? " badge-gm" : " badge-player");
  badge.textContent = entry.papel;

  topRow.appendChild(title);
  topRow.appendChild(badge);

  var infoRow = document.createElement("div");
  infoRow.className = "mesa-card-info";

  if (entry.gm) {
    var gmTag = document.createElement("span");
    gmTag.className = "mesa-info-pill";
    gmTag.textContent = entry.gm;
    infoRow.appendChild(gmTag);
  }

  var playersTag = document.createElement("span");
  playersTag.className = "mesa-info-pill";
  playersTag.textContent = entry.jogadores;
  infoRow.appendChild(playersTag);

  var terrorTag = document.createElement("span");
  terrorTag.className = "mesa-info-pill mesa-info-terror";
  terrorTag.textContent = entry.terror;
  infoRow.appendChild(terrorTag);

  var footerRow = document.createElement("div");
  footerRow.className = "mesa-card-footer";

  var detail = document.createElement("span");
  detail.className = "mesa-card-meta";
  detail.textContent = entry.detalhe;

  var status = document.createElement("span");
  status.className = "mesa-status-label";
  status.textContent = entry.status;

  footerRow.appendChild(detail);
  footerRow.appendChild(status);

  card.appendChild(topRow);
  card.appendChild(infoRow);
  card.appendChild(footerRow);
  return card;
}

/**
 * Renderiza os cards estéticos (mock) dos blocos "Minhas Mesas" e "Mesas como Player".
 * [PROVISÓRIO] Substituir por listagem real de mesas quando o backend/lógica de mesas existir.
 */
OS.renderMesasMock = function () {
  if (typeof OS.renderMesasList === "function") {
    OS.renderMesasList();
    return;
  }
  var gmGrid = OS.$("mesas-gm-grid");
  var playerGrid = OS.$("mesas-player-grid");

  if (gmGrid) {
    gmGrid.innerHTML = "";
    MOCK_GM_TABLES.forEach(function (entry) {
      gmGrid.appendChild(buildMockMesaCard(entry));
    });
  }

  if (playerGrid) {
    playerGrid.innerHTML = "";
    MOCK_PLAYER_TABLES.forEach(function (entry) {
      playerGrid.appendChild(buildMockMesaCard(entry));
    });
  }
};

/**
 * Alterna entre as abas da página inicial ("mesas" | "fichas").
 */
OS.showHomeTab = function (tabName) {
  var name = tabName === "fichas" ? "fichas" : "mesas";
  OS.activeHomeTab = name;

  var tabs = document.querySelectorAll("#home-screen .home-tab");
  var panels = document.querySelectorAll("#home-screen .home-tab-panel");

  tabs.forEach(function (tab) {
    var active = tab.getAttribute("data-home-tab") === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach(function (panel) {
    var active = panel.id === "home-panel-" + name;
    panel.classList.toggle("active", active);
    if (active) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });

  if (name === "mesas") {
    OS.renderMesasMock();
  } else {
    OS.renderCharactersList();
  }
};

OS.restoreFichaToHomeSlot = function () {
  var homeSlot = OS.$("ficha-home-slot");
  var ficha = OS.$("ficha");
  var toolbar = document.querySelector(".toolbar");
  if (homeSlot) {
    if (ficha && ficha.parentElement !== homeSlot) {
      homeSlot.appendChild(ficha);
    }
    if (toolbar && toolbar.parentElement !== homeSlot) {
      homeSlot.appendChild(toolbar);
    }
  }
};

OS.showHomeScreen = function (options) {
  if (OS.isAuthenticated && !OS.isAuthenticated()) {
    if (OS.showLoginScreen) OS.showLoginScreen();
    return;
  }
  if (OS.hideAuthScreens) OS.hideAuthScreens();
  document.body.classList.remove("mesa-fullscreen-active");
  if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
  var mesaScreen = OS.$("mesa-screen");
  if (mesaScreen) mesaScreen.style.display = "none";
  OS.restoreFichaToHomeSlot();
  var home = OS.$("home-screen");
  var ficha = OS.$("ficha");
  var toolbar = document.querySelector(".toolbar");
  if (home) home.style.display = "";
  if (ficha) ficha.style.display = "none";
  if (toolbar) toolbar.style.display = "none";

  OS.renderMesasMock();
  var targetTab = options && options.tab ? options.tab : (OS.activeHomeTab || "mesas");
  OS.showHomeTab(targetTab);
};

OS.showSheetScreen = function (options) {
  options = options || {};
  if (OS.isAuthenticated && !OS.isAuthenticated()) {
    if (OS.showLoginScreen) OS.showLoginScreen();
    return;
  }
  if (OS.hideAuthScreens) OS.hideAuthScreens();
  var isReadOnly = !!options.readOnlyMode;
  if (OS.setReadOnlyMode) {
    OS.setReadOnlyMode(isReadOnly);
  }
  var home = OS.$("home-screen");
  var mesaScreen = OS.$("mesa-screen");
  var ficha = OS.$("ficha");
  var toolbar = document.querySelector(".toolbar");
  if (home) home.style.display = "none";
  if (!options.insideMesa) {
    document.body.classList.remove("mesa-fullscreen-active");
    if (mesaScreen) mesaScreen.style.display = "none";
    OS.restoreFichaToHomeSlot();
  }
  if (ficha) ficha.style.display = "";
  if (toolbar) toolbar.style.display = isReadOnly ? "none" : "";
};

/**
 * Verifica (somente leitura) se uma ficha possui vínculo com mesa (mesa_id / mesaId).
 * Não modifica o arquivo nem a estrutura interna de nenhuma ficha.
 */
OS.getCharacterMesaId = function (payload, indexItem) {
  if (indexItem && typeof indexItem === "object") {
    var idxMesa = indexItem.mesa_id || indexItem.mesaId;
    if (idxMesa !== null && idxMesa !== undefined && String(idxMesa).trim() !== "") {
      return String(idxMesa).trim();
    }
  }
  if (payload && typeof payload === "object") {
    var metaMesa = payload.meta && (payload.meta.mesa_id || payload.meta.mesaId);
    if (metaMesa !== null && metaMesa !== undefined && String(metaMesa).trim() !== "") {
      return String(metaMesa).trim();
    }
    var dataObj = payload.data && typeof payload.data === "object" ? payload.data : payload;
    var dataMesa = dataObj && (dataObj.mesa_id || dataObj.mesaId);
    if (dataMesa !== null && dataMesa !== undefined && String(dataMesa).trim() !== "") {
      return String(dataMesa).trim();
    }
  }
  return null;
};

function buildCharacterCardElement(item, mesaId) {
  var card = document.createElement("div");
  card.className = "character-card";

  var title = document.createElement("h3");
  title.className = "character-card-name";
  title.textContent = item.name || item.filename;

  var meta = document.createElement("p");
  meta.className = "character-card-meta";
  var metaText = "Última alteração: " + OS.formatCharacterDate(item.last_modified);
  if (mesaId) {
    metaText += " • Mesa: " + mesaId;
  }
  meta.textContent = metaText;

  var actions = document.createElement("div");
  actions.className = "character-card-actions";

  var btnOpen = document.createElement("button");
  btnOpen.type = "button";
  btnOpen.className = "btn btn-secondary";
  btnOpen.textContent = "Abrir";
  btnOpen.addEventListener("click", function () {
    OS.openCharacter(item.filename, item.name);
  });

  var btnDelete = document.createElement("button");
  btnDelete.type = "button";
  btnDelete.className = "btn btn-danger";
  btnDelete.textContent = "Excluir";
  btnDelete.addEventListener("click", function () {
    OS.confirmDeleteCharacter(item.filename, item.name);
  });

  actions.appendChild(btnOpen);
  actions.appendChild(btnDelete);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);
  return card;
}

OS.renderCharactersList = async function () {
  var listMesaEl = OS.$("characters-list-mesa");
  var listSemMesaEl = OS.$("characters-list-sem-mesa");
  if (!listMesaEl && !listSemMesaEl) return;

  if (listMesaEl) {
    listMesaEl.innerHTML = '<p class="characters-empty">Carregando…</p>';
  }
  if (listSemMesaEl) {
    listSemMesaEl.innerHTML = '<p class="characters-empty">Carregando…</p>';
  }

  try {
    // Sincroniza mesa_id com o banco Supabase para refletir exclusões de mesa imediatamente
    var validMesaIds = null;
    var dbMesaByCharName = {};
    if (OS.getSupabaseClient && OS.getCurrentUserId) {
      var client = OS.getSupabaseClient();
      var uid = await OS.getCurrentUserId();
      if (client && uid) {
        try {
          var mesasData = OS.fetchUserMesas ? await OS.fetchUserMesas() : null;
          if (mesasData) {
            validMesaIds = {};
            (mesasData.gmTables || []).forEach(function (m) { validMesaIds[m.id] = true; });
            (mesasData.playerTables || []).forEach(function (m) { validMesaIds[m.id] = true; });
          }
          var fichasRes = await client
            .from("fichas")
            .select("id, nome_personagem, mesa_id, dados, updated_at")
            .eq("usuario_id", uid);
          if (fichasRes && Array.isArray(fichasRes.data)) {
            fichasRes.data.forEach(function (row) {
              var d = row.dados && typeof row.dados === "object" ? row.dados : {};
              if (d.isBestiaryCustom || d.tipo_ficha === "npc" || d.tipo_ficha === "monstro") return;
              var nm = String(row.nome_personagem || d.nome || "").trim().toLowerCase();
              if (nm) {
                dbMesaByCharName[nm] = row.mesa_id || null;
              }
            });
          }
        } catch (syncErr) {
          console.warn("[renderCharactersList] Falha ao sincronizar mesa_id:", syncErr);
        }
      }
    }

    var list = (await OS.listCharacters()) || [];
    var mesaEntries = [];
    var semMesaEntries = [];

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var payload = null;
      try {
        payload = await OS.loadCharacterFile(item.filename);
      } catch (readErr) {
        payload = null;
      }
      var unwrapped = payload ? OS.unwrapCharacterPayload(payload) : null;
      if (
        (item && (item.isBestiaryCustom || item.tipo_ficha === "npc" || item.tipo_ficha === "monstro")) ||
        (unwrapped &&
          (unwrapped.isBestiaryCustom === true ||
            unwrapped.tipo_ficha === "npc" ||
            unwrapped.tipo_ficha === "monstro"))
      ) {
        continue;
      }
      var mesaId = OS.getCharacterMesaId(payload, item);
      var charNameKey = String((unwrapped && unwrapped.nome) || item.name || "").trim().toLowerCase();

      // Se a mesa foi excluída no banco (mesa_id = NULL em fichas ou não consta nas mesas ativas), limpa o vínculo local
      var shouldClearMesa = false;
      if (mesaId) {
        if (validMesaIds && !validMesaIds[mesaId]) {
          shouldClearMesa = true;
        } else if (charNameKey && charNameKey in dbMesaByCharName && dbMesaByCharName[charNameKey] === null) {
          shouldClearMesa = true;
        }
      }
      if (shouldClearMesa) {
        mesaId = null;
        if (item) {
          delete item.mesa_id;
          delete item.mesaId;
        }
        if (payload && typeof payload === "object") {
          if (payload.meta && typeof payload.meta === "object") {
            delete payload.meta.mesa_id;
            delete payload.meta.mesaId;
          }
          if (unwrapped && typeof unwrapped === "object") {
            delete unwrapped.mesa_id;
            delete unwrapped.mesaId;
          }
          await OS.saveCharacterFile(item.filename, payload);
        }
      }

      if (mesaId) {
        mesaEntries.push({ item: item, mesaId: mesaId });
      } else {
        semMesaEntries.push({ item: item, mesaId: null });
      }
    }

    if (listMesaEl) {
      if (!mesaEntries.length) {
        listMesaEl.innerHTML =
          '<p class="characters-empty">Nenhuma ficha vinculada a uma mesa.</p>';
      } else {
        listMesaEl.innerHTML = "";
        mesaEntries.forEach(function (entry) {
          listMesaEl.appendChild(buildCharacterCardElement(entry.item, entry.mesaId));
        });
      }
    }

    if (listSemMesaEl) {
      if (!semMesaEntries.length) {
        listSemMesaEl.innerHTML =
          '<p class="characters-empty">Nenhum personagem salvo. Crie o primeiro.</p>';
      } else {
        listSemMesaEl.innerHTML = "";
        semMesaEntries.forEach(function (entry) {
          listSemMesaEl.appendChild(buildCharacterCardElement(entry.item, null));
        });
      }
    }
  } catch (err) {
    console.error(err);
    if (listMesaEl) {
      listMesaEl.innerHTML =
        '<p class="characters-empty">Erro ao listar fichas de mesa.</p>';
    }
    if (listSemMesaEl) {
      listSemMesaEl.innerHTML =
        '<p class="characters-empty">Erro ao listar personagens.</p>';
    }
  }
};

OS.openCharacter = async function (filename, name) {
  try {
    var payload = await OS.loadCharacterFile(filename);
    var data = OS.unwrapCharacterPayload(payload);
    OS.clearForm();
    if (OS.clearRollVisualState) OS.clearRollVisualState();
    OS.isNewCharacterSession = false;
    OS.applyState(data);
    OS.activeCharacterFilename = filename;
    OS.activeCharacterName =
      name ||
      (payload.meta && payload.meta.name) ||
      data.nome ||
      filename.replace(/\.json$/i, "").replace(/_/g, " ");
    OS.saveToStorage();
    OS.initCylinder();
    OS.showSheetScreen();
    OS.setStatus("Personagem carregado", true);
  } catch (err) {
    console.error(err);
    alert("Não foi possível abrir o personagem.");
  }
};

OS.createNewCharacter = async function (options) {
  options = options || {};
  var mesaId = options.mesaId || null;
  var userId = options.userId || null;
  var existingFichaId = options.existingFichaId || null;
  var defaultName = options.defaultName ? String(options.defaultName).trim() : "";

  var name = window.prompt("Nome do personagem:", defaultName);
  if (!mesaId) {
    if (name === null) return;
    name = String(name).trim();
    if (!name) {
      alert("Informe um nome válido.");
      return;
    }
  } else {
    if (name === null || !String(name).trim()) {
      name =
        defaultName ||
        (OS.authSession && OS.authSession.username) ||
        "Forasteiro";
    } else {
      name = String(name).trim();
    }
  }

  var filename = OS.toCharacterFilename(name);
  try {
    if (!mesaId) {
      var existing = await OS.listCharacters();
      var clash = existing.some(function (c) {
        return c.filename === filename;
      });
      if (clash) {
        var ok = window.confirm(
          "Já existe um personagem com esse nome. Sobrescrever?"
        );
        if (!ok) return;
      }
    }

    OS.clearForm({ freeEdit: false });
    if (OS.clearRollVisualState) OS.clearRollVisualState();
    var nomeEl = OS.$("nome");
    if (nomeEl) nomeEl.value = name;

    OS.activeCharacterFilename = filename;
    OS.activeCharacterName = name;
    OS.activeCharacterMesaId = mesaId || null;
    if (mesaId && OS.activeMesaState) {
      OS.activeMesaState.playerFichaId = existingFichaId || null;
    }
    OS.hasPerformedInitialReload = false;
    OS.initialSkills = [];
    OS.resetCylinderState();
    for (var i = 0; i < 6; i++) {
      var inp = OS.$("chamber-" + i);
      if (inp) {
        inp.value = "";
        inp.removeAttribute("data-original-val");
      }
    }

    // Forçar nível 1 para novo personagem
    var nivelEl = OS.$("nivel");
    if (nivelEl) nivelEl.value = "1";
    OS.isNewCharacterSession = true;
    OS.firstPurchaseDiscountUsed = false;
    if (OS.setCharacterMoney && OS.calculateInitialMoney) OS.setCharacterMoney(OS.calculateInitialMoney(1));

    OS.updateStatsFields(false);
    OS.updateReloadButtonState();

    OS.openInitialSkillsModal(async function () {
      var state = OS.collectState();
      if (mesaId) {
        state.mesa_id = mesaId;
        state.freeEdit = false;
        OS.activeCharacterMesaId = mesaId;
      }
      var payload = OS.wrapCharacterPayload(state, name);
      if (mesaId && payload.meta) {
        payload.meta.mesa_id = mesaId;
      }
      await OS.saveCharacterFile(filename, payload);

      if (mesaId) {
        var upsertPromise = (async function () {
          var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
          var uid =
            userId || (OS.getCurrentUserId ? await OS.getCurrentUserId() : null);
          if (!client || !uid) return;
          var targetFichaId =
            existingFichaId ||
            (OS.activeMesaState && OS.activeMesaState.playerFichaId) ||
            null;
          var latestState = OS.collectState();
          latestState.mesa_id = mesaId;
          latestState.freeEdit = false;

          if (targetFichaId) {
            var upd = await client
              .from("fichas")
              .update({
                nome_personagem: latestState.nome || name,
                nivel: parseInt(String(latestState.nivel || 1), 10) || 1,
                dados: latestState,
                updated_at: new Date().toISOString()
              })
              .eq("id", targetFichaId)
              .select("*")
              .single();
            if (OS.activeMesaState) {
              OS.activeMesaState.playerFichaId =
                (upd && upd.data && upd.data.id) || targetFichaId;
            }
          } else {
            var ins = await client
              .from("fichas")
              .insert({
                usuario_id: uid,
                mesa_id: mesaId,
                nome_personagem: latestState.nome || name,
                nivel: parseInt(String(latestState.nivel || 1), 10) || 1,
                dados: latestState
              })
              .select("*")
              .single();
            if (ins && ins.data) {
              existingFichaId = ins.data.id;
              if (OS.activeMesaState) {
                OS.activeMesaState.playerFichaId = ins.data.id;
              }
            }
          }
        })();

        if (OS.activeMesaState) {
          OS.activeMesaState._pendingPlayerSheetUpsert = upsertPromise;
        }
        try {
          await upsertPromise;
        } finally {
          if (OS.activeMesaState) {
            OS.activeMesaState._pendingPlayerSheetUpsert = null;
          }
        }
      }

      OS.saveToStorage();
      OS.initCylinder();
      OS.showSheetScreen(
        mesaId ? { insideMesa: true, readOnlyMode: false } : undefined
      );
      OS.setStatus("Novo personagem criado", true);
    });
  } catch (err) {
    console.error(err);
    alert("Não foi possível criar o personagem.");
  }
};

OS.confirmDeleteCharacter = function (filename, name) {
  var label = name || filename;
  var ok = window.confirm(
    'Tem certeza que deseja excluir este personagem?\n\n"' + label + '"'
  );
  if (!ok) return;

  OS.deleteCharacterFile(filename)
    .then(function () {
      if (OS.activeCharacterFilename === filename) {
        OS.activeCharacterFilename = null;
        OS.activeCharacterName = null;
      }
      return OS.renderCharactersList();
    })
    .catch(function (err) {
      console.error(err);
      alert("Não foi possível excluir o personagem.");
    });
};

OS.returnToHome = async function () {
  if (OS.activeMesaState && OS.activeMesaState.mesaId) {
    if (OS.activeMesaState.isMestre && OS.activeMesaState.gmEditingSheet && OS.closeMesaSheetEditor) {
      await OS.closeMesaSheetEditor();
      return;
    }
    if (OS.leaveMesaScreen) {
      await OS.leaveMesaScreen();
      return;
    }
  }
  try {
    if (OS.activeCharacterFilename) {
      await OS.persistActiveCharacter();
      OS.saveToStorage();
    }
    if (typeof OS.onStandaloneFreeEditClosed === "function") {
      await OS.onStandaloneFreeEditClosed();
    }
  } catch (err) {
    console.error(err);
  }
  if (OS.clearRollVisualState) OS.clearRollVisualState();
  OS.activeCharacterFilename = null;
  OS.activeCharacterName = null;
  if (OS.setFreeEditMode) OS.setFreeEditMode(false);
  OS.showHomeScreen();
  await OS.renderCharactersList();
};

OS.bindHomeEvents = function () {
  var homeTabs = document.querySelectorAll("#home-screen .home-tab");
  homeTabs.forEach(function (tab) {
    if (tab._bound) return;
    tab._bound = true;
    tab.addEventListener("click", function () {
      OS.showHomeTab(tab.getAttribute("data-home-tab"));
    });
  });

  var btnNew = OS.$("btn-novo-personagem");
  if (btnNew && !btnNew._bound) {
    btnNew._bound = true;
    btnNew.addEventListener("click", function () {
      OS.createNewCharacter();
    });
  }

  var btnBack = OS.$("btn-voltar-home");
  if (btnBack && !btnBack._bound) {
    btnBack._bound = true;
    btnBack.addEventListener("click", function () {
      OS.returnToHome();
    });
  }
};
