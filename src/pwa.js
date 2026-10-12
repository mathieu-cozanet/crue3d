// Registers the service worker in production builds (installable app, faster repeat visits).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register(new URL(/* @vite-ignore */ "../sw.js", import.meta.url)).catch(() => { /* the site works without it */ });
  });
}
