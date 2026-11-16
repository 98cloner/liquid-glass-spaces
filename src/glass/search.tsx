import {Input} from '@base-ui/react/input';
import {Button as BaseButton} from '@base-ui/react/button';
import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {NamedIcon} from './react';
import {Toolbar, ToolbarGroup, ToolbarItem, ToolbarSpacer, useBar} from './toolbar';
import {containerMorph, type MorphSettings} from './morph';

/** Props of `SearchBar`. */
export interface SearchBarProps {
  /** The query. */
  text: string;
  /** Called as the query changes. */
  onTextChange: (text: string) => void;
  /** Its placeholder (default "Search"). */
  prompt?: string;
  /** Called on Return. */
  onSubmit?: (text: string) => void;
  /** Called when editing begins and ends. */
  onActiveChange?: (active: boolean) => void;
  /** The software keyboard's height in CSS px (0: none). While editing, the field moves above it. `useKeyboardHeight()` reads the browser's. */
  keyboard?: number;
  /** Your own magnifier. */
  icon?: ReactNode;
  style?: CSSProperties;
}

const BAR = {inset: 28, height: 48, gap: 12, close: 48}, KEY = {inset: 12}, ICON = {x: 18, y: 14.33}, TEXT = {x: 46.33, y: 14, right: 19.33}, CLEAR = 20;
export const SEARCH_FIELD_MORPH: MorphSettings = {...containerMorph(12),
  transition: [.26, .25], appear: [.5, .3], delay: {factor: .4, min: .1, max: .2},
  pulse: {up: [.1, .25], height: [.176, .4], heightDelay: .08, width: [.196, .4], widthDelay: .1, maxScale: 1.2, maxPoints: 10, blur: null}, maxDistance: 12,
  kick: {...containerMorph(12).kick, scale: 0}};


/** A search field in a bottom bar (a `<Toolbar>` holding it, at the bottom of the screen). */
export function SearchBar({style, ...props}: SearchBarProps) {
  return <Toolbar style={style}><SearchField {...props} /></Toolbar>;
}

export function SearchField({text, onTextChange, prompt = 'Search', onSubmit, onActiveChange, keyboard = 0, icon, leaving = null}: Omit<SearchBarProps, 'style'> & {leaving?: (() => void) | null}) {
  const [active, setActive] = useState(false);
  const input = useRef<HTMLInputElement>(null), bar = useBar();
  const lifted = active && keyboard > 0;
  const activate = (v: boolean) => {
    if (v === active) return;
    if (bar?.live.current) for (const e of bar.morph.entries) e.snap = e.read(true);
    setActive(v); onActiveChange?.(v);
  };
  const cancel = () => { onTextChange(''); input.current?.blur(); activate(false); };
  const was = useRef(active);
  useLayoutEffect(() => {
    if (was.current !== active && bar) { bar.morph.settings = SEARCH_FIELD_MORPH; bar.morph.change(); }
    was.current = active;
  }, [active, bar]);
  useLayoutEffect(() => { bar?.setLift(lifted ? {left: KEY.inset, right: KEY.inset, bottom: keyboard + KEY.inset} : null); }, [lifted, keyboard, bar]);
  useLayoutEffect(() => () => bar?.setLift(null), [bar]);
  const [closing, setClosing] = useState(false), shownBefore = useRef(false);
  if (shownBefore.current && !active && !closing && bar?.live.current) setClosing(true);
  shownBefore.current = active;
  const close = active || closing;
  return <>
    {
}
    <ToolbarGroup fill leaving={leaving} style={{cursor: 'text'}} onPointerDown={(e) => { if (!active) e.preventDefault(); }} onPointerUp={() => input.current?.focus()}>
      {
}
      <span data-lg-fill="" style={{position: 'absolute', inset: 0}}><span {...{drawable: ''}} data-lg-item="" style={{position: 'absolute', inset: 0}}>
        <span style={{position: 'absolute', left: ICON.x, top: ICON.y, color: 'var(--lg-label)', lineHeight: 0}}>{icon ?? <NamedIcon name="magnifyingglass" size={17} />}</span>
        <Input ref={input} type="search" value={text} placeholder={prompt} aria-label={prompt} enterKeyHint="search"
          onChange={(e) => onTextChange(e.target.value)} onFocus={() => activate(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(text); if (e.key === 'Escape') cancel(); }}
          className="lg-search-input"
          style={{position: 'absolute', left: TEXT.x, top: TEXT.y, right: TEXT.right + (active && text ? CLEAR + 4 : 0), height: 20.333,
            fontSize: 17, lineHeight: '20.333px', fontWeight: 400, color: 'var(--lg-label)', caretColor: 'rgb(20, 111, 225)'}} />
        {active && text && <BaseButton nativeButton={false} render={<span />} data-lg-ring="" aria-label="Clear text" onPointerDown={(e) => e.preventDefault()} onClick={() => { onTextChange(''); input.current?.focus(); }}
          style={{position: 'absolute', right: TEXT.right, top: (BAR.height - CLEAR) / 2, width: CLEAR, height: CLEAR, color: 'var(--lg-label)', lineHeight: 0, cursor: 'default'}}>
          <NamedIcon name="xmark.circle.fill" size={17} />
        </BaseButton>}
      </span></span>
    </ToolbarGroup>
    { }
    {active && <ToolbarSpacer />}
    {close && <ToolbarGroup leaving={leaving ?? (active ? null : () => setClosing(false))}>
      <ToolbarItem icon="xmark" aria-label="Cancel" onPointerDown={(e) => e.preventDefault()} onClick={cancel} />
    </ToolbarGroup>}
  </>;
}
(SearchField as unknown as {toolbarGroup: boolean}).toolbarGroup = true;

/** The software keyboard's height over the page's bottom in CSS px (from the visual viewport; 0 without one). */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const vk = (navigator as unknown as {virtualKeyboard?: EventTarget & {boundingRect: DOMRect; overlaysContent: boolean}}).virtualKeyboard, vv = window.visualViewport;
    const read = () => setH(vk?.overlaysContent ? vk.boundingRect.height : vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0);
    vk?.addEventListener('geometrychange', read); vv?.addEventListener('resize', read); read();
    return () => { vk?.removeEventListener('geometrychange', read); vv?.removeEventListener('resize', read); };
  }, []);
  return h;
}
