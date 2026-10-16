# Changelog

Full version history for Live MLB Scoreboard, newest first. The [README](README.md) lists the three most recent updates.

**v1.0.26.0**
- Score flash is now 5 solid blinks of the scoring team's color with no text, so it reads at a glance even on light team colors
- New: right after the flash, a 3-second card shows the scoring team and how many runs scored (e.g. ATL / +2 RUNS), then the score returns
- Settings help text now says "key" instead of "button"
- Fixed: with Scoreboard keys on more than one Stream Deck (e.g. a physical deck plus a Virtual Stream Deck or Stream Deck Mobile), only one of them flashed for a run or played the end-of-game fireworks — now every deck does
- Coming back to a page with Scoreboard keys now just shows the current scores, instead of replaying a flash or fireworks for what happened while you were on another page (matches the other plugins)

**v1.0.25.0**
- Rained-out games that MLB cancels outright now show CANC instead of a 0-0 "Final" (doubleheaders included)
- Doubleheader keys (G1/G2) now use the same text sizes as Live MLB Scores

**v1.0.24.0**
- Added a high-resolution (2x) plugin icon so it stays sharp on Retina/high-DPI displays
- Plugin description now recommends 15 or more keys, matching a full regular-season slate
- Removed a stray macOS system file from the installer
- Turned off Node debug mode for release builds

**v1.0.23.0**
- Fixed: pressing a key set to MLB.tv during the Warmup state (right before first pitch, including right after a rain delay clears) fell back to Gameday instead of opening the stream — MLB.tv already carries Warmup as pre-game coverage, so it now opens directly

**v1.0.22.0**
- Coming out of a rain delay, keys now show `WARMUP` alongside the original scheduled time instead of just re-displaying that now-stale clock as if nothing happened

**v1.0.21.0**
- Each Stream Deck device (physical or virtual) now gets its own independent board — keys on a physical deck and a Virtual Stream Deck no longer compete for the same slots in one combined game list; each shows the full schedule starting from game 1

**v1.0.20.0**
- Fixed: a pre-game weather delay (e.g. "Delayed Start") could be misread as a mid-game delay because MLB's linescore data pre-populates a "Top 1" shell before first pitch — this in turn caused the previous fix's MLB.tv fallback check to think the game had started and open the stream early. Now checks the game's actual live/preview status instead

**v1.0.19.0**
- Fixed: pressing a key set to MLB.tv for a game delayed past its scheduled start time no longer opens the stream early — the plugin now checks the game's actual status instead of the clock, so a rain delay correctly falls back to Gameday until the game actually begins

**v1.0.18.0**
- Fixed: Gameday links now use the correct URL suffix for the game's actual state — pressing a key for a game that hasn't started (preview, postponed, suspended, or pre-game delay) no longer sends you to a blank `/live` page

**v1.0.17.0**
- Fixed: Gameday links now use the correct calendar date for evening games — West Coast/Mountain teams whose game time crosses into the next UTC day were getting a link one day ahead of the real game

**v1.0.16.0**
- Fixed: the All-Star Game could return a broken MLB.tv link — it now correctly falls back to Gameday since the ASG isn't carried on MLB.tv
- Internal cleanup: score/state tracking for games no longer on the day's schedule is now cleared automatically instead of accumulating indefinitely

**v1.0.15.0**
- New setting: send completed games to the end of the list, so finished games don't clutter the front of the board while others are still live

**v1.0.14.0**
- Fixed: the inning/out indicator row now stays centered when a G1 or G2 label is shown during doubleheaders

**v1.0.13.0**
- Pre-game delays now show the updated start time alongside the DELAY indicator — if the first pitch gets pushed back, the key reflects the new time within 30 seconds

**v1.0.12.0**
- Fixed: All-Star Game now shows AL @ NL instead of MLB @ MLB

**v1.0.11.0**
- Doubleheader labels: when two teams play twice in a day, each game's key now shows G1 or G2 — in the inning indicator during live play, next to "Final" when the game ends, and as a third line before the game starts

**v1.0.10.0**
- Fixed: keys no longer switch to "Top 1" during pre-game warmups before first pitch — the matchup and start time stay visible until the game actually begins

**v1.0.9.0**
- Out indicators: two dots appear to the left of the inning — gray for unrecorded outs, red for recorded outs (inspired by classic out-of-town scoreboards)

**v1.0.6.0**
- Added overflow indicator: when there are more games than keys, the last key shows how many games aren't displayed and opens MLB Scores on press

**v1.0.5.0**
- Added fill order setting: choose between top-to-bottom, left-to-right (default) or left-to-right, top-to-bottom

**v1.0.4.0**
- Updated Oakland Athletics to Athletics (ATH) to reflect team's relocation to Sacramento

**v1.0.3.0**
- Updated action and category icons to white on transparent background
- Added plugin category for Stream Deck action picker grouping

**v1.0.2.0**
- PPD and SUSP now display in red — signals the game won't happen today
- Pre-game rain delay displays DELAY in blue
- Mid-game rain delay keeps the current score visible with DELAY in blue where the inning indicator normally sits

*Note: v1.0.1 was an internal build — all changes are included here.*

**v1.0.1**
- Inning indicator and "Final" label now display in yellow
- End-of-game fireworks animation with the winning team's name and colors
