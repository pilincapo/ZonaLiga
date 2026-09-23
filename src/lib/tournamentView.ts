// Vista de torneo: el paquete de datos que casi todas las páginas necesitan.
//
// Antes, cada página armaba a mano el mismo conjunto (torneo + partidos +
// equipos + a veces eventos/goleadores), repitiendo el conocimiento de cómo se
// une todo. Este módulo esconde ese ensamblado: el llamador pide la vista con
// opciones y recibe el paquete coherente, en la menor cantidad de consultas
// posible (paralelizadas; nada de N+1).

import type { Event, Match, Team, Tournament } from './types.ts';
import type { ScorersRow } from './queries.ts';
import {
  activeTournament,
  getTournament,
  getTournamentBySlug,
  listMatches,
  listTeams,
  listTournaments,
  topScorers,
  tournamentEvents,
} from './queries.ts';

export interface TournamentViewOptions {
  /** Id del torneo (precede a slug); para páginas que ya resolvieron cuál mostrar. */
  id?: number;
  /** Slug del torneo; si falta, se toma el activo (o el más reciente). */
  slug?: string;
  /** Incluir equipos inactivos (lo necesitan las páginas del panel). */
  includeInactiveTeams?: boolean;
  /** Traer todos los eventos del torneo (suspensiones, planilla). */
  events?: boolean;
  /** Traer la tabla de goleadores, limitada a N. */
  scorers?: number;
}

export interface TournamentView {
  tournament: Tournament;
  matches: Match[];
  teams: Team[];
  /** Eventos del torneo: solo se llena con `events: true`; vacío en otro caso. */
  events: Event[];
  /** Goleadores: solo se llena con `scorers: N`; vacío en otro caso. */
  scorers: ScorersRow[];
}

/** Qué torneo muestra una página: por id, por slug, o el activo (o el más reciente). */
export async function resolveTournament(db: D1Database, slug?: string, id?: number): Promise<Tournament | null> {
  if (id != null) return getTournament(db, id);
  return slug ? getTournamentBySlug(db, slug) : activeTournament(db);
}

/** Torneo (por id, slug o activo) + partidos + equipos, y extras según opciones. */
export async function loadTournamentView(
  db: D1Database,
  opts: TournamentViewOptions = {}
): Promise<TournamentView | null> {
  const tournament = await resolveTournament(db, opts.slug, opts.id);
  if (!tournament) return null;

  const [matches, teams, events, scorers] = await Promise.all([
    listMatches(db, tournament.id),
    listTeams(db, opts.includeInactiveTeams ?? false),
    opts.events ? tournamentEvents(db, tournament.id) : Promise.resolve([]),
    opts.scorers ? topScorers(db, tournament.id, opts.scorers) : Promise.resolve([]),
  ]);

  return { tournament, matches, teams, events, scorers };
}

/** La misma vista para todos los torneos, sin consultas N+1. */
export async function listTournamentViews(db: D1Database): Promise<TournamentView[]> {
  const [tournaments, matches, teams] = await Promise.all([
    listTournaments(db),
    db.prepare('SELECT * FROM matches ORDER BY id').all<Match>(),
    listTeams(db, true),
  ]);

  const byTournament = new Map<number, Match[]>();
  for (const m of matches.results ?? []) {
    const arr = byTournament.get(m.tournament_id);
    if (arr) arr.push(m);
    else byTournament.set(m.tournament_id, [m]);
  }

  return (tournaments ?? []).map((tournament) => ({
    tournament,
    matches: byTournament.get(tournament.id) ?? [],
    teams,
    events: [],
    scorers: [],
  }));
}
