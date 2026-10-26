/** Textarea normalizes CRLF to LF. Translate its UTF-16 offsets to the source. */
export function sourceSelection(text: string, start: number, end: number) {
  const offset = (index: number) => {
    let source = 0, visible = 0;
    while (source < text.length && visible < index) {
      source += text[source] === "\r" && text[source + 1] === "\n" ? 2 : 1;
      visible++;
    }
    return source;
  };
  const from = offset(start), to = offset(end);
  return { start: from, end: to, quote: text.slice(from, to) };
}
