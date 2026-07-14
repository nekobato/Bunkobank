import { describe, expect, it } from "vitest";

import {
  getBookSourceStatusLabel,
  getBookSourceStatusMessage,
  getBookSourceStatusTitle,
  isReadableBookStatus
} from "./bookAvailability";

describe("book availability", () => {
  it("treats only ready sources as readable", () => {
    expect(isReadableBookStatus("ready")).toBe(true);
    expect(isReadableBookStatus("missing")).toBe(false);
    expect(isReadableBookStatus("error")).toBe(false);
    expect(isReadableBookStatus("scanning")).toBe(false);
  });

  it("formats compact source status labels", () => {
    expect(getBookSourceStatusLabel("ready")).toBe("Ready");
    expect(getBookSourceStatusLabel("scanning")).toBe("Scanning");
    expect(getBookSourceStatusLabel("missing")).toBe("Missing");
    expect(getBookSourceStatusLabel("error")).toBe("Error");
  });

  it("explains unavailable source states with remediation text", () => {
    expect(getBookSourceStatusTitle("missing")).toBe("Source unavailable");
    expect(getBookSourceStatusMessage("missing")).toContain(
      "scan the collection root again"
    );
    expect(getBookSourceStatusTitle("error")).toBe("Source error");
    expect(getBookSourceStatusMessage("error")).toContain("Check the file");
    expect(getBookSourceStatusTitle("scanning")).toBe("Source scanning");
    expect(getBookSourceStatusMessage("scanning")).toContain(
      "after the current scan finishes"
    );
  });
});
