/**
 * Prefix root-relative links in Markdown/MDX with the deploy base (SITE_BASE), so docs can link
 * `/en/docs/start/install/` and still work under https://<owner>.github.io/<repo>/.
 * Covers <a href> and the `href` prop of MDX components like <LinkCard>.
 * @param {{ base: string }} options
 */
export default function rehypeBaseLinks({ base }) {
  const prefix = base.replace(/\/$/, '');
  /** @param {string} href */
  const fix = (href) =>
    prefix && href.startsWith('/') && !href.startsWith('//') && !href.startsWith(`${prefix}/`) ? prefix + href : href;

  /** @param {any} node */
  const walk = (node) => {
    if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string') {
      node.properties.href = fix(node.properties.href);
    }
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && Array.isArray(node.attributes)) {
      for (const a of node.attributes) {
        if (a.type === 'mdxJsxAttribute' && a.name === 'href' && typeof a.value === 'string') a.value = fix(a.value);
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return () => (/** @type {any} */ tree) => walk(tree);
}
