import {useRef, useState, type ReactNode} from 'react';
import {Glass, GlassContainer, GlassRoot, Vibrant} from '../glass/react';
import {Button} from '../glass/button';
import {Menu, MenuDivider, MenuItem, MenuSubmenu} from '../glass/menu';
import {ContextMenu} from '../glass/contextMenu';
import {Toolbar, ToolbarGroup, ToolbarItem, ToolbarSpacer} from '../glass/toolbar';
import {Tab, TabView} from '../glass/tabView';
import {SearchBar} from '../glass/search';
import {Sheet} from '../glass/sheet';
import {Alert} from '../glass/alert';
import {ConfirmationDialog} from '../glass/popover';
import {EditMenu} from '../glass/editMenu';
import {Toggle} from '../glass/toggle';
import {Slider} from '../glass/slider';
import {Picker} from '../glass/picker';
import {photoURL} from './photos';
import {useLookPlatform} from './glassLook';
import {Check, Copy, Folder, Grid, Heart, House, Plus, Share, Stack, Trash} from './apps/icons';

const H = 300, SAFE: [number, number, number, number] = [16, 0, 16, 0];
const BAR = {left: 16, right: 16, bottom: 16};
const photo = photoURL;

const CAPTION = 56;
function Card({name, photo: bg, dark, height = H, wide, wideIn2, captionInside, children}: {name: string; photo?: string; dark: boolean; height?: number; wide?: boolean; wideIn2?: boolean; captionInside?: boolean; children: ReactNode}) {
  const stage = <>{bg && <div className="site-stage-photo" style={{backgroundImage: `url(${bg})`}} />}{children}</>;
  return (
    <figure className={`site-card${wide ? ' site-wide' : ''}${wideIn2 ? ' site-wide2' : ''}`} aria-label={captionInside ? name : undefined}>
      <div className={`site-stage-wrap${captionInside ? ' site-stage-whole' : bg ? '' : ' site-plain'}`}>
        <GlassRoot dark={dark} platform={useLookPlatform()} className="site-stage-root" style={{width: '100%', height: captionInside ? height + CAPTION : height}}>
          {captionInside ? <>
            <div className={bg ? undefined : 'site-plain'} style={{position: 'absolute', left: 0, right: 0, top: 0, height}}>{stage}</div>
            <div className="site-card-caption" aria-hidden style={{position: 'absolute', left: 0, right: 0, top: height, height: CAPTION}}>{name}</div>
          </> : stage}
        </GlassRoot>
      </div>
      {!captionInside && <figcaption>{name}</figcaption>}
    </figure>
  );
}
const Center = ({children}: {children: ReactNode}) => <div className="site-stage-center">{children}</div>;

function Draggable({x = 0, y = 0, size, radius = 36, shape, variant}: {x?: number; y?: number; size: [number, number]; radius?: number | 'circle'; shape?: string; variant?: 'clear'}) {
  const [at, setAt] = useState({x, y}), drag = useRef<{x: number; y: number} | null>(null), [w, h] = size;
  return (
    <Glass interactive radius={radius} shape={shape} variant={variant} className="site-drag"
      style={{left: `calc(50% + ${at.x - w / 2}px)`, top: `calc(50% + ${at.y - h / 2}px)`, width: w, height: h}}
      onPointerDown={(e) => { drag.current = {x: e.clientX - at.x, y: e.clientY - at.y}; }}
      onPointerMove={(e) => { if (drag.current) setAt({x: e.clientX - drag.current.x, y: e.clientY - drag.current.y}); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
  );
}

const STAR = (() => {
  const c = 65, pts: string[] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 28 : 64, a = -Math.PI / 2 + i * Math.PI / 5; pts.push(`${(c + r * Math.cos(a)).toFixed(2)} ${(c + 4 + r * Math.sin(a)).toFixed(2)}`); }
  return `M${pts.join('L')}Z`;
})();

function ToolbarDemo() {
  const [editing, setEditing] = useState(false);
  return (
    <Toolbar style={BAR}>{editing ? [
      <ToolbarGroup key="a"><ToolbarItem key="share" icon={<Share />} aria-label="Share" /><ToolbarItem key="trash" icon={<Trash />} aria-label="Delete" /></ToolbarGroup>,
      <ToolbarSpacer key="s" flexible />,
      <ToolbarGroup key="b"><ToolbarItem key="done" prominent onClick={() => setEditing(false)}>Done</ToolbarItem></ToolbarGroup>,
    ] : [
      <ToolbarGroup key="a"><ToolbarItem key="select" onClick={() => setEditing(true)}>Select</ToolbarItem></ToolbarGroup>,
      <ToolbarSpacer key="s" flexible />,
      <ToolbarGroup key="b"><ToolbarItem key="add" icon={<Plus />} aria-label="Add" /></ToolbarGroup>,
    ]}</Toolbar>
  );
}

const PLANETS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn'];
function SearchDemo() {
  const [q, setQ] = useState(''), found = PLANETS.filter((p) => p.toLowerCase().includes(q.trim().toLowerCase()));
  return <>
    <div className="site-search-list">{found.length ? found.map((p) => <div key={p}>{p}</div>) : <div className="site-muted">No Results</div>}</div>
    <SearchBar text={q} onTextChange={setQ} prompt="Planets" style={BAR} />
  </>;
}

function ButtonDemo() {
  const [done, setDone] = useState(false);
  return (
    <Center>
      <GlassContainer spacing={8}>
        <div className="site-row">
          <Button glassId="cancel">Cancel</Button>
          {done ? <Button key="check" variant="prominent" border="circle" icon={<Check size={24} />} aria-label="Undo" glassId="done" onClick={() => setDone(false)} />
            : <Button key="done" variant="prominent" glassId="done" onClick={() => setDone(true)}>Done</Button>}
          <Button variant="clear" border="circle" icon={<Heart size={24} />} aria-label="Favourite" glassId="heart" />
        </div>
      </GlassContainer>
    </Center>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return <>
    <Center><Button onClick={() => setOpen(true)}>Show Sheet</Button></Center>
    <Sheet open={open} onOpenChange={setOpen} detents={['medium', 'large']} safeArea={SAFE}>
      <div className="site-sheet"><b>Sheet</b><span>Drag it up, down, or away.</span></div>
    </Sheet>
  </>;
}

function AlertDemo() {
  const [open, setOpen] = useState(false);
  return <>
    <Center><Button onClick={() => setOpen(true)}>Delete…</Button></Center>
    <Alert open={open} onOpenChange={setOpen} title="Delete this photo?" message="This can't be undone." safeArea={SAFE}
      actions={[{label: 'Cancel', role: 'cancel'}, {label: 'Delete', role: 'destructive'}]} />
  </>;
}

function DialogDemo() {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLDivElement>(null);
  return <>
    <Center><div ref={anchor}><Button border="circle" size="large" icon={<Trash />} aria-label="Delete" onClick={() => setOpen(true)} /></div></Center>
    <ConfirmationDialog open={open} onOpenChange={setOpen} anchor={anchor} safeArea={SAFE}
      actions={[{label: 'Delete Photo', role: 'destructive'}, {label: 'Cancel', role: 'cancel'}]} />
  </>;
}

function EditMenuDemo() {
  const [range, setRange] = useState<Range | null>(null), text = useRef<HTMLParagraphElement>(null);
  const read = () => { const s = getSelection(); setRange(s && !s.isCollapsed && s.rangeCount && text.current!.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null); };
  return <>
    <Center><p ref={text} className="site-select" onPointerUp={() => requestAnimationFrame(read)}>Select some of this text to bring up the edit menu.</p></Center>
    <EditMenu open={!!range} onOpenChange={(o) => { if (!o) setRange(null); }} source={range ?? {x: 0, y: 0, w: 0, h: 0}} safeArea={SAFE}
      actions={[{label: 'Copy', onSelect: () => navigator.clipboard?.writeText(String(range)).catch(() => {})}, {label: 'Look Up'}, {label: 'Share…'}]} />
  </>;
}

function TabDemo() {
  const [tab, setTab] = useState('lakes');
  const page = (p: string) => <div className="site-stage-photo" style={{backgroundImage: `url(${photo(p)})`}} />;
  return (
    <TabView selection={tab} onSelectionChange={setTab} safeArea={[0, 0, 15, 0]}>
      <Tab value="lakes" title="Lakes" icon={<House />}>{page('louise')}</Tab>
      <Tab value="coast" title="Coast" icon={<Grid />}>{page('headland')}</Tab>
      <Tab value="fields" title="Fields" icon={<Stack />}>{page('sunflowers')}</Tab>
    </TabView>
  );
}

export function Catalog({dark, tall}: {dark: boolean; tall: number}) {
  const [on, setOn] = useState(true), [value, setValue] = useState(.4), [range, setRange] = useState('Week'), [sort, setSort] = useState('Name');
  return (
    <div className="site-grid">
      <Card name="Glass" photo={photo('glass-wide')} dark={dark} wide>
        <Draggable x={-180} size={[140, 104]} /><Draggable size={[110, 110]} radius="circle" variant="clear" /><Draggable x={180} size={[130, 130]} shape={STAR} />
      </Card>
      <Card name="GlassContainer" photo={photo('container')} dark={dark}>
        { }
        <GlassContainer spacing={48} animation={null}><Draggable x={-55} size={[90, 90]} radius="circle" /><Draggable x={55} size={[90, 90]} radius="circle" /></GlassContainer>
      </Card>
      <Card name="Vibrant" photo={photo('ember')} dark>
        {
}
        <div className="site-stage-dim" />
        <Center><Glass radius={28} variant="clear" className="site-vibrant">
          <Vibrant tone="label" className="site-vibrant-line">Label</Vibrant>
          <Vibrant tone="secondary-label" className="site-vibrant-line">Secondary Label</Vibrant>
          <Vibrant tone="tab-label" className="site-vibrant-line">Vibrant</Vibrant>
          <Vibrant tone="blue" className="site-vibrant-line">Blue</Vibrant>

        </Glass></Center>
      </Card>
      <Card name="Button" photo={photo('seceda')} dark={dark}><ButtonDemo /></Card>
      <Card name="Toggle" dark={dark}><Center><Toggle checked={on} onChange={setOn} aria-label="Toggle" /></Center></Card>
      <Card name="Slider" dark={dark} wide><Center><Slider value={value} onChange={setValue} aria-label="Slider" style={{width: 420}} /></Center></Card>
      <Card name="Picker" dark={dark}>
        <Center><Picker options={['Day', 'Week', 'Month'].map((v) => ({value: v, label: v}))} selection={range} onChange={setRange} width={260} aria-label="Range" /></Center>
      </Card>
      <Card name="Toolbar" photo={photo('kirkjufell')} dark={dark}><ToolbarDemo /></Card>
      <Card name="TabView" dark={dark}><TabDemo /></Card>
      <Card name="SearchBar" dark={dark}><SearchDemo /></Card>
      <Card name="Menu" photo={photo('poppies')} dark={dark}>
        <Center><Menu label="Sort" safeArea={SAFE}>
          {['Name', 'Date', 'Size'].map((k) => <MenuItem key={k} checked={sort === k} onSelect={() => setSort(k)}>{k}</MenuItem>)}
          <MenuDivider />
          <MenuSubmenu title="Move to" icon={<Folder />}><MenuItem>Documents</MenuItem><MenuItem>Desktop</MenuItem></MenuSubmenu>
        </Menu></Center>
      </Card>
      <Card name="ContextMenu" dark={dark} captionInside>
        <Center><ContextMenu safeArea={SAFE} menu={<>
          <MenuItem icon={<Copy />}>Copy</MenuItem>
          <MenuItem icon={<Share size={22} />}>Share…</MenuItem>
          <MenuItem icon={<Trash size={22} />} destructive>Delete</MenuItem>
        </>}><div className="site-tile" style={{backgroundImage: `url(${photo('sakura')})`}} /></ContextMenu></Center>
      </Card>
      <Card name="EditMenu" dark={dark} wideIn2><EditMenuDemo /></Card>
      { }
      <Card name="Sheet" photo={photo('mist')} dark={dark} height={tall}><SheetDemo /></Card>
      <Card name="Alert" photo={photo('timessq')} dark={dark} height={tall}><AlertDemo /></Card>
      <Card name="ConfirmationDialog" photo={photo('tulips')} dark={dark} height={tall} wideIn2><DialogDemo /></Card>
    </div>
  );
}
