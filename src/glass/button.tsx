import {isValidElement, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Button as BaseButton} from '@base-ui/react/button';
import {Glass, NamedIcon, useIcon, Vibrant, type GlassProps} from './react';
import {localPoint, usePressHighlight, type PressHighlight} from './highlight';
import type {SystemColor, Tone} from './palette';

/** A button's control size, 'mini' to 'extraLarge' (default 'regular'). */
export type ButtonSize = 'mini' | 'small' | 'regular' | 'large' | 'extraLarge';
/** A button's shape: 'automatic' (a capsule), 'capsule', 'roundedRectangle', 'circle', or a corner radius in CSS px. */
export type ButtonBorder = 'automatic' | 'capsule' | 'roundedRectangle' | 'circle' | number;

/** Props of `Button`, besides `Glass`'s. */
export interface ButtonProps extends Omit<GlassProps, 'radius' | 'corner' | 'variant' | 'interactive' | 'prominent'> {
  /** 'glass' (default), 'prominent' (filled with the tint) or 'clear' (clear glass). */
  variant?: 'glass' | 'prominent' | 'clear';
  /** Control size (default 'regular'). */
  size?: ButtonSize;
  /** Shape (default 'automatic': a capsule). */
  border?: ButtonBorder;
  /** Prominent: the fill (default blue). Otherwise the label's colour: a system colour (a `#rrggbb` tint colours only prominent buttons). */
  tint?: GlassProps['tint'];
  /** An icon alone, or before the title: your element (centred on the title's line), or a name from `<GlassRoot iconSet>`. */
  icon?: string | ReactNode;
  /** The title. */
  children?: ReactNode;
}

const SPEC: Record<ButtonSize, {font: number; leading: number; h: number; v: number}> = {
  mini: {font: 15, leading: 20, h: 10, v: 5}, small: {font: 15, leading: 20, h: 10, v: 5}, regular: {font: 17, leading: 22, h: 12, v: 7},
  large: {font: 17, leading: 22, h: 20, v: 15}, extraLarge: {font: 17, leading: 22, h: 20, v: 15},
};
const lineHeight = (size: number, dpr: number) => Math.ceil(size * 2444 / 2048 * dpr - 1e-9) / dpr;

const tracks: PressHighlight['tracks'] = (el, x, y) => { const p = localPoint(el, x, y), o = 70; return p.x >= -o && p.x <= p.w + o && p.y >= -o && p.y <= p.h + o; };
const LABEL_PRESS: PressHighlight = {light: 1, dark: 1, tracks}, PLAIN_LABEL_PRESS: PressHighlight = {light: .75, dark: 1, tracks};
const labelOf = (el: HTMLElement) => [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !('lgGlyphs' in c.dataset));

/** A glass button: a title and/or an icon on interactive glass, sized by `size`. Focusable; Enter and Space press it; `onClick` fires on a release over it. */
export function Button({variant = 'glass', size = 'regular', border = 'automatic', tint, icon, style, children, ...rest}: ButtonProps) {
  const spec = SPEC[size], dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 3;
  const line = lineHeight(spec.font, dpr);
  const shape: Pick<GlassProps, 'radius' | 'corner'> = border === 'circle' ? {radius: 'circle'} : border === 'roundedRectangle' ? {radius: 'rounded'}
    : typeof border === 'number' ? {radius: border} : {radius: 'capsule'};
  const title = {display: 'block', whiteSpace: 'pre-line', lineHeight: `${spec.leading}px`, marginTop: (line - spec.leading) / 2, marginBottom: (line - spec.leading) / 2} as const;
  const symbol = typeof icon === 'string' ? icon : null, entry = useIcon(symbol ?? '', spec.font);
  const own = useRef<HTMLSpanElement>(null), [ownHeight, setOwnHeight] = useState(0);
  useLayoutEffect(() => {
    if (symbol || !own.current) return;
    const el = own.current, measure = () => setOwnHeight(parseFloat(getComputedStyle(el).height) || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [symbol]);
  const plain = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = plain.current;
    if (!el) return;
    const fit = () => { el.style.minWidth = ''; const w = parseFloat(getComputedStyle(el).width) || 0; el.style.minWidth = `${Math.ceil(w * dpr - 1e-3) / dpr}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dpr]);
  const guide = Math.round(spec.font * 1950 / 2048 * dpr) / dpr - spec.font * 1443 / 4096;
  const offset = symbol ? entry?.titleOffset ?? 0 : ownHeight / 2 - guide;
  const iconNode = (style?: object) => symbol ? <NamedIcon name={symbol} size={spec.font} style={style} />
    : <span ref={own} style={{display: 'flex', flex: 'none', ...style}}>{isValidElement(icon) ? icon : <>{icon}</>}</span>;
  const colored = (node: ReactNode, box = false) => variant !== 'prominent' && !rest.disabled && (!tint || !tint.startsWith('#'))
    ? <Vibrant tone={(tint ?? 'label') as Tone} style={{...(box ? {display: 'flex', flex: 'none'} : null), ...(tint ? null : {color: 'rgb(from currentColor 0 0 0 / calc(alpha * 1000))'})}}>{node}</Vibrant> : node;
  const press = usePressHighlight(variant === 'prominent' ? PLAIN_LABEL_PRESS : LABEL_PRESS, {targets: labelOf, click: false});
  const {disabled, onClick, onPointerDown, onKeyDown, tabIndex, ...glass} = rest;
  const label = icon && children != null ? (
    colored(<span style={{display: 'flex', alignItems: 'flex-start', gap: 8}}>
      {iconNode({marginTop: Math.max(0, -offset)})}
      { }
      <span style={{marginTop: Math.max(0, offset), textAlign: 'start'}}><span style={title}>{children}</span></span>
    </span>, true)
  ) : icon ? colored(iconNode(), true) : <span ref={plain} style={title}>{colored(children)}</span>;
  return (
    <BaseButton nativeButton={false} disabled={disabled} {...(tabIndex !== undefined ? {tabIndex} : null)} onKeyDown={(e) => onKeyDown?.(e as unknown as React.KeyboardEvent<HTMLDivElement>)}
      onPointerDown={(e) => { onPointerDown?.(e as unknown as React.PointerEvent<HTMLDivElement>); press(e as unknown as React.PointerEvent<HTMLDivElement>); }}
      onClick={(e) => { if (e.detail === 0 || e.currentTarget.dataset.lgPressHit !== '0') onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); }}
      render={(props) => (
        <Glass {...glass} {...(props as GlassProps)} data-lg-ring="inside" interactive disabled={disabled} {...shape} variant={variant === 'clear' ? 'clear' : 'regular'} prominent={variant === 'prominent'}
          tint={variant === 'prominent' ? tint : undefined}
          style={{display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'content-box', padding: `${spec.v}px ${spec.h}px`,
            fontSize: spec.font, fontWeight: 400, lineHeight: `${line}px`, textAlign: 'center', userSelect: 'none', ...style}}>
          {label}
        </Glass>
      )} />
  );
}
