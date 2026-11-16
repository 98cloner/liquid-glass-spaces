import {createRoot} from 'react-dom/client';
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Glass, GlassContainer, GlassRoot, glassSupported, Vibrant} from '../glass/react';
import {scalePath, WORDMARK} from './wordmark';
import {supercircleURL} from '../glass/supercircle';
import {Toolbar, TopBar, ToolbarGroup, ToolbarItem} from '../glass/toolbar';
import {Catalog} from './Catalog';
import {MenuItem, MenuSection} from '../glass/menu';
import {LookPlatform, useLook, useLookPlatform, type Look} from './glassLook';
import {MusicApp} from './apps/Music';
import {PhotosApp} from './apps/Photos';
import {NotesApp} from './apps/Notes';
import {ShopApp} from './apps/Shop';
import '../showcase/showcase.css';
import {Auto, ChevronLeft, ChevronRight, Close, Expand, Lens, Moon, Sun} from './apps/icons';
import './apps/apps.css';
import './site.css';

document.documentElement.classList.add('site-photos-wait');
const releasePhotos = () => document.documentElement.classList.remove('site-photos-wait');
addEventListener('scroll', releasePhotos, {once: true, capture: true});
setTimeout(releasePhotos, 12000);

const dismissBoot = () => {
  const boot = document.getElementById('site-boot');
  if (!boot || boot.dataset.out) return;
  boot.dataset.out = '1'; boot.style.opacity = '0'; boot.style.pointerEvents = 'none';
  setTimeout(() => boot.remove(), 450);
};
setTimeout(dismissBoot, 15000);

type Appearance = 'light' | 'dark' | 'system';
const STORED = 'site-appearance';
function useAppearance() {
  const forced = new URLSearchParams(location.search).get('dark');
  const read = (): Appearance => { try { const v = localStorage.getItem(STORED); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };
  const [mode, setMode] = useState<Appearance>(forced === null ? read : forced === '1' ? 'dark' : 'light');
  const q = matchMedia('(prefers-color-scheme: dark)'), [system, setSystem] = useState(q.matches);
  useEffect(() => { const f = () => setSystem(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [q]);
  const dark = mode === 'system' ? system : mode === 'dark';
  useLayoutEffect(() => { document.documentElement.dataset.scheme = dark ? 'dark' : 'light'; }, [dark]);
  const choose = (m: Appearance) => { setMode(m); try { if (m === 'system') localStorage.removeItem(STORED); else localStorage.setItem(STORED, m); } catch { } };
  return {dark, mode, choose};
}
function useWindow() {
  const [size, setSize] = useState({w: innerWidth, h: innerHeight});
  useEffect(() => { const on = () => setSize({w: innerWidth, h: innerHeight}); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  return size;
}
const go = (id: string) => document.getElementById(id)?.scrollIntoView({behavior: 'smooth'});

function FitRoot({dark, className, bleed = 0, children}: {dark: boolean; className?: string; bleed?: number; children: ReactNode}) {
  const inner = useRef<HTMLDivElement>(null), [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current!, ro = new ResizeObserver(() => setH(Math.ceil(el.offsetHeight)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <GlassRoot dark={dark} platform={useLookPlatform()} className={`site-root ${className ?? ''}`} style={{width: `calc(100% + ${2 * bleed}px)`, height: h, margin: `0 ${-bleed}px`}}>
      <div ref={inner} style={{paddingLeft: bleed, paddingRight: bleed}}>{children}</div>
    </GlassRoot>
  );
}

const displayMask = (w: number, h: number, r: number) => `url(${supercircleURL(w, h, r, Math.max(2, devicePixelRatio || 1))}) 0 0 / ${w}px ${h}px no-repeat`;
function Phone({k, dark, full, children}: {k: number; dark: boolean; full?: {x: number; y: number; k: number} | null; children: ReactNode}) {
  const screen = displayMask(FRAME.w, FRAME.h, PHONE_CORNER), ring = `${displayMask(FRAME.w + 2, FRAME.h + 2, PHONE_CORNER + 1)}, ${screen.replace(' 0 0 /', ' 1px 1px /')}`;
  return (
    <div className="site-device" style={{width: FRAME.w * k, height: FRAME.h * k}}>
      <div className="device" style={full ? {position: 'fixed', left: full.x, top: full.y, zIndex: 1001, transform: `scale(${full.k})`, transformOrigin: '0 0'} : {transform: `scale(${k})`, transformOrigin: '0 0'}}>
        <div className="site-device-shadow" aria-hidden><div style={{mask: screen, WebkitMask: screen}} /></div>
        <div className="site-device-ring" aria-hidden style={{mask: ring, WebkitMask: ring, maskComposite: 'exclude', WebkitMaskComposite: 'xor'}} />
        <div className="display" style={{mask: screen, WebkitMask: screen}}>
          <GlassRoot className={`screen${dark ? ' dark' : ''}`} dark={dark} platform={useLookPlatform()} style={{width: 402, height: 874}}>{children}</GlassRoot>
        </div>
        <div className="island" />
      </div>
    </div>
  );
}

const PEEK = (narrow: boolean) => 40 + (narrow ? 22 : 30);

function Hero({mode, choose, look, chooseLook}: {mode: Appearance; choose: (m: Appearance) => void; look: Look; chooseLook: (l: Look) => void}) {
  const {w, h} = useWindow(), narrow = w < 760, video = useRef<HTMLVideoElement>(null);
  const k = Math.min((narrow ? w * .72 : Math.min(w * .42, 600)) / WORDMARK.w, h * .42 / WORDMARK.h), timeW = WORDMARK.w * k, timeH = WORDMARK.h * k;
  const shape = useMemo(() => scalePath(WORDMARK.d, k), [k]);
  const noteW = narrow ? Math.min(374, w - 28) : 500, noteLive = useMemo(() => ({spacing: 8, material: {size: [noteW, 24] as [number, number], progress: 1}}), [noteW]);
  useEffect(() => {
    const v = video.current!;
    v.muted = true;
    const buffered = () => v.buffered.length && v.duration && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.1;
    const check = () => { if (buffered()) { releasePhotos(); v.removeEventListener('progress', check); } };
    v.addEventListener('progress', check); v.addEventListener('error', releasePhotos, {once: true}); check();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); });
    seen.observe(v);
    return () => seen.disconnect();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const on = () => { const top = document.querySelector<HTMLElement>('main.site')?.offsetTop ?? 0; root.classList.toggle('site-snap', scrollY <= top + 50); };
    on();
    addEventListener('scroll', on, {passive: true}); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); root.classList.remove('site-snap'); };
  }, []);
  return (
    <GlassRoot dark platform={useLookPlatform()} onFirstFrame={dismissBoot} className="site-video" style={{width: '100%', height: Math.max(560, h - PEEK(narrow)), scrollSnapAlign: 'start'}}>
      <video ref={video} className="site-video-media" src="/site/hero.mp4" poster="/site/hero.jpg" muted loop playsInline preload="auto" aria-hidden="true" />
      {
}
      <div className="site-video-dim" />
      {
}
      <TopBar top={narrow ? 12 : 24} style={narrow ? undefined : {left: 48, right: 48}}>
        <ToolbarGroup><ToolbarItem icon={mode === 'light' ? <Sun /> : mode === 'dark' ? <Moon /> : <Auto />} aria-label="Appearance" menu={<>
          <MenuSection title="Appearance">
            <MenuItem icon={<Sun size={22} />} checked={mode === 'light'} onSelect={() => choose('light')}>Light</MenuItem>
            <MenuItem icon={<Moon size={22} />} checked={mode === 'dark'} onSelect={() => choose('dark')}>Dark</MenuItem>
            <MenuItem icon={<Auto size={22} />} checked={mode === 'system'} onSelect={() => choose('system')}>System</MenuItem>
          </MenuSection>
          <MenuSection title="Liquid Glass">
            <MenuItem checked={look === 'clear'} onSelect={() => chooseLook('clear')}>Clear</MenuItem>
            <MenuItem checked={look === 'tinted'} onSelect={() => chooseLook('tinted')}>Tinted</MenuItem>
          </MenuSection>
        </>} /></ToolbarGroup>
      </TopBar>
      <Glass variant="text" shape={shape} aria-hidden="true" style={{position: 'absolute', left: (w - timeW) / 2, top: Math.max(narrow ? 76 : 96, h * .11), width: timeW, height: timeH}} />
      {
}
      <GlassContainer spacing={8} live={noteLive}>
        <Glass variant="clear" radius={23.5} className={narrow ? 'site-note' : 'site-note site-note-ipad'} style={{left: (w - noteW) / 2, width: noteW}}>
          { }
          <Glass variant="clear" radius={8.5} className="site-note-icon"><Lens size={24} color="rgba(255, 255, 255, .92)" /></Glass>
          <span className="site-note-title">Liquid Glass is now on the web</span>
          <span className="site-note-body">Powered by WebGPU and <span style={{whiteSpace: 'nowrap'}}>HTML-in-Canvas.</span></span>
          <Vibrant tone="notification-date" className="site-note-time">now</Vibrant>
        </Glass>
      </GlassContainer>
      {
}
      <span className="site-unlock-bar" aria-hidden="true" />
    </GlassRoot>
  );
}

const FRAME = {w: 402, h: 874}, PHONE_CORNER = 62;
const SHELF: {name: string; note: string; dark?: boolean; app: () => ReactNode}[] = [
  {name: 'Photos', note: 'NavigationStack · Toolbar · Menu · ContextMenu · Sheet · ConfirmationDialog', dark: true, app: () => <PhotosApp open="neonstreet" />},
  {name: 'Music', note: 'TabView · Sheet · Slider · Button', app: () => <MusicApp />},
  {name: 'Notes', note: 'SearchBar · Toolbar · EditMenu · Menu · Alert', app: () => <NotesApp />},
  {name: 'Shop', note: 'Picker · Slider · Toggle · Button · GlassContainer · Sheet', app: () => <ShopApp />},
];

function Showcase({dark}: {dark: boolean}) {
  const {w, h} = useWindow(), narrow = w < 760, row = useRef<HTMLDivElement>(null);
  const k = narrow ? Math.max(.5, Math.min(1, (w - 72) / FRAME.w, (h - 300) / FRAME.h)) : Math.max(.6, Math.min(1, (h - 280) / FRAME.h));
  const [full, setFull] = useState<number | null>(null), top = narrow ? 52 : 24;
  const fk = narrow ? Math.min(w / FRAME.w, (h - top) / FRAME.h) : Math.min((w - 48) / FRAME.w, (h - 48) / FRAME.h);
  const fullAt = {x: (w - FRAME.w * fk) / 2, y: narrow ? top + (h - top - FRAME.h * fk) / 2 : (h - FRAME.h * fk) / 2, k: fk};
  useEffect(() => {
    if (full === null) return;
    const root = document.documentElement, was = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(null); };
    addEventListener('keydown', onKey);
    return () => { root.style.overflow = was; removeEventListener('keydown', onKey); };
  }, [full]);
  const step = (d: number) => row.current?.scrollBy({left: d * (FRAME.w * k + 40), behavior: 'smooth'});
  const section = useRef<HTMLElement>(null), [edge, setEdge] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const measure = () => {
      const r = section.current!.getBoundingClientRect(), page = document.documentElement.clientWidth;
      setEdge([r.left, page - r.right]);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);
  return (
    <section id="showcase" ref={section} className="site-showcase">
      <div className="site-shelf-head">
        <h2>Showcase</h2>
        { }
        {!narrow && <div className="site-shelf-buttons"><FitRoot dark={dark} bleed={24}>
          <div className="site-shelf-step">
            <Toolbar style={{position: 'relative', left: 'auto', right: 'auto', bottom: 'auto', justifyContent: 'flex-end'}}>{[
              <ToolbarGroup key="step">
                <ToolbarItem icon={<ChevronLeft />} aria-label="Previous" onClick={() => step(-1)} />
                <ToolbarItem icon={<ChevronRight />} aria-label="Next" onClick={() => step(1)} />
              </ToolbarGroup>,
            ]}</Toolbar>
          </div>
        </FitRoot></div>}
      </div>
      <div ref={row} className="site-shelf" style={{marginLeft: -edge[0], marginRight: -edge[1], paddingLeft: Math.round(edge[0]), paddingRight: Math.round(edge[1]), scrollPaddingLeft: Math.round(edge[0])}}>
        {SHELF.map((a, i) => (
          <figure key={a.name} className="site-shelf-item" style={{width: FRAME.w * k}}>
            <Phone k={k} dark={a.dark ?? dark} full={full === i ? fullAt : null}>{a.app()}</Phone>
            <figcaption>
              <div className="site-shelf-cap"><b>{a.name}</b><span>{a.note}</span></div>
              { }
              <button className="site-shelf-full" aria-label={`${a.name} full screen`} onClick={() => setFull(i)}><Expand size={18} /></button>
            </figcaption>
          </figure>
        ))}
      </div>
      {full !== null && <>
        <div className="site-full" onClick={() => setFull(null)} />
        <button className="site-full-close" aria-label="Close full screen" onClick={() => setFull(null)}><Close size={22} /></button>
      </>}
    </section>
  );
}

const CODE = `import {GlassRoot, Glass} from '@robinwongm/liquid-glass';

<GlassRoot>
  <img src="photo.jpg" />
  <Glass radius="capsule">Hello</Glass>
</GlassRoot>`;

function Site() {
  const {dark, mode, choose} = useAppearance(), {look, chooseLook, platform} = useLook(), {h} = useWindow();
  const tall = Math.round(FRAME.h * Math.max(.6, Math.min(1, (h - 260) / FRAME.h)));
  return (
    <LookPlatform.Provider value={platform}>
      <Hero mode={mode} choose={choose} look={look} chooseLook={chooseLook} />
      <main className="site">
        <Showcase dark={dark} />

        <section id="components">
          <h2>Components</h2>
          <Catalog dark={dark} tall={tall} />
        </section>

        <section id="start">
          <h2>Get Started</h2>
          <pre><code>{CODE}</code></pre>
        </section>

        <footer>
          Requires Chromium 157 or later with HTML-in-Canvas and WebGPU. Not affiliated with Apple.
          <br />Video by <a href="https://www.pexels.com/video/close-up-on-flowers-moving-on-wind-10313456/">Dmitry Marchenkov</a> on Pexels; photos from Unsplash.
        </footer>
      </main>
    </LookPlatform.Provider>
  );
}

function Unsupported() {
  useEffect(dismissBoot, []);
  return (
    <main className="site-unsupported">
      <h1>This page needs a newer Chromium.</h1>
      <p>It draws Liquid Glass with WebGPU and HTML-in-Canvas, which this browser doesn’t have. Chromium 157 or later, with both enabled.</p>
    </main>
  );
}
function KnownBug({version, onContinue}: {version: number; onContinue: () => void}) {
  useEffect(dismissBoot, []);
  return (
    <main className="site-unsupported">
      <h1>This browser has a known bug.</h1>
      <p>Chromium {version || '157 and earlier'} has a known bug in HTML-in-Canvas that can leave parts of this page undrawn as you scroll. Use Chromium 158 or later for the best experience.</p>
      <button type="button" className="site-continue" onClick={onContinue}>Continue anyway</button>
    </main>
  );
}
const CONTINUED = 'site-known-bug-continued';
const continued = () => { try { return sessionStorage.getItem(CONTINUED) === '1'; } catch { return false; } };
function Gate() {
  const [go, setGo] = useState(continued);
  const onContinue = () => { try { sessionStorage.setItem(CONTINUED, '1'); } catch { } setGo(true); };
  return chromium >= 158 || go ? <Site /> : <KnownBug version={chromium} onContinue={onContinue} />;
}
const chromium = Number((navigator as Navigator & {userAgentData?: {brands: {brand: string; version: string}[]}}).userAgentData?.brands.find((b) => b.brand === 'Chromium')?.version ?? 0);
const capable = glassSupported() && !!(await navigator.gpu.requestAdapter().catch(() => null));
createRoot(document.getElementById('root')!).render(capable ? <Gate /> : <Unsupported />);
