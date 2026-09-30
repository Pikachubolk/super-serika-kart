// Online multiplayer screens (owner: online agent).
//   'online'         OnlineScreen: nickname + Create Room / Join Room (code), then the lobby (big shareable code,
//                    copy code / copy invite link / share, player list with portrait + name + ready + ping,
//                    character picker, host settings, Ready / Start, Leave). ?join=CODE prefills (and auto-joins
//                    when a nickname is known).
//   'onlineresults'  OnlineResultsScreen: the normal results board with Back to Lobby / Leave actions.
// Networking lives in src/net/ (NetSession, NetRaceSync, online.js).

import { Screen, topbar, footer, chip } from './Screen.js';
import { el, esc, ICONS, hintsHTML } from './kit.js';
import { ResultsScreen } from './screensResults.js';
import { CHARACTERS, getCharacter } from '../../data/characters.js';
import { TRACKS, getTrackEntry } from '../../data/tracks/index.js';
import { CC_LIST } from '../../data/engine.js';
import { ensureOnline, urlFlag } from '../../net/online.js';
import { normalizeCode, inviteLink, loadNick, saveNick, MAX_PLAYERS, CODE_LEN } from '../../net/NetSession.js';

const TRACK_CHOICES = ['random', ...TRACKS.map((t) => t.id), 'test-oval'];
const trackLabel = (id) => (id === 'random' ? 'Random Course' : getTrackEntry(id)?.name || id);
const ccs = () => (Array.isArray(CC_LIST) && CC_LIST.length ? CC_LIST : [50, 100, 150, 200]);

let cssDone = false;
function injectCSS() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'ssk-online-css';
  s.textContent = `
.mn-online-body { position:absolute; inset: calc(clamp(58px,9.5vh,76px) + clamp(10px,2.4vh,22px)) clamp(12px,3vw,44px) 50px; display:grid; gap:clamp(10px,1.8vw,24px); overflow:auto; }
.mn-online-body.is-entry { grid-template-columns: minmax(0,560px); justify-content:center; align-content:start; }
.mn-online-body.is-lobby { grid-template-columns: minmax(0,1fr) minmax(0,1.05fr); align-items:start; }
.mn-on-panel { padding: clamp(10px,1.8vh,18px) clamp(12px,1.8vw,22px); animation: mn-rise .4s var(--mn-smooth) both; }
.mn-on-panel + .mn-on-panel { margin-top: clamp(8px,1.4vh,14px); }
.mn-online-body.is-still .mn-on-panel { animation: none; }
.mn-online-body.is-lobby .mn-sec { margin: 2px 0 6px; font-size: 16px; }
.mn-on-field { display:flex; flex-direction:column; gap:6px; margin:8px 0 12px; }
.mn-on-field label { font:800 13px/1 var(--ssk-font-ui); color:#52617e; letter-spacing:.04em; text-transform:uppercase; }
.mn-on-input { font:400 22px/1 var(--ssk-font-display); color:var(--mn-navy); padding:10px 14px; border-radius:12px; border:2px solid var(--mn-line); background:#fff; outline:none; width:100%; box-sizing:border-box; letter-spacing:.04em; }
.mn-on-input:focus { border-color: var(--mn-blue); box-shadow: 0 0 0 3px rgba(18,140,255,.2); }
.mn-on-input.is-code { text-transform:uppercase; letter-spacing:.3em; text-align:center; font-size:28px; }
.mn-on-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.mn-on-row .mn-btn { min-width:0; flex:1 1 auto; font-size:18px; padding:11px 16px; }
.mn-on-or { text-align:center; margin:10px 0 4px; font:800 12px/1 var(--ssk-font-ui); color:#8a97b0; letter-spacing:.2em; }
.mn-on-status { min-height:1.3em; margin-top:10px; font:700 14px/1.35 var(--ssk-font-ui); color:#52617e; }
.mn-on-status.is-error { color:#e8304f; }
.mn-on-status.is-busy::before { content:''; display:inline-block; width:12px; height:12px; margin-right:8px; border-radius:50%; border:3px solid var(--mn-line); border-top-color:var(--mn-blue); animation: mn-on-spin .8s linear infinite; vertical-align:-2px; }
@keyframes mn-on-spin { to { transform: rotate(360deg); } }
.mn-on-note { font:500 12px/1.4 var(--ssk-font-ui); color:#6b7893; margin-top:8px; }
.mn-on-code { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.mn-on-code-label { font:800 12px/1 var(--ssk-font-ui); color:#52617e; letter-spacing:.12em; text-transform:uppercase; }
.mn-on-code-val { font:400 clamp(32px,6vh,50px)/1 var(--ssk-font-display); letter-spacing:.18em; color:var(--mn-blue2); text-shadow: 0 3px 0 #d4ecff; user-select:all; }
.mn-on-share { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
.mn-on-share .mn-btn { min-width:0; font-size:15px; padding:8px 12px; }
.mn-on-players { display:flex; flex-direction:column; gap:4px; }
.mn-on-player { display:grid; grid-template-columns: 30px minmax(0,1fr) auto auto; gap:10px; align-items:center; padding:2px 8px; border-radius:10px; background:#f3f9ff; }
.mn-on-player.is-me { background: linear-gradient(100deg,#e2f3ff,#d0ebff); box-shadow: inset 4px 0 0 var(--mn-blue); }
.mn-on-player img, .mn-on-player .mn-on-ph { width:30px; height:30px; border-radius:50%; background:#dbe9fb; object-fit:cover; }
.mn-on-pname { font:800 15px/1.1 var(--ssk-font-ui); color:var(--mn-navy); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mn-on-pname small { display:block; font:600 11px/1.2 var(--ssk-font-ui); color:#6b7893; }
.mn-on-tag { font:400 13px/1 var(--ssk-font-display); padding:4px 8px; border-radius:999px; background:#dfe7f3; color:#6b7893; letter-spacing:.04em; }
.mn-on-tag.is-ready { background: linear-gradient(90deg,#2fd27e,#1fb86a); color:#fff; }
.mn-on-tag.is-host { background: linear-gradient(90deg,#ffd23f,#ff9f1f); color:#5a3a00; }
.mn-on-ping { font:700 12px/1 var(--ssk-font-ui); color:#6b7893; min-width:44px; text-align:right; }
.mn-on-ping.is-bad { color:#e8304f; }
.mn-on-empty { padding:6px 10px; border-radius:10px; border:2px dashed #d4e2f3; color:#9aa7bf; font:700 13px/1.2 var(--ssk-font-ui); }
.mn-on-chars { display:grid; grid-template-columns: repeat(8, minmax(0,1fr)); gap:6px; }
.mn-on-char { position:relative; aspect-ratio:1; border:none; border-radius:12px; padding:0; cursor:pointer; background: linear-gradient(160deg, var(--c1,#1fb6ff), #fff 140%); box-shadow: 0 0 0 2px var(--mn-line); overflow:hidden; transition: transform .15s var(--mn-bounce), box-shadow .15s; }
.mn-on-char img { width:100%; height:100%; object-fit:cover; display:block; }
.mn-on-char.is-sel { box-shadow: 0 0 0 3px var(--mn-blue2), 0 4px 12px rgba(18,140,255,.4); }
.mn-on-char.is-focus { transform: scale(1.1); box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--mn-sky); z-index:1; }
.mn-on-charname { margin-top:6px; font:400 17px/1 var(--ssk-font-display); color:var(--mn-navy); }
.mn-on-set .mn-opt { grid-template-columns: minmax(90px,.8fr) minmax(0,1.3fr); padding:3px 10px; margin:1px 0; }
.mn-on-set .mn-sel-arrow { width:26px; height:26px; }
.mn-on-set .mn-opt.is-locked { cursor:default; }
.mn-on-set .mn-opt.is-locked .mn-sel-arrow { visibility:hidden; }
.mn-on-actions { display:flex; gap:10px; margin-top:10px; flex-wrap:wrap; }
.mn-on-actions .mn-btn { flex:1 1 auto; min-width:0; font-size:19px; }
.mn-btn.is-ready-on { background: linear-gradient(90deg,#2fd27e,#1fb86a); color:#fff; }
@media (max-width: 760px) {
  .mn-online-body.is-lobby { grid-template-columns: minmax(0,1fr); }
  .mn-on-chars { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .mn-online-body { inset: calc(clamp(58px,9.5vh,76px) + 10px) 16px 46px; }
}`;
  document.head.appendChild(s);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ================================================================================================
// Online screen (entry + lobby)
// ================================================================================================

export class OnlineScreen extends Screen {
  constructor(menus, params) {
    super(menus, params);
    this.session = ensureOnline(this.game);
    this.busy = false;
    this.status = '';
    this.statusKind = '';
    this.wrap = false;
    const nick = urlFlag('nick');
    this.nick = nick ? nick.slice(0, 16) : loadNick();
    this.code = params.join ? normalizeCode(params.join) : '';
    this.autoJoin = !!params.join && (!!nick || hasStoredNick());
  }
  get music() {
    return 'menu';
  }
  stageSetup(stage) {
    stage.setMode('backdrop');
  }
  build() {
    injectCSS();
    const e = el(`<div class="mn-online">
      ${topbar({ title: 'Online Race', crumb: 'Multiplayer', right: chip('Room codes', 'mn-chip-mode'), color: '#27d3f0' })}
      <div class="mn-online-body"></div>
      ${footer([
        ['move', 'Move'],
        ['confirm', 'Select'],
        ['back', 'Back'],
      ])}
    </div>`);
    this.body = e.querySelector('.mn-online-body');
    return e;
  }
  enter() {
    this._offs = [
      this.session.on('lobby', () => this._render()),
      this.session.on('closed', (ev) => {
        if (ev?.reason) this._setStatus(ev.reason, 'error', false);
        this._render(true);
      }),
    ];
    this._render(true);
    window.__ssk.onlineScreen = this;
    if (this.autoJoin && !this.session.active) setTimeout(() => this.menus.base === this && this._join(), 350);
  }
  leave() {
    for (const off of this._offs || []) off();
    this._offs = [];
    if (window.__ssk.onlineScreen === this) window.__ssk.onlineScreen = null;
  }

  get inLobby() {
    return this.session.active && (this.session.role === 'host' || this.session.role === 'client');
  }

  defaultFocus() {
    if (this.inLobby) return this.el.querySelector(this.session.isHost ? '[data-key="start"]' : '[data-key="ready"]') || super.defaultFocus();
    return this.el.querySelector(this.code.length === CODE_LEN ? '[data-key="join"]' : '[data-key="create"]') || super.defaultFocus();
  }

  _setStatus(text, kind = '', rerender = true) {
    this.status = text || '';
    this.statusKind = kind;
    if (!rerender) return;
    const st = this.el?.querySelector('.mn-on-status');
    if (st) {
      st.textContent = this.status;
      st.className = `mn-on-status${kind ? ` is-${kind}` : ''}`;
    }
  }

  _render(force = false) {
    if (!this.el) return;
    const view = this.inLobby ? 'lobby' : 'entry';
    const key = this.focusEl?.isConnected ? this.focusEl.dataset.key : null;
    if (view === 'entry') {
      if (!force && this._view === 'entry') return; // keep the inputs as the user typed them
      this._renderEntry();
    } else this._renderLobby();
    const changed = this._view !== view;
    this._view = view;
    const f = (!changed && key && this.el.querySelector(`[data-key="${CSS.escape(key)}"]`)) || this.defaultFocus();
    this.focusEl = null;
    if (f) this.menus.setFocus(this, f, { silent: true });
  }

  _renderEntry() {
    this.body.className = 'mn-online-body is-entry';
    this.body.innerHTML = `<section class="mn-panel mn-on-panel" style="--mn-accent:#27d3f0">
        <div class="mn-sec">Your Name</div>
        <div class="mn-on-field"><input class="mn-on-input" data-input="nick" maxlength="16" autocomplete="off" spellcheck="false" value="${esc(this.nick)}" aria-label="Nickname"></div>
        <div class="mn-sec">Play With Friends</div>
        <div class="mn-on-row"><button class="mn-btn mn-btn-primary" data-focus data-key="create" ${this.busy ? 'disabled' : ''}>${ICONS.people}<span>Create Room</span></button></div>
        <div class="mn-on-or">— OR JOIN WITH A CODE —</div>
        <div class="mn-on-row">
          <input class="mn-on-input is-code" data-input="code" maxlength="${CODE_LEN + 60}" placeholder="ABC123" autocomplete="off" spellcheck="false" value="${esc(this.code)}" aria-label="Room code" style="flex:1 1 160px">
          <button class="mn-btn" data-focus data-key="join" ${this.busy ? 'disabled' : ''} style="flex:0 0 auto">${ICONS.play}<span>Join</span></button>
        </div>
        <div class="mn-on-status${this.statusKind ? ` is-${this.statusKind}` : ''}">${esc(this.status)}</div>
        <p class="mn-on-note">Up to ${MAX_PLAYERS} players. Share the 6-character room code or an invite link. Uses peer-to-peer WebRTC and a free public matchmaking server — an internet connection is required.</p>
      </section>`;
    const nick = this.body.querySelector('[data-input="nick"]');
    const code = this.body.querySelector('[data-input="code"]');
    nick.addEventListener('input', () => {
      this.nick = nick.value;
    });
    nick.addEventListener('change', () => saveNick(this._nick()));
    code.addEventListener('input', () => {
      const n = normalizeCode(code.value);
      if (code.value.includes('join=') || code.value !== n) code.value = n;
      this.code = n;
    });
    const enter = (fn) => (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.target.blur();
        fn();
      } else if (ev.key === 'Escape') ev.target.blur();
    };
    code.addEventListener('keydown', enter(() => this._join()));
    nick.addEventListener('keydown', enter(() => (this.code.length === CODE_LEN ? this._join() : null)));
  }

  _nick() {
    const n = String(this.nick || '').trim().slice(0, 16);
    return n || loadNick();
  }

  _renderLobby() {
    const s = this.session;
    const P = this.game.portraits;
    const me = s.me;
    const host = s.isHost;
    const st = s.settings;
    const rows = s.players
      .map((p) => {
        const img = P?.get?.(p.charId);
        const ch = getCharacter(p.charId);
        const ping = p.host ? '' : p.id === s.selfId && !host ? `${Math.round(s.rtt)} ms` : `${p.ping || 0} ms`;
        return `<div class="mn-on-player${p.id === s.selfId ? ' is-me' : ''}">
          ${img ? `<img src="${img}" alt="">` : '<span class="mn-on-ph"></span>'}
          <span class="mn-on-pname">${esc(p.name)}${p.id === s.selfId ? ' (You)' : ''}<small>${esc(ch.name)}</small></span>
          <span class="mn-on-tag${p.host ? ' is-host' : p.ready ? ' is-ready' : ''}">${p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span>
          <span class="mn-on-ping${(p.ping || 0) > 200 ? ' is-bad' : ''}">${ping}</span>
        </div>`;
      })
      .join('');
    const empty = Math.max(0, MAX_PLAYERS - s.players.length);
    const empties = empty ? `<div class="mn-on-empty">${empty} open slot${empty > 1 ? 's' : ''}${st.cpus ? ' — filled with CPU racers' : ''}</div>` : '';
    const chars = CHARACTERS.map((c) => {
      const img = P?.get?.(c.id);
      return `<button class="mn-on-char${me?.charId === c.id ? ' is-sel' : ''}" data-focus data-key="char:${c.id}" title="${esc(c.name)}" style="--c1:${c.kart?.body || '#1fb6ff'}">${img ? `<img src="${img}" alt="${esc(c.name)}" draggable="false">` : esc(c.name[0])}</button>`;
    }).join('');
    const opt = (key, label, val) =>
      `<div class="mn-opt${host ? '' : ' is-locked'}" ${host ? 'data-focus' : ''} data-key="set:${key}" data-kind="select"><span class="mn-opt-label">${label}</span><div class="mn-select"><span class="mn-sel-arrow" data-dir="left">${ICONS.arrowL}</span><span class="mn-sel-val">${esc(val)}</span><span class="mn-sel-arrow" data-dir="right">${ICONS.arrowR}</span></div></div>`;
    const readyN = s.players.filter((p) => p.host || p.ready).length;
    // skip identical re-renders (the host re-broadcasts every 2 s for ping updates)
    const sig = JSON.stringify([s.players, st, s.code, this.status, this.statusKind, Math.round(s.rtt / 10)]);
    if (sig === this._sig && this.body.classList.contains('is-lobby')) return;
    const again = this.body.classList.contains('is-lobby');
    this._sig = sig;
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const action = host
      ? `<button class="mn-btn mn-btn-primary" data-focus data-key="start">${ICONS.flag}<span>Start Race (${readyN}/${s.players.length} ready)</span></button>`
      : `<button class="mn-btn mn-btn-primary${me?.ready ? ' is-ready-on' : ''}" data-focus data-key="ready">${ICONS.check}<span>${me?.ready ? 'Ready! (tap to cancel)' : 'Ready'}</span></button>`;
    this.body.className = `mn-online-body is-lobby${again ? ' is-still' : ''}`;
    this.body.innerHTML = `<div class="mn-on-col">
        <section class="mn-panel mn-on-panel" style="--mn-accent:#27d3f0">
          <div class="mn-on-code"><div><div class="mn-on-code-label">Room Code</div><div class="mn-on-code-val" data-code>${esc(s.code || '')}</div></div></div>
          <div class="mn-on-share">
            <button class="mn-btn" data-focus data-key="copycode">${ICONS.check}<span>Copy Code</span></button>
            <button class="mn-btn" data-focus data-key="copylink">${ICONS.people}<span>Copy Invite Link</span></button>
            ${canShare ? `<button class="mn-btn" data-focus data-key="share">${ICONS.arrowR}<span>Share</span></button>` : ''}
          </div>
          <div class="mn-on-actions">
            ${action}
            <button class="mn-btn mn-btn-danger" data-focus data-key="leave">${ICONS.home}<span>Leave</span></button>
          </div>
          <div class="mn-on-status${this.statusKind ? ` is-${this.statusKind}` : ''}">${esc(this.status)}</div>
        </section>
        <section class="mn-panel mn-on-panel">
          <div class="mn-sec">Players ${s.players.length}/${MAX_PLAYERS}</div>
          <div class="mn-on-players">${rows}${empties}</div>
        </section>
      </div>
      <div class="mn-on-col">
        <section class="mn-panel mn-on-panel" style="--mn-accent:#ff4d8d">
          <div class="mn-sec">Your Racer</div>
          <div class="mn-on-chars">${chars}</div>
          <div class="mn-on-charname">${esc(getCharacter(me?.charId).name)}</div>
        </section>
        <section class="mn-panel mn-on-panel mn-on-set" style="--mn-accent:#ff9f1f">
          <div class="mn-sec">Race Settings${host ? '' : ' (host)'}</div>
          ${opt('cc', 'Engine', `${st.cc}cc`)}
          ${opt('track', 'Course', trackLabel(st.trackId))}
          ${opt('laps', 'Laps', String(st.laps))}
          ${opt('cpus', 'CPU Racers', st.cpus ? 'On' : 'Off')}
          ${opt('items', 'Items', st.items ? 'On' : 'Off')}
        </section>
      </div>`;
  }

  // ------------------------------------------------------------------------------------------ actions
  async _create() {
    if (this.busy) return;
    saveNick(this._nick());
    this.busy = true;
    this._setStatus('Creating a room...', 'busy', false);
    this._render(true);
    try {
      await this.session.host({ name: this._nick(), charId: this.menus.flow.characterId || 'serika' });
      this.sfx('menuSelect');
      this.status = 'Room ready! Share the code with your friends.';
      this.statusKind = '';
    } catch (err) {
      this.sfx('menuError');
      this.status = err?.message || 'Could not create a room.';
      this.statusKind = 'error';
    } finally {
      this.busy = false;
      if (this.menus.base === this) this._render(true);
    }
  }

  async _join() {
    if (this.busy) return;
    const code = normalizeCode(this.code);
    if (code.length !== CODE_LEN) {
      this.sfx('menuError');
      this._setStatus('Enter the 6-character room code.', 'error');
      this.el.querySelector('[data-input="code"]')?.focus();
      return;
    }
    saveNick(this._nick());
    this.busy = true;
    this._setStatus(`Joining room ${code}...`, 'busy', false);
    this._render(true);
    try {
      await this.session.join(code, { name: this._nick(), charId: this.menus.flow.characterId || 'serika' });
      this.sfx('menuSelect');
      this.status = 'Joined! Pick your racer and press Ready.';
      this.statusKind = '';
    } catch (err) {
      this.sfx('menuError');
      this.status = err?.message || 'Could not join the room.';
      this.statusKind = 'error';
    } finally {
      this.busy = false;
      if (this.menus.base === this) this._render(true);
    }
  }

  _flash(text) {
    this._setStatus(text, '');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => this.menus.base === this && this._setStatus('', ''), 2600);
  }

  _changeSetting(key, dir) {
    const s = this.session;
    if (!s.isHost) return false;
    const st = s.settings;
    const cyc = (list, v) => list[(list.indexOf(v) + dir + list.length) % list.length];
    if (key === 'cc') s.updateSettings({ cc: cyc(ccs(), st.cc) });
    else if (key === 'track') s.updateSettings({ trackId: cyc(TRACK_CHOICES, st.trackId) });
    else if (key === 'laps') s.updateSettings({ laps: ((st.laps - 1 + dir + 5) % 5) + 1 });
    else if (key === 'cpus') s.updateSettings({ cpus: !st.cpus });
    else if (key === 'items') s.updateSettings({ items: !st.items });
    else return false;
    this.sfx('menuMove');
    return true;
  }

  onDir(dir, e) {
    const k = e?.dataset.key || '';
    if (k.startsWith('set:') && (dir === 'left' || dir === 'right')) return this._changeSetting(k.slice(4), dir === 'left' ? -1 : 1);
    return false;
  }

  onConfirm(e, ev) {
    if (!e) return;
    const k = e.dataset.key || '';
    const s = this.session;
    if (k === 'create') return this._create();
    if (k === 'join') return this._join();
    if (k.startsWith('char:')) {
      const id = k.slice(5);
      this.menus.flow.characterId = id;
      s.setMe({ charId: id });
      this.sfx('menuSelect');
      this.game.audio?.voice?.(id, 'select');
      return;
    }
    if (k.startsWith('set:')) {
      const dir = ev?.target?.closest?.('[data-dir="left"]') ? -1 : 1;
      this._changeSetting(k.slice(4), dir);
      return;
    }
    if (k === 'ready') {
      s.setMe({ ready: !s.me?.ready });
      this.sfx('menuSelect');
      return;
    }
    if (k === 'start') {
      const notReady = s.players.filter((p) => !p.host && !p.ready).length;
      if (notReady) {
        this.menus.confirm({ title: 'Start anyway?', text: `${notReady} player${notReady > 1 ? 's are' : ' is'} not ready yet.`, yes: 'Start', onYes: () => s.startRace() });
      } else {
        this.sfx('menuSelect');
        s.startRace();
      }
      return;
    }
    if (k === 'copycode') {
      copyText(s.code).then((ok) => this._flash(ok ? `Code ${s.code} copied!` : `Room code: ${s.code}`));
      return;
    }
    if (k === 'copylink') {
      const link = inviteLink(s.code);
      copyText(link).then((ok) => this._flash(ok ? 'Invite link copied!' : link));
      return;
    }
    if (k === 'share') {
      navigator.share?.({ title: 'Super Serika Kart', text: `Race me in Super Serika Kart! Room code: ${s.code}`, url: inviteLink(s.code) }).catch(() => {});
      return;
    }
    if (k === 'leave') return this.onBack();
  }

  onBack() {
    if (document.activeElement?.matches?.('.mn-on-input')) {
      document.activeElement.blur();
      return;
    }
    if (this.inLobby) {
      this.menus.confirm({
        title: this.session.isHost ? 'Close the room?' : 'Leave the room?',
        text: this.session.isHost ? 'Everyone in the room will be disconnected.' : '',
        yes: 'Leave',
        danger: true,
        onYes: () => {
          this.status = '';
          this.statusKind = '';
          this.session.leave();
        },
      });
      return;
    }
    this.menus.back();
  }
}

function hasStoredNick() {
  try {
    return !!localStorage.getItem('ssk.online.nick');
  } catch {
    return false;
  }
}

// ================================================================================================
// Online results
// ================================================================================================

export class OnlineResultsScreen extends ResultsScreen {
  _showActions() {
    if (this.actionsShown) return;
    this.actionsShown = true;
    const session = window.__ssk?.net;
    const alive = !!session?.active && !this.params.hostLeft;
    const btns = alive
      ? [
          ['lobby', 'Back to Lobby', ICONS.people],
          ['leave', 'Leave Room', ICONS.home],
        ]
      : [['online', 'Online Menu', ICONS.home]];
    const box = this.el.querySelector('.mn-res-actions');
    box.innerHTML = btns
      .map(([k, label, ico], i) => `<button class="mn-btn${i === 0 ? ' mn-btn-primary' : ''}" data-focus data-key="${k}" style="--i:${i}">${ico}<span>${esc(label)}</span></button>`)
      .join('');
    box.classList.add('is-in');
    const ft = this.el.querySelector('.mn-footer');
    if (ft) ft.innerHTML = hintsHTML([['confirm', 'Select'], ['lr', 'Choose']]);
    this.menus.refocus(this, box.querySelector('[data-focus]'));
  }
  onConfirm(e) {
    if (!this.actionsShown || !e) return super.onConfirm(e);
    const g = this.game;
    this.sfx('menuSelect');
    const k = e.dataset.key;
    if (k === 'leave') g.leaveOnline();
    else g.quitToMenu('online');
  }
}
