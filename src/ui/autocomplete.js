// Accessible address autocomplete (ARIA combobox) on top of the Base Adresse Nationale.
import { searchAddress, MIN_QUERY } from "../api/ban.js";
import "./autocomplete.css";

const TYPE_LABEL = { housenumber: "Adresse", street: "Voie", locality: "Lieu-dit", municipality: "Commune" };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Bold the parts of `text` that match words typed by the user (accent and case insensitive). */
function highlight(text, query) {
  const words = fold(query).split(/[\s,]+/).filter(w => w.length >= 2);
  if (!words.length) return esc(text);
  const folded = fold(text), marks = new Array(text.length).fill(false);
  for (const w of words) for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1)) marks.fill(true, i, i + w.length);
  let out = "", open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== open) { out += marks[i] ? "<mark>" : "</mark>"; open = marks[i]; }
    out += esc(text[i]);
  }
  return out + (open ? "</mark>" : "");
}

/**
 * Wires an <input> inside a positioned container. `onSelect(address)` receives the chosen BAN result.
 * Returns { resolve } to turn the current text into an address (first suggestion) on form submit.
 */
export function attachAddressAutocomplete(input, { onSelect, limit = 6 } = {}) {
  const list = document.createElement("ul");
  list.id = `${input.id}-suggestions`;
  list.className = "ac-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Adresses proposées");
  list.hidden = true;
  input.insertAdjacentElement("afterend", list);
  const status = document.createElement("div");
  status.className = "ac-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  list.insertAdjacentElement("afterend", status);

  Object.assign(input, { autocomplete: "off", spellcheck: false });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);

  let items = [], active = -1, timer = null, ctrl = null, lastQuery = "";

  function open(show) {
    list.hidden = !show;
    input.setAttribute("aria-expanded", String(show));
    if (!show) input.removeAttribute("aria-activedescendant");
  }

  function render(message) {
    if (message) {
      list.innerHTML = `<li class="ac-msg" role="presentation">${esc(message)}</li>`;
      open(true);
      return;
    }
    list.innerHTML = items.map((a, i) => `
      <li id="${list.id}-${i}" role="option" aria-selected="${i === active}" data-i="${i}">
        <span class="ac-main">${highlight(a.type === "municipality" ? a.city : a.name || a.label, lastQuery)}</span>
        <span class="ac-sub">${esc([a.type === "municipality" ? a.postcode : `${a.postcode || ""} ${a.city || ""}`.trim(), a.department].filter(Boolean).join(" · "))}</span>
        <span class="ac-type">${TYPE_LABEL[a.type] || ""}</span>
      </li>`).join("");
    open(items.length > 0);
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
      document.getElementById(`${list.id}-${active}`)?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
    status.textContent = items.length ? `${items.length} adresse${items.length > 1 ? "s" : ""} proposée${items.length > 1 ? "s" : ""}` : "";
  }

  async function query(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    lastQuery = q;
    try {
      items = await searchAddress(q, limit, { signal: ctrl.signal });
      active = -1;
      render(items.length ? null : "Aucune adresse trouvée");
      return items;
    } catch (e) {
      if (e.name !== "AbortError") { items = []; render("Recherche d'adresse indisponible pour le moment"); }
      return [];
    }
  }

  function choose(a) {
    if (!a) return;
    input.value = a.label;
    items = []; open(false);
    status.textContent = "";
    onSelect?.(a);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY) { ctrl?.abort(); items = []; open(false); return; }
    timer = setTimeout(() => query(q), 180);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      if (!list.hidden) { e.preventDefault(); open(false); }
    }
  });

  input.addEventListener("focus", () => { if (items.length) render(); });
  input.addEventListener("blur", () => setTimeout(() => open(false), 120));
  list.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    e.preventDefault();
    choose(items[+li.dataset.i]);
  });

  return {
    /** Form submit: use the highlighted or first suggestion, searching now if needed. */
    async resolve() {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < MIN_QUERY) { render("Tapez au moins 3 caractères"); return null; }
      const found = items.length && lastQuery === q ? items : await query(q);
      const a = found[Math.max(active, 0)];
      if (a) choose(a);
      return a || null;
    },
  };
}
