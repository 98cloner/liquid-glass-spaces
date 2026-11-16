import {useState, type CSSProperties} from 'react';
import {NavigationPage, NavigationStack} from '../../glass/navigation';
import {Toolbar, ToolbarGroup, ToolbarItem, ToolbarSpacer} from '../../glass/toolbar';
import {Menu, MenuDivider, MenuItem, MenuSubmenu} from '../../glass/menu';
import {GlassContainer} from '../../glass/react';
import {Button} from '../../glass/button';
import {Picker} from '../../glass/picker';
import {Slider} from '../../glass/slider';
import {Toggle} from '../../glass/toggle';
import {Sheet, type SheetDetent} from '../../glass/sheet';
import {supercircleURL} from '../../glass/supercircle';
import {photoURL} from '../photos';
import {Bag, Check, Ellipsis, Folder, Heart, HeartFill, Link, Plus, Share, Trash} from './icons';

type Product = {id: string; name: string; price: number; photo: string; at: string; kind: 'Indoor' | 'Outdoor'; blurb: string};
const PRODUCTS: Product[] = [
  {id: 'facet', name: 'Facet', price: 38, photo: 'facet', at: '50% 50%', kind: 'Indoor', blurb: 'Matte white ceramic with a faceted relief that catches the window light. Made for a sill or a shelf.'},
  {id: 'ivory', name: 'Ivory', price: 44, photo: 'ivory', at: '50% 60%', kind: 'Indoor', blurb: 'A tall, plain cylinder in glazed ivory: room for a fiddle leaf fig to grow into. Drainage hole and saucer.'},
  {id: 'terracotta', name: 'Terracotta', price: 42, photo: 'terracotta', at: '50% 55%', kind: 'Outdoor', blurb: 'Hand-thrown clay with a white wash. Breathable, so roots stay healthy through the seasons.'},
  {id: 'sunset', name: 'Sunset', price: 36, photo: 'sunset', at: '60% 60%', kind: 'Outdoor', blurb: 'Classic unglazed terracotta, frost-proof, with a rolled rim. A monstera’s favourite.'},
  {id: 'blush', name: 'Blush', price: 29, photo: 'blush', at: '50% 50%', kind: 'Indoor', blurb: 'Speckled stoneware in soft pink, stackable. A trailing spider plant spills over it beautifully.'},
  {id: 'bowl', name: 'Bowl', price: 54, photo: 'bowl', at: '50% 70%', kind: 'Outdoor', blurb: 'A wide, low clay bowl for succulents and cacti. Heavy enough to stand firm in the wind.'},
];
const byId = (id: string) => PRODUCTS.find((p) => p.id === id)!;
const FINISHES = ['Natural', 'Charcoal', 'Sand'];
const diameterOf = (size: number) => Math.round(15 + 25 * size);
const usd = (n: number) => `$${n}`;
type Line = {id: string; qty: number; finish: number; size: number; gift: boolean};

const rounded = (w: number, h: number, r: number): CSSProperties => {
  const url = supercircleURL(w, h, r, devicePixelRatio || 1, 'circular');
  return {maskImage: `url(${url})`, WebkitMaskImage: `url(${url})`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%'};
};
function Photo({p, w, h, r}: {p: Product; w: number; h: number; r: number}) {
  return <div className="photo" style={{width: w, height: h, background: `url(${photoURL(p.photo)}) ${p.at} / cover`, ...(r ? rounded(w, h, r) : null)}} />;
}
const TITLE2 = Math.ceil(22 * 2444 / 2048 * (devicePixelRatio || 1) - 1e-9) / (devicePixelRatio || 1);

type Shop = {saved: Set<string>; toggleSaved: (id: string) => void; add: (line: Line) => void; showBag: () => void};

function ProductPage({p, shop}: {p: Product; shop: Shop}) {
  const [finish, setFinish] = useState(0), [size, setSize] = useState(.36), [gift, setGift] = useState(false), [added, setAdded] = useState(0);
  const saved = shop.saved.has(p.id), diameter = diameterOf(size);
  const add = () => { shop.add({id: p.id, qty: 1, finish, size, gift}); setAdded(added + 1); };
  const bar = (
    <Toolbar>{[
      <ToolbarGroup key="lead">
        <ToolbarItem key="save" icon={saved ? <HeartFill /> : <Heart />} tint={saved ? 'red' : undefined} aria-label={saved ? 'Remove from Saved' : 'Save'} onClick={() => shop.toggleSaved(p.id)} />
        <ToolbarItem key="more" icon={<Ellipsis />} aria-label="More" menu={<>
          <MenuItem icon={<Share size={22} />}>Share</MenuItem>
          <MenuItem icon={<Link />}>Copy Link</MenuItem>
          <MenuDivider />
          <MenuSubmenu title="Add to Collection" icon={<Folder />}>
            <MenuItem>Living Room</MenuItem>
            <MenuItem>Balcony</MenuItem>
            <MenuItem>Gifts</MenuItem>
            <MenuDivider />
            <MenuItem icon={<Plus size={22} />}>New Collection</MenuItem>
          </MenuSubmenu>
        </>} />
      </ToolbarGroup>,
      <ToolbarSpacer key="flexible" flexible />,
      ...(added ? [
        <ToolbarGroup key="add">
          <ToolbarItem key="n"><span style={{fontSize: 22, lineHeight: `${TITLE2}px`}}>{added}</span></ToolbarItem>
          <ToolbarItem key="plus" icon={<Plus />} aria-label="Add another" onClick={add} />
        </ToolbarGroup>,
        <ToolbarSpacer key="fixed" />,
        <ToolbarGroup key="bag"><ToolbarItem key="bag" icon={<Bag />} aria-label="Bag" onClick={shop.showBag} /></ToolbarGroup>,
      ] : [
        <ToolbarGroup key="add"><ToolbarItem key="add" prominent onClick={add}>Add to Bag</ToolbarItem></ToolbarGroup>,
      ]),
    ]}</Toolbar>
  );
  const specs: [string, string][] = [['Finish', FINISHES[finish]], ['Diameter', `${diameter} cm`], ['Height', `${Math.round(diameter * .9)} cm`],
    ['Material', p.kind === 'Indoor' ? 'Fibre-reinforced concrete' : 'Frost-proof stoneware'], ['Drainage', 'One hole, with plug']];
  return (
    <NavigationPage title={p.name} toolbar={bar}>
      <div className="page product">
        <Photo p={p} w={402} h={480} r={0} />
        <div className="section">
          <div className="heading"><span className="name">{p.name}</span><span className="price">{usd(p.price)}</span></div>
          <div className="text secondary">{p.kind} planter</div>
          <p className="text blurb">{p.blurb}</p>
        </div>
        <div className="section controls">
          <Picker options={FINISHES.map((f, k) => ({value: k, label: f}))} selection={finish} onChange={setFinish} width={346} aria-label="Finish" />
          <div className="row"><span className="text">Size</span><span className="text secondary">{diameter} cm</span></div>
          <Slider value={size} onChange={setSize} aria-label="Size" style={{width: 346}} />
          <div className="row"><span className="text">Gift Wrap</span><Toggle checked={gift} onChange={setGift} aria-label="Gift Wrap" /></div>
        </div>
        <div className="section">
          <div className="header">Specifications</div>
          {specs.map(([k, v]) => <div key={k} className="spec"><span className="text">{k}</span><span className="text secondary">{v}</span></div>)}
        </div>
      </div>
    </NavigationPage>
  );
}

function BagSheet({lines, setQty, checkout}: {lines: Line[]; setQty: (i: number, q: number) => void; checkout: () => void}) {
  const [done, setDone] = useState(false);
  const total = lines.reduce((s, l) => s + l.qty * byId(l.id).price + (l.gift ? 5 : 0), 0);
  const pay = () => { setDone(true); setTimeout(() => { checkout(); setDone(false); }, 1400); };
  return (
    <div className="page sh-bag">
      <div className="heading"><span className="name">Bag</span><span className="price">{lines.length ? usd(total) : ''}</span></div>
      {lines.length ? <>
        {lines.map((l, i) => {
          const p = byId(l.id);
          return (
            <div key={i} className="line">
              <Photo p={p} w={64} h={64} r={10} />
              <div className="what">
                <div className="text">{p.name}</div>
                <div className="text secondary small">{FINISHES[l.finish]} · {diameterOf(l.size)} cm{l.gift ? ' · Gift wrapped' : ''}</div>
              </div>
              <Menu label={`Qty ${l.qty}`} size="small">
                <MenuItem icon={<Trash size={22} />} destructive onSelect={() => setQty(i, 0)}>Remove</MenuItem>
                <MenuDivider />
                {Array.from({length: 20}, (_, k) => <MenuItem key={k} checked={l.qty === k + 1} onSelect={() => setQty(i, k + 1)}>{String(k + 1)}</MenuItem>)}
              </Menu>
            </div>
          );
        })}
        <div className="spec"><span className="text">Shipping</span><span className="text secondary">Free</span></div>
        <div className="checkout">
          <GlassContainer spacing={8}>
            {done ? <Button key="done" variant="prominent" border="circle" size="large" icon={<Check />} aria-label="Order placed" glassId="checkout" />
              : <Button key="pay" variant="prominent" size="large" glassId="checkout" onClick={pay}>Check Out</Button>}
          </GlassContainer>
        </div>
      </> : <div className="empty text secondary">Your bag is empty.</div>}
    </div>
  );
}

export function ShopApp() {
  const [path, setPath] = useState<string[]>([]), [kind, setKind] = useState<'All' | 'Indoor' | 'Outdoor'>('All');
  const [saved, setSaved] = useState(() => new Set(['sunset', 'blush'])), [bag, setBag] = useState(false), [detent, setDetent] = useState<SheetDetent>('medium');
  const [lines, setLines] = useState<Line[]>([{id: 'sunset', qty: 2, finish: 0, size: .4, gift: false}]);
  const shop: Shop = {saved,
    toggleSaved: (id) => setSaved((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    add: (line) => setLines((ls) => {
      const k = ls.findIndex((l) => l.id === line.id && l.finish === line.finish && diameterOf(l.size) === diameterOf(line.size) && l.gift === line.gift);
      return k < 0 ? [...ls, line] : ls.map((l, i) => (i === k ? {...l, qty: Math.min(20, l.qty + 1)} : l));
    }),
    showBag: () => { setDetent('medium'); setBag(true); }};
  const items = PRODUCTS.filter((p) => kind === 'All' || p.kind === kind), count = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <>
      <NavigationStack path={path} onPathChange={setPath} destination={(id) => <ProductPage p={byId(id)} shop={shop} />}>
        <NavigationPage title="Planters" titleDisplayMode="large"
          trailing={<ToolbarGroup><ToolbarItem icon={<Bag size={26} />} aria-label={`Bag, ${count} items`} onClick={shop.showBag} /></ToolbarGroup>}>
          <div className="page">
            <div className="filter">
              <Picker options={(['All', 'Indoor', 'Outdoor'] as const).map((k) => ({value: k, label: k}))} selection={kind} onChange={setKind} width={346} aria-label="Category" />
            </div>
            <div className="grid">
              {items.map((p) => (
                <div key={p.id} className="cell">
                  <div className="tile" role="link" aria-label={p.name} onClick={() => setPath([p.id])}><Photo p={p} w={165} h={220} r={12} /></div>
                  {
}
                  <span className="unsave"><Button border="circle" style={{padding: 7}} icon={saved.has(p.id) ? <HeartFill size={22} /> : <Heart size={22} />} tint={saved.has(p.id) ? 'red' : undefined}
                    aria-label={saved.has(p.id) ? `Remove ${p.name} from Saved` : `Save ${p.name}`} onClick={() => shop.toggleSaved(p.id)} /></span>
                  <div className="text">{p.name}</div>
                  <div className="text secondary">{usd(p.price)}</div>
                </div>
              ))}
            </div>
          </div>
        </NavigationPage>
      </NavigationStack>
      <Sheet open={bag} onOpenChange={setBag} detents={['medium', 'large']} detent={detent} onDetentChange={setDetent}>
        <BagSheet lines={lines} checkout={() => { setLines([]); setTimeout(() => setBag(false), 500); }}
          setQty={(i, q) => setLines((ls) => q ? ls.map((l, k) => (k === i ? {...l, qty: q} : l)) : ls.filter((_, k) => k !== i))} />
      </Sheet>
    </>
  );
}
