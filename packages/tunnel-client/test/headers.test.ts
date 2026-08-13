import { describe, expect, it } from "vitest";
import { CONNECT_VIEWER_ACCESS_HEADER } from "@bb/tunnel-contract";
import { headersForLoopbackRequest } from "../src/headers.js";

describe("headersForLoopbackRequest", () => {
  it("replaces, rather than forwards, a visitor-supplied Connect viewer marker", () => {
    expect(
      headersForLoopbackRequest(
        [
          [CONNECT_VIEWER_ACCESS_HEADER, "forged-token"],
          ["Origin", "https://brsbl.getbb.app"],
        ],
        {
          publicOrigin: "https://brsbl.getbb.app",
          loopbackOrigin: "http://127.0.0.1:38886",
          connectViewerAccessToken: "private-tunnel-token",
        },
      ),
    ).toEqual({
      Origin: "http://127.0.0.1:38886",
      [CONNECT_VIEWER_ACCESS_HEADER]: "private-tunnel-token",
    });
  });
});
