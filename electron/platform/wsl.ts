// WSL paths and the distro list. Pure, so they're tested on any OS.

/** `\\wsl.localhost\Ubuntu\home\me` or `\\wsl$\Ubuntu\home\me` → distro + Linux path. */
export function parseWslUnc(p: string): { distro: string; path: string } | null {
  const m = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(.*)$/i.exec(p);
  if (!m) return null;
  const rest = m[2]!.replace(/\\/g, '/').replace(/\/+$/, '');
  return { distro: m[1]!, path: rest || '/' };
}

/** Linux path in a distro → the UNC path Windows tools (fs.watch, Explorer) use. */
export function wslUncPath(distro: string, linuxPath: string): string {
  return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`;
}

/** `C:\Users\me` → `/mnt/c/Users/me`, like `wslpath -a` with the default automount root. */
export function toWslPath(winPath: string): string {
  const unc = parseWslUnc(winPath);
  if (unc) return unc.path;
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, '/');
  const rest = m[2]!.replace(/\\/g, '/').replace(/\/+$/, '');
  return `/mnt/${m[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`;
}

/**
 * `wsl.exe -l -q` prints UTF-16LE (with a BOM on some builds); newer builds honor WSL_UTF8=1 and print UTF-8.
 * Returns the distro names in the order listed (the default first).
 */
export function parseWslList(out: Buffer): string[] {
  const utf16 = out.length >= 2 && (out.includes(0) || (out[0] === 0xff && out[1] === 0xfe));
  const text = out.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\0/g, '').trim())
    .filter((l) => l && !/^docker-desktop(-data)?$/i.test(l));
}
