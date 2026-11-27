/**
 * Site-wide motion: smooth scroll (Lenis), scroll-scrubbed hero (GSAP ScrollTrigger), reveal-on-scroll
 * (IntersectionObserver), loops that play only on screen, card spotlights and the shortcut "presses".
 * Under prefers-reduced-motion none of it runs: content is shown in its final state.
 */
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Reveal ── */
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      revealIO.unobserve(e.target);
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
);
document.querySelectorAll('[data-reveal]').forEach((el) => revealIO.observe(el));

/* ── Loops: play while visible, pause otherwise ── */
const loops = [...document.querySelectorAll<HTMLVideoElement>('video[data-autoplay]')];
if (!reduce) {
  const loopIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting && v.offsetParent !== null) {
          if (v.preload === 'none') v.preload = 'auto';
          void v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
    },
    { threshold: 0.25 },
  );
  loops.forEach((v) => loopIO.observe(v));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loops.forEach((v) => v.pause());
  });
}

/* ── Spotlight cards ── */
document.querySelectorAll<HTMLElement>('[data-spot]').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

/* ── Shortcuts: press one key combo at a time while the strip is visible ── */
const keyItems = [...document.querySelectorAll<HTMLElement>('[data-key-item]')];
if (!reduce && keyItems.length) {
  let i = 0;
  let timer = 0;
  const step = () => {
    keyItems.forEach((k) => k.classList.remove('is-pressed'));
    keyItems[i % keyItems.length].classList.add('is-pressed');
    i++;
  };
  new IntersectionObserver(([e]) => {
    window.clearInterval(timer);
    if (e.isIntersecting) timer = window.setInterval(step, 900);
    else keyItems.forEach((k) => k.classList.remove('is-pressed'));
  }).observe(keyItems[0].parentElement!);
}

/* ── Smooth scroll + scroll-scrubbed hero ── */
if (!reduce) {
  gsap.registerPlugin(ScrollTrigger);

  const lenis = new Lenis({ anchors: { offset: -72 }, lerp: 0.11 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Dialogs lock the page.
  const sync = () => (document.querySelector('dialog[open]') ? lenis.stop() : lenis.start());
  new MutationObserver(sync).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });

  const mm = gsap.matchMedia();
  mm.add('(min-width: 48rem)', () => {
    // The app window tilts back, then lies flat as you scroll into it.
    gsap.fromTo(
      '[data-hero-mock]',
      { rotateX: 22, scale: 0.9, y: -20 },
      {
        rotateX: 0,
        scale: 1,
        y: 0,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero-stage]', start: 'top 92%', end: 'top 18%', scrub: 0.6 },
      },
    );
  });

  // The constellation drifts slower than the page (parallax).
  gsap.to('[data-eagle]', {
    yPercent: 30,
    rotate: -6,
    ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: '+=900', scrub: true },
  });

  // Big footer word rises in.
  gsap.from('.foot__word', {
    yPercent: 40,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });

  // Images and fonts change layout height: recompute triggers once settled.
  window.addEventListener('load', () => ScrollTrigger.refresh());
}
