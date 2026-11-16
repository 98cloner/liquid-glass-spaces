import {useEffect, useRef, useState} from 'react';
import {NavigationPage, NavigationStack, useNavigation} from '../../glass/navigation';
import {Toolbar, ToolbarGroup, ToolbarItem, ToolbarSpacer} from '../../glass/toolbar';
import {MenuDivider, MenuItem, MenuSubmenu} from '../../glass/menu';
import {ContextMenu} from '../../glass/contextMenu';
import {ConfirmationDialog} from '../../glass/popover';
import {Sheet} from '../../glass/sheet';
import {photoURL, thumbURL} from '../photos';
import {Album, Calendar, Camera, Copy, Ellipsis, Heart, HeartFill, Hide, Info, ListView, Place, Plus, Share, Slideshow, Trash} from './icons';

type Shot = {id: string; photo: string; place: string; date: string; time: string; lens: string};
const MAIN = 'Main · 24 mm · ƒ1.78', WIDE = 'Ultra Wide · 13 mm · ƒ2.2', TELE = 'Telephoto · 120 mm · ƒ2.8';
const SHOTS: Shot[] = ([
  ['neonstreet', 'Shinjuku, Tokyo', 'Today', `${MAIN} · 1/60 s · ISO 800`], ['alley', 'Golden Gai, Tokyo', 'Today', `${MAIN} · 1/30 s · ISO 1250`],
  ['timessq', 'Times Square, New York', 'Today', `${WIDE} · 1/50 s · ISO 1000`], ['pagoda', 'Yasaka, Kyoto', 'Yesterday', `${MAIN} · 1/250 s · ISO 50`],
  ['gion', 'Gion, Kyoto', 'Yesterday', `${WIDE} · 1/500 s · ISO 32`], ['sakura', 'Kiyamachi, Kyoto', 'Yesterday', `${TELE} · 1/320 s · ISO 64`],
  ['kirkjufell', 'Kirkjufell, Iceland', 'Saturday', `${MAIN} · 1/1000 s · ISO 32`], ['canyon', 'Fjaðrárgljúfur, Iceland', 'Saturday', `${WIDE} · 1/250 s · ISO 50`],
  ['blacksand', 'Reynisfjara, Iceland', 'Saturday', `${MAIN} · 1/800 s · ISO 32`], ['highlands', 'Skógafoss, Iceland', 'Saturday', `${WIDE} · 1/400 s · ISO 40`],
  ['moonhouse', 'Snæfellsnes, Iceland', 'Saturday', `${TELE} · 1/60 s · ISO 400`], ['coast', 'Big Sur, California', '12 October', `${MAIN} · 1/1000 s · ISO 32`],
  ['seacliff', 'Étretat, France', '12 October', `${WIDE} · 1/1600 s · ISO 32`], ['headland', 'Slieve League, Ireland', '12 October', `${MAIN} · 1/800 s · ISO 32`],
  ['bluffs', 'Torrey Pines, California', '12 October', `${MAIN} · 1/1250 s · ISO 32`], ['louise', 'Lake Louise, Canada', '3 October', `${MAIN} · 1/500 s · ISO 32`],
  ['moraine', 'Moraine Lake, Canada', '3 October', `${WIDE} · 1/320 s · ISO 40`], ['mirror', 'Lake Bohinj, Slovenia', '3 October', `${MAIN} · 1/400 s · ISO 32`],
  ['mist', 'Lofoten, Norway', '3 October', `${TELE} · 1/200 s · ISO 100`], ['seceda', 'Seceda, Italy', '28 September', `${WIDE} · 1/640 s · ISO 32`],
  ['tulips', 'Lisse, Netherlands', '28 September', `${MAIN} · 1/1000 s · ISO 32`], ['poppies', 'Provence, France', '28 September', `${MAIN} · 1/800 s · ISO 32`],
  ['sunflowers', 'Tuscany, Italy', '28 September', `${WIDE} · 1/1600 s · ISO 32`], ['meadow', 'Valensole, France', '28 September', `${TELE} · 1/1000 s · ISO 50`],
] as const).map(([photo, place, date, lens], i) => ({id: photo, photo, place, date, lens, time: `${String(7 + (i * 5) % 13).padStart(2, '0')}:${String((i * 17 + 4) % 60).padStart(2, '0')}`}));

type Library = {shots: Shot[]; favs: Set<string>; fav: (id: string, on: boolean) => void; remove: (id: string) => void};

const PAGE_W = 402;
function Pager({shots, index, onIndex}: {shots: Shot[]; index: number; onIndex: (i: number) => void}) {
  const [drag, setDrag] = useState(0), [settling, setSettling] = useState(false);
  const g = useRef<{id: number; x0: number; k: number; pts: [number, number][]} | null>(null), wheel = useRef({dx: 0, timer: 0});
  useEffect(() => () => clearTimeout(wheel.current.timer), []);
  const n = shots.length, resist = (dx: number) => ((index === 0 && dx > 0) || (index === n - 1 && dx < 0) ? dx / 3 : dx);
  const release = (dx: number, v: number) => {
    const step = dx < -PAGE_W / 3 || v < -.4 ? 1 : dx > PAGE_W / 3 || v > .4 ? -1 : 0;
    setSettling(true); setDrag(0); onIndex(Math.max(0, Math.min(n - 1, index + step)));
  };
  return (
    <div className="pv-pager" data-lg-pan-x=""
      onPointerDown={(e) => { if (e.button !== 0) return; const el = e.currentTarget; el.setPointerCapture(e.pointerId); g.current = {id: e.pointerId, x0: e.clientX, k: el.getBoundingClientRect().width / el.offsetWidth || 1, pts: [[e.timeStamp, e.clientX]]}; setSettling(false); }}
      onPointerMove={(e) => { const d = g.current; if (!d || d.id !== e.pointerId) return; d.pts.push([e.timeStamp, e.clientX]); setDrag(resist((e.clientX - d.x0) / d.k)); }}
      onPointerUp={(e) => {
        const d = g.current; if (!d || d.id !== e.pointerId) return; g.current = null;
        const pts = d.pts.filter(([t]) => e.timeStamp - t <= 80), [t0, x0] = pts[0] ?? [e.timeStamp, e.clientX];
        release((e.clientX - d.x0) / d.k, e.timeStamp > t0 ? (e.clientX - x0) / d.k / (e.timeStamp - t0) : 0);
      }}
      onPointerCancel={() => { g.current = null; release(0, 0); }}
      onWheel={(e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        const w = wheel.current; w.dx -= e.deltaX; setSettling(false); setDrag(resist(Math.max(-PAGE_W, Math.min(PAGE_W, w.dx))));
        clearTimeout(w.timer);
        w.timer = window.setTimeout(() => { const dx = w.dx; w.dx = 0; release(Math.abs(dx) > 40 ? Math.sign(dx) * PAGE_W : 0, 0); }, 120);
      }}>
      <div className="pv-track" onTransitionEnd={() => setSettling(false)}
        style={{width: n * PAGE_W, transform: `translateX(${-index * PAGE_W + drag}px)`, transition: settling ? 'transform .45s cubic-bezier(.2, .9, .3, 1)' : 'none'}}>
        {shots.map((s, i) => <div key={s.id} className="pv-full" style={{backgroundImage: Math.abs(i - index) <= 1 ? `url(${photoURL(s.photo)})` : undefined}} />)}
      </div>
    </div>
  );
}

function Viewer({shot: opened, lib}: {shot: Shot; lib: Library}) {
  const [id, setId] = useState(opened.id), index = Math.max(0, lib.shots.findIndex((s) => s.id === id)), shot = lib.shots[index] ?? opened;
  const fav = lib.favs.has(shot.id), [info, setInfo] = useState(false), [asking, setAsking] = useState(false), trash = useRef<HTMLSpanElement>(null), nav = useNavigation();
  const bar = (
    <Toolbar>{[
      <ToolbarGroup key="share"><ToolbarItem icon={<Share />} aria-label="Share" menu={<>
        <MenuItem icon={<Copy />}>Copy Photo</MenuItem>
        <MenuSubmenu title="Add to Album" icon={<Album />}>
          <MenuItem>Travel</MenuItem>
          <MenuItem>Weekends</MenuItem>
          <MenuDivider />
          <MenuItem icon={<Plus size={22} />}>New Album</MenuItem>
        </MenuSubmenu>
        <MenuItem icon={<Slideshow />}>Slideshow</MenuItem>
      </>} /></ToolbarGroup>,
      <ToolbarSpacer key="a" flexible />,
      <ToolbarGroup key="mid">
        <ToolbarItem icon={fav ? <HeartFill /> : <Heart />} tint={fav ? 'red' : undefined} aria-label={fav ? 'Unfavourite' : 'Favourite'} onClick={() => lib.fav(shot.id, !fav)} />
        <ToolbarItem icon={<Info />} aria-label="Info" onClick={() => setInfo(true)} />
      </ToolbarGroup>,
      <ToolbarSpacer key="b" flexible />,
      <ToolbarGroup key="trash"><ToolbarItem ref={trash} icon={<Trash />} aria-label="Delete" onClick={() => setAsking(true)} /></ToolbarGroup>,
    ]}</Toolbar>
  );
  return (
    <NavigationPage toolbar={bar} edgeEffect="hidden" background="#000"
      trailing={<><ToolbarGroup placement="principal"><ToolbarItem aria-label={`${shot.date}, ${shot.time}`}>
        <span className="pv-title"><b>{shot.date}</b><span>{shot.time}</span></span>
      </ToolbarItem></ToolbarGroup>
      <ToolbarGroup><ToolbarItem icon={<Ellipsis />} aria-label="More" menu={<>
        <MenuItem icon={<Copy />}>Duplicate</MenuItem>
        <MenuItem icon={<Hide />}>Hide</MenuItem>
        <MenuItem icon={<Calendar />}>Adjust Date & Time</MenuItem>
        <MenuItem icon={<Place />}>Adjust Location</MenuItem>
      </>} /></ToolbarGroup></>}>
      <Pager shots={lib.shots} index={index} onIndex={(i) => setId(lib.shots[i].id)} />
      <Sheet open={info} onOpenChange={setInfo} detents={[{height: 300}, 'large']}>
        <div className="pv-info">
          <div className="pv-info-date">{shot.date}</div>
          <div className="pv-info-row"><Place /><span>{shot.place}</span></div>
          <div className="pv-info-row"><Camera /><span>{shot.lens}</span></div>
          <div className="pv-info-row"><Album /><span>{fav ? 'Favourites, ' : ''}Recents</span></div>
        </div>
      </Sheet>
      <ConfirmationDialog open={asking} onOpenChange={setAsking} anchor={trash} message="This photo will be deleted from your library."
        actions={[{label: 'Delete Photo', role: 'destructive', onSelect: () => { nav.pop(); setTimeout(() => lib.remove(shot.id), 600); }}, {label: 'Cancel', role: 'cancel'}]} />
    </NavigationPage>
  );
}

export function PhotosApp({open}: {open?: string}) {
  const [path, setPath] = useState<string[]>(open ? [open] : []), [only, setOnly] = useState(false);
  const [shots, setShots] = useState(SHOTS), [favs, setFavs] = useState(() => new Set(['pagoda', 'kirkjufell', 'moraine', 'tulips']));
  const lib: Library = {shots, favs,
    fav: (id, on) => setFavs((f) => { const n = new Set(f); if (on) n.add(id); else n.delete(id); return n; }),
    remove: (id) => setShots((s) => s.filter((x) => x.id !== id))};
  const shown = only ? shots.filter((s) => favs.has(s.id)) : shots;
  return (
    <NavigationStack path={path} onPathChange={setPath} destination={(id) => <Viewer shot={shots.find((s) => s.id === id) ?? SHOTS[0]} lib={lib} />}>
      <NavigationPage title={only ? 'Favourites' : 'Library'} titleDisplayMode="large"
        trailing={<ToolbarGroup><ToolbarItem icon={<ListView size={24} />} aria-label="Show" menu={<>
          <MenuItem checked={!only} onSelect={() => setOnly(false)}>All Photos</MenuItem>
          <MenuItem checked={only} icon={<Heart size={22} />} onSelect={() => setOnly(true)}>Favourites</MenuItem>
        </>} /></ToolbarGroup>}>
        <div className="pv-page">
          <div className="pv-grid">
            {shown.map((s) => (
              <ContextMenu key={s.id} menu={<>
                <MenuItem icon={<Copy />}>Copy</MenuItem>
                <MenuItem icon={<Share size={22} />}>Share…</MenuItem>
                <MenuItem icon={favs.has(s.id) ? <HeartFill size={22} /> : <Heart size={22} />} onSelect={() => lib.fav(s.id, !favs.has(s.id))}>{favs.has(s.id) ? 'Unfavourite' : 'Favourite'}</MenuItem>
                <MenuDivider />
                <MenuItem icon={<Trash size={22} />} destructive onSelect={() => lib.remove(s.id)}>Delete</MenuItem>
              </>}>
                <button className="pv-tile" aria-label={s.place} style={{backgroundImage: `url(${thumbURL(s.photo)})`}} onClick={() => setPath([s.id])}>
                  {favs.has(s.id) && <span className="pv-fav"><HeartFill size={14} color="#fff" /></span>}
                </button>
              </ContextMenu>
            ))}
          </div>
          <div className="pv-count">{shown.length ? `${shown.length} Photos` : 'No Favourites'}</div>
        </div>
      </NavigationPage>
    </NavigationStack>
  );
}
