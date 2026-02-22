import type { IncomingMessage, ServerResponse } from "node:http";
import { createCloudflareAccessVerifier, type CloudflareAccessVerifier } from "./tunnel/access.js";
import { startGatewayCloudflareExposure } from "./tunnel/exposure.js";

type TunnelConfig = {
  mode?: "off" | "managed" | "access-only";
  tunnelToken?: string;
  teamDomain?: string;
  audience?: string;
};

type PluginConfig = {
  tunnel?: TunnelConfig;
};

export default {
  id: "cloudflare",
  name: "Cloudflare",

  register(api: {
    pluginConfig?: PluginConfig;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    registerService(service: { id: string; start: () => Promise<void>; stop: () => Promise<void> }): void;
    registerHttpHandler(handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean): void;
  }) {
    const config = api.pluginConfig?.tunnel;
    const mode = config?.mode ?? "off";
    if (mode === "off") return;

    const tunnelToken =
      config?.tunnelToken ?? process.env.OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN;
    const teamDomain = config?.teamDomain;

    // Validate config
    if (mode === "managed" && !tunnelToken) {
      api.logger.error(
        "[cloudflare] managed mode requires tunnelToken config or OPENCLAW_CLOUDFLARE_TUNNEL_TOKEN env var",
      );
      return;
    }
    if (teamDomain === undefined) {
      api.logger.warn(
        "[cloudflare] no teamDomain configured — JWT verification will be skipped",
      );
    }

    let verifier: CloudflareAccessVerifier | null = null;
    let stopTunnel: (() => Promise<void>) | null = null;

    // Register background service for tunnel lifecycle
    api.registerService({
      id: "cloudflare-tunnel",
      async start() {
        // Create JWT verifier if teamDomain is set
        if (teamDomain) {
          verifier = createCloudflareAccessVerifier({
            teamDomain,
            audience: config?.audience,
          });
          api.logger.info(
            `[cloudflare] Access JWT verifier active for ${teamDomain}.cloudflareaccess.com`,
          );
        }

        // Start tunnel exposure (managed mode)
        stopTunnel = await startGatewayCloudflareExposure({
          cloudflareMode: mode,
          tunnelToken,
          logCloudflare: {
            info: (msg) => api.logger.info(`[cloudflare] ${msg}`),
            warn: (msg) => api.logger.warn(`[cloudflare] ${msg}`),
            error: (msg) => api.logger.error(`[cloudflare] ${msg}`),
          },
        });
      },
      async stop() {
        if (stopTunnel) {
          await stopTunnel();
          stopTunnel = null;
        }
        verifier = null;
      },
    });

    // Register HTTP handler for JWT auth
    api.registerHttpHandler(async (req: IncomingMessage, _res: ServerResponse) => {
      // Always strip identity headers to prevent spoofing from untrusted clients
      delete req.headers["x-openclaw-user-email"];
      delete req.headers["x-openclaw-auth-source"];

      if (!verifier) return false;

      const jwtHeader = req.headers["cf-access-jwt-assertion"];
      const token = Array.isArray(jwtHeader) ? jwtHeader[0] : jwtHeader;
      if (!token) return false;

      const user = await verifier.verify(token);
      if (user) {
        // Set identity headers for gateway auth flow
        req.headers["x-openclaw-user-email"] = user.email;
        req.headers["x-openclaw-auth-source"] = "cloudflare-access";
      }

      return false; // don't consume the request
    });
  },
};
