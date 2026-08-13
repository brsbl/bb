import { useEffect, useMemo, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  environmentServiceReferenceQuerySchema,
  type EnvironmentServiceLinkResolution,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { PageShell } from "@/components/ui/page-shell";
import {
  ENVIRONMENT_SERVICE_ROUTE_PATH,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { sdk } from "@/lib/sdk";

type ResolutionState =
  | { kind: "loading" }
  | { kind: "resolved"; resolution: EnvironmentServiceLinkResolution }
  | { kind: "invalid" };

/** Opens a durable BB service route at the destination usable by this viewer. */
export function EnvironmentServiceRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const serviceMatch = matchPath(
    ENVIRONMENT_SERVICE_ROUTE_PATH,
    location.pathname,
  );
  const { hostId, port } = serviceMatch?.params ?? {};
  const reference = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return environmentServiceReferenceQuerySchema.safeParse({
      hostId,
      port,
      path: query.get("path") ?? "",
      ...(query.has("query") ? { query: query.get("query") } : {}),
      ...(query.has("hash") ? { hash: query.get("hash") } : {}),
    });
  }, [hostId, location.search, port]);
  const [state, setState] = useState<ResolutionState>(() =>
    reference.success ? { kind: "loading" } : { kind: "invalid" },
  );

  useEffect(() => {
    if (!reference.success) {
      setState({ kind: "invalid" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    void sdk.environmentServices
      .resolve({ reference: reference.data, signal: controller.signal })
      .then((resolution) => {
        if (!controller.signal.aborted) {
          setState({ kind: "resolved", resolution });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            kind: "resolved",
            resolution: {
              kind: "unavailable",
              reason: "BB could not resolve this service link.",
            },
          });
        }
      });
    return () => controller.abort();
  }, [reference]);

  useEffect(() => {
    if (state.kind !== "resolved" || state.resolution.kind !== "destination") {
      return;
    }
    window.location.assign(state.resolution.url);
  }, [state]);

  const reason =
    state.kind === "invalid"
      ? "This environment service link is invalid."
      : state.kind === "resolved" && state.resolution.kind === "unavailable"
        ? state.resolution.reason
        : null;

  return (
    <PageShell contentClassName="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 text-center">
        <h1 className="text-lg font-medium">
          {reason ? "Service unavailable" : "Opening service…"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {reason ?? "Resolving the service for this BB viewer."}
        </p>
        {reason ? (
          <Button
            variant="outline"
            onClick={() => navigate(getRootComposeRoutePath())}
          >
            Back to BB
          </Button>
        ) : null}
      </div>
    </PageShell>
  );
}
