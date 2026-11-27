# Aquila Agents — homepage & docs

The marketing site (`/ko/`, `/en/`) and the user docs (`/ko/docs/`, `/en/docs/`), built with
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build). Static output, no server.

```bash
cd site
npm install
npm run dev       # http://localhost:4321  (/ picks ko or en from the browser)
npm run build     # astro check + static build → site/dist
npm run preview   # serve site/dist
```

## How it's put together

| Path                               | What                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/pages/index.astro`            | `/` → `/ko/` or `/en/` (saved choice, else browser language)                                        |
| `src/pages/[lang]/index.astro`     | The landing page, one per language                                                                  |
| `src/components/*.astro`           | Landing sections (Hero, AppMock, Film, StatusStory, Showcase, …)                                    |
| `src/i18n/ui.ts`                   | **Every landing string, ko + en.** `en` is typed against `ko`, so a missing key fails `astro check` |
| `src/content/docs/{en,ko}/docs/**` | Docs pages (MDX). Same path in both languages                                                       |
| `src/components/docs/Shot.astro`   | `<Shot id="split" />` — a guide screen in the page's language                                       |
| `src/lib/media.ts`                 | Reads the app's guide media from `../src/features/guide/media` (no copies)                          |
| `src/scripts/motion.ts`            | Lenis smooth scroll, GSAP ScrollTrigger hero, reveal-on-scroll, loop playback                       |
| `src/styles/site.css`              | Imports `design-system/tokens.css`; adds only the site scale (display type, rhythm)                 |
| `src/styles/docs.css`              | Maps Starlight's variables onto the app tokens (light + dark)                                       |

### Rules

- **Copy in both languages.** Landing: `src/i18n/ui.ts`. Docs: write the `en` and `ko` page together.
- **Colors and motion come from the app's semantic tokens** (`--color-*`, `--motion-*`). Never `--p-*` primitives.
- **Screens are the app's own captures.** After UI changes, run `npm run capture` in the repo root; the site and
  docs pick the new media up on the next build.
- **Reduced motion** shows every section in its final state: no smooth scroll, no scrubbing, loops show posters.
- **macOS only** in user-facing copy until other platforms ship.

## Deploy

`.github/workflows/site.yml` builds and publishes to GitHub Pages on pushes to `main` that touch the site, the
tokens or the guide media. Defaults to `https://<owner>.github.io/<repo>/`; for a custom domain set the repo
variables `SITE_URL` (e.g. `https://aquila.dev`) and `SITE_BASE=/`.

Any static host works too: `SITE_URL=… SITE_BASE=/ npm run build` and upload `site/dist`.
