import { describe, expect, it, vi, beforeEach } from "vitest";

const startCloudflaredTunnelMock = vi.fn();
vi.mock("./cloudflared.js", () => ({
  startCloudflaredTunnel: (...args: unknown[]) => startCloudflaredTunnelMock(...args),
}));

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("startGatewayCloudflareExposure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    startCloudflaredTunnelMock.mockReset();
  });

  it("returns null when mode is off", async () => {
    const { startGatewayCloudflareExposure } = await import("./exposure.js");
    const log = createMockLogger();

    const result = await startGatewayCloudflareExposure({
      cloudflareMode: "off",
      logCloudflare: log,
    });

    expect(result).toBeNull();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("returns null and logs info in access-only mode", async () => {
    const { startGatewayCloudflareExposure } = await import("./exposure.js");
    const log = createMockLogger();

    const result = await startGatewayCloudflareExposure({
      cloudflareMode: "access-only",
      logCloudflare: log,
    });

    expect(result).toBeNull();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("access-only mode"),
    );
  });

  it("returns null and logs error in managed mode without token", async () => {
    const { startGatewayCloudflareExposure } = await import("./exposure.js");
    const log = createMockLogger();

    const result = await startGatewayCloudflareExposure({
      cloudflareMode: "managed",
      logCloudflare: log,
    });

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("no tunnel token provided"),
    );
  });

  it("starts tunnel and returns stop function in managed mode", async () => {
    const stopFn = vi.fn();
    startCloudflaredTunnelMock.mockResolvedValue({
      connectorId: "abc-123",
      pid: 9999,
      stderr: [],
      stop: stopFn,
    });

    const { startGatewayCloudflareExposure } = await import("./exposure.js");
    const log = createMockLogger();

    const result = await startGatewayCloudflareExposure({
      cloudflareMode: "managed",
      tunnelToken: "test-token",
      logCloudflare: log,
    });

    expect(result).toBe(stopFn);
    expect(startCloudflaredTunnelMock).toHaveBeenCalledWith({
      token: "test-token",
      timeoutMs: 30_000,
      logger: log,
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("connectorId=abc-123"),
    );
  });

  it("returns null and logs error when tunnel start fails", async () => {
    startCloudflaredTunnelMock.mockRejectedValue(new Error("connection refused"));

    const { startGatewayCloudflareExposure } = await import("./exposure.js");
    const log = createMockLogger();

    const result = await startGatewayCloudflareExposure({
      cloudflareMode: "managed",
      tunnelToken: "bad-token",
      logCloudflare: log,
    });

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("connection refused"),
    );
  });
});
