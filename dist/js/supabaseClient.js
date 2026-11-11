/**
 * Instância única do client Supabase (anon key).
 * Reutilizada no login e no cadastro.
 */
import { OS } from "./app.js";
import "./supabaseConfig.js";

OS.getSupabaseClient = function () {
  if (OS._supabaseClient) return OS._supabaseClient;

  var url = String(OS.SUPABASE_URL || "").trim();
  var anonKey = String(OS.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) {
    console.error("[supabase] URL ou anon key ausentes em supabaseConfig.js");
    return null;
  }
  if (/service_role/i.test(anonKey)) {
    console.error("[supabase] service_role não pode ser usada no cliente");
    return null;
  }

  var lib = window.supabase;
  if (!lib || typeof lib.createClient !== "function") {
    console.error("[supabase] biblioteca não carregada");
    return null;
  }

  OS._supabaseClient = lib.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: {
        getItem: function (key) {
          return sessionStorage.getItem(key) || localStorage.getItem(key);
        },
        setItem: function (key, value) {
          var remember = OS.$("login-remember-me");
          var persistent = localStorage.getItem("oesteSombrioRememberMe") === "true";
          if (remember && OS._loginInProgress) persistent = remember.checked;
          var target = persistent ? localStorage : sessionStorage;
          var other = persistent ? sessionStorage : localStorage;
          other.removeItem(key);
          target.setItem(key, value);
        },
        removeItem: function (key) {
          sessionStorage.removeItem(key);
          localStorage.removeItem(key);
        }
      }
    }
  });
  return OS._supabaseClient;
};
