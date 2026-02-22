import type { IncomingMessage, ServerResponse } from "node:http";
import { createCloudflareAccessVerifier } from "./tunnel/access.js";

type PluginConfig = {
  access?: {
    teamDomain?: string;
    audience?: string;
  };
};

export default {
  id: "cloudflare",
  name: "Cloudflare",

  register(api: {
    pluginConfig?: PluginConfig;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    registerHttpHandler(handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean): void;
  }) {
    const config = api.pluginConfig?.access;
    const teamDomain = config?.teamDomain;

    if (!teamDomain) {
      api.logger.warn("[cloudflare] no teamDomain configured — plugin disabled");
      return;
    }

    const verifier = createCloudflareAccessVerifier({
      teamDomain,
      audience: config.audience,
    });

    api.logger.info(`[cloudflare] Access JWT verifier active for ${teamDomain}.cloudflareaccess.com`);

    api.registerHttpHandler(async (req: IncomingMessage, _res: ServerResponse) => {
      // Always strip identity headers to prevent spoofing from untrusted clients
      delete req.headers["x-openclaw-user-email"];
      delete req.headers["x-openclaw-auth-source"];

      const jwtHeader = req.headers["cf-access-jwt-assertion"];
      const token = Array.isArray(jwtHeader) ? jwtHeader[0] : jwtHeader;
      if (!token) return false;

      const user = await verifier.verify(token);
      if (user) {
        req.headers["x-openclaw-user-email"] = user.email;
        req.headers["x-openclaw-auth-source"] = "cloudflare-access";
      }

      return false;
    });
  },
};
