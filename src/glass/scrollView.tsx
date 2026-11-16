import type {CSSProperties, ReactNode, Ref} from 'react';
import {GlassLayer} from './react';

/** What content under a bar does: 'soft' (default: fades and blurs into the bar), 'hard' (a solid band behind the bar) or 'hidden' (nothing). */
export type ScrollEdgeEffect = 'soft' | 'hard' | 'hidden';

/** A scroll view whose `bars` (a `<Toolbar>`, a `<TopBar>`) stay over its content, the content treated by `edgeEffect` where it passes under them. `scrollRef`: the scrolling element. `background`: a CSS background behind the content. */
export function ScrollView({children, bars, edgeEffect = 'soft', scrollRef, pocketId, contentTop, background, className, style}: {children?: ReactNode; bars?: ReactNode; edgeEffect?: ScrollEdgeEffect;
  scrollRef?: Ref<HTMLDivElement>; pocketId?: string; contentTop?: number; background?: string; className?: string; style?: CSSProperties}) {
  return (
    <div data-lg-pocket={edgeEffect} data-lg-pocket-id={pocketId} style={{position: 'absolute', inset: 0}}>
      { }
      {background ? <GlassLayer aria-hidden style={{position: 'absolute', inset: 0, background, pointerEvents: 'none'}} /> : null}
      { }
      {
}
      <GlassLayer plain={false} data-lg-scroll="" data-lg-content-top={contentTop} ref={scrollRef} className={className}
        style={{position: 'absolute', inset: 0, overflowX: 'hidden', overflowY: 'auto', overscrollBehaviorX: 'auto', overscrollBehaviorY: 'contain', overflowAnchor: 'none', scrollbarWidth: 'none', ...style}}>{children}</GlassLayer>
      {bars}
    </div>
  );
}
