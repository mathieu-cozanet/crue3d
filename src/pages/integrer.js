import { attachAddressAutocomplete } from "../ui/autocomplete.js";

const $ = id => document.getElementById(id);
const appURL = new URL("../app/", location.href);
let chosen = null;

function render() {
  if (!chosen) return;
  const url = new URL(appURL);
  url.searchParams.set("q", chosen.label);
  url.searchParams.set("lon", chosen.lonlat[0].toFixed(6));
  url.searchParams.set("lat", chosen.lonlat[1].toFixed(6));
  url.searchParams.set("zone", $("embedZone").value);
  url.searchParams.set("embed", "");
  const height = $("embedHeight").value;
  const title = `Crue 3D — zones inondables autour de ${chosen.city || chosen.label}`;
  const attrs = `src="${url.href}" title="${title.replace(/"/g, "&quot;")}" width="100%" height="${height}" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen"`;
  $("embedCode").value = `<iframe ${attrs}></iframe>`;
  $("copyCode").disabled = false;
  $("embedPreview").innerHTML = `<iframe ${attrs}></iframe>`;
}

attachAddressAutocomplete($("embedQ"), { onSelect: a => { chosen = a; render(); } });
$("embedForm").addEventListener("submit", e => e.preventDefault());
$("embedZone").onchange = $("embedHeight").onchange = render;
$("copyCode").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("embedCode").value);
    $("copyStatus").textContent = "Code copié.";
  } catch {
    $("embedCode").select();
    $("copyStatus").textContent = "Sélectionné : faites Ctrl+C.";
  }
};
