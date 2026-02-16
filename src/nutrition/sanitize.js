export function cleanStr(x, max = 700) {
  const s = String(x ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) : s;
}

export function cleanList(arr, maxItems = 10, maxItemLen = 220) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const s = cleanStr(it, maxItemLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
