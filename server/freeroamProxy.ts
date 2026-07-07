import type { Express, Request, Response } from "express";

/**
 * Freeroam Proxy Endpoint
 * 
 * Allows the dev server to proxy requests to Freeroam through the production server,
 * bypassing IP-based blocking. Secured with a shared secret.
 * 
 * Only accepts requests with a valid x-proxy-secret header.
 * The production server itself never uses this endpoint (it calls Freeroam directly).
 */
export function registerFreeroamProxy(app: Express) {
  app.post("/api/freeroam-proxy", async (req: Request, res: Response) => {
    const secret = req.headers["x-proxy-secret"];
    const expectedSecret = process.env.FREEROAM_PROXY_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { url, method, headers, body } = req.body as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };

    if (!url || !url.startsWith("https://getfreeroam.com")) {
      res.status(400).json({ error: "Invalid URL — must be a getfreeroam.com URL" });
      return;
    }

    try {
      const fetchOptions: RequestInit = {
        method: method || "GET",
        headers: headers || {},
        redirect: "follow",
      };

      if (body && method !== "GET") {
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);
      const responseBody = await response.text();

      res.status(response.status).set("content-type", response.headers.get("content-type") || "application/json").send(responseBody);
    } catch (err) {
      res.status(502).json({ error: "Proxy request failed", detail: err instanceof Error ? err.message : "Unknown error" });
    }
  });
}
