export const $ = (id) => document.getElementById(id);

export const escapeHTML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer;
export function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast show" + (error ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), error ? 8000 : 3200);
}

export function askName(title, value) {
  const dialog = $("nameDialog");
  $("nameTitle").textContent = title;
  $("nameInput").value = value;
  dialog.returnValue = "";
  dialog.showModal();
  $("nameInput").select();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "ok" ? $("nameInput").value.trim() || "名称未設定" : null),
      { once: true },
    ),
  );
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const toBlob = (canvas) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(Error("画像を作れませんでした。"))), "image/png"));

// Close any open <details class="menu"> when clicking elsewhere.
export function initMenus() {
  document.addEventListener("click", (e) => {
    for (const menu of document.querySelectorAll("details.menu[open]"))
      if (!menu.contains(e.target)) menu.open = false;
  });
}
