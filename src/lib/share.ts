// Links para compartir por WhatsApp (wa.me con texto pre-armado).

import { formatDateShort } from './format.ts';

/** Construye URL absoluta a partir de un path, usando el Host del request. */
export function absoluteUrl(path: string, origin: string): string {
  return origin.replace(/\/$/, '') + path;
}

export function waLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function shareTextHome(tournamentName: string, url: string): string {
  return `⚽ ${tournamentName}\n📅 Fixture, resultados y posiciones: ${url}`;
}

export function shareTextMatchday(
  tournamentName: string,
  roundLabel: string,
  dateIso: string,
  lines: string[],
  url: string
): string {
  const head = `⚽ ${tournamentName} — ${roundLabel}`;
  const date = dateIso ? ` (${formatDateShort(dateIso)})` : '';
  return `${head}${date}\n${lines.join('\n')}\n🔗 ${url}`;
}

export function shareTextScorers(tournamentName: string, lines: string[], url: string): string {
  return `🥇 Goleadores ${tournamentName}\n${lines.join('\n')}\n🔗 ${url}`;
}

export function shareTextMatch(
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
  tournamentName: string,
  url: string
): string {
  return `⚽ ${home} ${homeGoals}-${awayGoals} ${away} — ${tournamentName}\n🔗 ${url}`;
}
