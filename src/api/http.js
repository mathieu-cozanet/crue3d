// Fetch helpers with timeout and up to two retries on transient failures (network errors, timeouts, HTTP 5xx / 429):
// public data services get hammered during a flood, exactly when the tool matters most.

class HttpError extends Error {
  constructor(status, host) { super(`HTTP ${status} sur ${host}`); this.status = status; }
}

const transient = e => !(e instanceof HttpError) || e.status >= 500 || e.status === 429;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY_DELAYS = [800, 2000]; // Hub'Eau, for one, resets connections intermittently

async function request(url, { timeout, signal, read }) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new HttpError(res.status, host);
      return await read(res);
    } catch (e) {
      if (signal?.aborted) throw e;                       // cancelled by the caller: no retry
      const err = e.name === "AbortError" ? new Error(`Délai dépassé sur ${host}`) : e;
      if (attempt >= RETRY_DELAYS.length || !transient(err)) throw err;
      await sleep(RETRY_DELAYS[attempt]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export const fetchJSON = (url, { timeout = 30000, signal } = {}) => request(url, { timeout, signal, read: r => r.json() });
export const fetchBuffer = (url, { timeout = 45000, signal } = {}) => request(url, { timeout, signal, read: r => r.arrayBuffer() });

export const qs = params => new URLSearchParams(params).toString();
