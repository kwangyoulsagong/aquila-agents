/** Creator, credited in the footer, page metadata and docs. */
export const AUTHOR = 'Kwangyoul Sagong';
export const AUTHOR_URL = 'https://github.com/kwangyoulsagong';
/** Creator's LinkedIn profile URL; the footer shows the LinkedIn link only when this is set. */
export const AUTHOR_LINKEDIN = 'https://www.linkedin.com/in/%EA%B4%91%EC%97%B4-%EC%82%AC%EA%B3%B5-8626281b4';

/** Outbound links in one place. */
export const REPO = 'https://github.com/kwangyoulsagong/aquila-agents';
export const RELEASES = `${REPO}/releases`;
export const LATEST = `${REPO}/releases/latest`;

/** The version the download buttons hand out. Bump with each release (asset names come from electron-builder; GitHub turns the space into a dot). */
export const VERSION = '1.4.0';
export const DOWNLOAD_DMG = `${REPO}/releases/download/v${VERSION}/Aquila.Agents-${VERSION}-arm64.dmg`;

/** Path under the deploy base (SITE_BASE), e.g. href('/en/') → '/aquila-agents/en/'. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
