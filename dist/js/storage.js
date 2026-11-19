/**
 * Persistência localStorage
 */
import { OS } from "./app.js";

OS.freeEdit = false;
OS.activeSheetTipo = null;
OS.isBestiaryCustom = false;
OS.isReadOnlySheet = false;
OS.characterPortraitUrl = "";
OS._freeEditUploadSuffix = null;
OS._lastSheetSavePromise = null;
var npcUploadCounter = 0;

OS.setReadOnlyMode = function (enabled) {
  var isRo = !!enabled;
  OS.isReadOnlySheet = isRo;
  var fichaEl = OS.$("ficha");
  if (fichaEl) {
    fichaEl.classList.toggle("ficha-readonly", isRo);
    var controls = fichaEl.querySelectorAll("input, textarea, select, button");
    controls.forEach(function (el) {
      if (el.classList && el.classList.contains("ficha-tab")) {
        return;
      }
      if (isRo) {
        if (!el.disabled) {
          el.setAttribute("data-ro-disabled", "1");
          el.disabled = true;
        }
      } else {
        if (el.getAttribute("data-ro-disabled") === "1") {
          el.removeAttribute("data-ro-disabled");
          el.disabled = false;
        }
      }
    });
  }
  if (!isRo) {
    if (OS.setFreeEditMode) OS.setFreeEditMode(OS.freeEdit);
    if (OS.updateReloadButtonState) OS.updateReloadButtonState();
  }
};

OS.renderPortraitPreview = function (url) {
  var cleanUrl = url ? String(url).trim() : "";
  var imgEl = OS.$("historia-portrait-preview");
  var placeholderEl = OS.$("historia-portrait-placeholder");
  var fbEl = OS.$("historia-portrait-feedback");
  var gmBarImgEl = OS.$("gm-bar-portrait-preview");
  var gmBarFbEl = OS.$("gm-bar-portrait-feedback");
  if (imgEl) {
    if (cleanUrl) {
      imgEl.src = cleanUrl;
      imgEl.hidden = false;
      imgEl.removeAttribute("hidden");
    } else {
      imgEl.removeAttribute("src");
      imgEl.hidden = true;
      imgEl.setAttribute("hidden", "");
    }
  }
  if (gmBarImgEl) {
    if (cleanUrl) {
      gmBarImgEl.src = cleanUrl;
      gmBarImgEl.hidden = false;
      gmBarImgEl.removeAttribute("hidden");
    } else {
      gmBarImgEl.removeAttribute("src");
      gmBarImgEl.hidden = true;
      gmBarImgEl.setAttribute("hidden", "");
    }
  }
  if (placeholderEl) {
    if (cleanUrl) {
      placeholderEl.hidden = true;
      placeholderEl.setAttribute("hidden", "");
    } else {
      placeholderEl.hidden = false;
      placeholderEl.removeAttribute("hidden");
    }
  }
  if (fbEl) {
    fbEl.textContent = "";
    fbEl.hidden = true;
    fbEl.setAttribute("hidden", "");
    fbEl.className = "historia-portrait-feedback";
  }
  if (gmBarFbEl) {
    gmBarFbEl.textContent = "";
    gmBarFbEl.hidden = true;
    gmBarFbEl.setAttribute("hidden", "");
    gmBarFbEl.className = "gm-bar-portrait-feedback";
  }
};

function showPortraitFeedback(msg, isError, customFeedbackFn) {
  if (typeof customFeedbackFn === "function") {
    customFeedbackFn(msg, !!isError);
    return;
  }
  var fbEl = OS.$("historia-portrait-feedback");
  var gmBarFbEl = OS.$("gm-bar-portrait-feedback");
  if (fbEl) {
    if (!msg) {
      fbEl.textContent = "";
      fbEl.hidden = true;
      fbEl.setAttribute("hidden", "");
    } else {
      fbEl.textContent = msg;
      fbEl.className = "historia-portrait-feedback " + (isError ? "is-error" : "is-success");
      fbEl.hidden = false;
      fbEl.removeAttribute("hidden");
    }
  }
  if (gmBarFbEl) {
    if (!msg) {
      gmBarFbEl.textContent = "";
      gmBarFbEl.hidden = true;
      gmBarFbEl.setAttribute("hidden", "");
    } else {
      gmBarFbEl.textContent = msg;
      gmBarFbEl.className = "gm-bar-portrait-feedback " + (isError ? "is-error" : "is-success");
      gmBarFbEl.hidden = false;
      gmBarFbEl.removeAttribute("hidden");
    }
  }
}

OS.uploadCharacterPortraitFile = async function (file, options) {
  options = options || {};
  var customFb = typeof options.onFeedback === "function" ? options.onFeedback : null;
  if (!file) return null;
  if (!options.skipSheetApply && OS.isReadOnlySheet) return null;

  var MAX_PORTRAIT_BYTES = 5 * 1024 * 1024; // 5 MB (5242880 bytes)
  if (file.size > MAX_PORTRAIT_BYTES) {
    var mbStr = (file.size / (1024 * 1024)).toFixed(2);
    showPortraitFeedback(
      "Arquivo excede o limite de 5 MB (" + mbStr + " MB). Escolha uma imagem menor.",
      true,
      customFb
    );
    return null;
  }

  var client = OS.getSupabaseClient ? OS.getSupabaseClient() : null;
  if (!client || !client.storage) {
    showPortraitFeedback("Cliente Supabase indisponível para upload.", true, customFb);
    return null;
  }

  var uid = OS.getCurrentUserId ? await OS.getCurrentUserId() : null;
  if (!uid) {
    showPortraitFeedback("Você precisa estar autenticado para enviar um retrato.", true, customFb);
    return null;
  }

  var ext = "png";
  if (file.name && file.name.indexOf(".") >= 0) {
    ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  } else if (file.type) {
    var mimePart = file.type.split("/")[1] || "png";
    ext = mimePart === "jpeg" ? "jpg" : mimePart.replace(/[^a-z0-9]/g, "");
  }
  if (["jpg", "jpeg", "png", "webp", "gif"].indexOf(ext) < 0) {
    ext = "png";
  }

  var gmEdit = OS.activeMesaState && OS.activeMesaState.gmEditingSheet;
  var isNpcFreeEdit =
    !!options.customNpcId ||
    !!OS.freeEdit ||
    !!(gmEdit && gmEdit.mode !== "player-readonly");

  var rawSlug;
  if (isNpcFreeEdit) {
    var uniqueId =
      options.customNpcId ||
      (gmEdit && (gmEdit.customId || gmEdit.instanceId || gmEdit.mesaNpcId || gmEdit._uploadSuffix)) ||
      OS._freeEditUploadSuffix;
    if (!uniqueId) {
      npcUploadCounter += 1;
      uniqueId = "npc_" + Date.now() + "_" + npcUploadCounter;
      if (gmEdit) gmEdit._uploadSuffix = uniqueId;
      OS._freeEditUploadSuffix = uniqueId;
    }
    var npcNamePart =
      options.npcName !== undefined
        ? String(options.npcName || "").trim()
        : (!options.skipSheetApply && OS.$("nome") ? String(OS.$("nome").value || "").trim() : "");
    var idPart = String(uniqueId);
    if (idPart.indexOf("npc_") !== 0) {
      idPart = "npc_" + idPart;
    }
    rawSlug = npcNamePart ? npcNamePart + "_" + idPart : idPart;
  } else {
    rawSlug =
      (OS.activeMesaState && OS.activeMesaState.playerFichaId) ||
      (OS.activeCharacterFilename && OS.activeCharacterFilename.replace(/\.json$/i, "")) ||
      (OS.$("nome") && OS.$("nome").value) ||
      "personagem";
  }

  var slug = String(rawSlug)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "personagem";

  var objectPath = uid + "/" + slug + "." + ext;
  showPortraitFeedback("Enviando retrato...", false, customFb);

  var upRes = await client.storage
    .from("character-portraits")
    .upload(objectPath, file, {
      upsert: true,
      contentType: file.type || "image/png"
    });

  if (upRes.error) {
    showPortraitFeedback(
      "Erro ao enviar retrato: " + (upRes.error.message || "falha no Storage"),
      true,
      customFb
    );
    return null;
  }

  var pubData = client.storage.from("character-portraits").getPublicUrl(objectPath);
  var publicUrl = (pubData && pubData.data && pubData.data.publicUrl) || "";
  if (!publicUrl) {
    showPortraitFeedback("Não foi possível obter a URL pública do retrato.", true, customFb);
    return null;
  }

  var versionedUrl = publicUrl + (publicUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();

  if (options.skipSheetApply) {
    showPortraitFeedback("✓ Imagem atualizada com sucesso!", false, customFb);
    return versionedUrl;
  }

  OS.characterPortraitUrl = versionedUrl;
  OS.renderPortraitPreview(versionedUrl);
  showPortraitFeedback("✓ Retrato atualizado com sucesso!", false);
  OS.saveToStorage();
  if (OS._lastSheetSavePromise) {
    try {
      await OS._lastSheetSavePromise;
    } catch (e) {
      /* logged inside saveToStorage */
    }
  }
  return versionedUrl;
};

OS.uploadCharacterPortrait = OS.uploadCharacterPortraitFile;

OS.bindPortraitUploadEvents = function () {
  var btnUpload = OS.$("btn-historia-portrait-upload");
  var btnGmBarUpload = OS.$("btn-gm-bar-portrait-upload");
  var fileInput = OS.$("historia-portrait-input");

  if (btnUpload && !btnUpload._bound) {
    btnUpload._bound = true;
    btnUpload.addEventListener("click", function () {
      if (OS.isReadOnlySheet) return;
      if (fileInput) fileInput.click();
    });
  }

  if (btnGmBarUpload && !btnGmBarUpload._bound) {
    btnGmBarUpload._bound = true;
    btnGmBarUpload.addEventListener("click", function () {
      if (OS.isReadOnlySheet) return;
      if (fileInput) fileInput.click();
    });
  }

  if (fileInput && !fileInput._bound) {
    fileInput._bound = true;
    fileInput.addEventListener("change", async function () {
      if (OS.isReadOnlySheet) {
        fileInput.value = "";
        return;
      }
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        await OS.uploadCharacterPortraitFile(file);
      } finally {
        fileInput.value = "";
      }
    });
  }
};

OS.setFreeEditMode = function (enabled) {
  var isFree = !!enabled;
  OS.freeEdit = isFree;
  var fichaEl = OS.$("ficha");
  if (fichaEl) {
    fichaEl.classList.toggle("ficha-free-edit", isFree);
  }
  var cfg6bEl = OS.$("config-6b");
  var remTotalEl = OS.$("rem-total");
  if (cfg6bEl) {
    if (isFree) {
      cfg6bEl.removeAttribute("readonly");
      cfg6bEl.readOnly = false;
    } else {
      cfg6bEl.setAttribute("readonly", "");
      cfg6bEl.readOnly = true;
    }
  }
  if (remTotalEl) {
    if (isFree) {
      remTotalEl.removeAttribute("readonly");
      remTotalEl.readOnly = false;
    } else {
      remTotalEl.setAttribute("readonly", "");
      remTotalEl.readOnly = true;
    }
  }
  if (OS.syncCriaturaModeUI) OS.syncCriaturaModeUI();
  if (OS.syncOwn6BEditorUI) OS.syncOwn6BEditorUI();
};

OS.collectState = function () {
    var state = {};

    OS.getFormElements().forEach(function (el) {
      if (!el.name && !el.id) return;
      if (el.id === "is-criatura" || el.name === "is-criatura") return;
      if (el.id === "has-own-6b" || el.name === "has-own-6b") return;
      if (el.id && el.id.indexOf("own-6b-count-") === 0) return;
      var key = el.name || el.id;

      if (el.type === "checkbox") {
        state[key] = el.checked;
      } else if (el.type === "radio") {
        if (el.checked) {
          state[el.name] = el.value;
        }
      } else {
        state[key] = el.value;
      }
    });

    var cylState = OS.saveCylinderState();
    state.usedChambers = cylState.usedChambers;
    state.markedChambers = cylState.markedChambers;
    state.damagedChambers = cylState.damagedChambers || [];
    state.receivedDeliveryIds = (OS.receivedDeliveryIds || []).slice();
    state.originalChambers = cylState.originalChambers;
    state.hasPerformedInitialReload = OS.hasPerformedInitialReload !== false;
    state.initialSkills = Array.isArray(OS.initialSkills)
      ? OS.initialSkills.slice()
      : [];
    if (OS.collectInventoryState) {
      state.inventoryItems = OS.collectInventoryState();
    }
    if (OS.collectMagiasState) {
      var ms = OS.collectMagiasState();
      state.knownSpells = ms.knownSpells;
      state.config6B = ms.config6B;
      state.remSpent = ms.remSpent;
      state.activeBuffs = ms.activeBuffs;
    } else {
      state.activeBuffs = Array.isArray(OS.activeBuffs)
        ? OS.activeBuffs.map(function (b) { return Object.assign({}, b); })
        : [];
    }

    if (OS.freeEdit) {
      if (OS._own6BExplicit === true) {
        if (OS.hasOwn6B === false) {
          state.hasOwn6B = false;
          state["has-own-6b"] = false;
          state.own6B = OS.getOwn6BTemplateSnapshot
            ? OS.getOwn6BTemplateSnapshot()
            : {
                schemaVersion: 1,
                enabled: false,
                totalDice: 0,
                counts: { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 },
                diceTypes: [],
                diceSides: [],
                formatted: ""
              };
          state.config6B = {};
          state["config-6b"] = "";
        } else if (OS.hasOwn6B === true) {
          var ownSnap = OS.getOwn6BTemplateSnapshot
            ? OS.getOwn6BTemplateSnapshot()
            : null;
          state.hasOwn6B = true;
          state["has-own-6b"] = true;
          if (ownSnap) {
            state.own6B = ownSnap;
            var compactOwn = {};
            Object.keys(ownSnap.counts || {}).forEach(function (dk) {
              var qty = parseInt(ownSnap.counts[dk], 10) || 0;
              if (qty > 0) compactOwn[dk] = qty;
            });
            state.config6B = compactOwn;
            OS.config6B = Object.assign({}, compactOwn);
            state["config-6b"] = ownSnap.formatted || "";
            if (ownSnap.totalDice > 6) {
              var extraSaved = OS._loadedExtraChambers || {};
              for (var eci = 6; eci < ownSnap.totalDice; eci++) {
                var ek = "chamber-" + eci;
                if (state[ek] === undefined) {
                  state[ek] = extraSaved[ek] !== undefined ? String(extraSaved[ek]) : "0";
                }
              }
            }
          }
        }
      } else {
        var rawCfgStr = String(state["config-6b"] || "").trim();
        if (rawCfgStr && typeof OS.parse6BConfigString === "function") {
          var parsed6b = OS.parse6BConfigString(rawCfgStr);
          if (Object.keys(parsed6b).length) {
            state.config6B = Object.assign({}, parsed6b);
            OS.config6B = Object.assign({}, parsed6b);
          }
        } else if (
          state.config6B &&
          typeof state.config6B === "object" &&
          Object.keys(state.config6B).length &&
          typeof OS.format6BConfig === "function"
        ) {
          state["config-6b"] = OS.format6BConfig(state.config6B);
        }
        if (OS._loadedExtraChambers && typeof OS._loadedExtraChambers === "object") {
          Object.keys(OS._loadedExtraChambers).forEach(function (ek) {
            if (state[ek] === undefined) {
              state[ek] = String(OS._loadedExtraChambers[ek]);
            }
          });
        }
      }
    }

    // Última rolagem de cada perícia e de ataques/combate
    var skillRollResults = {};
    document.querySelectorAll("#ficha .roll-result[data-roll-key]").forEach(function (el) {
      var k = el.getAttribute("data-roll-key");
      if (k && el.textContent) {
        skillRollResults[k] = {
          text: el.textContent,
          rolled: el.classList.contains("rolled")
        };
      }
    });
    if (
      OS.unarmedPseudoWeapon &&
      (OS.unarmedPseudoWeapon.lastMeleeRollText || OS.unarmedPseudoWeapon.lastWeaponRollText)
    ) {
      var uTxt =
        OS.unarmedPseudoWeapon.lastMeleeRollText ||
        OS.unarmedPseudoWeapon.lastWeaponRollText;
      skillRollResults["weapon-__unarmed__"] = {
        text: uTxt,
        rolled: true,
        total: OS.unarmedPseudoWeapon.lastWeaponRoll
      };
    }
    if (OS.naturalAttackRollResults && typeof OS.naturalAttackRollResults === "object") {
      Object.keys(OS.naturalAttackRollResults).forEach(function (nk) {
        var nEntry = OS.naturalAttackRollResults[nk];
        if (nEntry && nEntry.text) {
          skillRollResults[nk] = {
            text: nEntry.text,
            rolled: nEntry.rolled !== false,
            total: nEntry.total
          };
        }
      });
    }
    state.skillRollResults = skillRollResults;

    // Fichas do Destino
    state.fateTokens = Object.assign(
      { vermelha: 0, azul: 0, verde: 0, preta: 0 },
      OS.fateTokens || {}
    );
    state.fatePool = OS.getCurrentFatePool
      ? OS.getCurrentFatePool()
      : Object.assign({ vermelha: 20, azul: 10, verde: 5, preta: 1 }, OS.fatePool || {});

    // Controle de desconto da primeira compra da criação
    state.firstPurchaseDiscountUsed = !!OS.firstPurchaseDiscountUsed;

    // Condições Ativas, Terror da Cena, Veterano e Tempo Livre
    state.activeConditions = Array.isArray(OS.activeConditions)
      ? OS.activeConditions.map(function (c) { return Object.assign({}, c); })
      : [];
    state.sceneTerrorLevel = OS.getSceneTerrorLevel ? OS.getSceneTerrorLevel() : (OS.sceneTerrorLevel || 0);
    state.isVeterano = !!(OS.isVeterano || (OS.$("is-veterano") && OS.$("is-veterano").checked));
    state.downtimeWeeks = OS.downtimeWeeks || 0;
    state.downtimeDays = OS.downtimeDays || 0;

    // Calculadora de Dificuldade do Teste (localizada no modal de teste de perícia geral)
    var calcDbEl = OS.$("test-calc-db");
    var calcModEl = OS.$("test-calc-mod");
    if (calcDbEl) state["test-calc-db"] = calcDbEl.value;
    if (calcModEl) state["test-calc-mod"] = calcModEl.value;

    // Modo de edição livre (NPCs / Monstros / Bestiário)
    state.freeEdit = !!OS.freeEdit;
    if (OS.activeSheetTipo) {
      state.tipo_ficha = OS.activeSheetTipo;
    }
    if (OS.isBestiaryCustom) {
      state.isBestiaryCustom = true;
    }
    if (OS.freeEdit) {
      if (OS.isCriatura === true) {
        state.isCriatura = true;
        state["is-criatura"] = true;
        state.operationalMode = "creature_mode";
      } else if (OS.isCriatura === false) {
        state.isCriatura = false;
        state["is-criatura"] = false;
        state.operationalMode = "full_sheet";
      } else if (OS._loadedCreatureModeNullKeys) {
        if (OS._loadedCreatureModeNullKeys.isCriatura) state.isCriatura = null;
        if (OS._loadedCreatureModeNullKeys.dash) state["is-criatura"] = null;
        if (OS._loadedCreatureModeNullKeys.operationalMode) state.operationalMode = null;
      }
    }
    if (
      !OS.freeEdit &&
      OS.activeMesaState &&
      OS.activeMesaState.mesaId &&
      !OS.activeMesaState.isMestre
    ) {
      state.mesa_id = OS.activeMesaState.mesaId;
    } else if (!OS.freeEdit && OS.activeCharacterMesaId) {
      state.mesa_id = OS.activeCharacterMesaId;
    }
    state.retrato_url = OS.characterPortraitUrl || "";
    OS.activeCharacterState = state;

    return state;
  };

  OS.applyState = function (state, options) {
    if (!state || typeof state !== "object") return;
    options = options || {};

    var allChambersZeroInState = true;
    for (var ci = 0; ci < 6; ci++) {
      var cVal = state["chamber-" + ci];
      if (cVal !== undefined && String(cVal).trim() !== "" && String(cVal).trim() !== "0") {
        allChambersZeroInState = false;
        break;
      }
    }
    var hasManualDefInState =
      state.defesa !== undefined &&
      String(state.defesa).trim() !== "" &&
      parseInt(String(state.defesa), 10) > 0;
    var isFree = !!(
      state.freeEdit ||
      state.isBestiaryCustom ||
      state.tipo_ficha === "npc" ||
      state.tipo_ficha === "monstro" ||
      (allChambersZeroInState && hasManualDefInState)
    );
    if (OS.setFreeEditMode) {
      OS.setFreeEditMode(isFree);
    } else {
      OS.freeEdit = isFree;
    }
    var hasExplicitTipoFicha =
      Object.prototype.hasOwnProperty.call(state, "tipo_ficha") &&
      state.tipo_ficha !== undefined &&
      state.tipo_ficha !== null &&
      String(state.tipo_ficha).trim() !== "";
    OS._loadedHasTipoFicha = hasExplicitTipoFicha;
    OS.activeSheetTipo = hasExplicitTipoFicha ? state.tipo_ficha : null;
    OS.isBestiaryCustom = !!state.isBestiaryCustom;
    OS._loadedCreatureModeNullKeys = {
      isCriatura: Object.prototype.hasOwnProperty.call(state, "isCriatura") && state.isCriatura === null,
      dash: Object.prototype.hasOwnProperty.call(state, "is-criatura") && state["is-criatura"] === null,
      operationalMode: Object.prototype.hasOwnProperty.call(state, "operationalMode") && state.operationalMode === null
    };
    OS.activeCharacterMesaId = !isFree && (state.mesa_id || state.mesaId)
      ? String(state.mesa_id || state.mesaId)
      : null;

    OS.getFormElements().forEach(function (el) {
      var key = el.name || el.id;
      if (el.id === "is-criatura" || el.name === "is-criatura") {
        return;
      }
      if (el.id === "has-own-6b" || el.name === "has-own-6b") {
        return;
      }
      if (el.id && el.id.indexOf("own-6b-count-") === 0) {
        return;
      }
      if (!(key in state) && el.type === "radio" && !(el.name in state)) {
        return;
      }

      if (el.classList.contains("chamber-input")) {
        // Remove o cache bruto herdado da ficha anterior; loadCylinderState() o
        // restaura a partir de state.originalChambers quando existir.
        el.removeAttribute("data-original-val");
        if (key in state && typeof state[key] === "string") {
          el.value = OS.sanitizeChamberValue(state[key]);
        }
        return;
      }

      if (el.type === "checkbox") {
        if (key in state) {
          el.checked = !!state[key];
        } else if (el.classList.contains("die-checkbox")) {
          var legacyName = (key || "").replace(/-(d4|d6|d8|d10|d12)$/, "");
          if (legacyName in state && state[legacyName] === el.value) {
            el.checked = true;
          }
        }
      } else if (el.type === "radio") {
        if (el.name in state && el.value === state[el.name]) {
          el.checked = true;
        }
      } else if (key in state) {
        el.value = state[key];
      }
    });

    OS.loadCylinderState(state);
    if ("hasPerformedInitialReload" in state) {
      OS.hasPerformedInitialReload = state.hasPerformedInitialReload !== false;
    } else if ("isFirstLoad" in state) {
      OS.hasPerformedInitialReload = !state.isFirstLoad;
    } else {
      OS.hasPerformedInitialReload = true;
    }
    OS.initialSkills = Array.isArray(state.initialSkills)
      ? state.initialSkills.slice()
      : [];

    // Dinheiro e controle de primeira compra
    if ("firstPurchaseDiscountUsed" in state) {
      OS.firstPurchaseDiscountUsed = !!state.firstPurchaseDiscountUsed;
    } else {
      var hasExistingInv =
        (Array.isArray(state.inventoryItems) && state.inventoryItems.length > 0) ||
        (typeof state.inventario === "string" && state.inventario.trim().length > 0);
      OS.firstPurchaseDiscountUsed = hasExistingInv;
    }

    var dinheiroEl = OS.$("dinheiro");
    if (dinheiroEl) {
      if (state.dinheiro !== undefined && String(state.dinheiro).trim() !== "") {
        dinheiroEl.value = String(state.dinheiro);
      } else if (!OS.freeEdit) {
        var lv = parseInt(String(state.nivel || 1), 10);
        if (isNaN(lv) || lv < 1) lv = 1;
        var calcDin = OS.calculateInitialMoney
          ? OS.calculateInitialMoney(lv)
          : 10 + Math.max(0, lv - 1) * 5;
        dinheiroEl.value = String(calcDin);
      } else {
        dinheiroEl.value = state.dinheiro !== undefined ? String(state.dinheiro) : "";
      }
    }

    // Fichas do Destino
    if (state.fateTokens && typeof state.fateTokens === "object") {
      OS.fateTokens = {
        vermelha: Math.max(0, parseInt(state.fateTokens.vermelha, 10) || 0),
        azul: Math.max(0, parseInt(state.fateTokens.azul, 10) || 0),
        verde: Math.max(0, parseInt(state.fateTokens.verde, 10) || 0),
        preta: Math.max(0, parseInt(state.fateTokens.preta, 10) || 0)
      };
    } else {
      OS.fateTokens = { vermelha: 0, azul: 0, verde: 0, preta: 0 };
    }
    if (OS.renderFateTokens) OS.renderFateTokens();

    // Restaurar últimas rolagens de perícias e ataques/combate
    document.querySelectorAll("#ficha .roll-result").forEach(function (el) {
      el.textContent = "";
      el.classList.remove("rolled");
      if (el.id && el.id.indexOf("combate-") === 0) {
        el.hidden = true;
        el.setAttribute("hidden", "");
      }
    });
    if (OS.unarmedPseudoWeapon) {
      delete OS.unarmedPseudoWeapon.lastWeaponRoll;
      OS.unarmedPseudoWeapon.lastWeaponRollText = "";
      OS.unarmedPseudoWeapon.lastMeleeRollText = "";
      OS.unarmedPseudoWeapon.lastRangedRollText = "";
    }
    OS.naturalAttackRollResults = {};

    if (state.skillRollResults && typeof state.skillRollResults === "object") {
      document.querySelectorAll("#ficha .roll-result[data-roll-key]").forEach(function (el) {
        var k = el.getAttribute("data-roll-key");
        var entry = k && state.skillRollResults[k];
        if (entry) {
          var txt = typeof entry === "string" ? entry : (entry.text || "");
          el.textContent = txt;
          if (txt && (typeof entry !== "object" || entry.rolled !== false)) {
            el.classList.add("rolled");
            el.hidden = false;
            el.removeAttribute("hidden");
          }
        }
      });

      var unarmedSaved = state.skillRollResults["weapon-__unarmed__"];
      if (unarmedSaved && OS.unarmedPseudoWeapon) {
        var uText = typeof unarmedSaved === "string" ? unarmedSaved : (unarmedSaved.text || "");
        if (uText) {
          OS.unarmedPseudoWeapon.lastMeleeRollText = uText;
          OS.unarmedPseudoWeapon.lastWeaponRollText = uText;
          if (typeof unarmedSaved === "object" && typeof unarmedSaved.total === "number") {
            OS.unarmedPseudoWeapon.lastWeaponRoll = unarmedSaved.total;
          }
        }
      }

      Object.keys(state.skillRollResults).forEach(function (rk) {
        if (rk.indexOf("natural-") === 0) {
          var nSaved = state.skillRollResults[rk];
          var nText = typeof nSaved === "string" ? nSaved : (nSaved && nSaved.text) || "";
          if (nText) {
            OS.naturalAttackRollResults[rk] = {
              text: nText,
              rolled: true,
              total: typeof nSaved === "object" ? nSaved.total : undefined
            };
          }
        }
      });
    }

    if (state.sceneAttackRolls && typeof state.sceneAttackRolls === "object") {
      Object.keys(state.sceneAttackRolls).forEach(function (sk) {
        if (sk.indexOf("natural-") === 0 && !OS.naturalAttackRollResults[sk]) {
          var sSaved = state.sceneAttackRolls[sk];
          var sText = typeof sSaved === "string" ? sSaved : (sSaved && sSaved.text) || "";
          if (sText) {
            OS.naturalAttackRollResults[sk] = {
              text: sText,
              rolled: true,
              total: typeof sSaved === "object" ? sSaved.total : undefined
            };
          }
        }
      });
    }

    if (OS.applyInventoryState) OS.applyInventoryState(state);
    if (OS.applyMagiasState) OS.applyMagiasState(state);

    // Restaurar Condições Ativas, Terror da Cena, Veterano e Tempo Livre
    OS.isVeterano = !!state.isVeterano || !!state["is-veterano"];
    var vetCb = OS.$("is-veterano");
    if (vetCb) vetCb.checked = OS.isVeterano;

    var terrorLv = state.sceneTerrorLevel !== undefined
      ? parseInt(String(state.sceneTerrorLevel), 10)
      : parseInt(String(state["scene-terror-input"] || state["scene-terror-slider"] || 0), 10);
    if (isNaN(terrorLv)) terrorLv = 0;
    terrorLv = Math.max(0, Math.min(6, terrorLv));
    OS.sceneTerrorLevel = terrorLv;
    var sSlider = OS.$("scene-terror-slider");
    var sInp = OS.$("scene-terror-input");
    if (sSlider) sSlider.value = String(terrorLv);
    if (sInp) sInp.value = String(terrorLv);

    OS.activeConditions = Array.isArray(state.activeConditions)
      ? state.activeConditions.map(function (c) { return Object.assign({}, c); })
      : [];

    // Migração retrocompatível: fichas antigas com fadiga-0..fadiga-39 sem "Fatigado" em activeConditions
    var hasFatigadoCond = OS.activeConditions.some(function (c) {
      return c && String(c.nome || "").trim().toLowerCase() === "fatigado";
    });
    if (!hasFatigadoCond) {
      var legacyFatigueCount = 0;
      for (var fi = 0; fi < 40; fi++) {
        if (state["fadiga-" + fi]) legacyFatigueCount++;
      }
      if (legacyFatigueCount > 0) {
        OS.activeConditions.push({
          nome: "Fatigado",
          grau: legacyFatigueCount,
          possui_grau: true,
          cumulativo: true,
          efeito: "Reduz o maior dado do 6B em 1 para cada nível de Fadiga."
        });
      }
    }

    OS.characterPortraitUrl = state.retrato_url ? String(state.retrato_url) : "";
    if (OS.renderPortraitPreview) {
      OS.renderPortraitPreview(OS.characterPortraitUrl);
    }
    OS.downtimeWeeks = Math.max(0, parseInt(String(state.downtimeWeeks || state["downtime-weeks"] || 0), 10) || 0);
    OS.downtimeDays = Math.max(0, parseInt(String(state.downtimeDays || state["downtime-days"] || 0), 10) || 0);
    var wEl = OS.$("downtime-weeks");
    var dEl = OS.$("downtime-days");
    if (wEl) wEl.value = String(OS.downtimeWeeks);
    if (dEl) dEl.value = String(OS.downtimeDays);

    var calcDbRestore = OS.$("test-calc-db");
    var calcModRestore = OS.$("test-calc-mod");
    if (calcDbRestore && "test-calc-db" in state) {
      calcDbRestore.value = String(state["test-calc-db"]);
    }
    if (calcModRestore && "test-calc-mod" in state) {
      calcModRestore.value = String(state["test-calc-mod"]);
    }

    if (OS.syncFadigaVisual) OS.syncFadigaVisual();
    if (OS.applyFatiguePenalty) OS.applyFatiguePenalty();
    if (OS.renderActiveConditions) OS.renderActiveConditions();
    if (OS.syncTerrorAndVeteranoUI) OS.syncTerrorAndVeteranoUI();
    var loadedCriaturaChoice = OS.extractCreatureModeChoice
      ? OS.extractCreatureModeChoice(state)
      : state.operationalMode === "creature_mode" || state.isCriatura === true || state["is-criatura"] === true
      ? true
      : state.operationalMode === "full_sheet" || state.isCriatura === false || state["is-criatura"] === false
      ? false
      : null;
    if (OS.setCriaturaMode) {
      OS.setCriaturaMode(isFree ? loadedCriaturaChoice : null, true);
    } else {
      OS.isCriatura = isFree ? loadedCriaturaChoice : null;
    }

    // XER-04: Restaurar estado do 6B próprio de NPC/Boss sem poluir fichas de jogador ou legados não editados
    OS._loadedExtraChambers = {};
    for (var xci = 6; xci < 15; xci++) {
      var xk = "chamber-" + xci;
      if (state[xk] !== undefined) {
        OS._loadedExtraChambers[xk] = String(state[xk]);
      }
    }
    if (!isFree) {
      if (OS.setOwn6BEnabled) {
        OS.setOwn6BEnabled(null, { skipSave: true, markExplicit: false });
      }
    } else {
      var hasExplicitOwnFalse =
        state.hasOwn6B === false ||
        state["has-own-6b"] === false ||
        Boolean(state.own6B && typeof state.own6B === "object" && state.own6B.enabled === false);
      var hasExplicitOwnTrue =
        state.hasOwn6B === true ||
        state["has-own-6b"] === true ||
        Boolean(state.own6B && typeof state.own6B === "object" && state.own6B.enabled === true);

      if (hasExplicitOwnFalse) {
        if (OS.setOwn6BEnabled) {
          OS.setOwn6BEnabled(false, { skipSave: true, markExplicit: true });
        }
      } else if (hasExplicitOwnTrue) {
        var explicitCompSource =
          state.own6B && typeof state.own6B === "object"
            ? state.own6B.counts || state.own6B.formatted || state.own6B.diceTypes
            : null;
        if (!explicitCompSource) {
          explicitCompSource = state["config-6b"] || state.config6B || { d6: 6 };
        }
        if (OS.setOwn6BComposition) {
          OS.setOwn6BComposition(explicitCompSource, { skipSave: true, markExplicit: true });
        }
      } else {
        // Legado sem flag explícita hasOwn6B/own6B: sincroniza UI para refletir config-6b existente sem marcar _own6BExplicit
        var legacySource = state["config-6b"] || state.config6B || null;
        if (legacySource && OS.validateOwn6BComposition) {
          var legRes = OS.validateOwn6BComposition(legacySource, { enabled: true });
          if (legRes.valid) {
            OS.hasOwn6B = true;
            OS.own6BCounts = Object.assign({}, legRes.counts);
            OS._lastValidOwn6BCounts = Object.assign({}, legRes.counts);
            OS._own6BExplicit = false;
            OS.own6BValidationError = null;
            OS.own6BValidationCode = null;
          } else {
            OS.hasOwn6B = false;
            OS.own6BCounts = OS.createEmptyOwn6BCounts ? OS.createEmptyOwn6BCounts() : { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 };
            OS._own6BExplicit = false;
          }
        } else {
          OS.hasOwn6B = false;
          OS.own6BCounts = OS.createEmptyOwn6BCounts ? OS.createEmptyOwn6BCounts() : { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 };
          OS._own6BExplicit = false;
        }
        if (OS.syncOwn6BEditorUI) {
          OS.syncOwn6BEditorUI({ preserveConfigInput: true });
        }
      }
    }

    if (OS.updateBuffButtonUI) OS.updateBuffButtonUI();
    if (OS.updateStatsFields) OS.updateStatsFields(false);

    // Garantir preservação de valores manuais em modo freeEdit
    if (OS.freeEdit) {
      var defEl = OS.$("defesa");
      var iniEl = OS.$("iniciativa");
      var remTEl = OS.$("rem-total");
      var remAEl = OS.$("rem-atual");
      var cfgEl = OS.$("config-6b");
      if (defEl && state.defesa !== undefined) defEl.value = String(state.defesa);
      if (iniEl && state.iniciativa !== undefined) iniEl.value = String(state.iniciativa);
      if (remTEl && state["rem-total"] !== undefined) remTEl.value = String(state["rem-total"]);
      if (remAEl && state["rem-atual"] !== undefined) remAEl.value = String(state["rem-atual"]);
      if (cfgEl) {
        if (OS.hasOwn6B === false && OS._own6BExplicit) {
          cfgEl.value = "";
        } else if (state["config-6b"] !== undefined) {
          cfgEl.value = String(state["config-6b"]);
        }
      }
      if (typeof OS.syncUsedChambersVisual === "function") {
        OS.syncUsedChambersVisual(true);
      }
      if (typeof OS.updateReloadButtonState === "function") {
        OS.updateReloadButtonState();
      }
    }

    if (OS.setReadOnlyMode) {
      OS.setReadOnlyMode(!!options.readOnlyMode);
    }
    if (typeof OS.updateNovaSessaoButtonVisibility === "function") {
      OS.updateNovaSessaoButtonVisibility();
    }
    OS.activeCharacterState = state;
  };

  OS.saveToStorage = function () {
    if (OS.isReadOnlySheet) return false;
    try {
      var state = OS.collectState();
      localStorage.setItem(OS.STORAGE_KEY, JSON.stringify(state));
      if (OS.activeCharacterFilename && OS.persistActiveCharacter) {
        OS.persistActiveCharacter().catch(function (err) {
          console.error("character file:", err);
        });
      }
      if (typeof OS.onSheetSavedHook === "function") {
        OS._lastSheetSavePromise = Promise.resolve(OS.onSheetSavedHook(state)).catch(function (err) {
          console.error("[onSheetSavedHook]", err);
        });
      }
      OS.setStatus("Salvo automaticamente", true);
      return true;
    } catch (err) {
      OS.setStatus("Erro ao salvar — armazenamento cheio?", false);
      console.error("localStorage:", err);
      return false;
    }
  };

  OS.scheduleSave = function () {
    if (OS.isReadOnlySheet) return;
    if (OS.saveTimer) clearTimeout(OS.saveTimer);
    OS.setStatus("Salvando…", false);
    OS.saveTimer = setTimeout(function () {
      OS.saveToStorage();
    }, OS.SAVE_DEBOUNCE_MS);
  };

  OS.loadFromStorage = function () {
    try {
      var raw = localStorage.getItem(OS.STORAGE_KEY);
      if (!raw) {
        OS.setStatus("Nova ficha — alterações serão salvas automaticamente", false);
        return;
      }
      var state = JSON.parse(raw);
      OS.applyState(state);
      OS.setStatus("Ficha carregada", true);
    } catch (err) {
      OS.setStatus("Erro ao carregar ficha salva", false);
      console.error("load:", err);
    }
  };

  OS.clearForm = function (options) {
    options = options || {};
    OS.damagedChambers = [];
    var isFree = !!options.freeEdit;
    if (OS.setFreeEditMode) {
      OS.setFreeEditMode(isFree);
    } else {
      OS.freeEdit = isFree;
    }
    if (!isFree) {
      OS.activeSheetTipo = null;
      OS.isBestiaryCustom = false;
    }
    OS.activeCharacterMesaId = null;

    OS.getFormElements().forEach(function (el) {
      if (el.type === "checkbox" || el.type === "radio") {
        el.checked = false;
      } else {
        el.value = "";
      }
    });
    if (OS.clearRollVisualState) OS.clearRollVisualState();
    OS.resetCylinderState();
    OS.hasPerformedInitialReload = true;
    OS.initialSkills = [];
    OS.firstPurchaseDiscountUsed = false;
    OS.fateTokens = { vermelha: 0, azul: 0, verde: 0, preta: 0 };
    if (OS.renderFateTokens) OS.renderFateTokens();
    var fb = OS.$("destino-feedback");
    if (fb) fb.textContent = "";
    var dinheiroEl = OS.$("dinheiro");
    if (dinheiroEl) dinheiroEl.value = isFree ? "" : "10";
    OS.activeConditions = [];
    OS._freeEditUploadSuffix = null;
    OS.characterPortraitUrl = "";
    if (OS.renderPortraitPreview) OS.renderPortraitPreview("");
    if (OS.setReadOnlyMode) OS.setReadOnlyMode(false);
    OS.sceneTerrorLevel = 0;
    OS.isVeterano = false;
    OS.isCriatura = null;
    OS.hasOwn6B = isFree ? false : null;
    OS.own6BCounts = OS.createEmptyOwn6BCounts ? OS.createEmptyOwn6BCounts() : { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0 };
    OS._own6BExplicit = false;
    OS.own6BValidationError = null;
    OS.own6BValidationCode = null;
    OS._loadedExtraChambers = null;
    OS._loadedHasTipoFicha = false;
    OS._loadedCreatureModeNullKeys = null;
    OS.downtimeWeeks = 0;
    OS.downtimeDays = 0;
    var sSlider = OS.$("scene-terror-slider");
    var sInp = OS.$("scene-terror-input");
    if (sSlider) sSlider.value = "0";
    if (sInp) sInp.value = "0";
    var calcDb = OS.$("test-calc-db");
    var calcMod = OS.$("test-calc-mod");
    if (calcDb) calcDb.value = "6";
    if (calcMod) calcMod.value = "0";
    var wEl = OS.$("downtime-weeks");
    var dEl = OS.$("downtime-days");
    if (wEl) wEl.value = "0";
    if (dEl) dEl.value = "0";
    if (OS.renderActiveConditions) OS.renderActiveConditions();
    if (OS.syncTerrorAndVeteranoUI) OS.syncTerrorAndVeteranoUI();
    if (OS.syncCriaturaModeUI) OS.syncCriaturaModeUI();
    if (OS.syncOwn6BEditorUI) OS.syncOwn6BEditorUI();
    if (OS.clearInventoryItems) OS.clearInventoryItems();
    if (OS.clearMagiasState) OS.clearMagiasState({ freeEdit: isFree });
    OS.activeBuffs = [];
    OS._pendingBuffDeactivations = {};
    if (OS.updateBuffButtonUI) OS.updateBuffButtonUI();
    if (!isFree && OS.updateStatsFields) OS.updateStatsFields(false);
    try {
      localStorage.removeItem(OS.STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    OS.setStatus("Ficha limpa", false);
  };

  OS.getCharacterState = function () {
    return OS.collectState ? OS.collectState() : (OS.activeCharacterState || {});
  };

  OS.saveCharacter = function () {
    return OS.saveToStorage ? OS.saveToStorage() : false;
  };
