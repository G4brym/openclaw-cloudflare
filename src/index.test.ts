import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createCloudflareAccessVerifierMock = vi.fn();

vi.mock("./tunnel/access.js", () => ({
  createCloudflareAccessVerifier: (...args: unknown[]) =>
    createCloudflareAccessVerifierMock(...args),
}));

function createMockApi(pluginConfig?: Record<string, unknown>) {
  return {
    pluginConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerHttpHandler: vi.fn(),
  };
}

function createMockReq(headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse {
  return {} as unknown as ServerResponse;
}

describe("cloudflare plugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createCloudflareAccessVerifierMock.mockReset();
  });

  it("does nothing when no teamDomain is configured", async () => {
    const { default: plugin } = await import("./index.js");
    const api = createMockApi({});

    plugin.register(api);

    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("no teamDomain configured"));
    expect(api.registerHttpHandler).not.toHaveBeenCalled();
  });

  it("does nothing when pluginConfig is absent", async () => {
    const { default: plugin } = await import("./index.js");
    const api = createMockApi(undefined);

    plugin.register(api);

    expect(api.registerHttpHandler).not.toHaveBeenCalled();
  });

  it("creates verifier and registers HTTP handler when teamDomain is set", async () => {
    const mockVerifier = { verify: vi.fn() };
    createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({ access: { teamDomain: "myteam", audience: "my-aud" } });

    plugin.register(api);

    expect(createCloudflareAccessVerifierMock).toHaveBeenCalledWith({
      teamDomain: "myteam",
      audience: "my-aud",
    });
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining("myteam.cloudflareaccess.com"));
    expect(api.registerHttpHandler).toHaveBeenCalledTimes(1);
  });

  describe("HTTP handler", () => {
    async function setupHandler(config: Record<string, unknown> = { access: { teamDomain: "myteam" } }) {
      const mockVerifier = { verify: vi.fn().mockResolvedValue(null) };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi(config);
      plugin.register(api);

      const handler = api.registerHttpHandler.mock.calls[0][0];
      return { handler, mockVerifier };
    }

    it("strips spoofed identity headers on every request", async () => {
      const { handler } = await setupHandler();
      const req = createMockReq({
        "x-openclaw-user-email": "spoofed@evil.com",
        "x-openclaw-auth-source": "spoofed",
      });

      await handler(req, createMockRes());

      expect(req.headers["x-openclaw-user-email"]).toBeUndefined();
      expect(req.headers["x-openclaw-auth-source"]).toBeUndefined();
    });

    it("returns false when no JWT header is present", async () => {
      const { handler, mockVerifier } = await setupHandler();
      const result = await handler(createMockReq({}), createMockRes());

      expect(result).toBe(false);
      expect(mockVerifier.verify).not.toHaveBeenCalled();
    });

    it("sets identity headers on valid JWT", async () => {
      const { handler, mockVerifier } = await setupHandler();
      mockVerifier.verify.mockResolvedValue({ email: "alice@example.com" });

      const req = createMockReq({ "cf-access-jwt-assertion": "valid-jwt" });
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
      expect(mockVerifier.verify).toHaveBeenCalledWith("valid-jwt");
      expect(req.headers["x-openclaw-user-email"]).toBe("alice@example.com");
      expect(req.headers["x-openclaw-auth-source"]).toBe("cloudflare-access");
    });

    it("does not set headers on invalid JWT", async () => {
      const { handler, mockVerifier } = await setupHandler();
      mockVerifier.verify.mockResolvedValue(null);

      const req = createMockReq({ "cf-access-jwt-assertion": "bad-jwt" });
      await handler(req, createMockRes());

      expect(req.headers["x-openclaw-user-email"]).toBeUndefined();
      expect(req.headers["x-openclaw-auth-source"]).toBeUndefined();
    });

    it("strips spoofed headers before setting verified ones", async () => {
      const { handler, mockVerifier } = await setupHandler();
      mockVerifier.verify.mockResolvedValue({ email: "real@example.com" });

      const req = createMockReq({
        "cf-access-jwt-assertion": "valid-jwt",
        "x-openclaw-user-email": "spoofed@evil.com",
        "x-openclaw-auth-source": "spoofed",
      });
      await handler(req, createMockRes());

      expect(req.headers["x-openclaw-user-email"]).toBe("real@example.com");
      expect(req.headers["x-openclaw-auth-source"]).toBe("cloudflare-access");
    });

    it("handles array JWT header (takes first value)", async () => {
      const { handler, mockVerifier } = await setupHandler();
      mockVerifier.verify.mockResolvedValue({ email: "bob@example.com" });

      const req = createMockReq({
        "cf-access-jwt-assertion": ["first-jwt", "second-jwt"] as unknown as string,
      });
      await handler(req, createMockRes());

      expect(mockVerifier.verify).toHaveBeenCalledWith("first-jwt");
    });
  });
});
