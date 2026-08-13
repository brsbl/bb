// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/lib/sdk", () => ({
  sdk: { environmentServices: { resolve } },
}));

import { EnvironmentServiceRoute } from "./EnvironmentServiceRoute";

describe("EnvironmentServiceRoute", () => {
  beforeEach(() => {
    resolve.mockReset();
  });

  it("shows the server's safe unavailable result instead of manufacturing a destination", async () => {
    resolve.mockResolvedValue({
      kind: "unavailable",
      reason: "This service is not currently shared through BB Connect.",
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/services/host_air/4173?path=%2Fpreview&query=theme%3Ddark&hash=ready",
        ]}
      >
        <Routes>
          <Route
            path="/services/:hostId/:port"
            element={<EnvironmentServiceRoute />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Service unavailable" }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "This service is not currently shared through BB Connect.",
      ),
    ).not.toBeNull();
    expect(resolve).toHaveBeenCalledWith({
      reference: {
        hostId: "host_air",
        port: 4173,
        path: "/preview",
        query: "theme=dark",
        hash: "ready",
      },
      signal: expect.any(AbortSignal),
    });
  });
});
