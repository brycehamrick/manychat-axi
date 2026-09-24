import { describe, expect, it } from "vitest";
import { summarizeFlowDocument, summarizeNode } from "../src/flows/model.js";
import fixture from "./fixtures/flow-doc.json" with { type: "json" };

const doc = fixture as Record<string, unknown>;

describe("summarizeFlowDocument (real captured document)", () => {
  const summary = summarizeFlowDocument(doc);

  it("captures flow metadata", () => {
    expect(summary.ns).toBe("content20260922154445_584682");
    expect(summary.name).toBe("EP166 to DM FB");
    expect(summary.status).toBe("active");
    expect(summary.hasUnpublishedChanges).toBe(false);
    expect(summary.rootContentId).toBe(1284556697);
    expect(summary.nodeCount).toBe(6);
  });

  it("captures the trigger widget and its keywords", () => {
    expect(summary.widgets).toEqual([
      {
        widget_id: 60411074,
        widget_type: "feed_comment_trigger",
        status: expect.any(String),
        name: expect.any(String),
        keywords: ["EP166", "EP 166"],
      },
    ]);
  });

  it("summarizes the hook message with its quick-reply jump", () => {
    const hook = summary.nodes.find((node) => node.caption === "Send Message");
    expect(hook?.text).toContain("Endometriosis");
    expect(hook?.buttons).toEqual([
      { kind: "quick_reply", caption: "Send me the link!", targetContentId: 1283736568 },
    ]);
  });

  it("summarizes the delivery message URL button and the click tag", () => {
    const delivery = summary.nodes.find((node) => node.caption === "Send Message #1");
    expect(delivery?.buttons).toEqual([
      {
        kind: "url",
        caption: "Listen Now!",
        url: "https://drbrt.in/1FP2hSMC",
        targetContentId: 1283736570,
      },
    ]);
    const actions = summary.nodes.find((node) => node.caption === "Actions #2");
    expect(actions?.actions).toEqual([{ type: "add_tag", tagId: 97158079 }]);
  });

  it("accepts the flattened patchDraft write shape too", () => {
    const flattened = summarizeNode({
      content_id: 1,
      caption: "Send Message",
      type: "default",
      _oid: "aaa",
      messages: [{ type: "text", content: { text: "flat" }, keyboard: [] }],
      quick_replies: { buttons: [], settings: {} },
    });
    expect(flattened.text).toBe("flat");
    expect(flattened.oid).toBe("aaa");
  });
});
