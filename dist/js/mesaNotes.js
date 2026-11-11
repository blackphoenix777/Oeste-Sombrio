import { OS } from "./app.js";

var notebook = null;
function element(tag, cls, text) {
  var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el;
}
function button(text, action, title) {
  var b = element("button", "btn btn-secondary btn-small", text); b.type = "button"; b.title = title || text; b.addEventListener("click", action); return b;
}
function walk(items, fn) { items.forEach(function (n) { fn(n, items); if (n.tipo === "pasta") walk(n.itens, fn); }); }
function find(id) { var result; walk(notebook.tree, function (n, parent) { if (n.id === id) result = { node: n, parent: parent }; }); return result; }
function status(text, error) {
  if (!notebook) return;
  notebook.status = text;
  notebook.windows.forEach(function (w) { w.status.textContent = text; w.status.classList.toggle("is-error", !!error); });
  var s = document.getElementById("mesa-notes-status"); if (s) s.textContent = text;
}
function dirty() {
  notebook.edit++; clearTimeout(notebook.timer); status("🟡 Salvando...");
  notebook.timer = setTimeout(function () { OS.flushMesaNotes(); }, 1500);
}
OS.flushMesaNotes = async function () {
  var book = notebook;
  if (!book) return true;
  clearTimeout(book.timer);
  if (book.saving) { await book.saving; if (book.error) return false; return book === notebook && book.saved !== book.edit ? OS.flushMesaNotes() : true; }
  if (book.saved === book.edit) return !book.error;
  if (book.conflict) return false;
  book.saving = (async function () {
    var revision = book.edit, tree = JSON.parse(JSON.stringify(book.tree));
    try {
      var res = await OS.getSupabaseClient().from("mesas").update({ notas_mestre: tree })
        .eq("id", book.room).eq("notas_mestre_versao", book.version).select("notas_mestre_versao");
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) { book.conflict = true; throw Error("As notas mudaram em outra janela. Copie seu texto e use Recarregar."); }
      book.version = res.data[0].notas_mestre_versao; book.saved = revision; book.error = null;
      if (book === notebook) status(book.saved === book.edit ? "🟢 Salvo" : "🟡 Salvando...");
    } catch (error) {
      book.error = error.message;
      if (book === notebook) status("🔴 Erro ao salvar: " + error.message, true);
    }
  })();
  await book.saving; book.saving = null;
  if (book.error) return false;
  return book.saved !== book.edit ? OS.flushMesaNotes() : true;
};
function renderTree() {
  if (!notebook) return;
  var host = document.getElementById("mesa-notes-tree"), query = document.getElementById("mesa-notes-search").value.toLocaleLowerCase();
  host.replaceChildren();
  function matches(n) { return n.nome.toLocaleLowerCase().includes(query) || (n.tipo === "pasta" && n.itens.some(matches)); }
  function render(items, parent) {
    items.filter(matches).forEach(function (n) {
      var row = element("div", "mesa-note-tree-row"), shell = n.tipo === "pasta" ? element("details", "mesa-note-folder") : element("div");
      var label = n.tipo === "pasta" ? element("summary") : element("div");
      if (n.tipo === "pasta") {
        shell.open = !!query || notebook.expanded.has(n.id);
        var owner = notebook;
        shell.addEventListener("toggle", function () { if (notebook !== owner) return; if (shell.open) owner.expanded.add(n.id); else owner.expanded.delete(n.id); });
        label.appendChild(element("span", "mesa-note-name", "📁 " + n.nome));
      } else label.appendChild(button("📝 " + n.nome, function () { OS.openMesaNote(n.id); }, "Abrir " + n.nome));
      row.appendChild(label);
      if (n.tipo === "pasta") row.appendChild(button("+", function (e) { e.preventDefault(); chooseCreate(n.id); }, "Adicionar à pasta"));
      row.appendChild(button("✎", function (e) { e.preventDefault(); editName(n); }, "Renomear"));
      row.appendChild(button("×", function (e) { e.preventDefault(); removeNode(n); }, "Excluir"));
      if (n.tipo === "pasta") {
        // summary must be a direct child of details for native keyboard disclosure.
        label.appendChild(row.children[1]); label.appendChild(row.children[1]); label.appendChild(row.children[1]);
        shell.appendChild(label); var children = element("div", "mesa-note-children"); render(n.itens, children); shell.appendChild(children);
      } else shell.appendChild(row);
      parent.appendChild(shell);
    });
  }
  render(notebook.tree, host);
  if (!host.children.length) host.appendChild(element("p", "characters-empty", query ? "Nenhuma nota encontrada." : "Crie uma pasta ou nota para começar."));
}
function openDialog(title, initial, action, choice) {
  var d = document.getElementById("mesa-notes-dialog"); if (d) d.remove();
  d = element("dialog", "mesa-map-settings"); d.id = "mesa-notes-dialog"; d.appendChild(element("h3", "", title));
  var field = element("input"); field.maxLength = 120; field.value = initial || ""; field.placeholder = "Nome"; field.setAttribute("aria-label", "Nome");
  if (choice !== "delete") d.appendChild(field);
  var error = element("p", "mesa-notes-error"); d.appendChild(error);
  var actions = element("div", "mesa-map-settings-actions");
  actions.appendChild(button("Cancelar", function () { d.close(); d.remove(); }));
  actions.appendChild(button(choice === "delete" ? "Excluir" : "Salvar", async function () {
    if (choice !== "delete" && !field.value.trim()) { error.textContent = "Informe um nome."; return; }
    await action(field.value.trim()); d.close(); d.remove();
  })); d.appendChild(actions); document.body.appendChild(d); d.showModal(); field.focus();
}
function chooseCreate(parentId) {
  var d = element("dialog", "mesa-map-settings mesa-notes-dialog"); d.appendChild(element("h3", "", "Adicionar"));
  ["pasta", "arquivo"].forEach(function (kind) { d.appendChild(button(kind === "pasta" ? "Criar Pasta" : "Criar Nota de Texto", function () {
    d.close(); d.remove(); openDialog("Nome da " + (kind === "pasta" ? "pasta" : "nota"), "", function (name) { OS.createMesaNote(kind, name, parentId); });
  })); });
  d.appendChild(button("Cancelar", function () { d.close(); d.remove(); })); document.body.appendChild(d); d.showModal();
}
OS.createMesaNote = function (kind, name, parentId) {
  if (!notebook || !OS.activeMesaState.isMestre) return;
  var parent = parentId && find(parentId), list = parent ? parent.node.itens : notebook.tree;
  var node = { id: crypto.randomUUID(), tipo: kind, nome: name.trim().slice(0, 120) };
  if (kind === "pasta") node.itens = []; else node.conteudo = "";
  list.push(node); if (parentId) notebook.expanded.add(parentId); dirty(); renderTree();
  if (kind === "arquivo") OS.openMesaNote(node.id);
  return node.id;
};
function editName(n) { openDialog("Renomear", n.nome, function (name) {
  n.nome = name; var w = notebook.windows.get(n.id); if (w) w.title.value = name; dirty(); renderTree();
}); }
function removeNode(n) { openDialog("Excluir “" + n.nome + "”" + (n.tipo === "pasta" ? " e todo o conteúdo?" : "?"), "", function () {
  var ids = [n.id]; if (n.itens) walk(n.itens, function (child) { ids.push(child.id); });
  ids.forEach(function (id) { var w = notebook.windows.get(id); if (w) w.el.remove(); notebook.windows.delete(id); });
  var found = find(n.id); found.parent.splice(found.parent.indexOf(n), 1); dirty(); renderTree();
}, "delete"); }
function clampWindow(el, x, y) {
  el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, x)) + "px";
  el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, y)) + "px";
}
OS.openMesaNote = function (id) {
  if (!notebook || !OS.activeMesaState.isMestre) return;
  var found = find(id); if (!found || found.node.tipo !== "arquivo") return;
  var existing = notebook.windows.get(id); if (existing) { existing.el.classList.remove("is-minimized"); existing.el.style.zIndex = ++notebook.z; return; }
  var node = found.node, el = element("section", "mesa-floating-popup mesa-note-popup"); el.dataset.noteId = id;
  var header = element("div", "mesa-floating-popup-header"), title = element("input", "mesa-note-title");
  title.value = node.nome; title.maxLength = 120; title.setAttribute("aria-label", "Título da nota"); header.appendChild(title);
  header.appendChild(button("−", function () { el.classList.toggle("is-minimized"); clampWindow(el, el.offsetLeft, el.offsetTop); }, "Minimizar / restaurar"));
  header.appendChild(button("×", async function () { if (await OS.flushMesaNotes()) { notebook.windows.delete(id); el.remove(); } }, "Salvar e fechar"));
  el.appendChild(header);
  var textarea = element("textarea", "mesa-note-textarea"); textarea.value = node.conteudo; textarea.setAttribute("aria-label", "Conteúdo da nota"); el.appendChild(textarea);
  var footer = element("footer", "mesa-note-save-status", notebook.status || "🟢 Salvo"); el.appendChild(footer);
  title.addEventListener("input", function () { node.nome = title.value.trim() || "Sem título"; dirty(); renderTree(); });
  textarea.addEventListener("input", function () { node.conteudo = textarea.value; dirty(); });
  var drag = null;
  header.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || event.target.closest("input,textarea,button,select,[contenteditable]")) return;
    drag = { id: event.pointerId, x: event.clientX - el.offsetLeft, y: event.clientY - el.offsetTop }; header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", function (event) { if (drag && drag.id === event.pointerId) clampWindow(el, event.clientX - drag.x, event.clientY - drag.y); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) { header.addEventListener(name, function () { drag = null; }); });
  el.addEventListener("pointerdown", function () { el.style.zIndex = ++notebook.z; });
  document.getElementById("mesa-notes-popups").appendChild(el);
  clampWindow(el, 40 + notebook.windows.size * 24, 100 + notebook.windows.size * 24);
  notebook.windows.set(id, { el: el, title: title, status: footer }); textarea.focus();
};
OS.initMesaNotes = function () {
  OS.clearMesaNotes();
  var st = OS.activeMesaState; if (!st.isMestre) return;
  notebook = { room: st.mesaId, tree: JSON.parse(JSON.stringify(st.mesa.notas_mestre || [])), version: st.mesa.notas_mestre_versao || 1, edit: 0, saved: 0, expanded: new Set(), windows: new Map(), z: 130 };
  var tab = button("📝 Notas", function () { OS.switchMesaSidebarTab("notes"); }); tab.id = "btn-mesa-tab-notes"; tab.className = "mesa-sidebar-tab-btn"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", "false");
  document.querySelector(".mesa-sidebar-tabs").appendChild(tab);
  var panel = element("div", "mesa-sidebar-panel"); panel.id = "mesa-sidebar-panel-notes"; panel.hidden = true;
  var toolbar = element("div", "mesa-notes-toolbar"), search = element("input"); search.id = "mesa-notes-search"; search.type = "search"; search.placeholder = "Buscar notas…"; search.setAttribute("aria-label", "Buscar notas"); search.addEventListener("input", renderTree);
  toolbar.appendChild(search); toolbar.appendChild(button("+", function () { chooseCreate(null); }, "Criar pasta ou nota")); panel.appendChild(toolbar);
  var feedback = element("p", "mesa-note-save-status", "🟢 Salvo"); feedback.id = "mesa-notes-status"; panel.appendChild(feedback);
  panel.appendChild(button("Tentar salvar", function () { OS.flushMesaNotes(); }));
  panel.appendChild(button("Recarregar", function () {
    openDialog("Descartar alterações locais e recarregar notas?", "", async function () {
      var res = await OS.getSupabaseClient().from("mesas").select("notas_mestre,notas_mestre_versao").eq("id", st.mesaId).single();
      if (res.error) { status("🔴 " + res.error.message, true); return; }
      Object.assign(st.mesa, res.data); OS.initMesaNotes(); OS.switchMesaSidebarTab("notes");
    }, "delete");
  }));
  var tree = element("div"); tree.id = "mesa-notes-tree"; panel.appendChild(tree); document.getElementById("mesa-sidebar-feed").appendChild(panel);
  var layer = element("div", "mesa-floating-popups-layer"); layer.id = "mesa-notes-popups"; document.body.appendChild(layer); renderTree();
};
OS.clearMesaNotes = function () {
  if (notebook) clearTimeout(notebook.timer);
  notebook = null;
  document.querySelectorAll(".mesa-notes-dialog").forEach(function (el) { el.remove(); });
  ["btn-mesa-tab-notes", "mesa-sidebar-panel-notes", "mesa-notes-popups", "mesa-notes-dialog"].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
};
window.addEventListener("resize", function () { if (notebook) notebook.windows.forEach(function (w) { clampWindow(w.el, w.el.offsetLeft, w.el.offsetTop); }); });
window.addEventListener("beforeunload", function (e) { if (notebook && notebook.saved !== notebook.edit) { OS.flushMesaNotes(); e.preventDefault(); e.returnValue = ""; } });
