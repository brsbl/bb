import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { bootPluginFrontends } from "../lib/plugin-frontend";
import { setPluginContentScriptNavigate } from "../lib/plugin-content-script-context";
import { useSystemConfig } from "./queries/system-queries";

/**
 * Load plugin frontend bundles (plugin design §5.1) once per page load,
 * after system config resolves — the loading never delays first paint.
 * The server inventory already filters to running, loadable plugins; builtin
 * plugin frontends can be present even when the Plugins experiment is off.
 * After boot, the realtime
 * `plugins-changed` broadcast keeps bundles live via
 * schedulePluginFrontendReconcile (no page refresh needed).
 */
export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const navigate = useNavigate();
  const resolved = systemConfig.data !== undefined;
  useEffect(() => {
    const disposeNavigate = setPluginContentScriptNavigate(navigate);
    if (resolved) void bootPluginFrontends();
    return () => {
      void disposeNavigate();
    };
  }, [navigate, resolved]);
}
