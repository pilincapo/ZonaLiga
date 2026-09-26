// Íconos de línea (SVG inline, sin dependencias ni fuentes remotas).

export type IconName =
  | 'search'
  | 'pin'
  | 'trophy'
  | 'users'
  | 'calendar'
  | 'bolt'
  | 'phone'
  | 'shield'
  | 'list'
  | 'whistle'
  | 'monitor'
  | 'clock';

const ICON_PATHS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/><path d="M12 14v4M8.5 20h7"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.3a3 3 0 0 1 0 5.4M17.5 20a5.6 5.6 0 0 0-1.6-3.9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
  bolt: '<path d="M13.2 2.5L5 13.4h5.3L9.8 21.5 18 10.6h-5.3l.5-8.1z"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 5.5h2M12 18.2h.01"/>',
  shield: '<path d="M12 21.5c4.7-2.3 7-6 7-10.7V5.6L12 2.7 5 5.6v5.2c0 4.7 2.3 8.4 7 10.7z"/><path d="M9 12l2 2 4-4"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  whistle: '<path d="M14 8.5h6.5v3a5.5 5.5 0 1 1-5.5-5.5H16"/><path d="M13.5 9.5h1"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M9 20.5h6M12 17v3.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

export function icon(name: IconName, size = 18): string {
  const p = ICON_PATHS[name] ?? '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
