import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { identityFromHeaders } from "../src/identity.js";
import type { AppConfig } from "../src/types.js";

const baseConfig: AppConfig = {
  host: "127.0.0.1",
  port: 3217,
  stateDir: "/tmp/qmdui-test",
  authMode: "signed",
  apiToken: "token",
  openWebuiSharedSecret: "secret",
  enableQmdCli: false,
  enableAdminDanger: false,
  enableExternalConverters: false,
  qmdBin: "qmd"
};

describe("identity contract", () => {
  it("validates signed Open WebUI headers", () => {
    const timestamp = String(Date.now());
    const groups = "eng,docs";
    const canonical = [timestamp, "u1", "user", groups].join("\n");
    const signature = crypto.createHmac("sha256", "secret").update(canonical).digest("hex");
    const identity = identityFromHeaders(
      {
        authorization: "Bearer token",
        "x-open-webui-timestamp": timestamp,
        "x-open-webui-signature": signature,
        "x-open-webui-user-id": "u1",
        "x-open-webui-role": "user",
        "x-open-webui-groups": groups
      },
      baseConfig
    );
    expect(identity).toMatchObject({ userId: "u1", role: "user", groups: ["eng", "docs"], trusted: true });
  });

  it("rejects invalid API token", () => {
    expect(() =>
      identityFromHeaders(
        {
          authorization: "Bearer nope"
        },
        baseConfig
      )
    ).toThrow(/token/);
  });
});
