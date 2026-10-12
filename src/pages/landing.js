import { attachAddressAutocomplete } from "../ui/autocomplete.js";

const form = document.querySelector(".search-hero");
const input = document.getElementById("hero-q");

// Hand the chosen address to the application; coordinates avoid a second, possibly ambiguous, geocoding.
function open(a) {
  const url = new URL(form.getAttribute("action"), location.href);
  url.searchParams.set("q", a.label);
  url.searchParams.set("lon", a.lonlat[0].toFixed(6));
  url.searchParams.set("lat", a.lonlat[1].toFixed(6));
  location.href = url.href;
}

const ac = attachAddressAutocomplete(input, { onSelect: open });
form.addEventListener("submit", e => {
  e.preventDefault();
  ac.resolve();
});
