/**
 * Live MLB Scoreboard — Stream Deck Plugin
 * Displays the full day's MLB schedule across multiple keys.
 * One game per button, ordered top-to-bottom then left-to-right by start time.
 * Uses Node.js built-in modules only (net, https, crypto).
 * No npm packages required.
 */

'use strict';

const net    = require('net');
const https  = require('https');
const crypto = require('crypto');
const events = require('events');
const path   = require('path');
const fs     = require('fs');

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'plugin.log');
try { fs.writeFileSync(LOG_FILE, `=== MLB Scoreboard Plugin ${new Date().toISOString()} ===\nNode: ${process.version}\nArgs: ${process.argv.slice(2).join(' ')}\n`); } catch (e) { /* ignore */ }

function log(...args) {
    const ts   = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { /* ignore */ }
}

process.on('uncaughtException',  err => log('CRASH:', err.stack || err.message));
process.on('unhandledRejection', err => log('UNHANDLED:', String(err)));

// ── Parse Stream Deck launch arguments ───────────────────────────────────────
let sdPort, pluginUUID, registerEvent;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-port')          sdPort        = argv[i + 1];
    if (argv[i] === '-pluginUUID')    pluginUUID    = argv[i + 1];
    if (argv[i] === '-registerEvent') registerEvent = argv[i + 1];
}

log('port=' + sdPort + ' uuid=' + pluginUUID + ' event=' + registerEvent);

if (!sdPort || !pluginUUID || !registerEvent) {
    log('ERROR: Missing required args.');
    process.exit(1);
}

// ── Minimal WebSocket client (no external deps) ───────────────────────────────
class SimpleWS extends events.EventEmitter {
    constructor(port, host) {
        super();
        this.readyState  = 0;
        this._buf        = Buffer.alloc(0);
        this._handshaked = false;

        this._sock = net.createConnection(parseInt(port, 10), host || '127.0.0.1');

        this._sock.on('connect', () => {
            log('TCP connected, sending WS upgrade...');
            const key = crypto.randomBytes(16).toString('base64');
            this._sock.write([
                'GET / HTTP/1.1',
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '', '',
            ].join('\r\n'));
        });

        this._sock.on('data',  chunk => this._onData(chunk));
        this._sock.on('error', err   => { log('TCP error:', err.message); this.emit('error', err); });
        this._sock.on('close', ()    => { this.readyState = 3; log('TCP closed'); this.emit('close'); });
    }

    _onData(chunk) {
        this._buf = Buffer.concat([this._buf, chunk]);

        if (!this._handshaked) {
            let end = -1;
            for (let i = 0; i <= this._buf.length - 4; i++) {
                if (this._buf[i]===13 && this._buf[i+1]===10 &&
                    this._buf[i+2]===13 && this._buf[i+3]===10) { end = i + 4; break; }
            }
            if (end === -1) return;

            const header = this._buf.slice(0, end).toString('ascii');
            log('HTTP response:', header.split('\r\n')[0]);

            if (!header.includes('101')) {
                log('WS upgrade failed!');
                this.emit('error', new Error('WebSocket upgrade rejected'));
                return;
            }

            this._handshaked = true;
            this.readyState  = 1;
            this._buf        = this._buf.slice(end);
            log('WS handshake OK');
            this.emit('open');
        }

        this._parseFrames();
    }

    _parseFrames() {
        while (this._buf.length >= 2) {
            const b0       = this._buf[0];
            const b1       = this._buf[1];
            const opcode   = b0 & 0x0f;
            const isMasked = !!(b1 & 0x80);
            let   plen     = b1 & 0x7f;
            let   offset   = 2;

            if (plen === 126) {
                if (this._buf.length < 4) return;
                plen = this._buf.readUInt16BE(2); offset = 4;
            } else if (plen === 127) {
                if (this._buf.length < 10) return;
                plen = Number(this._buf.readBigUInt64BE(2)); offset = 10;
            }

            const maskLen = isMasked ? 4 : 0;
            const total   = offset + maskLen + plen;
            if (this._buf.length < total) return;

            let payload = Buffer.from(this._buf.slice(offset + maskLen, total));
            if (isMasked) {
                const mask = this._buf.slice(offset, offset + 4);
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            }
            this._buf = this._buf.slice(total);

            if      (opcode === 0x1) this.emit('message', payload.toString('utf8'));
            else if (opcode === 0x8) { this.readyState = 3; log('WS close frame'); this.emit('close'); return; }
            else if (opcode === 0x9) this._sendFrame(0x8a, payload); // pong — echo ping payload per RFC 6455
        }
    }

    send(str) {
        if (this.readyState !== 1) { log('WARN: send() called but WS not open (state=' + this.readyState + ')'); return; }
        this._sendFrame(0x81, Buffer.from(String(str), 'utf8'));
    }

    _sendFrame(opcode, payload) {
        const len  = payload.length;
        const mask = crypto.randomBytes(4);
        let   hdr;

        if (len < 126) {
            hdr = Buffer.alloc(6);
            hdr[0] = opcode; hdr[1] = 0x80 | len;
            mask.copy(hdr, 2);
        } else if (len < 65536) {
            hdr = Buffer.alloc(8);
            hdr[0] = opcode; hdr[1] = 0x80 | 126;
            hdr.writeUInt16BE(len, 2);
            mask.copy(hdr, 4);
        } else {
            log('WS: payload too large (' + len + ' bytes)'); return;
        }

        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        this._sock.write(Buffer.concat([hdr, masked]));
    }
}

// ── Plugin state ──────────────────────────────────────────────────────────────
// context -> { coords: { row, column }, settings: {} }
const instances  = new Map();
// gamePk -> { awayRuns, homeRuns } — tracks score changes for flash
const prevScores = new Map();
// gamePk -> last known game state string — tracks live → final transitions
const prevGameStates = new Map();
// contexts currently mid-flash animation
const flashing   = new Set();
// context -> JSON key of last rendered lines (no-redraw optimisation)
const lastRender = new Map();

let allGames         = [];        // today's games sorted by start time
let globalTimer      = null;      // single shared 30s refresh timer
let globalRefreshing = false;     // mutex: prevents overlapping fetches
let globalLinkType   = 'gameday'; // shared across all scoreboard buttons
let globalSortOrder  = 'column';  // 'column' = top→bottom, left→right | 'row' = left→right, top→bottom

// Debounce willAppear bursts (user dragging multiple buttons at once)
let refreshDebounce  = null;

// ── Connect to Stream Deck ────────────────────────────────────────────────────
log('Connecting to Stream Deck on port', sdPort);
const ws = new SimpleWS(sdPort);

ws.on('open', () => {
    log('WS open — registering plugin');
    ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
});

ws.on('message', raw => {
    let ev;
    try { ev = JSON.parse(raw); } catch (e) { log('Bad JSON:', e.message); return; }
    log('← SD event:', ev.event, ev.context ? ev.context.slice(0, 8) : '');
    try { handleEvent(ev); } catch (e) { log('handleEvent crash:', e.stack || e.message); }
});

ws.on('error', err => log('WS error:', err.message));
ws.on('close', () => {
    log('WS closed — exiting so Stream Deck can restart');
    setTimeout(() => process.exit(0), 2000);
});

// ── Stream Deck event handler ─────────────────────────────────────────────────
function handleEvent({ event, context, payload }) {
    switch (event) {

        case 'willAppear': {
            const settings = (payload && payload.settings) || {};
            const coords   = (payload && payload.coordinates) || { row: 0, column: 0 };
            instances.set(context, { coords, settings });
            if (settings.linkType)  globalLinkType  = settings.linkType;
            if (settings.sortOrder) globalSortOrder = settings.sortOrder;

            // Push current globals to any new button that has no saved settings yet,
            // so its property inspector always reflects the shared state.
            if (!settings.linkType || !settings.sortOrder) {
                ws.send(JSON.stringify({ event: 'setSettings', context, payload: { linkType: globalLinkType, sortOrder: globalSortOrder } }));
            }

            log('willAppear row=' + coords.row + ' col=' + coords.column + ' total=' + instances.size);

            // Start the shared timer if not already running
            if (!globalTimer) {
                globalTimer = setInterval(refreshAll, 30_000);
                log('Global timer started');
            }

            // Debounce: if several buttons appear in quick succession (e.g. on startup),
            // wait 300ms before refreshing so we fetch once for all of them together.
            if (refreshDebounce) clearTimeout(refreshDebounce);
            refreshDebounce = setTimeout(() => { refreshDebounce = null; refreshAll(); }, 300);
            break;
        }

        case 'willDisappear':
            instances.delete(context);
            lastRender.delete(context);
            flashing.delete(context);
            if (instances.size === 0 && globalTimer) {
                clearInterval(globalTimer);
                globalTimer = null;
                log('All buttons gone — timer stopped');
            }
            break;

        case 'didReceiveSettings': {
            const settings = (payload && payload.settings) || {};
            const inst = instances.get(context);
            if (inst) inst.settings = settings;
            if (settings.linkType)   globalLinkType  = settings.linkType;
            if (settings.sortOrder)  globalSortOrder = settings.sortOrder;
            break;
        }

        case 'keyUp': {
            const sorted    = getSortedContexts();
            const slotIndex = sorted.indexOf(context);
            const game      = slotIndex >= 0 ? (allGames[slotIndex] || null) : null;
            if (game && game.gamePk) {
                const url = buildGameUrl(game, globalLinkType);
                log('keyUp slot=' + slotIndex + ' — opening:', url);
                ws.send(JSON.stringify({ event: 'openUrl', payload: { url } }));
            } else {
                log('keyUp — no game, refreshing');
                refreshAll();
            }
            break;
        }

        case 'sendToPlugin': {
            if (payload && payload.settings) {
                const s = payload.settings;
                if (s.linkType)  globalLinkType  = s.linkType;
                if (s.sortOrder) globalSortOrder = s.sortOrder;
                // Sync the setting to every button so it persists on restart
                for (const [ctx, inst] of instances) {
                    inst.settings = { ...inst.settings, ...s };
                    ws.send(JSON.stringify({ event: 'setSettings', context: ctx, payload: inst.settings }));
                }
                // Re-render immediately so the new sort order takes effect
                if (s.sortOrder) refreshAll();
            }
            break;
        }
    }
}

// ── Sort contexts by fill order ───────────────────────────────────────────────
// 'column' = column-major: top→bottom, left→right (default)
// 'row'    = row-major:    left→right, top→bottom
function getSortedContexts() {
    return [...instances.keys()].sort((a, b) => {
        const ca = instances.get(a).coords;
        const cb = instances.get(b).coords;
        if (globalSortOrder === 'row') {
            if (ca.row !== cb.row) return ca.row - cb.row;
            return ca.column - cb.column;
        }
        // default: column-major
        if (ca.column !== cb.column) return ca.column - cb.column;
        return ca.row - cb.row;
    });
}

// ── Refresh all buttons ───────────────────────────────────────────────────────
async function refreshAll() {
    if (globalRefreshing) { log('Refresh already in progress, skipping'); return; }
    globalRefreshing = true;
    log('Refreshing scoreboard (' + instances.size + ' buttons)...');
    try {
        allGames = await fetchAllGames();
        log('Fetched ' + allGames.length + ' games');

        const sorted = getSortedContexts();
        for (let i = 0; i < sorted.length; i++) {
            renderButton(sorted[i], allGames[i] || null);
        }
    } catch (err) {
        log('refreshAll error:', err.message);
        for (const ctx of instances.keys()) {
            setButton(ctx, ['MLB', 'Err']);
        }
    } finally {
        globalRefreshing = false;
    }
}

// ── Render one button ─────────────────────────────────────────────────────────
function renderButton(context, game) {
    if (flashing.has(context)) return;

    const lines   = buildLines(game);
    const spacing = lines.some(l => typeof l === 'object') ? 1.2 : 1.4;

    if (game && game.gamePk) {
        const prevGameState = prevGameStates.get(game.gamePk);
        prevGameStates.set(game.gamePk, game.state);

        // Detect live → final transition and play fireworks
        if (prevGameState === 'live' && game.state === 'final') {
            const winnerIsHome = game.homeRuns >= game.awayRuns;
            const winnerId     = winnerIsHome ? game.homeId : game.awayId;
            log('Game over — fireworks for', teamName(winnerId));
            playFireworks(context, teamName(winnerId), teamColor(winnerId)).catch(e => log('fireworks error:', e.message));
            return;
        }

        // Detect score change on live games and flash in the scoring team's color
        if (game.state === 'live') {
            const prev = prevScores.get(game.gamePk);
            prevScores.set(game.gamePk, { awayRuns: game.awayRuns, homeRuns: game.homeRuns });
            if (prev) {
                const awayScored = game.awayRuns > prev.awayRuns;
                const homeScored = game.homeRuns > prev.homeRuns;
                if (awayScored || homeScored) {
                    const color = (awayScored && homeScored) ? '#FFFFFF'
                        : awayScored ? teamColor(game.awayId)
                                     : teamColor(game.homeId);
                    log('Score change — ' + game.matchup + ' — flashing', color);
                    flashButton(context, color, lines, spacing).catch(e => log('flash error:', e.message));
                    return;
                }
            }
        } else {
            prevScores.delete(game.gamePk);
        }
    }

    setButton(context, lines, spacing);
}

// ── Build display lines ───────────────────────────────────────────────────────
function buildLines(game) {
    if (!game) return ['No', 'Game'];

    switch (game.state) {
        case 'preview': return [game.matchup, game.time];
        case 'ppd':        return [game.matchup, { text: 'PPD',   fs: 16, color: '#E74C3C' }];
        case 'susp':       return [game.matchup, { text: 'SUSP',  fs: 16, color: '#E74C3C' }];
        case 'delay':      return [game.matchup, { text: 'DELAY', fs: 14, color: '#3498DB' }];
        case 'delay-live': return [
            { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
            { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
            { text: 'DELAY',                              fs: 14, color: '#3498DB' },
        ];
        case 'live':    return [
            { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
            { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
            { text: game.half + game.inn,                fs: 14, color: '#FFD700' },
        ];
        case 'final':   return [
            { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
            { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
            { text: 'Final',                              fs: 14, color: '#FFD700' },
        ];
        default: return ['MLB', '---'];
    }
}

// ── Team data (abbr, URL slug, primary color) ─────────────────────────────────
const TEAMS = {
    108: { abbr: 'LAA', slug: 'angels',     color: '#BA0021', name: 'Angels'       },
    109: { abbr: 'ARI', slug: 'd-backs',    color: '#A71930', name: 'D-backs'      },
    110: { abbr: 'BAL', slug: 'orioles',    color: '#DF4601', name: 'Orioles'      },
    111: { abbr: 'BOS', slug: 'red-sox',    color: '#BD3039', name: 'Red Sox'      },
    112: { abbr: 'CHC', slug: 'cubs',       color: '#0E3386', name: 'Cubs'         },
    113: { abbr: 'CIN', slug: 'reds',       color: '#C6011F', name: 'Reds'         },
    114: { abbr: 'CLE', slug: 'guardians',  color: '#E31937', name: 'Guardians'    },
    115: { abbr: 'COL', slug: 'rockies',    color: '#33006F', name: 'Rockies'      },
    116: { abbr: 'DET', slug: 'tigers',     color: '#FA4616', name: 'Tigers'       },
    117: { abbr: 'HOU', slug: 'astros',     color: '#EB6E1F', name: 'Astros'       },
    118: { abbr: 'KC',  slug: 'royals',     color: '#004687', name: 'Royals'       },
    119: { abbr: 'LAD', slug: 'dodgers',    color: '#005A9C', name: 'Dodgers'      },
    120: { abbr: 'WSH', slug: 'nationals',  color: '#AB0003', name: 'Nationals'    },
    121: { abbr: 'NYM', slug: 'mets',       color: '#002D72', name: 'Mets'         },
    133: { abbr: 'ATH', slug: 'athletics',  color: '#006B3F', name: 'Athletics'    },
    134: { abbr: 'PIT', slug: 'pirates',    color: '#FDB827', name: 'Pirates'      },
    135: { abbr: 'SD',  slug: 'padres',     color: '#FFC425', name: 'Padres'       },
    136: { abbr: 'SEA', slug: 'mariners',   color: '#005C5C', name: 'Mariners'     },
    137: { abbr: 'SF',  slug: 'giants',     color: '#FD5A1E', name: 'Giants'       },
    138: { abbr: 'STL', slug: 'cardinals',  color: '#C41E3A', name: 'Cardinals'    },
    139: { abbr: 'TB',  slug: 'rays',       color: '#F5D130', name: 'Rays'         },
    140: { abbr: 'TEX', slug: 'rangers',    color: '#C0111F', name: 'Rangers'      },
    141: { abbr: 'TOR', slug: 'blue-jays',  color: '#134A8E', name: 'Blue Jays'    },
    142: { abbr: 'MIN', slug: 'twins',      color: '#D31145', name: 'Twins'        },
    143: { abbr: 'PHI', slug: 'phillies',   color: '#E81828', name: 'Phillies'     },
    144: { abbr: 'ATL', slug: 'braves',     color: '#CE1141', name: 'Braves'       },
    145: { abbr: 'CWS', slug: 'white-sox',  color: '#C4CED4', name: 'White Sox'    },
    146: { abbr: 'MIA', slug: 'marlins',    color: '#00A3E0', name: 'Marlins'      },
    147: { abbr: 'NYY', slug: 'yankees',    color: '#C4CED4', name: 'Yankees'      },
    158: { abbr: 'MIL', slug: 'brewers',    color: '#FFC52F', name: 'Brewers'      },
};

const teamAbbr  = id => TEAMS[id]?.abbr  || 'MLB';
const teamSlug  = id => TEAMS[id]?.slug  || '';
const teamColor = id => TEAMS[id]?.color || '#FFFFFF';
const teamName  = id => TEAMS[id]?.name  || teamAbbr(id);

// ── URL builder ───────────────────────────────────────────────────────────────
function buildGameUrl(game, linkType) {
    if (!game || !game.gamePk) return 'https://www.mlb.com';
    const away = teamSlug(game.awayId) || 'away';
    const home = teamSlug(game.homeId) || 'home';
    if (linkType === 'tv') {
        // If the game starts more than 60 minutes from now, the stream won't be live yet.
        const startsIn = game.startISO ? (new Date(game.startISO) - Date.now()) : 0;
        if (startsIn > 60 * 60 * 1000) {
            log('TV requested but game is ' + Math.round(startsIn / 60000) + 'min away — falling back to Gameday');
            return `https://www.mlb.com/gameday/${away}-vs-${home}/${game.gameDate}/${game.gamePk}/live`;
        }
        return `https://www.mlb.com/tv/g${game.gamePk}`;
    }
    return `https://www.mlb.com/gameday/${away}-vs-${home}/${game.gameDate}/${game.gamePk}/live`;
}

// ── MLB Stats API ─────────────────────────────────────────────────────────────
function fetchAllGames() {
    return new Promise((resolve, reject) => {
        const now = new Date();
        // Don't roll to the next day's schedule until 2am — covers late-running games
        if (now.getHours() < 2) now.setDate(now.getDate() - 1);
        const date = now.getFullYear() + '-' +
                     String(now.getMonth() + 1).padStart(2, '0') + '-' +
                     String(now.getDate()).padStart(2, '0');
        const url  = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + date +
                     '&hydrate=linescore';

        log('Fetching:', url);
        const req = https.get(url, { headers: { 'User-Agent': 'StreamDeckMLBScoreboard/1.0' } }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(parseAllGames(JSON.parse(body))); }
                catch (e) { reject(e); }
            });
        });

        req.on('error', reject);
        req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}

function parseAllGames(data) {
    try {
        if (!data?.dates?.length) { log('API: no dates (off day)'); return []; }
        const games = data.dates[0].games;
        if (!games?.length) { log('API: no games'); return []; }

        // Sort by scheduled start time
        games.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

        return games.map(g => {
            const status   = g?.status?.abstractGameState;
            const detailed = g?.status?.detailedState || '';
            const homeId   = g?.teams?.home?.team?.id;
            const awayId   = g?.teams?.away?.team?.id;
            if (!homeId || !awayId) return null;

            const homeAbr  = teamAbbr(homeId);
            const awayAbr  = teamAbbr(awayId);
            const matchup  = awayAbr + ' @ ' + homeAbr;
            const gamePk   = g.gamePk;
            const gameDate = g.gameDate ? g.gameDate.slice(0, 10).replace(/-/g, '/') : '2000/01/01';
            const startISO = g.gameDate || null;
            const ls       = g.linescore;

            log('Game:', matchup, '|', status, '|', detailed);

            // Special states — check detailedState first
            if (detailed === 'Postponed')       return { state: 'ppd',   matchup, gamePk, gameDate, startISO, homeId, awayId };
            if (detailed.includes('Suspended')) return { state: 'susp',  matchup, gamePk, gameDate, startISO, homeId, awayId };
            if (detailed.includes('Delayed')) {
                // Mid-game delay: game started, show score with DELAY where inning would be
                const inn = ls?.currentInning;
                if (inn) {
                    const homeRuns = ls?.teams?.home?.runs ?? 0;
                    const awayRuns = ls?.teams?.away?.runs ?? 0;
                    return { state: 'delay-live', matchup, homeAbbr: homeAbr, awayAbbr: awayAbr, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, startISO };
                }
                return { state: 'delay', matchup, gamePk, gameDate, startISO, homeId, awayId };
            }

            if (status === 'Preview') {
                return { state: 'preview', matchup, time: fmtTime(g.gameDate), gamePk, gameDate, startISO, homeId, awayId };
            }

            const homeRuns = ls?.teams?.home?.runs ?? 0;
            const awayRuns = ls?.teams?.away?.runs ?? 0;

            if (status === 'Final') {
                return { state: 'final', matchup, homeAbbr: homeAbr, awayAbbr: awayAbr, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, startISO };
            }

            // Live
            const inn  = ls?.currentInning || '?';
            const half = ls?.inningHalf === 'Top' ? '\u25b2' : '\u25bc';
            return { state: 'live', matchup, homeAbbr: homeAbr, awayAbbr: awayAbr, homeId, awayId, homeRuns, awayRuns, inn, half, gamePk, gameDate, startISO };

        }).filter(Boolean);

    } catch (e) {
        log('parseAllGames error:', e.message);
        return [];
    }
}

function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return '?:??'; }
}

// ── SVG button renderer ───────────────────────────────────────────────────────
function escXml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Accepts an array of strings (auto-sized) or { text, fs } objects (explicit size).
function makeImage(lines, lineSpacing = 1.4, bgColor = 'black') {
    const W = 72, H = 72, PAD = 4, MAX_W = W - PAD * 2;

    const items = lines.map(l => {
        if (typeof l === 'string') {
            let fs = 16;
            while (fs > 8 && l.length * fs * 0.60 > MAX_W) fs--;
            return { text: l, fs };
        }
        return l;
    });

    const lineHeights = items.map(({ fs }) => fs * lineSpacing);
    const totalH      = lineHeights.reduce((a, b) => a + b, 0);
    let   y           = (H - totalH) / 2 + items[0].fs * 0.80;

    const rows = items.map(({ text, fs, color }, i) => {
        if (i > 0) y += lineHeights[i - 1] - items[i - 1].fs * 0.80 + fs * 0.80;
        return `<text x="36" y="${y.toFixed(1)}" text-anchor="middle" fill="${color || 'white'}" ` +
               `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(text)}</text>`;
    }).join('');

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="${bgColor}"/>` +
        rows + `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function makeFireworks(frame, winnerColor, winnerName) {
    const W = 72, H = 72;
    const cx = 36, cy = 36;
    const COLORS = [winnerColor, '#FFD700', '#FFFFFF'];

    let circles = '';
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].forEach((startFrame, burstIdx) => {
        const f = frame - startFrame;
        if (f < 0 || f >= 6) return;
        const progress = f / 5;
        const r        = 5 + progress * 28;
        const pSize    = Math.max(0.5, 3.5 - progress * 2.5);
        const opacity  = (1 - progress * 0.65).toFixed(2);
        for (let i = 0; i < 8; i++) {
            const angle = (i * 45 + burstIdx * 22.5) * Math.PI / 180;
            const px    = (cx + r * Math.cos(angle)).toFixed(1);
            const py    = (cy + r * Math.sin(angle)).toFixed(1);
            const color = COLORS[(i + burstIdx) % COLORS.length];
            circles += `<circle cx="${px}" cy="${py}" r="${pSize.toFixed(1)}" fill="${color}" opacity="${opacity}"/>`;
        }
    });

    const throb   = Math.floor(frame / 2) % 2 === 0;
    const winSize = throb ? 20 : 16;
    let nameSize = 13;
    while (nameSize > 7 && winnerName.length * nameSize * 0.62 > 62) nameSize--;
    const nameY = throb ? 25 : 27;

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="black"/>` +
        circles +
        `<text x="36" y="${nameY}" text-anchor="middle" fill="white" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${nameSize}" font-weight="700">${escXml(winnerName)}</text>` +
        `<text x="36" y="50" text-anchor="middle" fill="#FFD700" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${winSize}" font-weight="800">WIN!</text>` +
        `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function playFireworks(context, winnerName, winnerColor) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ fireworks for', winnerName, winnerColor);
    try {
        for (let i = 0; i < 42; i++) {
            const img = makeFireworks(i, winnerColor, winnerName);
            ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: img, target: 0 } }));
            await sleep(120);
        }
    } finally {
        flashing.delete(context);
        lastRender.delete(context);
        refreshAll();
    }
}

function setButton(context, lines, lineSpacing, bgColor) {
    const key = JSON.stringify(lines);
    if (!bgColor && lastRender.get(context) === key) return; // skip if unchanged
    if (!bgColor) lastRender.set(context, key);
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: makeImage(lines, lineSpacing, bgColor), target: 0 } }));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function flashButton(context, color, lines, spacing) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ flash', color);
    try {
        for (let i = 0; i < 4; i++) {
            setButton(context, lines, spacing, color);
            await sleep(200);
            setButton(context, lines, spacing, 'black');
            await sleep(200);
        }
    } finally {
        flashing.delete(context);
        setButton(context, lines, spacing, 'black');
    }
}
