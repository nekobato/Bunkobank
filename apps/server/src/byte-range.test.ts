import { describe, expect, it } from "vitest";

import { createBufferResponse, parseByteRange } from "./byte-range.js";

describe("HTTP byte ranges", () => {
  it("parses bounded, open-ended, and suffix byte ranges", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({
      kind: "partial",
      range: { start: 2, end: 5 }
    });
    expect(parseByteRange("Bytes=2-5", 10)).toEqual({
      kind: "partial",
      range: { start: 2, end: 5 }
    });
    expect(parseByteRange("bytes=7-", 10)).toEqual({
      kind: "partial",
      range: { start: 7, end: 9 }
    });
    expect(parseByteRange("bytes=-4", 10)).toEqual({
      kind: "partial",
      range: { start: 6, end: 9 }
    });
    expect(parseByteRange("bytes=0-999", 10)).toEqual({
      kind: "partial",
      range: { start: 0, end: 9 }
    });
  });

  it("ignores unsupported units and rejects unusable byte ranges", () => {
    expect(parseByteRange(null, 10)).toEqual({ kind: "full" });
    expect(parseByteRange("items=0-1", 10)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=10-", 10)).toEqual({
      kind: "unsatisfiable"
    });
    expect(parseByteRange("bytes=4-2", 10)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-1,3-4", 10)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=-0", 10)).toEqual({
      kind: "unsatisfiable"
    });
  });

  it("slices generated binary assets with the same response semantics", async () => {
    const response = createBufferResponse({
      request: new Request("http://bookcafe.local/page", {
        headers: { Range: "bytes=1-3" }
      }),
      data: new Uint8Array([10, 20, 30, 40, 50]),
      contentType: "image/png"
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([20, 30, 40])
    );
  });

  it("ignores byte ranges for HEAD requests", async () => {
    const response = createBufferResponse({
      request: new Request("http://bookcafe.local/page", {
        method: "HEAD",
        headers: { Range: "bytes=1-3" }
      }),
      data: new Uint8Array([10, 20, 30, 40, 50]),
      contentType: "image/png"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("content-length")).toBe("5");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });
});
