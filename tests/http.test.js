import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJSON } from "../src/api/http.js";

const ok = body => ({ ok: true, status: 200, json: async () => body });
const ko = status => ({ ok: false, status, json: async () => ({}) });

afterEach(() => vi.unstubAllGlobals());

describe("fetchJSON", () => {
  it("retries once on a server error", async () => {
    const f = vi.fn().mockResolvedValueOnce(ko(503)).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJSON("https://x.test/a")).resolves.toEqual({ a: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network error", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(ok(1));
    vi.stubGlobal("fetch", f);
    await expect(fetchJSON("https://x.test/a")).resolves.toBe(1);
  });

  it("does not retry a client error", async () => {
    const f = vi.fn().mockResolvedValue(ko(400));
    vi.stubGlobal("fetch", f);
    await expect(fetchJSON("https://x.test/a")).rejects.toThrow("HTTP 400");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up after two retries", async () => {
    const f = vi.fn().mockResolvedValue(ko(502));
    vi.stubGlobal("fetch", f);
    await expect(fetchJSON("https://x.test/a")).rejects.toThrow("HTTP 502");
    expect(f).toHaveBeenCalledTimes(3);
  }, 10000);
});
