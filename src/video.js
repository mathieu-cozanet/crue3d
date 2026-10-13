// Records the flood animation as a shareable video (vertical for social networks, or landscape),
// with a title card overlay. Uses the browser's MediaRecorder: MP4 where supported, WebM otherwise.
import { DEPTH_CLASSES } from "./config.js";

export const FORMATS = {
  vertical: { w: 1080, h: 1920, label: "Vertical 9:16 (réseaux sociaux)" },
  landscape: { w: 1920, h: 1080, label: "Paysage 16:9 (site, présentation)" },
};

export function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
    .find(m => MediaRecorder.isTypeSupported(m)) || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Title card, current level, legend and disclaimer drawn over the 3D frame. */
function drawOverlay(g, W, H, { place, caption, detail, site, progress }) {
  const u = Math.min(W, H) / 1080;               // 1 unit = 1 px at 1080 p
  const font = (wgt, px) => `${wgt} ${Math.round(px * u)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  // top band
  const band = 400 * u;
  const grad = g.createLinearGradient(0, 0, 0, band);
  grad.addColorStop(0, "rgba(11,28,48,.92)"); grad.addColorStop(0.62, "rgba(11,28,48,.7)"); grad.addColorStop(1, "rgba(11,28,48,0)");
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 10 * u;
  g.fillStyle = grad; g.fillRect(0, 0, W, band);
  g.fillStyle = "#fff"; g.textBaseline = "top";
  g.font = font(700, 34); g.fillText("Crue 3D", 56 * u, 48 * u);
  g.font = font(500, 30); g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(place, 56 * u, 94 * u);
  g.font = font(800, 64); g.fillStyle = "#fff"; g.fillText(caption, 56 * u, 140 * u);
  if (detail) { g.font = font(600, 32); g.fillStyle = "#d9ecf9"; g.fillText(detail, 56 * u, 222 * u); }
  g.shadowBlur = 0; g.shadowColor = "transparent";

  // legend
  const lx = 56 * u, ly = H - 470 * u, lw = 300 * u, row = 44 * u;
  g.fillStyle = "rgba(255,255,255,.9)"; roundRect(g, lx, ly, lw, 70 * u + row * DEPTH_CLASSES.length, 18 * u); g.fill();
  g.fillStyle = "#33414d"; g.font = font(600, 26); g.fillText("Hauteur d'eau", lx + 22 * u, ly + 20 * u);
  DEPTH_CLASSES.forEach((c, i) => {
    const y = ly + 62 * u + i * row;
    g.fillStyle = c.color; roundRect(g, lx + 22 * u, y, 30 * u, 30 * u, 6 * u); g.fill();
    g.fillStyle = "#1d2730"; g.font = font(500, 26); g.fillText(c.label, lx + 66 * u, y + 2 * u);
  });

  // footer: disclaimer + where to try it
  const fb = 150 * u;
  const grad2 = g.createLinearGradient(0, H - fb, 0, H);
  grad2.addColorStop(0, "rgba(11,28,48,0)"); grad2.addColorStop(1, "rgba(11,28,48,.85)");
  g.fillStyle = grad2; g.fillRect(0, H - fb, W, fb);
  g.fillStyle = "rgba(255,255,255,.92)"; g.font = font(500, 24);
  g.fillText("Simulation d'après les cartes officielles Vigicrues — ce n'est pas une prévision.", 56 * u, H - 92 * u);
  g.font = font(700, 26); g.fillStyle = "#fff"; g.fillText(site, 56 * u, H - 56 * u);

  // progress bar
  g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(0, H - 8 * u, W, 8 * u);
  g.fillStyle = "#5aa9dc"; g.fillRect(0, H - 8 * u, W * progress, 8 * u);
}

/**
 * steps: [{ hold: ms, run(): void, caption, detail }] played in order while recording.
 * Returns { blob, mime, ext }.
 */
export async function recordFloodVideo(viewer, { format, place, site, steps, preview, onProgress }) {
  const mime = pickMime();
  if (!mime) throw new Error("Votre navigateur ne permet pas d'enregistrer une vidéo.");
  const { w, h } = FORMATS[format];
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  preview?.replaceChildren(canvas);

  const total = steps.reduce((s, x) => s + x.hold, 0);
  const restore = viewer.beginCapture(w, h);
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => (recorder.onstop = r));

  let current = steps[0], t0 = 0;
  viewer.onFrame = () => {
    const t = t0 ? performance.now() - t0 : 0;
    g.drawImage(viewer.renderer.domElement, 0, 0, w, h);
    drawOverlay(g, w, h, { place, site, caption: current.caption, detail: current.detail, progress: Math.min(1, t / total) });
    onProgress?.(Math.min(1, t / total));
  };
  try {
    await sleep(300);              // let the new size settle before the first frame is recorded
    recorder.start(500);
    t0 = performance.now();
    for (const step of steps) {
      current = step;
      step.run();
      await sleep(step.hold);
    }
    recorder.stop();
    await stopped;
  } finally {
    restore();
  }
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), mime: type, ext: type === "video/mp4" ? "mp4" : "webm" };
}
