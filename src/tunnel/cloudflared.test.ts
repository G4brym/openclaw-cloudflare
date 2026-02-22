import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

// Mock spawn and execFile (promisified via util.promisify)
const spawnMock = vi.fn();
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Mock existsSync
const existsSyncMock = vi.fn<(p: string) => boolean>(() => true);
vi.mock("node:fs", () => ({
  existsSync: (p: string) => existsSyncMock(p),
}));

// Mock fs/promises
const mkdirMock = vi.fn().mockResolvedValue(undefined);
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const chmodMock = vi.fn().mockResolvedValue(undefined);
const unlinkMock = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  chmod: (...args: unknown[]) => chmodMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

// Mock os.homedir
const homedirMock = vi.fn(() => "/home/testuser");
vi.mock("node:os", () => ({
  default: { homedir: () => homedirMock() },
  homedir: () => homedirMock(),
}));

// Shared exec mock for findCloudflaredBinary
const execMock = vi.fn();

describe("findCloudflaredBinary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("finds cloudflared via which", async () => {
    execMock.mockImplementation((cmd: string, _args: string[]) => {
      if (cmd === "which") {
        return Promise.resolve({ stdout: "/usr/local/bin/cloudflared\n", stderr: "" });
      }
      // --version check
      return Promise.resolve({ stdout: "cloudflared version 2024.1.0\n", stderr: "" });
    });
    existsSyncMock.mockReturnValue(true);

    const { findCloudflaredBinary } = await import("./cloudflared.js");
    const result = await findCloudflaredBinary(execMock);
    expect(result).toBe("/usr/local/bin/cloudflared");
  });

  it("falls back to known paths when which fails", async () => {
    execMock.mockImplementation((cmd: string, _args: string[]) => {
      if (cmd === "which") {
        return Promise.reject(new Error("not found"));
      }
      // --version check for known path
      return Promise.resolve({ stdout: "cloudflared version 2024.1.0\n", stderr: "" });
    });
    existsSyncMock.mockImplementation((p: string) => p === "/usr/local/bin/cloudflared");

    const { findCloudflaredBinary } = await import("./cloudflared.js");
    const result = await findCloudflaredBinary(execMock);
    expect(result).toBe("/usr/local/bin/cloudflared");
  });

  it("returns null when binary is not found", async () => {
    execMock.mockRejectedValue(new Error("not found"));
    existsSyncMock.mockReturnValue(false);

    const { findCloudflaredBinary } = await import("./cloudflared.js");
    const result = await findCloudflaredBinary(execMock);
    expect(result).toBeNull();
  });

  it("finds cloudflared in ~/.openclaw/bin", async () => {
    const openclawBinPath = "/home/testuser/.openclaw/bin/cloudflared";
    execMock.mockImplementation((cmd: string, _args: string[]) => {
      if (cmd === "which") {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve({ stdout: "cloudflared version 2024.1.0\n", stderr: "" });
    });
    existsSyncMock.mockImplementation((p: string) => p === openclawBinPath);

    const { findCloudflaredBinary } = await import("./cloudflared.js");
    const result = await findCloudflaredBinary(execMock);
    expect(result).toBe(openclawBinPath);
  });
});

describe("installCloudflared", () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    chmodMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    homedirMock.mockReturnValue("/home/testuser");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    Object.defineProperty(process, "arch", { value: originalArch });
  });

  it("downloads and installs linux binary", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });

    const binaryData = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(binaryData.buffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { installCloudflared } = await import("./cloudflared.js");
    const logger = { info: vi.fn() };
    const result = await installCloudflared(logger);

    expect(result).toBe("/home/testuser/.openclaw/bin/cloudflared");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
      { redirect: "follow" },
    );
    expect(mkdirMock).toHaveBeenCalledWith("/home/testuser/.openclaw/bin", { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(
      "/home/testuser/.openclaw/bin/cloudflared",
      expect.any(Uint8Array),
    );
    expect(chmodMock).toHaveBeenCalledWith("/home/testuser/.openclaw/bin/cloudflared", 0o755);
    expect(logger.info).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("downloads and extracts macOS tgz", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "arm64" });

    // Make execFile (used by promisify) call the callback immediately.
    // promisify looks for the last function argument as the callback.
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") (cb as (err: Error | null, stdout: string, stderr: string) => void)(null, "", "");
    });

    const binaryData = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(binaryData.buffer),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { installCloudflared } = await import("./cloudflared.js");
    const logger = { info: vi.fn() };
    const result = await installCloudflared(logger);

    expect(result).toBe("/home/testuser/.openclaw/bin/cloudflared");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
      { redirect: "follow" },
    );
    // tgz should be written, tar extracted, then tgz deleted
    expect(writeFileMock).toHaveBeenCalledWith(
      "/home/testuser/.openclaw/bin/cloudflared.tgz",
      expect.any(Uint8Array),
    );
    expect(unlinkMock).toHaveBeenCalledWith("/home/testuser/.openclaw/bin/cloudflared.tgz");
    expect(chmodMock).toHaveBeenCalledWith("/home/testuser/.openclaw/bin/cloudflared", 0o755);

    vi.unstubAllGlobals();
  });

  it("throws on unsupported platform", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });

    const { installCloudflared } = await import("./cloudflared.js");
    await expect(installCloudflared()).rejects.toThrow(/Unsupported platform/);
  });

  it("throws on download failure", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "arch", { value: "x64" });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { installCloudflared } = await import("./cloudflared.js");
    await expect(installCloudflared()).rejects.toThrow(/Failed to download cloudflared: HTTP 404/);

    vi.unstubAllGlobals();
  });
});

describe("startCloudflaredTunnel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function createMockProcess(): ChildProcess & {
    _emit: (event: string, ...args: unknown[]) => void;
    _emitStderr: (data: string) => void;
  } {
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};
    const stdoutEvents: Record<string, Array<(...args: unknown[]) => void>> = {};
    const stderrEvents: Record<string, Array<(...args: unknown[]) => void>> = {};

    const mockStdout = {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        stdoutEvents[event] = stdoutEvents[event] ?? [];
        stdoutEvents[event].push(cb);
      }),
    };
    const mockStderr = {
      setEncoding: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        stderrEvents[event] = stderrEvents[event] ?? [];
        stderrEvents[event].push(cb);
      }),
    };

    return {
      pid: 12345,
      killed: false,
      stdout: mockStdout as unknown as Readable,
      stderr: mockStderr as unknown as Readable,
      kill: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        events[event] = events[event] ?? [];
        events[event].push(cb);
      }),
      once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        events[event] = events[event] ?? [];
        events[event].push(cb);
      }),
      _emit: (event: string, ...args: unknown[]) => {
        for (const cb of events[event] ?? []) {
          cb(...args);
        }
      },
      _emitStderr: (data: string) => {
        for (const cb of stderrEvents.data ?? []) {
          cb(data);
        }
      },
    } as unknown as ChildProcess & {
      _emit: (event: string, ...args: unknown[]) => void;
      _emitStderr: (data: string) => void;
    };
  }

  it("starts tunnel and parses connector ID", async () => {
    const mockChild = createMockProcess();

    spawnMock.mockReturnValue(mockChild);

    const { startCloudflaredTunnel } = await import("./cloudflared.js");

    const tunnelPromise = startCloudflaredTunnel({
      token: "test-token",
      timeoutMs: 5000,
      bin: "/usr/local/bin/cloudflared",
    });

    // Simulate cloudflared registering a connection
    await new Promise((r) => setTimeout(r, 50));
    mockChild._emitStderr("INF Registered tunnel connection connectorID=abc123-def456");

    const tunnel = await tunnelPromise;
    expect(tunnel.connectorId).toBe("abc123-def456");
    expect(tunnel.pid).toBe(12345);
    expect(typeof tunnel.stop).toBe("function");
  });

  it("throws when tunnel exits before registering", async () => {
    const mockChild = createMockProcess();

    spawnMock.mockReturnValue(mockChild);

    const { startCloudflaredTunnel } = await import("./cloudflared.js");

    const tunnelPromise = startCloudflaredTunnel({
      token: "bad-token",
      timeoutMs: 5000,
      bin: "/usr/local/bin/cloudflared",
    });

    await new Promise((r) => setTimeout(r, 50));
    mockChild._emit("exit", 1, null);

    await expect(tunnelPromise).rejects.toThrow(/cloudflared exited/);
  });
});
