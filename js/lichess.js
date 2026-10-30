// Lichess public API (no login needed).

const LICHESS_URL = /lichess\.org\/(?:embed\/)?(?:game\/export\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?\b/;

export function findLichessUrl(text) {
  const m = String(text || '').match(LICHESS_URL);
  return m ? { id: m[1], url: `https://lichess.org/${m[1]}` } : null;
}

export async function lichessGamePgn(id) {
  const res = await fetch(`https://lichess.org/game/export/${id}?clocks=true&evals=false&opening=true`, { headers: { Accept: 'application/x-chess-pgn' } });
  if (res.status === 404) throw new Error("Couldn't find that Lichess game.");
  if (!res.ok) throw new Error(`Lichess didn't respond (error ${res.status}). Try again in a minute.`);
  return res.text();
}

export async function recentLichessGames(username, limit = 20) {
  const user = username.trim();
  if (!user) return [];
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${limit}&clocks=true&opening=true&pgnInJson=true`, {
    headers: { Accept: 'application/x-ndjson' },
  });
  if (res.status === 404) throw new Error('No Lichess player with that username.');
  if (res.status === 429) throw new Error('Lichess is rate-limiting requests. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess didn't respond (error ${res.status}).`);
  const text = await res.text();
  const lower = user.toLowerCase();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((g) => g.variant === 'standard' && g.pgn && g.players && g.players.white && g.players.black)
    .map((g) => {
      const w = g.players.white, b = g.players.black;
      const meWhite = ((w.user && w.user.name) || '').toLowerCase() === lower;
      const opp = meWhite ? b : w;
      const me = meWhite ? 'white' : 'black';
      const result = !g.winner ? 'draw' : g.winner === me ? 'win' : 'loss';
      return {
        source: 'lichess',
        url: `https://lichess.org/${g.id}`,
        pgn: g.pgn,
        endTime: g.lastMoveAt || g.createdAt,
        timeClass: g.speed,
        color: meWhite ? 'w' : 'b',
        opponent: (opp.user && opp.user.name) || (opp.aiLevel ? `Stockfish level ${opp.aiLevel}` : 'Anonymous'),
        opponentRating: opp.rating || '',
        myRating: (meWhite ? w : b).rating || '',
        result,
      };
    });
}
