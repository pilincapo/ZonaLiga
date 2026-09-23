// Generador de fixture round-robin (algoritmo del círculo).
// Devuelve jornadas con pares [homeId, awayId]; con impar, cada jornada tiene un "libre".

export interface RoundPair {
  home: number;
  away: number;
}

export interface GeneratedFixture {
  rounds: RoundPair[][];
  byes: number[]; // índice de jornada => teamId libre (solo con cantidad impar)
}

/**
 * Round-robin de una vuelta. Cada equipo juega contra todos una vez.
 * teamIds se mezclan desde el caller si se quiere sorteos.
 */
export function generateRoundRobin(teamIds: number[]): GeneratedFixture {
  const ids = [...teamIds];
  if (ids.length < 2) return { rounds: [], byes: [] };

  const odd = ids.length % 2 === 1;
  if (odd) ids.push(-1); // "fantasma" = libre

  const n = ids.length; // par tras el fantasma
  const roundsCount = n - 1;
  const half = n / 2;

  const arr = [...ids]; // arr[0] fijo, el resto rota
  const rounds: RoundPair[][] = [];
  const byes: number[] = [];

  for (let r = 0; r < roundsCount; r++) {
    const pairs: RoundPair[] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a === -1 || b === -1) {
        byes[r] = a === -1 ? b : a;
        continue;
      }
      // Localía alternada para equilibrio.
      pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
    }
    rounds.push(pairs);
    // Rotación: arr[0] fijo; arr[1] pasa al final; el resto corre un lugar.
    const fixed = arr[0]!;
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  return { rounds, byes };
}

/**
 * Round-robin de ida y vuelta: la segunda vuelta es el espejo de la primera
 * (mismo orden de cruces, localía invertida).
 */
export function generateDoubleRoundRobin(teamIds: number[]): GeneratedFixture {
  const first = generateRoundRobin(teamIds);
  const second: RoundPair[][] = first.rounds.map((pairs) => pairs.map((p) => ({ home: p.away, away: p.home })));
  const byes = [...first.byes];
  for (let i = 0; i < second.length; i++) byes.push(byes[i] ?? -1);
  return { rounds: [...first.rounds, ...second], byes };
}

/** Fisher-Yates con RNG inyectable (para tests deterministas). */
export function shuffled<T>(list: T[], rng: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
