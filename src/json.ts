// Models sometimes write a draft or reasoning before the final JSON, so take the
// last complete top-level value rather than the span from first "{" to last "}".
export function parseLastJson(text: string): unknown | undefined {
  let last: unknown;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue; }
    const end = findObjectEnd(text, i);
    if (end === -1) { i++; continue; }
    try {
      last = JSON.parse(text.slice(i, end + 1));
      i = end + 1;
    } catch {
      i++;
    }
  }
  return last;
}

function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}
