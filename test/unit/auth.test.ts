import { describe, it, expect } from "vitest";
import { authorize } from "../../src/auth/index.js";

const OWNER = 12345;

describe("authorize", () => {
  it("allows owner in private chat", () => {
    const r = authorize(
      { from: { id: OWNER }, chat: { id: 1, type: "private" } },
      OWNER,
    );
    expect(r).toEqual({ allow: true, reason: "owner_private" });
  });

  it("rejects non-owner in private chat", () => {
    const r = authorize(
      { from: { id: 7 }, chat: { id: 1, type: "private" } },
      OWNER,
    );
    expect(r).toEqual({ allow: false, reason: "unauthorized_private_reject" });
  });

  it("rejects any user in a group", () => {
    const r = authorize(
      { from: { id: OWNER }, chat: { id: 1, type: "group" } },
      OWNER,
    );
    expect(r).toEqual({ allow: false, reason: "unauthorized_chat_type_reject" });
  });

  it("rejects any user in a supergroup", () => {
    const r = authorize(
      { from: { id: OWNER }, chat: { id: 1, type: "supergroup" } },
      OWNER,
    );
    expect(r).toEqual({ allow: false, reason: "unauthorized_chat_type_reject" });
  });

  it("rejects any user in a channel", () => {
    const r = authorize(
      { from: { id: OWNER }, chat: { id: 1, type: "channel" } },
      OWNER,
    );
    expect(r).toEqual({ allow: false, reason: "unauthorized_chat_type_reject" });
  });

  it("returns no_from when from is missing", () => {
    const r = authorize(
      { from: undefined, chat: { id: 1, type: "private" } },
      OWNER,
    );
    expect(r).toEqual({ allow: false, reason: "no_from" });
  });
});
