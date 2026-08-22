import { describe, expect, it } from "vitest";

describe("Cloudflare Worker 部署權杖", () => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const validatesWhenConfigured = token ? it : it.skip;

  validatesWhenConfigured("可通過 Cloudflare 的權杖驗證端點", async () => {
    expect(token, "缺少 CLOUDFLARE_API_TOKEN").toBeTruthy();

    const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as { success?: boolean; errors?: Array<{ message?: string }> };

    expect(response.ok, payload.errors?.map((error) => error.message).join("；") || "Cloudflare 驗證失敗").toBe(true);
    expect(payload.success).toBe(true);
  }, 15_000);
});
