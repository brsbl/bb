import { describe, expect, it } from "vitest";
import {
  environmentServiceReferenceFromPath,
  environmentServiceReferenceSchema,
  getEnvironmentServiceLinkPath,
  resolveEnvironmentServiceUrl,
} from "../src/api/environment-services.js";

describe("environment service references", () => {
  const reference = {
    hostId: "host_service",
    port: 4173,
    path: "/preview/app",
    query: "theme=dark",
    hash: "ready",
  };

  it("persists service identity as a relative BB route", () => {
    expect(getEnvironmentServiceLinkPath(reference)).toBe(
      "/services/host_service/4173?path=%2Fpreview%2Fapp&query=theme%3Ddark&hash=ready",
    );
  });

  it("preserves path, query, and hash on a trusted resolved base", () => {
    expect(
      resolveEnvironmentServiceUrl("https://brsbl--4173.getbb.app", reference),
    ).toBe("https://brsbl--4173.getbb.app/preview/app?theme=dark#ready");
    expect(
      resolveEnvironmentServiceUrl("http://localhost:4173", reference),
    ).toBe("http://localhost:4173/preview/app?theme=dark#ready");
  });

  it("splits a CLI path into the canonical fields", () => {
    expect(
      environmentServiceReferenceFromPath({
        hostId: "host_service",
        port: 4173,
        path: "/preview/app?theme=dark#ready",
      }),
    ).toEqual(reference);
  });

  it("rejects URL-shaped path injection", () => {
    expect(
      environmentServiceReferenceSchema.safeParse({
        ...reference,
        path: "//other.example/path",
      }).success,
    ).toBe(false);
    expect(() =>
      environmentServiceReferenceFromPath({
        hostId: "host_service",
        port: 4173,
        path: "https://other.example/path",
      }),
    ).toThrow("--path must start with /");
  });
});
