/** Verified Supabase session; local profile data never grants access. */
import { OS } from "./app.js";

let verifiedUser = null;
let expiresAt = 0;
let revision = 0;
let expiryTimer;

OS.isAuthenticated = function () {
  return !!verifiedUser && expiresAt > Date.now() / 1000;
};

OS.clearAuthSession = function () {
  revision++;
  verifiedUser = null;
  expiresAt = 0;
  clearTimeout(expiryTimer);
  OS.authSession = null;
  OS.activeCharacterFilename = null;
  OS.activeCharacterName = null;
  if (OS.saveTimer) clearTimeout(OS.saveTimer);
  if (OS.closeAllGmPopups) OS.closeAllGmPopups();
  if (OS.clearMesaNotes) OS.clearMesaNotes();
  clearInterval(OS.deliveryTimer);
  if (OS.activeMesaState) {
    OS.activeMesaState.tokenStatus = {};
    OS.activeMesaState.mesaId = null;
    OS.activeMesaState.currentUserId = null;
    OS.activeMesaState.isMestre = false;
  }
  if (OS.teardownMesaRealtimeChannel) {
    Promise.resolve(OS.teardownMesaRealtimeChannel()).catch(console.warn);
  }
  OS.showLoginScreen();
  var badge = OS.$("auth-user-display");
  if (badge) { badge.textContent = ""; badge.hidden = true; }
};

OS.verifyAuthSession = async function () {
  const current = ++revision;
  try {
    const client = OS.getSupabaseClient();
    if (!client) throw new Error("Supabase indisponível");
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw error || new Error("Sem sessão");
    const result = await client.auth.getUser();
    if (current !== revision) return false;
    const user = result.data && result.data.user;
    if (result.error || !user || user.is_anonymous || !user.email_confirmed_at ||
        user.id !== data.session.user.id) throw result.error || new Error("Sessão inválida");
    verifiedUser = user;
    expiresAt = data.session.expires_at || 0;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(function () { OS.verifyAuthSession(); },
      Math.max(0, expiresAt * 1000 - Date.now()));
    OS.authSession = {
      loggedIn: true, userId: user.id, email: user.email,
      username: user.email, loggedAt: new Date().toISOString()
    };
    return OS.isAuthenticated();
  } catch (error) {
    if (current === revision) OS.clearAuthSession();
    return false;
  }
};

OS.startAuthSession = async function () {
  OS.showLoginScreen();
  try { localStorage.removeItem(OS.AUTH_STORAGE_KEY); } catch (_) { /* legacy profile */ }
  const client = OS.getSupabaseClient();
  if (!client) return;
  if (!OS._authSubscription) {
    OS._authSubscription = client.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") OS.clearAuthSession();
      else if (["TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
        // Run outside the Auth callback lock.
        setTimeout(function () { OS.verifyAuthSession(); }, 0);
      }
    }).data.subscription;
  }
  if (await OS.verifyAuthSession()) {
    OS.showHomeScreen({ tab: "mesas" });
    if (OS.renderCharactersList) OS.renderCharactersList();
  }
};
