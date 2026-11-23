// Inline images in live preview (T67): a link target in a note → the URL the editor loads it from. Local files go
// through `aquila-note://local/<absolute path>` (main serves only images inside an enabled source); `data:` images
// as they are; remote images are left as text (the window's CSP doesn't load them).

/** `a/./b/../c` → `a/c`, keeping a leading `/`. */
function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/');
}

/** The URL to show `target` (as written in `![](target)`) from the note at `notePath`, or null. */
export function imageSrc(notePath: string, target: string): string | null {
  let t = target.trim().replace(/^<|>$/g, '');
  if (/^data:image\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return null;
  t = t.split(/[?#]/)[0]!;
  try {
    t = decodeURI(t);
  } catch {
    /* written unencoded */
  }
  const dir = notePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const abs = normalize(t.startsWith('/') ? t : `${dir}/${t}`);
  return `aquila-note://local/${encodeURIComponent(abs)}`;
}
