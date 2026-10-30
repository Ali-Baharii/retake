# Blundercheck

A home-screen web app for iPhone that reviews your Chess.com games with Stockfish 19,
right on the phone. For every game it shows:

- **Accuracy** for you and your opponent
- **Move counts**: Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, Blunder
- **Best move** for every position, with the engine line and an arrow on the board
- **Why each error was bad**: left material hanging, walked into a tactic, missed a winning
  tactic, missed or allowed checkmate, positional or endgame errors
- **How to improve**: the top 3–5 things to work on from that game
- **Clock use**: time per move, errors made in under 3 seconds, errors made low on time
- **Insights** across all your games: average accuracy, blunders per game, recurring problems

Nothing is uploaded anywhere. The engine runs on the phone and analyses are saved on the device.

## Put it on your iPhone

1. Open the app's web address in **Safari** on the iPhone.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the home screen. It runs full screen like an app and works offline.
4. In **Settings**, enter your Chess.com username (optional, but recommended).

## Getting games in

- **Copy & paste**: Chess.com app → open a finished game → Share → PGN (tap **Copy**) →
  open Blundercheck → **Paste game & analyze**. iPhone shows a small "Paste" bubble; tap it.
- **Recent games**: with your username set, your latest games are listed on the Analyze tab.
  Tap one to analyze it. No copying needed.
- **Game links**: a copied chess.com game link also works, as long as your username is set.
- **PGN files**: "Open PGN file" picks a `.pgn` file from the Files app.

### Optional: a Share-sheet shortcut

iPhone doesn't let home-screen web apps appear in the Share sheet directly, but a Shortcut can:

1. Open **Shortcuts** → **+** → name it *Blundercheck*.
2. Tap the **ⓘ** button and turn on **Show in Share Sheet**. Set it to receive **Text** and **URLs**.
3. Add the action **URL Encode** (input: *Shortcut Input*).
4. Add the action **Text** with: `https://YOUR-ADDRESS/#text=` followed by the *URL Encoded Text* variable.
5. Add the action **Open URLs**.

Now in Chess.com: Share → PGN → **Blundercheck**. Note that this opens the game in Safari,
which keeps its own saved-game history separate from the home-screen app.

## How moves are graded

Each position is evaluated with Stockfish (MultiPV 2) and converted to a win chance with the
Lichess formula. A move's grade is the win chance it gives away:

| Grade | Win chance lost |
|---|---|
| Best | engine's top move |
| Great | the top move, when the second-best move would lose 20%+ (not a simple recapture) |
| Excellent | under 2% |
| Good | 2–5% |
| Inaccuracy | 5–10% |
| Mistake | 10–20% |
| Blunder | 20% or more |
| Miss | an inaccuracy or mistake right after your opponent's mistake (you didn't punish it) |

Accuracy uses the Lichess per-move formula, averaged as (mean + harmonic mean) / 2.
Error explanations come from playing out the engine's line and checking material and mates.

Analysis strength (Settings): Fast = depth 11, Balanced = depth 14, Deep = depth 18.

## Files

```
index.html, app.css          app shell and styles
js/app.js                    screens and navigation
js/engine.js                 Stockfish (UCI) in a Web Worker
js/analysis.js               grading, accuracy, phases, error explanations
js/insights.js               coaching tips and cross-game patterns
js/pgn.js                    PGN parsing (clocks, time control, opening name)
js/chesscom.js               Chess.com public API (recent games)
js/board.js, js/graph.js     board, eval bar and charts (SVG)
js/store.js                  IndexedDB storage
sw.js, manifest.webmanifest  offline support and home-screen install
vendor/                      Stockfish 19 lite, chess.js, piece set
serve.py                     local test server
```

## Testing locally

```
python serve.py
```

Then open http://localhost:8765. iPhone needs an HTTPS address, so for the phone use the hosted copy.

## Updating

After changing files, bump `VERSION` in `sw.js` so phones refresh their offline copy, then publish again.

## Credits and licenses

- Stockfish 19 / Stockfish.js by the Stockfish developers and Nathan Rugg, GPLv3
  (`vendor/stockfish/COPYING.txt`, source: https://github.com/nmrugg/stockfish.js)
- chess.js, BSD-2-Clause (`vendor/chess.js.LICENSE.txt`)
- Chess pieces by Cburnett, CC BY-SA 3.0, via cm-chessboard (`vendor/pieces.svg`)

Not affiliated with Chess.com.
