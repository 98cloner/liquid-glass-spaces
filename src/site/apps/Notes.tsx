import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {NavigationPage, NavigationStack, useNavigation} from '../../glass/navigation';
import {Toolbar, ToolbarGroup, ToolbarItem, ToolbarSpacer} from '../../glass/toolbar';
import {MenuDivider, MenuItem, MenuSection, MenuSubmenu} from '../../glass/menu';
import {SearchBar} from '../../glass/search';
import {EditMenu} from '../../glass/editMenu';
import {Alert} from '../../glass/alert';
import {Attach, Check, Checklist, checklistImages, Compose, Ellipsis, Folder, Format, Markup, Pin, Share, Sort, Table, Trash} from './icons';

type Note = {id: string; html: string; edited: number; pinned: boolean; folder: string};
const box = (done: boolean, text: string) => `<div class="nt-check${done ? ' done' : ''}">${text}</div>`;
const NOTES: Note[] = [
  {id: 'trip', pinned: true, folder: 'Travel', edited: 6, html: `<h1>Lofoten in March</h1><div>Ferry from Bodø at 15:00, two hours. Rent the cabin in Reine for four nights.</div>${box(true, 'Book the ferry')}${box(true, 'Cabin in Reine')}${box(false, 'Wool socks, two pairs')}${box(false, 'Tripod for the aurora')}<div>Aurora forecast: check KP after dark, look north over the water.</div>`},
  {id: 'garden', pinned: true, folder: 'Home', edited: 30, html: `<h1>Balcony garden</h1><div>Basil and thyme on the sunny rail; the fern in the shade by the door.</div>${box(false, 'Repot the olive tree')}${box(true, 'New planter, sand finish')}<div>Water the herbs every second morning.</div>`},
  {id: 'pasta', pinned: false, folder: 'Recipes', edited: 120, html: `<h1>Lemon pasta</h1><div>Zest two lemons into butter, a ladle of the pasta water, parmesan off the heat. Black pepper, lots.</div>`},
  {id: 'books', pinned: false, folder: 'Notes', edited: 1440, html: `<h1>Books to read</h1>${box(true, 'The Overstory')}${box(false, 'A Field Guide to Getting Lost')}${box(false, 'The Living Mountain')}`},
  {id: 'ideas', pinned: false, folder: 'Notes', edited: 4320, html: `<h1>Gift ideas</h1><div>A planter for Mum, film for Ivo’s camera, the blue scarf from the market.</div>`},
  {id: 'run', pinned: false, folder: 'Notes', edited: 10080, html: `<h1>Running plan</h1><div>Tuesday intervals, Thursday tempo, long run on Sunday by the river.</div>`},
];
const FOLDERS = ['Notes', 'Travel', 'Home', 'Recipes'];
const ago = (min: number) => min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : min < 2880 ? 'Yesterday' : `${Math.round(min / 1440)} days ago`;
const textOf = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.children].map((c) => c.textContent ?? '').filter(Boolean); };

type Store = {notes: Note[]; save: (id: string, html: string) => void; set: (id: string, p: Partial<Note>) => void; remove: (id: string) => void};

function Editor({note, store, onEditing}: {note: Note; store: Store; onEditing: (on: boolean) => void}) {
  const el = useRef<HTMLDivElement>(null), [menu, setMenu] = useState<Range | null>(null);
  useLayoutEffect(() => { el.current!.innerHTML = note.html; }, []);
  const save = () => store.save(note.id, el.current!.innerHTML);
  const place = () => { const s = getSelection(); setMenu(s && !s.isCollapsed && s.rangeCount && el.current!.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null); };
  const act = (cmd: () => void) => () => { cmd(); save(); };
  return (
    <>
      <div ref={el} className="nt-body" style={checklistImages} contentEditable suppressContentEditableWarning spellCheck={false}
        onFocus={() => onEditing(true)} onBlur={() => { onEditing(false); setMenu(null); }} onInput={save}
        onPointerUp={() => requestAnimationFrame(place)} onKeyUp={(e) => { if (e.shiftKey) place(); }}
        onClick={(e) => { const t = e.target as HTMLElement; if (t.classList.contains('nt-check') && e.nativeEvent.offsetX < 28) { t.classList.toggle('done'); save(); } }} />
      <EditMenu open={!!menu} onOpenChange={(o) => { if (!o) setMenu(null); }} source={menu ?? {x: 0, y: 0, w: 0, h: 0}} actions={[
          {label: 'Cut', onSelect: act(() => { navigator.clipboard?.writeText(String(getSelection())).catch(() => {}); document.execCommand('delete'); })},
          {label: 'Copy', onSelect: act(() => { navigator.clipboard?.writeText(String(getSelection())).catch(() => {}); })},
          {label: 'Bold', onSelect: act(() => document.execCommand('bold'))},
          {label: 'Italic', onSelect: act(() => document.execCommand('italic'))},
        ]} />
    </>
  );
}

function NotePage({note, store}: {note: Note; store: Store}) {
  const [editing, setEditing] = useState(false), [asking, setAsking] = useState(false), body = useRef<HTMLDivElement>(null), nav = useNavigation();
  const insert = (html: string) => { const e = body.current?.querySelector<HTMLElement>('.nt-body'); e?.focus(); document.execCommand('insertHTML', false, html); };
  const done = () => (document.activeElement as HTMLElement | null)?.blur();
  const bar = (
    <Toolbar>{editing ? [
      <ToolbarGroup key="tools">
        <ToolbarItem key="format" icon={<Format />} aria-label="Format" onPointerDown={(e) => e.preventDefault()} onClick={() => document.execCommand('bold')} />
        <ToolbarItem key="check" icon={<Checklist />} aria-label="Checklist" onPointerDown={(e) => e.preventDefault()} onClick={() => insert(box(false, '&#8203;'))} />
        <ToolbarItem key="table" icon={<Table />} aria-label="Table" />
        <ToolbarItem key="attach" icon={<Attach />} aria-label="Attach" />
      </ToolbarGroup>,
      <ToolbarSpacer key="s" flexible />,
      <ToolbarGroup key="end"><ToolbarItem key="done" prominent tint="yellow" icon={<Check />} aria-label="Done" onPointerDown={(e) => e.preventDefault()} onClick={done} /></ToolbarGroup>,
    ] : [
      <ToolbarGroup key="tools">
        <ToolbarItem key="check" icon={<Checklist />} aria-label="Checklist" onClick={() => insert(box(false, '&#8203;'))} />
        <ToolbarItem key="attach" icon={<Attach />} aria-label="Attach" />
        <ToolbarItem key="markup" icon={<Markup />} aria-label="Markup" />
      </ToolbarGroup>,
      <ToolbarSpacer key="s" flexible />,
      <ToolbarGroup key="end"><ToolbarItem key="compose" icon={<Compose />} aria-label="New Note" /></ToolbarGroup>,
    ]}</Toolbar>
  );
  return (
    <NavigationPage toolbar={bar} trailing={<>
      <ToolbarGroup><ToolbarItem icon={<Share size={26} />} aria-label="Share" /></ToolbarGroup>
      <ToolbarGroup><ToolbarItem icon={<Ellipsis size={26} />} aria-label="More" menu={<>
        <MenuItem icon={<Pin />} onSelect={() => store.set(note.id, {pinned: !note.pinned})}>{note.pinned ? 'Unpin Note' : 'Pin Note'}</MenuItem>
        <MenuSubmenu title="Move to Folder" icon={<Folder />}>
          {FOLDERS.map((f) => <MenuItem key={f} checked={note.folder === f} onSelect={() => store.set(note.id, {folder: f})}>{f}</MenuItem>)}
        </MenuSubmenu>
        <MenuDivider />
        <MenuItem icon={<Trash size={22} />} destructive onSelect={() => setAsking(true)}>Delete</MenuItem>
      </>} /></ToolbarGroup>
    </>}>
      <div ref={body} className="nt-page">
        <div className="nt-stamp">{note.folder} · Edited {ago(note.edited)}</div>
        <Editor note={note} store={store} onEditing={setEditing} />
      </div>
      <Alert open={asking} onOpenChange={setAsking} title="Delete this note?" message="It moves to Recently Deleted for 30 days."
        actions={[{label: 'Cancel', role: 'cancel'}, {label: 'Delete', role: 'destructive', onSelect: () => { nav.pop(); setTimeout(() => store.remove(note.id), 600); }}]} />
    </NavigationPage>
  );
}

function Rows({notes, open}: {notes: Note[]; open: (id: string) => void}) {
  return (
    <div className="nt-cell">
      {notes.map((n) => {
        const [title, ...rest] = textOf(n.html);
        return (
          <button key={n.id} className="nt-row" onClick={() => open(n.id)}>
            <span className="nt-row-title">{title}</span>
            <span className="nt-row-sub"><b>{ago(n.edited)}</b> {rest.join(' ')}</span>
          </button>
        );
      })}
    </div>
  );
}

export function NotesApp() {
  const [path, setPath] = useState<string[]>([]), [query, setQuery] = useState(''), [order, setOrder] = useState<'edited' | 'title'>('edited');
  const [notes, setNotes] = useState(NOTES);
  const store: Store = {notes,
    save: (id, html) => setNotes((ns) => ns.map((n) => (n.id === id ? {...n, html, edited: 0} : n))),
    set: (id, p) => setNotes((ns) => ns.map((n) => (n.id === id ? {...n, ...p} : n))),
    remove: (id) => setNotes((ns) => ns.filter((n) => n.id !== id))};
  const compose = () => { const id = `new-${Date.now()}`; setNotes((ns) => [{id, html: '<h1>New Note</h1><div><br></div>', edited: 0, pinned: false, folder: 'Notes'}, ...ns]); setPath([id]); };
  const q = query.trim().toLowerCase();
  const shown = notes.filter((n) => !q || textOf(n.html).join(' ').toLowerCase().includes(q))
    .sort((a, b) => order === 'title' ? textOf(a.html)[0].localeCompare(textOf(b.html)[0]) : a.edited - b.edited);
  const section = (name: string, list: Note[]): ReactNode => list.length ? <><div className="nt-section">{name}</div><Rows notes={list} open={(id) => setPath([id])} /></> : null;
  return (
    <NavigationStack path={path} onPathChange={setPath} destination={(id) => {
      const n = notes.find((x) => x.id === id);
      return n ? <NotePage note={n} store={store} /> : null;
    }}>
      <NavigationPage title="Notes" titleDisplayMode="large" background="var(--nt-bg)"
        toolbar={<SearchBar text={query} onTextChange={setQuery} prompt="Search" />}
        trailing={<>
          <ToolbarGroup><ToolbarItem icon={<Sort size={26} />} aria-label="Sort" menu={<MenuSection title="Sort By">
            <MenuItem checked={order === 'edited'} onSelect={() => setOrder('edited')}>Date Edited</MenuItem>
            <MenuItem checked={order === 'title'} onSelect={() => setOrder('title')}>Title</MenuItem>
          </MenuSection>} /></ToolbarGroup>
          <ToolbarGroup><ToolbarItem icon={<Compose size={26} />} aria-label="New Note" onClick={compose} /></ToolbarGroup>
        </>}>
        <div className="nt-list">
          {section('Pinned', shown.filter((n) => n.pinned))}
          {section(q ? 'Results' : 'Notes', shown.filter((n) => !n.pinned))}
          {!shown.length && <div className="nt-none">No results for “{query.trim()}”</div>}
          <div className="nt-count">{notes.length} Notes</div>
        </div>
      </NavigationPage>
    </NavigationStack>
  );
}
