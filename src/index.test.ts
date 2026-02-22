import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";

const createCloudflareAccessVerifierMock = vi.fn();
const startGatewayCloudflareExposureMock = vi.fn();

vi.mock("./tunnel/access.js", () => ({
  createCloudflareAccessVerifier: (...args: unknown[]) =>
    createCloudflareAccessVerifierMock(...args),
}));

vi.mock("./tunnel/exposure.js", () => ({
  startGatewayCloudflareExposure: (...args: unknown[]) =>
    startGatewayCloudflareExposureMock(...args),
}));

function createMockApi(pluginConfig?: Record<string, unknown>) {
  return {
    pluginConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerService: vi.fn(),
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
    startGatewayCloudflareExposureMock.mockReset();
    delete process.env.OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN;
  });

  it("does nothing when mode is off", async () => {
    const { default: plugin } = await import("./index.js");
    const api = createMockApi({ tunnel: { mode: "off" } });

    plugin.register(api);

    expect(api.registerService).not.toHaveBeenCalled();
    expect(api.registerHttpHandler).not.toHaveBeenCalled();
  });

  it("does nothing when no tunnel config (defaults to off)", async () => {
    const { default: plugin } = await import("./index.js");
    const api = createMockApi({});

    plugin.register(api);

    expect(api.registerService).not.toHaveBeenCalled();
    expect(api.registerHttpHandler).not.toHaveBeenCalled();
  });

  it("logs error and returns when managed mode has no token", async () => {
    const { default: plugin } = await import("./index.js");
    const api = createMockApi({ tunnel: { mode: "managed" } });

    plugin.register(api);

    expect(api.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("managed mode requires tunnelToken"),
    );
    expect(api.registerService).not.toHaveBeenCalled();
  });

  it("reads tunnel token from env var when not in config", async () => {
    process.env.OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN = "env-token";
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "managed", teamDomain: "myteam" },
    });

    plugin.register(api);

    expect(api.registerService).toHaveBeenCalled();
    // Extract and run the service start to verify token is passed through
    const service = api.registerService.mock.calls[0][0];
    await service.start();

    expect(startGatewayCloudflareExposureMock).toHaveBeenCalledWith(
      expect.objectContaining({ tunnelToken: "env-token" }),
    );
  });

  it("warns when mode is active but no teamDomain is configured", async () => {
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({ tunnel: { mode: "access-only" } });

    plugin.register(api);

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no teamDomain configured"),
    );
  });

  it("warns when managed mode has no teamDomain", async () => {
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "managed", tunnelToken: "tok" },
    });

    plugin.register(api);

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no teamDomain configured"),
    );
  });

  it("registers service and HTTP handler in managed mode", async () => {
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
    });

    plugin.register(api);

    expect(api.registerService).toHaveBeenCalledTimes(1);
    expect(api.registerHttpHandler).toHaveBeenCalledTimes(1);

    const service = api.registerService.mock.calls[0][0];
    expect(service.id).toBe("cloudflare-tunnel");
  });

  it("service start creates verifier when teamDomain is set", async () => {
    const mockVerifier = { verify: vi.fn() };
    createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: {
        mode: "managed",
        tunnelToken: "tok",
        teamDomain: "myteam",
        audience: "my-aud",
      },
    });

    plugin.register(api);

    const service = api.registerService.mock.calls[0][0];
    await service.start();

    expect(createCloudflareAccessVerifierMock).toHaveBeenCalledWith({
      teamDomain: "myteam",
      audience: "my-aud",
    });
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("myteam.cloudflareaccess.com"),
    );
  });

  it("service start does not create verifier when teamDomain is unset", async () => {
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "managed", tunnelToken: "tok" },
    });

    plugin.register(api);

    const service = api.registerService.mock.calls[0][0];
    await service.start();

    expect(createCloudflareAccessVerifierMock).not.toHaveBeenCalled();
  });

  it("service stop calls tunnel stop and clears verifier", async () => {
    const tunnelStopFn = vi.fn();
    startGatewayCloudflareExposureMock.mockResolvedValue(tunnelStopFn);
    createCloudflareAccessVerifierMock.mockReturnValue({ verify: vi.fn() });

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
    });

    plugin.register(api);

    const service = api.registerService.mock.calls[0][0];
    await service.start();
    await service.stop();

    expect(tunnelStopFn).toHaveBeenCalled();
  });

  it("service stop is safe when no tunnel was started", async () => {
    startGatewayCloudflareExposureMock.mockResolvedValue(null);

    const { default: plugin } = await import("./index.js");
    const api = createMockApi({
      tunnel: { mode: "access-only", teamDomain: "myteam" },
    });

    plugin.register(api);

    const service = api.registerService.mock.calls[0][0];
    await service.start();
    // Should not throw
    await service.stop();
  });

  describe("HTTP handler", () => {
    it("strips spoofed identity headers even when no verifier is active", async () => {
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok" },
      });

      plugin.register(api);

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({
        "x-openclaw-user-email": "spoofed@evil.com",
        "x-openclaw-auth-source": "spoofed",
      });
      await handler(req, createMockRes());

      expect(req.headers["x-openclaw-user-email"]).toBeUndefined();
      expect(req.headers["x-openclaw-auth-source"]).toBeUndefined();
    });

    it("strips spoofed identity headers before setting verified ones", async () => {
      const mockVerifier = {
        verify: vi.fn().mockResolvedValue({ email: "real@example.com" }),
      };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
      });

      plugin.register(api);

      const service = api.registerService.mock.calls[0][0];
      await service.start();

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({
        "cf-access-jwt-assertion": "valid-jwt",
        "x-openclaw-user-email": "spoofed@evil.com",
        "x-openclaw-auth-source": "spoofed",
      });
      await handler(req, createMockRes());

      expect(req.headers["x-openclaw-user-email"]).toBe("real@example.com");
      expect(req.headers["x-openclaw-auth-source"]).toBe("cloudflare-access");
    });

    it("returns false when no verifier is active", async () => {
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok" },
      });

      plugin.register(api);

      // Service not started yet, so no verifier
      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({ "cf-access-jwt-assertion": "some-jwt" });
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
    });

    it("returns false when no JWT header is present", async () => {
      const mockVerifier = { verify: vi.fn() };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
      });

      plugin.register(api);

      const service = api.registerService.mock.calls[0][0];
      await service.start();

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({});
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
      expect(mockVerifier.verify).not.toHaveBeenCalled();
    });

    it("sets identity headers on valid JWT", async () => {
      const mockVerifier = {
        verify: vi.fn().mockResolvedValue({ email: "alice@example.com" }),
      };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
      });

      plugin.register(api);

      const service = api.registerService.mock.calls[0][0];
      await service.start();

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({ "cf-access-jwt-assertion": "valid-jwt" });
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
      expect(mockVerifier.verify).toHaveBeenCalledWith("valid-jwt");
      expect(req.headers["x-openclaw-user-email"]).toBe("alice@example.com");
      expect(req.headers["x-openclaw-auth-source"]).toBe("cloudflare-access");
    });

    it("does not set headers on invalid JWT", async () => {
      const mockVerifier = {
        verify: vi.fn().mockResolvedValue(null),
      };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
      });

      plugin.register(api);

      const service = api.registerService.mock.calls[0][0];
      await service.start();

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({ "cf-access-jwt-assertion": "bad-jwt" });
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
      expect(req.headers["x-openclaw-user-email"]).toBeUndefined();
    });

    it("handles array JWT header (takes first value)", async () => {
      const mockVerifier = {
        verify: vi.fn().mockResolvedValue({ email: "bob@example.com" }),
      };
      createCloudflareAccessVerifierMock.mockReturnValue(mockVerifier);
      startGatewayCloudflareExposureMock.mockResolvedValue(null);

      const { default: plugin } = await import("./index.js");
      const api = createMockApi({
        tunnel: { mode: "managed", tunnelToken: "tok", teamDomain: "myteam" },
      });

      plugin.register(api);

      const service = api.registerService.mock.calls[0][0];
      await service.start();

      const handler = api.registerHttpHandler.mock.calls[0][0];
      const req = createMockReq({
        "cf-access-jwt-assertion": ["first-jwt", "second-jwt"] as unknown as string,
      });
      const result = await handler(req, createMockRes());

      expect(result).toBe(false);
      expect(mockVerifier.verify).toHaveBeenCalledWith("first-jwt");
    });
  });
});
