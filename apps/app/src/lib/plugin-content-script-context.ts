import type {
  BbNavigate,
  PluginContentScriptContext,
  PluginContentScriptDisposer,
  PluginRealtimeConnectionState,
  PluginRpcClient,
} from "@bb/plugin-sdk";
import { getRootComposeRoutePath } from "./route-paths.js";
import { callPluginRpc } from "./plugin-sdk-hooks.js";
import { wsManager } from "./ws.js";

type Navigate = (
  to: string,
  options?: { state?: Record<string, unknown> },
) => void;

let appNavigate: Navigate | null = null;

/** Install the app router used by imperative plugin content-script navigation. */
export function setPluginContentScriptNavigate(
  navigate: Navigate,
): PluginContentScriptDisposer {
  appNavigate = navigate;
  return () => {
    if (appNavigate === navigate) appNavigate = null;
  };
}

function bindDisposerToSignal(
  signal: AbortSignal,
  dispose: PluginContentScriptDisposer,
): PluginContentScriptDisposer {
  let active = true;
  const run = () => {
    if (!active) return;
    active = false;
    signal.removeEventListener("abort", run);
    void dispose();
  };
  if (signal.aborted) {
    run();
  } else {
    signal.addEventListener("abort", run, { once: true });
  }
  return run;
}

function toCompose(options?: Parameters<BbNavigate["toCompose"]>[0]): void {
  if (appNavigate === null) {
    throw new Error("plugin content-script navigation is not mounted");
  }
  appNavigate(getRootComposeRoutePath(), {
    state: {
      focusPrompt: options?.focusPrompt ?? false,
      initialPrompt: options?.initialPrompt ?? "",
    },
  });
}

export function createPluginContentScriptContext(args: {
  pluginId: string;
  generation: number;
  signal: AbortSignal;
}): PluginContentScriptContext {
  const { pluginId, generation, signal } = args;
  const rpc: PluginRpcClient = {
    call: (method: string, input?: unknown) =>
      callPluginRpc(fetch, pluginId, method, input),
  };
  return {
    pluginId,
    generation,
    signal,
    rpc,
    realtime: {
      subscribe(channel, handler) {
        return bindDisposerToSignal(
          signal,
          wsManager.onPluginSignal((event) => {
            if (event.pluginId !== pluginId || event.channel !== channel)
              return;
            handler(event.payload);
          }),
        );
      },
      getConnectionState(): PluginRealtimeConnectionState {
        return wsManager.getConnectionState();
      },
      subscribeConnectionState(handler) {
        return bindDisposerToSignal(
          signal,
          wsManager.onConnectionStateChange(() => {
            handler(wsManager.getConnectionState());
          }),
        );
      },
    },
    navigate: { toCompose },
  };
}
