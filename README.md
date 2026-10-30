# Blundercheck

A home-screen web app that reviews your Chess.com and Lichess games with Stockfish 19,
right on the phone, and turns your mistakes into training. Live at
https://ali-baharii.github.io/blundercheck/

Nothing is uploaded anywhere. The engine runs on the device and everything is stored there.

## What it does

**Review every game**
- Accuracy for both players and every move graded: Book, Great, Best, Excellent, Good,
  Inaccuracy, Mistake, Miss, Blunder.
- Suspected errors are double-checked with a deeper search before they're graded.
- The opening is named from the Lichess opening database, with the move where theory ended.
- Clock use: time per move, time spent on critical moves, errors made in under 3 seconds
  or with little time left.

**Understand why**
- Tactics are named: fork, pin, skewer, discovered attack or check, double check, removing
  the defender, overloaded defender, trapped piece, hanging piece, losing trade,
  back-rank and smothered mates.
- Explanations use real squares and pieces, e.g. "After Nxe5, Qg5 forks the knight on e5 and the pawn on g2."
- Your opponent's threats (found with a null-move search) are shown with a red arrow.
  The app tells you when you ignored one.
- Board tools:
  - **Best line:** step through the engine line.
  - **Threat:** show the opponent's threat.
  - **Top moves:** the engine's three best moves.
  - **Explore:** play any move and see the live engine eval.

**Learn by doing**
- **Coach:** a guided review of each game's key moments. You try each position first, then
  see what you played, why it failed, the best line and the lesson.
- **Find a better move:** retry any mistake on an interactive board.
  - **Hint ladder:** a theme hint, then the piece to move, then an arrow, then the answer.
  - **Other good moves count:** the engine checks your move, and anything just as good is accepted.
- **Train tab:** every mistake becomes a puzzle (multi-move for forcing tactics and mates).
  Puzzles come back on a spaced-repetition schedule.
  - **Ways to practice:** today's queue, by theme, or from your latest game.
  - **Progress:** a streak and solve rate per theme.
- Notes on any move ("what was I thinking?"), included in the annotated PGN export.

**See your patterns (Insights)**
- Filter by time control and date range.
- Accuracy trend, recurring problems ranked, and the tactics behind your mistakes.
- Puzzle solve rate by theme, pieces you lose most, and when mistakes happen.
- How often you convert winning positions and save lost ones.
- Your openings with score and typical first mistake, plus a weekly blunder goal.

Lessons adapt to the ratings in each game: under ~1200, hanging pieces and one-move threats
come first; 1200–1800, multi-move tactics and conversion; above, critical moments and precision.

## Put it on your iPhone

1. Open the address in **Safari** → **Share** → **Add to Home Screen**.
2. Open it from the home screen. It runs full screen, works offline, and keeps the screen
   on while analyzing (iPhone pauses web apps in the background).
3. In **Settings**, add your Chess.com and/or Lichess username.

## Getting games in

- **Recent games:** with a username set, your latest games are listed on the Analyze tab.
- **Automatic:** Settings → *Analyze new games automatically* (latest 3, or all new) runs when the app opens.
- **Paste:** in Chess.com or Lichess, Share → copy the PGN (or the game link) → *Paste game & analyze*.
  Chess.com links need your username; Lichess links work for any game.
- **PGN files** from the Files app.
- **Optional Share-sheet shortcut:** iPhone doesn't let home-screen web apps appear in the
  Share sheet, but a Shortcut can.
  1. In Shortcuts, create *Blundercheck*.
  2. Turn on *Show in Share Sheet* (receives Text and URLs).
  3. Add **URL Encode** (Shortcut Input).
  4. Add a **Text** action: `https://ali-baharii.github.io/blundercheck/#text=` followed by the encoded text.
  5. Add **Open URLs**.

  This opens Safari, which keeps its own saved data separate from the home-screen app.

## How moves are graded

Each position is evaluated with Stockfish (MultiPV 3) and converted to a win chance with the
Lichess formula. A move's grade is the win chance it gives away:

| Grade | Rule |
|---|---|
| Book | known opening theory (lichess-org/chess-openings), not counted in accuracy |
| Best | the engine's top move |
| Great | the top move when the second-best loses 20%+ (not a simple recapture) |
| Excellent / Good | under 2% / 2–5% |
| Inaccuracy / Mistake / Blunder | 5–10% / 10–20% / 20%+ |
| Miss | an inaccuracy or mistake right after your opponent's mistake |

Moves that allow a mate in 3 or fewer count as at least a mistake. Accuracy uses the Lichess
per-move formula, averaged as (mean + harmonic mean) / 2.

## Development

```
python serve.py                 # local server at http://localhost:8765
node tests/run.mjs              # fast tests (tactics, openings, spaced repetition, PGN export)
npm install && npm run test:engine   # adds full Stockfish analysis tests
node tools/build-openings.mjs   # rebuilds data/openings.json
```

Files:

```
js/app.js        screens, navigation, settings     js/analysis.js   grading, accuracy, threats, book
js/engine.js     Stockfish (UCI) in a Web Worker   js/explain.js    explanations and lessons
js/motifs.js     tactic recognition                js/solver.js     interactive "find the move"
js/guided.js     coach review                      js/training.js   puzzles and spaced repetition
js/insights.js   tips and cross-game patterns      js/openings.js   opening names and book
js/board.js      interactive SVG board             js/graph.js      charts
js/store.js      IndexedDB (games, index, puzzles, eval cache)
js/chesscom.js, js/lichess.js   public game APIs   js/sync.js       background queue, wake lock
js/pgn.js, js/pgnexport.js      PGN in and out
```

After changing files, bump `VERSION` in `sw.js` so installed apps pick up the update
(they show an "Update" banner).

## Credits and licenses

- Stockfish 19 / Stockfish.js by the Stockfish developers and Nathan Rugg, GPLv3
  (`vendor/stockfish/COPYING.txt`, source: https://github.com/nmrugg/stockfish.js)
- chess.js, BSD-2-Clause (`vendor/chess.js.LICENSE.txt`)
- Chess pieces by Cburnett, CC BY-SA 3.0, via cm-chessboard (`vendor/pieces.svg`)
- Opening names: lichess-org/chess-openings, CC0 (`data/openings.json`)

Not affiliated with Chess.com or Lichess.
