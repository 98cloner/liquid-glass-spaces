import {useEffect, useState, type CSSProperties} from 'react';
import {Tab, TabView} from '../../glass/tabView';
import {NavigationPage, NavigationStack} from '../../glass/navigation';
import {Sheet} from '../../glass/sheet';
import {Slider} from '../../glass/slider';
import {Button} from '../../glass/button';
import {Vibrant} from '../../glass/react';
import {photoURL, thumbURL} from '../photos';
import {Forward, Grid, House, Pause, Play, Rewind, Stack, VolumeDown, VolumeUp, Waves} from './icons';

type Album = {title: string; artist: string; photo: string; length: number};
const ALBUMS: Album[] = [
  {title: 'Low Tide', artist: 'Marina Vale', photo: 'tide', length: 214},
  {title: 'Northern Hours', artist: 'Halden', photo: 'deep', length: 251},
  {title: 'Amber', artist: 'The Field Notes', photo: 'ember', length: 188},
  {title: 'Night Rain', artist: 'Sora Lin', photo: 'drift', length: 232},
  {title: 'Dune Sessions', artist: 'Ivo & June', photo: 'orb', length: 276},
  {title: 'First Snow', artist: 'Halden', photo: 'moons', length: 199},
  {title: 'Petals', artist: 'Marina Vale', photo: 'bloom', length: 223},
  {title: 'Crossings', artist: 'City Lights', photo: 'prism', length: 241},
];
const cover = (a: Album): CSSProperties => ({backgroundImage: `url(${photoURL(a.photo)})`});
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Home({play}: {play: (a: Album) => void}) {
  return (
    <NavigationStack>
      <NavigationPage title="Home" titleDisplayMode="large">
        <div className="ma-page">
          <button className="ma-feature" style={cover(ALBUMS[1])} onClick={() => play(ALBUMS[1])}>
            <span className="ma-feature-kicker">New Album</span>
            <span className="ma-feature-title">{ALBUMS[1].title}</span>
            <span className="ma-feature-artist">{ALBUMS[1].artist}</span>
          </button>
          <div className="ma-heading">Recently Played</div>
          <div className="ma-grid">
            {ALBUMS.slice(2).concat(ALBUMS.slice(0, 2)).map((a) => (
              <button key={a.title} className="ma-album" onClick={() => play(a)}>
                <span className="ma-cover" style={cover(a)} />
                <span className="ma-title">{a.title}</span>
                <span className="ma-artist">{a.artist}</span>
              </button>
            ))}
          </div>
        </div>
      </NavigationPage>
    </NavigationStack>
  );
}

function Plain({title}: {title: string}) {
  return (
    <NavigationStack>
      <NavigationPage title={title} titleDisplayMode="large"><div className="ma-page ma-empty">{title}</div></NavigationPage>
    </NavigationStack>
  );
}

function usePosition(now: Album, playing: boolean) {
  const [at, setAt] = useState(37);
  useEffect(() => setAt(0), [now]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAt((s) => (s + 1) % now.length), 1000);
    return () => clearInterval(t);
  }, [playing, now]);
  return [at, setAt] as const;
}

export function MusicApp() {
  const [tab, setTab] = useState('home'), [now, setNow] = useState(ALBUMS[0]), [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false), [volume, setVolume] = useState(.6), [at, setAt] = usePosition(now, playing && full);
  const step = (d: number) => setNow(ALBUMS[(ALBUMS.indexOf(now) + d + ALBUMS.length) % ALBUMS.length]);
  const play = (a: Album) => { setNow(a); setPlaying(true); };
  const accessory = (
    <div className="ma-now">
      <button className="ma-now-open" aria-label="Now Playing" onClick={() => setFull(true)}>
        <span className="ma-now-cover" style={cover(now)} />
        <span className="ma-now-text"><span>{now.title}</span><span>{now.artist}</span></span>
      </button>
      <button className="ma-now-button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}</button>
      <button className="ma-now-button" aria-label="Next" onClick={() => step(1)}><Forward /></button>
    </div>
  );
  return (
    <>
      <TabView selection={tab} onSelectionChange={setTab} accessory={accessory} minimizeBehavior="onScrollDown">
        <Tab value="home" title="Home" icon={<House />}><Home play={play} /></Tab>
        <Tab value="new" title="New" icon={<Grid />}><Plain title="New" /></Tab>
        <Tab value="radio" title="Radio" icon={<Waves />}><Plain title="Radio" /></Tab>
        <Tab value="library" title="Library" icon={<Stack />}><Plain title="Library" /></Tab>
      </TabView>
      {
}
      <Sheet open={full} onOpenChange={setFull} detents={['large']} dragIndicator="visible"
        background={<div className="ma-player-bg"><div className="ma-player-bg-art" style={{backgroundImage: `url(${thumbURL(now.photo)})`}} /></div>}>
        {
}
        <div className="ma-player">
          <div className="ma-player-cover" style={cover(now)} />
          <div className="ma-player-title">{now.title}</div>
          <div className="ma-player-artist"><Vibrant tone="notification-date">{now.artist}</Vibrant></div>
          <Slider value={at / now.length} onChange={(v) => setAt(Math.round(v * now.length))} aria-label="Position" style={{width: 346}} />
          <div className="ma-player-times"><Vibrant tone="notification-date">{time(at)}</Vibrant><Vibrant tone="notification-date">−{time(now.length - at)}</Vibrant></div>
          <div className="ma-player-transport">
            <Button border="circle" size="extraLarge" icon={<Rewind size={30} />} aria-label="Previous" onClick={() => step(-1)} />
            <Button variant="prominent" border="circle" size="extraLarge" icon={playing ? <Pause size={34} /> : <Play size={34} />} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} />
            <Button border="circle" size="extraLarge" icon={<Forward size={30} />} aria-label="Next" onClick={() => step(1)} />
          </div>
          <div className="ma-player-volume"><Vibrant tone="notification-date" style={{display: 'flex'}}><VolumeDown /></Vibrant><Slider value={volume} onChange={setVolume} aria-label="Volume" style={{width: 270}} /><Vibrant tone="notification-date" style={{display: 'flex'}}><VolumeUp /></Vibrant></div>
        </div>
      </Sheet>
    </>
  );
}
