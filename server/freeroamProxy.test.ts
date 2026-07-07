import { describe, it, expect } from "vitest";

describe("Freeroam Proxy", () => {
  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

  it("rejects requests without proxy secret", async () => {
    const resp = await fetch(`${baseUrl}/api/freeroam-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://getfreeroam.com/api/user/current" }),
    });
    expect(resp.status).toBe(403);
  });

  it("rejects requests with wrong proxy secret", async () => {
    const resp = await fetch(`${baseUrl}/api/freeroam-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-proxy-secret": "wrong-secret",
      },
      body: JSON.stringify({ url: "https://getfreeroam.com/api/user/current" }),
    });
    expect(resp.status).toBe(403);
  });

  it("rejects non-freeroam URLs", async () => {
    const secret = process.env.FREEROAM_PROXY_SECRET;
    if (!secret) return; // skip if secret not available
    const resp = await fetch(`${baseUrl}/api/freeroam-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-proxy-secret": secret,
      },
      body: JSON.stringify({ url: "https://evil.com/steal-data" }),
    });
    expect(resp.status).toBe(400);
  });

  it("proxies valid requests with correct secret", async () => {
    const secret = process.env.FREEROAM_PROXY_SECRET;
    if (!secret) return; // skip if secret not available
    const resp = await fetch(`${baseUrl}/api/freeroam-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-proxy-secret": secret,
      },
      body: JSON.stringify({
        url: "https://getfreeroam.com/api/user/current",
        method: "GET",
        headers: { accept: "*/*" },
      }),
    });
    // Should get a response from Freeroam (401 without cookie, but not 403 from our proxy)
    expect(resp.status).not.toBe(403);
    expect(resp.status).not.toBe(400);
  });
});
