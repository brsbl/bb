import type { BbPluginApi } from "@bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import { connectRpcContract, createRpcHandlers } from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { ShareHostResolver } from "./hosts.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import { resolveDefaultConnectBaseUrl } from "./redeem.js";
import { CONNECT_REALTIME_CHANNEL } from "./types.js";
import { readOrCreateViewerAccessToken } from "./viewer-access.js";

export default async function plugin(bb: BbPluginApi) {
  const store = createKvCredentialStore(bb.storage.kv);
  const viewerAccessToken = await readOrCreateViewerAccessToken(bb.storage.kv);
  // Tunnel is assigned below; ShareRegistry reads the live credential via this.
  let tunnel!: ConnectTunnel;
  const hostResolver = new ShareHostResolver(() => bb.sdk);
  const getLoopbackBaseUrl = () =>
    resolveLocalCloudLoopbackUrl(
      tunnel.getCredential()?.serverUrl,
      process.env.BB_DEV_APP_PORT,
    ) ?? bb.server.loopbackBaseUrl;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    hosts: bb.hosts,
    hostResolver,
    getLoopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    log: bb.log,
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  tunnel = new ConnectTunnel({
    store,
    shares,
    defaultBaseUrl: resolveDefaultConnectBaseUrl(process.env),
    getLoopbackBaseUrl,
    log: bb.log,
    connectViewerAccessToken: viewerAccessToken,
    onStatusChange: (status) =>
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status),
  });

  bb.rpc.register(
    connectRpcContract,
    createRpcHandlers(tunnel, hostResolver, viewerAccessToken),
  );
  registerConnectCli({ bb, tunnel, hostResolver });

  // The tunnel lives inside this service: idle while unpaired, dialing when
  // a credential exists, torn down on abort (reload/disable/shutdown) —
  // disabling the plugin cuts off all remote access. The tunnel keeps its
  // own capped-backoff reconnect; the host's restart-with-backoff is crash
  // supervision on top.
  bb.background.service("tunnel", {
    async start(signal) {
      await tunnel.start();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      tunnel.stop();
    },
  });
}
