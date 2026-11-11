import { OS } from "./app.js";

OS.showMesaToast = function (message, error) {
  var host = document.getElementById("mesa-toast-host");
  if (!host) { host = document.createElement("div"); host.id = "mesa-toast-host"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  var toast = document.createElement("div"); toast.className = "mesa-toast" + (error ? " is-error" : ""); toast.textContent = message;
  host.appendChild(toast); setTimeout(function () { toast.remove(); }, error ? 9000 : 6000);
};
OS.sendCatalogItemToPlayer = async function (item, qty, fichaId, deliveryId) {
  var st = OS.activeMesaState;
  if (!st || !st.isMestre || !st.mesaId) throw Error("Apenas o Mestre pode enviar itens.");
  if (!(st.playerSheets || []).some(function (s) { return s.id === fichaId; })) throw Error("Selecione uma ficha da mesa.");
  var res = await OS.getSupabaseClient().rpc("enviar_item_para_jogador", {
    p_mesa_id: st.mesaId, p_ficha_id: fichaId, p_item_data: item, p_quantidade: qty, p_entrega_id: deliveryId
  });
  if (res.error) throw res.error;
  return res.data;
};
OS.processMesaDeliveries = function () {
  var st = OS.activeMesaState;
  if (!st || st.isMestre || !st.playerFichaId || !st.mesaId) return Promise.resolve();
  if (st.deliveryTask) return st.deliveryTask;
  var room = st.mesaId, ficha = st.playerFichaId, user = st.currentUserId;
  function current() { return st.mesaId === room && st.playerFichaId === ficha && st.currentUserId === user && !st.isMestre; }
  st.deliveryTask = (async function () {
    var client = OS.getSupabaseClient();
    var res = await client.from("itens_entregues_pendentes").select("*").eq("destinatario_user_id", user).eq("ficha_id", ficha).eq("entregue", false).order("created_at", { ascending: true });
    if (res.error) throw res.error;
    for (var delivery of res.data || []) {
      if (!current()) return;
      OS.receivedDeliveryIds = OS.receivedDeliveryIds || [];
      if (OS.receivedDeliveryIds.indexOf(delivery.id) < 0) {
        var item = OS.addInventoryItem(delivery.item_data, delivery.quantidade, delivery.item_data.group, delivery.item_data.listId, null, "solto");
        if (!item) throw Error("Não foi possível receber o item.");
        item.id = delivery.id;
        OS.receivedDeliveryIds.push(delivery.id);
        OS.renderInventory();
      }
      // Persist receipt and item together before acknowledging. Retries reuse the same item ID.
      if (!(await OS.saveActivePlayerMesaSheet())) throw Error("Não foi possível salvar a entrega. Ela será tentada novamente.");
      var ack = await client.rpc("confirmar_entrega_item", { p_entrega_id: delivery.id });
      if (ack.error) throw ack.error;
      if (current()) OS.showMesaToast("O Mestre concedeu a você: " + (delivery.item_data.nome || delivery.item_data.name) + " x" + delivery.quantidade + "!");
    }
  })().catch(function (error) {
    console.warn("[entregas]", error.message);
    if (current() && st.deliveryError !== error.message) OS.showMesaToast(error.message, true);
    st.deliveryError = error.message;
  }).finally(function () { st.deliveryTask = null; });
  return st.deliveryTask;
};
OS.subscribeMesaDeliveries = function (channel) {
  var st = OS.activeMesaState;
  if (st.isMestre) return;
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "itens_entregues_pendentes", filter: "destinatario_user_id=eq." + st.currentUserId }, function () {
    if (OS.activeMesaChannel === channel) OS.processMesaDeliveries();
  });
};
