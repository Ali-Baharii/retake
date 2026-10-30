// Chess.com public API (no login needed; only public game data).

const API = 'https://api.chess.com/pub/player/';

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('No Chess.com player with that username.');
  if (!res.ok) throw new Error(`Chess.com didn't respond (error ${res.status}). Try again in a minute.`);
  return res.json();
}

// Most recent games first. Looks back through monthly archives until it has `limit` games.
export async function recentGames(username, limit = 25) {
  const user = username.trim().toLowerCase();
  if (!user) return [];
  const { archives = [] } = await getJson(API + encodeURIComponent(user) + '/games/archives');
  const out = [];
  for (let k = archives.length - 1; k >= 0 && out.length < limit && k >= archives.length - 3; k--) {
    const { games = [] } = await getJson(archives[k]);
    for (let j = games.length - 1; j >= 0 && out.length < limit; j--) {
      const g = games[j];
      if (!g.pgn || (g.rules && g.rules !== 'chess')) continue;
      out.push(simplify(g, user));
    }
  }
  return out;
}

function simplify(g, user) {
  const meWhite = g.white.username.toLowerCase() === user;
  const me = meWhite ? g.white : g.black;
  const opp = meWhite ? g.black : g.white;
  const res = me.result === 'win' ? 'win'
    : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result) ? 'draw'
    : 'loss';
  return {
    source: 'chess.com',
    url: g.url,
    pgn: g.pgn,
    endTime: g.end_time ? g.end_time * 1000 : null,
    timeClass: g.time_class,
    color: meWhite ? 'w' : 'b',
    opponent: opp.username,
    opponentRating: opp.rating,
    myRating: me.rating,
    result: res,
  };
}

// Find a shared game link (chess.com/game/live/123…) in the user's recent games.
export async function findByUrl(username, id) {
  const games = await recentGames(username, 200);
  return games.find((g) => g.url && g.url.endsWith('/' + id)) || null;
}
