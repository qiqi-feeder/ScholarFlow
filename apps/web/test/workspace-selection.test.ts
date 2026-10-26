import assert from "node:assert/strict";
import test from "node:test";
import { sourceSelection } from "../src/text-selection.js";
test("source coordinates preserve LF, CRLF, blank lines, tabs, Chinese and long text", () => {
  for (const newline of ["\n", "\r\n"]) {
    const text = `First${newline}${newline}中文\twith   spaces.${newline}${"long ".repeat(500)}`;
    const normalized = text.replaceAll("\r\n", "\n");
    const start = normalized.indexOf("中文"), end = start + 18;
    const selection = sourceSelection(text, start, end);
    assert.equal(selection.quote, text.slice(selection.start, selection.end));
    assert.equal(selection.quote.replaceAll("\r\n", "\n"), normalized.slice(start, end));
  }
});
