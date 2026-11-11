/**
 * Fluxo de Autenticação e Cadastro de Conta via Supabase Auth.
 * Reutiliza a instância única de OS.getSupabaseClient() (anon key).
 */
import { OS } from "./app.js";
import "./supabaseClient.js";
import "./authSession.js";

OS.AUTH_STORAGE_KEY = "oesteSombrioAuthSession_v1";
OS.KNOWN_SIGNUP_EMAILS_KEY = "oesteSombrioSignupEmails_v1";

// Regex obrigatória de validação de senha (mín. 8 chars, 1 minúscula, 1 maiúscula, 1 número e 1 especial)
OS.SIGNUP_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
// Validação básica de formato de e-mail
OS.SIGNUP_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

OS.authSession = null;

var isSignupSubmitting = false;
var signupFeedbackSource = ""; // "live" | "submit" | ""
var knownRegisteredEmailsMemory = {};

function normalizeEmail(raw) {
  return String(raw === null || raw === undefined ? "" : raw).trim().toLowerCase();
}

OS._isEmailKnownRegistered = function (emailRaw) {
  var email = normalizeEmail(emailRaw);
  if (!email) return false;
  if (knownRegisteredEmailsMemory[email]) return true;
  try {
    var raw = localStorage.getItem(OS.KNOWN_SIGNUP_EMAILS_KEY);
    if (raw) {
      var map = JSON.parse(raw);
      if (map && map[email]) return true;
    }
  } catch (err) {
    /* ignore */
  }
  return false;
};

OS._markEmailRegistered = function (emailRaw) {
  var email = normalizeEmail(emailRaw);
  if (!email) return;
  knownRegisteredEmailsMemory[email] = true;
  try {
    var raw = localStorage.getItem(OS.KNOWN_SIGNUP_EMAILS_KEY);
    var map = raw ? JSON.parse(raw) : {};
    if (!map || typeof map !== "object") map = {};
    map[email] = true;
    localStorage.setItem(OS.KNOWN_SIGNUP_EMAILS_KEY, JSON.stringify(map));
  } catch (err) {
    /* ignore */
  }
};

OS._unmarkEmailRegistered = function (emailRaw) {
  var email = normalizeEmail(emailRaw);
  if (!email) return;
  delete knownRegisteredEmailsMemory[email];
  try {
    var raw = localStorage.getItem(OS.KNOWN_SIGNUP_EMAILS_KEY);
    if (raw) {
      var map = JSON.parse(raw);
      if (map && typeof map === "object") {
        delete map[email];
        localStorage.setItem(OS.KNOWN_SIGNUP_EMAILS_KEY, JSON.stringify(map));
      }
    }
  } catch (err) {
    /* ignore */
  }
};

OS.loadRememberedAuthSession = function () { return OS.verifyAuthSession(); };

function updateLoggedUserBadge() {
  var badge = OS.$("auth-user-display");
  if (!badge) return;
  if (OS.isAuthenticated()) {
    badge.textContent = "Usuário: " + (OS.authSession.email || OS.authSession.username);
    badge.hidden = false;
    badge.removeAttribute("hidden");
  } else {
    badge.textContent = "";
    badge.hidden = true;
    badge.setAttribute("hidden", "");
  }
}

function setAuthFeedback(elId, message, type) {
  var el = OS.$(elId);
  if (!el) return;
  el.classList.remove("auth-feedback-error", "auth-feedback-success");
  if (!message) {
    el.textContent = "";
    el.hidden = true;
    el.setAttribute("hidden", "");
    return;
  }
  el.textContent = message;
  if (type === "error") {
    el.classList.add("auth-feedback-error");
  } else if (type === "success") {
    el.classList.add("auth-feedback-success");
  }
  el.hidden = false;
  el.removeAttribute("hidden");
}

function isNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!err) return false;
  var msg = String(err.message || err.error_description || err.name || err || "");
  return /failed to fetch|networkerror|fetcherror|load failed|network request failed|err_internet_disconnected|offline/i.test(msg);
}

OS.hideAuthScreens = function () {
  var loginEl = OS.$("login-screen");
  var recoveryEl = OS.$("recovery-screen");
  if (loginEl) loginEl.style.display = "none";
  if (recoveryEl) recoveryEl.style.display = "none";
};

OS.showLoginScreen = function (options) {
  options = options || {};
  var loginEl = OS.$("login-screen");
  var recoveryEl = OS.$("recovery-screen");
  var homeEl = OS.$("home-screen");
  var mesaEl = OS.$("mesa-screen");
  var fichaEl = OS.$("ficha");
  var toolbarEl = document.querySelector(".toolbar");

  if (OS.restoreFichaToHomeSlot) OS.restoreFichaToHomeSlot();
  if (homeEl) homeEl.style.display = "none";
  if (mesaEl) mesaEl.style.display = "none";
  if (fichaEl) fichaEl.style.display = "none";
  if (toolbarEl) toolbarEl.style.display = "none";
  if (recoveryEl) recoveryEl.style.display = "none";
  if (loginEl) loginEl.style.display = "";

  if (!options.keepFeedback) {
    setAuthFeedback("login-feedback", "", "");
  }
};

OS.showPasswordRecoveryScreen = function () {
  var loginEl = OS.$("login-screen");
  var recoveryEl = OS.$("recovery-screen");
  var homeEl = OS.$("home-screen");
  var mesaEl = OS.$("mesa-screen");
  var fichaEl = OS.$("ficha");
  var toolbarEl = document.querySelector(".toolbar");

  if (OS.restoreFichaToHomeSlot) OS.restoreFichaToHomeSlot();
  if (homeEl) homeEl.style.display = "none";
  if (mesaEl) mesaEl.style.display = "none";
  if (fichaEl) fichaEl.style.display = "none";
  if (toolbarEl) toolbarEl.style.display = "none";
  if (loginEl) loginEl.style.display = "none";
  if (recoveryEl) recoveryEl.style.display = "";

  var inputEl = OS.$("recovery-identifier");
  if (inputEl) inputEl.value = "";
  setAuthFeedback("recovery-feedback", "", "");
};

/**
 * Avalia os requisitos de senha, e-mail e confirmação de senha do modal de Cadastro.
 */
OS.evaluateSignupValidation = function (emailRaw, passwordRaw, confirmRaw) {
  var email = String(emailRaw === null || emailRaw === undefined ? "" : emailRaw).trim();
  var password = String(passwordRaw === null || passwordRaw === undefined ? "" : passwordRaw);
  var confirm = String(confirmRaw === null || confirmRaw === undefined ? "" : confirmRaw);

  var rules = {
    length: password.length >= 8,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: password.length > 0 && confirm.length > 0 && password === confirm
  };

  var passwordRegexOk = OS.SIGNUP_PASSWORD_REGEX.test(password);
  var emailOk = OS.SIGNUP_EMAIL_REGEX.test(email);
  var mismatchActive = confirm.length > 0 && password !== confirm;

  var missingPasswordLabels = [];
  if (!rules.length) missingPasswordLabels.push("mínimo de 8 caracteres");
  if (!rules.lower) missingPasswordLabels.push("letra minúscula");
  if (!rules.upper) missingPasswordLabels.push("letra maiúscula");
  if (!rules.number) missingPasswordLabels.push("número");
  if (!rules.special) missingPasswordLabels.push("caractere especial");

  return {
    email: email,
    password: password,
    confirm: confirm,
    rules: rules,
    passwordRegexOk: passwordRegexOk,
    emailOk: emailOk,
    mismatchActive: mismatchActive,
    missingPasswordLabels: missingPasswordLabels,
    allValid: emailOk && passwordRegexOk && rules.match
  };
};

var RULE_LABELS = {
  length: "mínimo de 8 caracteres",
  lower: "letra minúscula",
  upper: "letra maiúscula",
  number: "número",
  special: "caractere especial",
  match: "senhas iguais"
};

/**
 * Atualiza o checklist visual de requisitos e o estado do botão "Cadastrar" conforme o usuário digita/cola.
 */
OS.updateSignupValidationUI = function (options) {
  options = options || {};
  var emailInp = OS.$("signup-email");
  var passInp = OS.$("signup-password");
  var confInp = OS.$("signup-password-confirm");
  var submitBtn = OS.$("signup-submit");
  var checklistEl = OS.$("signup-checklist");

  var state = OS.evaluateSignupValidation(
    emailInp ? emailInp.value : "",
    passInp ? passInp.value : "",
    confInp ? confInp.value : ""
  );

  if (checklistEl) {
    Object.keys(RULE_LABELS).forEach(function (ruleKey) {
      var li = checklistEl.querySelector('[data-rule="' + ruleKey + '"]');
      if (!li) return;
      var ok = !!state.rules[ruleKey];
      li.textContent = (ok ? "✓ " : "✗ ") + RULE_LABELS[ruleKey];
      li.classList.toggle("is-valid", ok);
      li.classList.toggle("is-invalid", !ok);
    });
  }

  if (submitBtn) {
    submitBtn.disabled = !state.allValid || isSignupSubmitting;
  }

  // Edge case: usuário cola/digita a confirmação diferente da senha — avisa imediatamente sem esperar clique no botão
  if (state.mismatchActive) {
    signupFeedbackSource = "live";
    setAuthFeedback(
      "signup-feedback",
      "As senhas não coincidem. Os dois campos de senha precisam ser idênticos.",
      "error"
    );
  } else if (
    (options.showMissingOnAttempt || (state.confirm.length > 0 && state.password.length > 0)) &&
    !state.passwordRegexOk &&
    state.missingPasswordLabels.length > 0
  ) {
    signupFeedbackSource = "live";
    setAuthFeedback(
      "signup-feedback",
      "Senha inválida — falta atender: " + state.missingPasswordLabels.join(", ") + ".",
      "error"
    );
  } else if (options.showMissingOnAttempt && !state.emailOk) {
    signupFeedbackSource = "live";
    setAuthFeedback("signup-feedback", "Informe um endereço de e-mail válido.", "error");
  } else if (signupFeedbackSource === "live") {
    signupFeedbackSource = "";
    setAuthFeedback("signup-feedback", "", "");
  }

  return state;
};

OS.openSignupModal = function () {
  var modal = OS.$("signup-modal");
  if (!modal) return;
  var emailInp = OS.$("signup-email");
  var passInp = OS.$("signup-password");
  var confInp = OS.$("signup-password-confirm");

  isSignupSubmitting = false;
  signupFeedbackSource = "";
  if (emailInp) emailInp.value = "";
  if (passInp) passInp.value = "";
  if (confInp) confInp.value = "";
  setAuthFeedback("signup-feedback", "", "");
  OS.updateSignupValidationUI();

  modal.classList.add("open");
  if (emailInp) {
    setTimeout(function () {
      emailInp.focus();
    }, 20);
  }
};

OS.closeSignupModal = function () {
  var modal = OS.$("signup-modal");
  if (!modal) return;
  modal.classList.remove("open");
};

OS.openSignupConfirmModal = function (email) {
  OS.closeSignupModal();
  var confirmModal = OS.$("signup-confirm-modal");
  var subEl = OS.$("signup-confirm-sub");
  if (subEl) {
    var addr = String(email || "").trim();
    subEl.textContent = addr
      ? "Confirme seu e-mail para continuar. Enviamos um link de confirmação para " +
        addr +
        ". Você só poderá entrar depois de confirmar."
      : "Confirme seu e-mail para continuar. Enviamos um link de confirmação para o endereço cadastrado. Você só poderá entrar depois de confirmar.";
  }
  if (confirmModal) {
    confirmModal.classList.add("open");
  }
};

OS.closeSignupConfirmModal = function () {
  var confirmModal = OS.$("signup-confirm-modal");
  if (confirmModal) {
    confirmModal.classList.remove("open");
  }
  OS.authSession = null;
  updateLoggedUserBadge();
  OS.showLoginScreen({ keepFeedback: false });
};

/**
 * Envia o cadastro para o Supabase Auth via supabase.auth.signUp({ email, password }).
 */
OS.submitSignup = async function () {
  if (isSignupSubmitting) return false;

  var state = OS.updateSignupValidationUI({ showMissingOnAttempt: true });
  if (!state.allValid) {
    return false;
  }

  var client = OS.getSupabaseClient();
  if (!client) {
    signupFeedbackSource = "submit";
    setAuthFeedback(
      "signup-feedback",
      "Cliente do Supabase não configurado. Verifique supabaseConfig.js.",
      "error"
    );
    return false;
  }

  var submitBtn = OS.$("signup-submit");
  var emailWasAlreadyKnown = OS._isEmailKnownRegistered(state.email);

  isSignupSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Cadastrando...";
  }
  signupFeedbackSource = "";
  setAuthFeedback("signup-feedback", "", "");

  try {
    var result = await client.auth.signUp({
      email: state.email,
      password: state.password
    });

    var data = result ? result.data : null;
    var error = result ? result.error : null;

    if (error) {
      var errMsg = String(error.message || error.error_description || "");
      var errCode = String(error.code || "");

      if (isNetworkError(error)) {
        signupFeedbackSource = "submit";
        setAuthFeedback(
          "signup-feedback",
          "Erro de rede ao realizar o cadastro. Verifique sua conexão e tente novamente.",
          "error"
        );
        return false;
      }

      if (
        /user_already_exists|email_exists|already registered|already been registered|already exists|duplicate key|usuarios_username_key|usuarios_email_key/i.test(
          errMsg + " " + errCode
        ) ||
        (emailWasAlreadyKnown &&
          /over_email_send_rate_limit|security purposes|only request this after|rate limit|error sending confirmation email|unexpected_failure/i.test(
            errMsg + " " + errCode
          ))
      ) {
        OS._markEmailRegistered(state.email);
        signupFeedbackSource = "submit";
        setAuthFeedback(
          "signup-feedback",
          "Este e-mail já está cadastrado. Verifique sua caixa de entrada para confirmar a conta ou faça login.",
          "error"
        );
        return false;
      }

      if (/weak_password|password.*weak|password.*short|password.*characters|senha/i.test(errMsg + " " + errCode)) {
        signupFeedbackSource = "submit";
        setAuthFeedback(
          "signup-feedback",
          "A senha foi recusada pelo servidor por ser muito fraca. Revise os requisitos.",
          "error"
        );
        return false;
      }

      if (/over_email_send_rate_limit|rate limit|security purposes/i.test(errMsg + " " + errCode)) {
        signupFeedbackSource = "submit";
        setAuthFeedback(
          "signup-feedback",
          "Muitas tentativas de envio de e-mail em sequência. Aguarde alguns instantes e tente novamente.",
          "error"
        );
        return false;
      }

      if (/error sending confirmation email|confirmation email/i.test(errMsg)) {
        signupFeedbackSource = "submit";
        setAuthFeedback(
          "signup-feedback",
          "Não foi possível enviar o e-mail de confirmação para este endereço (verifique o endereço ou a configuração SMTP do servidor).",
          "error"
        );
        return false;
      }

      signupFeedbackSource = "submit";
      setAuthFeedback(
        "signup-feedback",
        errMsg || "Não foi possível concluir o cadastro. Tente novamente.",
        "error"
      );
      return false;
    }

    // Quando "Confirm email" está ativo, o Supabase retorna identities: [] para e-mails já cadastrados,
    // ou retorna o registro existente cujo created_at é anterior à tentativa atual.
    var user = data && data.user ? data.user : null;
    var emptyIdentities = !!(user && Array.isArray(user.identities) && user.identities.length === 0);
    var createdMs = user && user.created_at ? Date.parse(user.created_at) : NaN;
    var updatedMs =
      user && (user.updated_at || user.confirmation_sent_at)
        ? Date.parse(user.updated_at || user.confirmation_sent_at)
        : NaN;
    var preExistingUserTimestamp =
      (!isNaN(createdMs) && !isNaN(updatedMs) && Math.abs(updatedMs - createdMs) > 2500) ||
      (!isNaN(createdMs) && Date.now() - createdMs > 15000);

    if (emptyIdentities || preExistingUserTimestamp || emailWasAlreadyKnown) {
      OS._markEmailRegistered(state.email);
      signupFeedbackSource = "submit";
      setAuthFeedback(
        "signup-feedback",
        "Este e-mail já está cadastrado. Verifique sua caixa de entrada para confirmar a conta ou faça login.",
        "error"
      );
      return false;
    }

    // Garantir que nenhuma sessão automática fique ativa antes da confirmação do e-mail
    if (data && data.session) {
      try {
        await client.auth.signOut();
      } catch (signOutErr) {
        /* ignore */
      }
    }
    OS.authSession = null;
    OS._markEmailRegistered(state.email);

    // Sucesso: fecha modal de Cadastro e abre imediatamente o modal "Confirme seu e-mail"
    OS.openSignupConfirmModal(state.email);
    return true;
  } catch (err) {
    signupFeedbackSource = "submit";
    if (isNetworkError(err)) {
      setAuthFeedback(
        "signup-feedback",
        "Erro de rede ao realizar o cadastro. Verifique sua conexão e tente novamente.",
        "error"
      );
    } else {
      setAuthFeedback(
        "signup-feedback",
        "Ocorreu um erro ao comunicar com o servidor. Tente novamente.",
        "error"
      );
    }
    return false;
  } finally {
    isSignupSubmitting = false;
    if (submitBtn) {
      submitBtn.textContent = "Cadastrar";
    }
    OS.updateSignupValidationUI();
  }
};

/**
 * Realiza login via Supabase Auth (supabase.auth.signInWithPassword) reutilizando o mesmo client.
 * Trata especificamente "Email not confirmed" com a mensagem amigável "Confirme seu e-mail antes de entrar".
 */
OS.attemptLocalLogin = async function (usernameRaw, passwordRaw, rememberMe) {
  var email = String(usernameRaw === null || usernameRaw === undefined ? "" : usernameRaw).trim();
  var password = String(passwordRaw === null || passwordRaw === undefined ? "" : passwordRaw);

  if (!email || !password) {
    setAuthFeedback("login-feedback", "Informe seu e-mail e sua senha.", "error");
    return false;
  }

  var client = OS.getSupabaseClient();
  if (!client) {
    setAuthFeedback("login-feedback", "Cliente do Supabase não configurado.", "error");
    return false;
  }

  var loginBtn = OS.$("btn-login-submit");
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = "Entrando...";
  }
  setAuthFeedback("login-feedback", "", "");

  try {
    OS._loginInProgress = true;
    localStorage.setItem("oesteSombrioRememberMe", rememberMe ? "true" : "false");
    var result = await client.auth.signInWithPassword({
      email: email,
      password: password
    });

    var data = result ? result.data : null;
    var error = result ? result.error : null;

    if (error) {
      OS.authSession = null;
      var errMsg = String(error.message || error.error_description || "");
      var errCode = String(error.code || "");

      if (/email_not_confirmed|email not confirmed|not confirmed/i.test(errMsg + " " + errCode)) {
        OS._markEmailRegistered(email);
        setAuthFeedback("login-feedback", "Confirme seu e-mail antes de entrar.", "error");
        return false;
      }

      if (isNetworkError(error)) {
        setAuthFeedback(
          "login-feedback",
          "Não foi possível conectar. Verifique sua internet e tente novamente.",
          "error"
        );
        return false;
      }

      if (/invalid login credentials|invalid_credentials|invalid email or password/i.test(errMsg + " " + errCode)) {
        setAuthFeedback("login-feedback", "E-mail ou senha incorretos.", "error");
        return false;
      }

      setAuthFeedback("login-feedback", errMsg || "Não foi possível entrar.", "error");
      return false;
    }

    var user = data && data.user ? data.user : null;
    if (!user) {
      OS.authSession = null;
      setAuthFeedback("login-feedback", "Não foi possível validar sua sessão.", "error");
      return false;
    }

    // Caso extra de segurança se o servidor retornar usuário sem email_confirmed_at
    if (!user.email_confirmed_at && !user.confirmed_at) {
      try {
        await client.auth.signOut();
      } catch (e) {
        /* ignore */
      }
      OS.authSession = null;
      setAuthFeedback("login-feedback", "Confirme seu e-mail antes de entrar.", "error");
      return false;
    }

    if (!(await OS.verifyAuthSession())) {
      setAuthFeedback("login-feedback", "Não foi possível validar a sessão. Tente novamente.", "error");
      return false;
    }

    var passInput = OS.$("login-password");
    if (passInput) passInput.value = "";
    setAuthFeedback("login-feedback", "", "");
    updateLoggedUserBadge();

    OS.showHomeScreen({ tab: "mesas" });
    if (OS.renderCharactersList) {
      OS.renderCharactersList();
    }
    return true;
  } catch (err) {
    OS.authSession = null;
    if (isNetworkError(err)) {
      setAuthFeedback(
        "login-feedback",
        "Não foi possível conectar. Verifique sua internet e tente novamente.",
        "error"
      );
    } else {
      setAuthFeedback("login-feedback", "Erro ao realizar login. Tente novamente.", "error");
    }
    return false;
  } finally {
    OS._loginInProgress = false;
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    }
  }
};

OS.attemptLogin = OS.attemptLocalLogin;

/**
 * Recuperação de senha via Supabase Auth (resetPasswordForEmail).
 */
OS.submitPasswordRecovery = async function (identifierRaw) {
  var identifier = String(identifierRaw === null || identifierRaw === undefined ? "" : identifierRaw).trim();
  if (!identifier) {
    setAuthFeedback("recovery-feedback", "Informe seu e-mail cadastrado.", "error");
    return false;
  }
  if (!OS.SIGNUP_EMAIL_REGEX.test(identifier)) {
    setAuthFeedback("recovery-feedback", "Informe um endereço de e-mail válido.", "error");
    return false;
  }

  var client = OS.getSupabaseClient();
  if (!client) {
    setAuthFeedback("recovery-feedback", "Cliente do Supabase não configurado.", "error");
    return false;
  }

  try {
    var result = await client.auth.resetPasswordForEmail(identifier);
    if (result && result.error) {
      if (isNetworkError(result.error)) {
        setAuthFeedback(
          "recovery-feedback",
          "Não foi possível conectar. Verifique sua internet.",
          "error"
        );
        return false;
      }
    }
    setAuthFeedback(
      "recovery-feedback",
      "Se esse e-mail estiver cadastrado, enviaremos as instruções de redefinição.",
      "success"
    );
    return true;
  } catch (err) {
    setAuthFeedback(
      "recovery-feedback",
      "Não foi possível conectar. Verifique sua internet.",
      "error"
    );
    return false;
  }
};

/**
 * Encerra a sessão no Supabase Auth e retorna para a tela de Login.
 */
OS.logoutLocalSession = async function () {
  if (OS.flushMesaNotes && !(await OS.flushMesaNotes())) return false;
  if (OS.activeMesaState && OS.activeMesaState.deliveryTask) await OS.activeMesaState.deliveryTask;
  try {
    if (OS.activeCharacterFilename && OS.persistActiveCharacter) {
      await OS.persistActiveCharacter();
      if (OS.saveToStorage) OS.saveToStorage();
    }
  } catch (err) {
    console.error("[authUI] Erro ao salvar personagem ativo antes de sair:", err);
  }

  try {
    var client = OS.getSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  } catch (err) {
    console.warn("[authUI] Aviso ao encerrar sessão no Supabase:", err);
  }

  OS.clearAuthSession();
  if (OS.clearRollVisualState) OS.clearRollVisualState();
  OS.activeCharacterFilename = null;
  OS.activeCharacterName = null;
  OS.authSession = null;

  try {
    localStorage.removeItem(OS.AUTH_STORAGE_KEY);
  } catch (err) {
    /* ignore */
  }

  var userInp = OS.$("login-username");
  var passInp = OS.$("login-password");
  var remCb = OS.$("login-remember-me");
  if (userInp) userInp.value = "";
  if (passInp) passInp.value = "";
  if (remCb) remCb.checked = false;

  OS.activeHomeTab = "mesas";
  updateLoggedUserBadge();
  OS.showLoginScreen();
};

/**
 * Gate inicial chamado no boot do aplicativo (OS.init).
 */
OS.initAuthGate = OS.startAuthSession;

OS.bindAuthEvents = function () {
  var loginForm = OS.$("login-form");
  if (loginForm && !loginForm._bound) {
    loginForm._bound = true;
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var userInp = OS.$("login-username");
      var passInp = OS.$("login-password");
      var remCb = OS.$("login-remember-me");
      OS.attemptLocalLogin(
        userInp ? userInp.value : "",
        passInp ? passInp.value : "",
        !!(remCb && remCb.checked)
      );
    });
  }

  var btnOpenSignup = OS.$("btn-open-signup");
  if (btnOpenSignup && !btnOpenSignup._bound) {
    btnOpenSignup._bound = true;
    btnOpenSignup.addEventListener("click", function () {
      OS.openSignupModal();
    });
  }

  var signupForm = OS.$("signup-form");
  if (signupForm && !signupForm._bound) {
    signupForm._bound = true;
    signupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      OS.submitSignup();
    });
  }

  ["signup-email", "signup-password", "signup-password-confirm"].forEach(function (fieldId) {
    var inp = OS.$(fieldId);
    if (inp && !inp._bound) {
      inp._bound = true;
      var onFieldUpdate = function () {
        if (signupFeedbackSource === "submit") {
          signupFeedbackSource = "";
          setAuthFeedback("signup-feedback", "", "");
        }
        OS.updateSignupValidationUI();
      };
      inp.addEventListener("input", onFieldUpdate);
      inp.addEventListener("change", onFieldUpdate);
      inp.addEventListener("paste", function () {
        setTimeout(onFieldUpdate, 0);
      });
    }
  });

  var btnSignupCancel = OS.$("signup-cancel");
  if (btnSignupCancel && !btnSignupCancel._bound) {
    btnSignupCancel._bound = true;
    btnSignupCancel.addEventListener("click", function () {
      OS.closeSignupModal();
    });
  }

  var btnConfirmClose = OS.$("signup-confirm-close");
  if (btnConfirmClose && !btnConfirmClose._bound) {
    btnConfirmClose._bound = true;
    btnConfirmClose.addEventListener("click", function () {
      OS.closeSignupConfirmModal();
    });
  }

  var btnForgot = OS.$("btn-forgot-password");
  if (btnForgot && !btnForgot._bound) {
    btnForgot._bound = true;
    btnForgot.addEventListener("click", function () {
      OS.showPasswordRecoveryScreen();
    });
  }

  var recoveryForm = OS.$("recovery-form");
  if (recoveryForm && !recoveryForm._bound) {
    recoveryForm._bound = true;
    recoveryForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var idInp = OS.$("recovery-identifier");
      OS.submitPasswordRecovery(idInp ? idInp.value : "");
    });
  }

  var btnBackLogin = OS.$("btn-back-to-login");
  if (btnBackLogin && !btnBackLogin._bound) {
    btnBackLogin._bound = true;
    btnBackLogin.addEventListener("click", function () {
      OS.showLoginScreen();
    });
  }

  var btnLogoutHome = OS.$("btn-logout-home");
  if (btnLogoutHome && !btnLogoutHome._bound) {
    btnLogoutHome._bound = true;
    btnLogoutHome.addEventListener("click", function () {
      OS.logoutLocalSession();
    });
  }

  var btnLogoutToolbar = OS.$("btn-logout-toolbar");
  if (btnLogoutToolbar && !btnLogoutToolbar._bound) {
    btnLogoutToolbar._bound = true;
    btnLogoutToolbar.addEventListener("click", function () {
      OS.logoutLocalSession();
    });
  }
};
