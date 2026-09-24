import { expect, it, vi } from "vitest";

import { createIterableResponse } from "./byte-range.js";

it("streams only the requested byte range and closes its source", async () => {
  const content = Buffer.from("0123456789", "utf8");
  const close = vi.fn(async () => undefined);
  const response = await createIterableResponse({
    request: new Request("http://localhost/book", {
      headers: { Range: "bytes=2-5" }
    }),
    size: content.byteLength,
    etag: '"asset-1"',
    contentType: "application/octet-stream",
    iterate: async function* ({ start, endExclusive }) {
      yield content.subarray(start, endExclusive);
    },
    close
  });

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("2345");
  expect(close).toHaveBeenCalledOnce();
});
