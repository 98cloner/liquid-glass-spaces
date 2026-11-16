import {createContext, useContext, useState} from 'react';
import {IOS26_5, IOS26_5_TINTED, type Platform} from '../glass/react';

export type Look = 'clear' | 'tinted';
const STORED = 'site-glass';

export function useLook() {
  const forced = new URLSearchParams(location.search).get('tinted');
  const read = (): Look => { try { return localStorage.getItem(STORED) === 'tinted' ? 'tinted' : 'clear'; } catch { return 'clear'; } };
  const [look, setLook] = useState<Look>(forced === null ? read : forced === '1' ? 'tinted' : 'clear');
  const choose = (l: Look) => { setLook(l); try { if (l === 'clear') localStorage.removeItem(STORED); else localStorage.setItem(STORED, l); } catch { } };
  return {look, chooseLook: choose, platform: look === 'tinted' ? IOS26_5_TINTED : IOS26_5};
}

export const LookPlatform = createContext<Platform>(IOS26_5);
export const useLookPlatform = () => useContext(LookPlatform);
