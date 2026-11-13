// App shell: first-time setup, unlock, pickers, top bar, tabs, help panel and routing.
import { h, clear, announce, info, dialog, field } from './ui.js';
import { db, initDb, store, changed, onChange, classById, todayISO, log, now } from './data.js';
import {
  tryUnlock, startSession, getSession, saveSession, sessionProblem, touchSession, device, setDeviceNickname,
  makeCodeRecord, ROLE_LABEL, CODE_LENGTH, lockedFor, whoLabel,
} from './auth.js';
import { tick } from './domain.js';
import { HELP, GLOSSARY, LEGEND } from './help-text.js';
import { ELECTIVES, ELECTIVE_INFO, GRADE_LABEL } from './engine/constants.js';
import { renderHome } from './pages/home.js';
import { renderMyClass } from './pages/my-class.js';
import { renderBallots } from './pages/ballots.js';
import { renderBoard } from './pages/board.js';
import { renderAttendance } from './pages/attendance.js';
import { renderSchedule } from './pages/schedule.js';
import { renderReports } from './pages/reports.js';
import { renderOwner } from './pages/owner.js';

const app = document.getElementById('app');
const LAST_CLASS = 'fe-last-class';

const ROUTES = {
  home: { label: 'Home', roles: ['teacher', 'specialist', 'owner'], render: renderHome, help: 'home' },
  class: { label: 'My Class', roles: ['teacher', 'specialist', 'owner'], render: renderMyClass, help: 'myclass' },
  ballots: { label: 'Ballots', roles: ['teacher', 'specialist', 'owner'], render: renderBallots, help: 'ballots', hidden: true },
  board: { label: 'Specials Board', roles: ['specialist', 'owner'], render: renderBoard, help: 'board' },
  attendance: { label: 'Attendance', roles: ['specialist', 'owner'], render: renderAttendance, help: 'attendance' },
  schedule: { label: 'Schedule', roles: ['teacher', 'specialist', 'owner'], render: renderSchedule, help: 'schedule' },
  reports: { label: 'Print', roles: ['specialist', 'owner'], render: renderReports, help: 'board' },
  owner: { label: 'Owner', roles: ['owner'], render: renderOwner, help: 'owner' },
};

export function route() {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { name: ROUTES[name] ? name : 'home', params: rest.map(decodeURIComponent) };
}
export function go(path) {
  location.hash = `#/${path}`;
}

// ---------------- first-time setup ----------------
function renderSetup() {
  clear(app);
  const inputs = {
    teacher: h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'new-password', required: true }),
    specialist: h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'new-password', required: true }),
    owner: h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'new-password', required: true }),
  };
  const err = h('p', { class: 'banner bad', hidden: true, role: 'alert' });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    const problems = [];
    for (const [role, v] of Object.entries(vals)) if (!new RegExp(`^\\d{${CODE_LENGTH[role]}}$`).test(v)) problems.push(`${ROLE_LABEL[role]} code must be ${CODE_LENGTH[role]} digits.`);
    if (vals.teacher === vals.specialist) problems.push('Teacher and Specialist codes must be different.');
    if (problems.length) {
      err.hidden = false;
      err.textContent = problems.join(' ');
      return;
    }
    if (store.setup) {
      try {
        await store.setup(vals);
      } catch (ex) {
        err.hidden = false;
        err.textContent = `Could not save: ${ex.message}`;
        return;
      }
      announce('Passcodes saved on the server. Now unlock with the Owner code.');
      db.codes = { server: true };
      db.needsUnlock = true;
      return renderUnlock('none');
    }
    db.codes = {};
    for (const role of Object.keys(vals)) db.codes[role] = await makeCodeRecord(vals[role]);
    log('passcodes set (first-time setup)');
    changed();
    startSession('owner', db.codes.owner.version);
    announce('Passcodes saved. Write them down and keep the Owner code private.');
    boot();
  } },
    h('h2', {}, 'Set the three passcodes'),
    h('p', { class: 'muted' }, 'Only the owner does this, once. Codes are stored scrambled; nobody can read them back — write them down.'),
    field('Classroom Teacher code (4 digits, shared by all homeroom teachers)', inputs.teacher),
    field('Specialist code (4 digits, shared by Music, Art, PE and Media)', inputs.specialist),
    field('Owner code (6 digits — only you)', inputs.owner),
    err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Save passcodes'));
  app.append(h('main', { id: 'main', class: 'unlock' }, h('h1', {}, 'Friday Electives — first-time setup'), form));
  inputs.teacher.focus();
}

// ---------------- first cloud start: upload starting data (owner) ----------------
function renderBootstrap() {
  clear(app);
  const session = getSession();
  if (session?.role !== 'owner') {
    app.append(h('main', { id: 'main', class: 'unlock' }, h('h1', {}, 'Almost ready'),
      h('p', {}, 'The owner still needs to upload the students. Please try again later.'), h('button', { class: 'btn', onclick: lockNow }, 'Lock')));
    return;
  }
  const status = h('p', { role: 'status', class: 'muted' }, 'This copies the 33 classes, 653 students and the small photos from this computer to the cloud. It takes about a minute.');
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    btn.disabled = true;
    try {
      const roster = await (await fetch('../seed/roster.json', { cache: 'no-store' })).json();
      const { newRotation } = await import('./data.js');
      const { suggestRotations } = await import('./engine/calendar.js');
      const docs = {
        settings: db.settings,
        classes: roster.classes,
        students: roster.students.map((s) => ({ ...s, enrolledOn: db.settings.firstFriday, leftOn: null, pending: false })),
        rotations: suggestRotations(db.settings).map((r) => newRotation(r, db.settings)),
        assignments: {}, runs: [], attendance: {}, cancelled: [], exceptions: [], audit: [], inbox: [], requests: [], tourSeen: {},
      };
      status.textContent = 'Uploading students…';
      const r = await store.bootstrap(docs, roster.students, '../seed/', (n, total) => (status.textContent = `Uploading photos… ${n} of ${total}`));
      status.textContent = `Done: ${roster.students.length} students and ${r.photos} photos uploaded${r.failed.length ? ` (${r.failed.length} photos failed — you can retry later)` : ''}. Loading…`;
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      status.textContent = `Upload stopped: ${e.message}`;
      btn.disabled = false;
    }
  } }, 'Upload students and photos');
  app.append(h('main', { id: 'main', class: 'unlock' }, h('h1', {}, 'Last setup step'), status, btn));
}

// ---------------- unlock ----------------
const PROBLEM_TEXT = {
  idle: 'Locked after 10 minutes without use. Nothing you typed was lost.',
  'day-ended': 'Teacher sessions end at 4:30 pm each day. Enter the code again.',
  'code-changed': 'The passcode was changed — ask the owner for the new one.',
  expired: 'Your session ended after 12 hours. Enter the code again.',
};

function renderUnlock(problem) {
  clear(app);
  const input = h('input', { class: 'code', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'off', 'aria-label': 'Passcode' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const msg = h('p', { role: 'alert', class: problem && problem !== 'none' ? 'banner warn' : 'muted' }, PROBLEM_TEXT[problem] || 'Enter your passcode.');
  let busy = false;
  const submit = async () => {
    const code = input.value.trim();
    if (!code || busy) return;
    busy = true;
    msg.className = 'muted';
    msg.textContent = 'Checking…';
    input.disabled = true;
    let r;
    try {
      r = store.unlock ? await store.unlock(code, device().id, device().nickname) : await tryUnlock(db, code);
    } catch (e) {
      r = { error: 'network' };
    } finally {
      busy = false;
      input.disabled = false;
    }
    if (!store.unlock) changed();
    if (r.role) {
      startSession(r.role, r.codeVersion);
      if (store.mode === 'cloud') return location.reload(); // load the data now that we are signed in
      log('unlock', { role: r.role });
      boot();
      return;
    }
    input.value = '';
    if (r.error === 'locked') msg.textContent = `Too many wrong tries on this device. Wait ${Math.ceil(r.wait / 60000)} minutes, or ask a specialist or the owner to clear it.`;
    else if (r.error === 'slow') msg.textContent = 'Too many wrong codes at school this hour. Please wait a minute. The owner has been alerted.';
    else if (r.error === 'network') msg.textContent = 'Could not reach the server. Check the Wi-Fi and try again.';
    else msg.textContent = r.left > 0 ? `That code didn’t work. ${r.left} tries left on this device.` : 'That code didn’t work.';
    msg.className = 'banner bad';
    if (r.alert) db.inbox.push({ id: 'alert' + Date.now(), to: 'owner', text: 'Unusual number of wrong passcodes in the last hour.', at: now().toISOString(), read: false });
    input.focus();
  };
  const key = (d) => h('button', { class: 'btn', type: 'button', onclick: () => {
    if (d === '⌫') input.value = input.value.slice(0, -1);
    else if (d === 'OK') submit();
    else if (input.value.length < 6) input.value += d;
    input.focus();
  } }, d);
  const wait = lockedFor();
  app.append(h('main', { id: 'main', class: 'unlock' },
    h('h1', {}, h('span', { class: 'brand' }, h('span', { class: 'dot' }), 'Friday Electives')),
    msg,
    h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      input,
      h('div', { class: 'keypad', 'aria-label': 'Number pad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map(key))),
    wait ? h('p', { class: 'banner bad' }, `This device is waiting ${Math.ceil(wait / 60000)} more minutes.`) : null,
    store.mode === 'local' ? h('p', { class: 'hint' }, 'Local test mode — data stays on this computer.') : null));
  input.focus();
}

// ---------------- pickers ----------------
function renderClassPicker(session) {
  clear(app);
  let last = null;
  try { last = localStorage.getItem(LAST_CLASS); } catch {}
  const pick = (c) => {
    session.classId = c.id;
    session.confirmed = true;
    saveSession(session);
    store.pick?.({ classId: c.id, nickname: device().nickname });
    try { localStorage.setItem(LAST_CLASS, c.id); } catch {}
    boot();
  };
  const byGrade = {};
  for (const g of ['K', '1', '2', '3', '4', '5']) byGrade[g] = [];
  for (const c of db.classes) byGrade[c.grade].push(c);
  app.append(h('main', { id: 'main', class: 'unlock', style: { maxWidth: '760px' } },
    h('h1', {}, 'Which class are you working on?'),
    last && classById(last) ? h('div', { class: 'card' },
      h('p', {}, 'Last time on this device:'),
      h('button', { class: 'btn primary', style: { fontSize: '1.2rem', minHeight: '64px', width: '100%' }, onclick: () => pick(classById(last)) },
        `Yes — ${classById(last).code} · ${classById(last).teacher || 'Teacher TBD'}`)) : null,
    ...Object.entries(byGrade).map(([g, list]) => h('section', { class: 'card' }, h('h2', {}, GRADE_LABEL[g]),
      h('div', { class: 'picklist' }, list.map((c) => h('button', { class: `btn${c.id === last ? ' recent' : ''}`, onclick: () => pick(c) }, `${c.code} · ${c.teacher || 'Teacher TBD'}`))))),
    h('button', { class: 'btn', onclick: lockNow }, 'Lock')));
}

function renderElectivePicker(session) {
  clear(app);
  app.append(h('main', { id: 'main', class: 'unlock' },
    h('h1', {}, 'Which elective do you teach?'),
    h('p', { class: 'muted' }, 'This is used for “approve my elective”, your Friday packet and the change log.'),
    h('div', { class: 'bigbtns' }, ELECTIVES.map((e) => h('button', { class: `btn el-${e.toLowerCase()}`, onclick: () => {
      session.elective = e;
      saveSession(session);
      store.pick?.({ elective: e, nickname: device().nickname });
      boot();
    } }, `${ELECTIVE_INFO[e].icon} ${ELECTIVE_INFO[e].label}`))),
    h('p', {}, h('button', { class: 'btn', onclick: lockNow }, 'Lock'))));
}

async function askNickname() {
  const input = h('input', { placeholder: 'e.g. Room 12 Chromebook', maxlength: 40 });
  const v = await dialog({
    title: 'Name this device',
    body: [h('p', {}, 'A short name for this computer or iPad, used in the change log (asked once).'), field('Device name', input)],
    buttons: [{ label: 'Skip', value: null }, { label: 'Save', primary: true, value: () => input.value.trim() }],
    onOpen: () => input.focus(),
  });
  setDeviceNickname(v || 'Unnamed device');
}

export function lockNow() {
  saveSession(null);
  store.signOut?.();
  renderUnlock('none');
}

// ---------------- help panel ----------------
function openHelp(key) {
  document.querySelector('.helppanel')?.remove();
  const topic = HELP[key] || HELP.home;
  const panel = h('aside', { class: 'helppanel', role: 'dialog', 'aria-label': 'Help', tabindex: '-1' },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, `Help: ${topic.title}`), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => panel.remove() }, 'Close')),
    h('ol', {}, topic.steps.map((s) => h('li', {}, s))),
    topic.kids ? [h('h3', {}, 'What to tell the kids'), h('ul', {}, topic.kids.map((s) => h('li', {}, s)))] : null,
    h('h3', {}, 'Badges and icons'),
    h('table', {}, h('tbody', {}, LEGEND.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))))),
    h('h3', {}, 'Words'),
    h('dl', {}, GLOSSARY.map(([a, b]) => [h('dt', { style: { fontWeight: 700 } }, a), h('dd', { style: { margin: '0 0 0.5rem' } }, b)])),
    h('p', { class: 'hint' }, 'Friday periods: ', Object.entries(db.settings.periods).map(([g, p]) => `${g === 'K' ? 'K' : g + (g === '1' ? 'st' : g === '2' ? 'nd' : g === '3' ? 'rd' : 'th')} ${p.start}–${p.end}`).join(' · ')));
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && panel.remove());
  document.body.append(panel);
  panel.focus();
}

// ---------------- layout ----------------
function renderLayout(session) {
  clear(app);
  const { name, params } = route();
  const r = ROUTES[name];
  if (!r.roles.includes(session.role)) {
    go('home');
    return;
  }
  const unread = db.inbox.filter((m) => !m.read && (m.to === session.elective || (session.role === 'owner' && m.to === 'owner'))).length;
  const whoText = session.role === 'teacher'
    ? `${classById(session.classId)?.code} · ${classById(session.classId)?.teacher || 'Teacher TBD'}`
    : session.role === 'specialist' ? `${ELECTIVE_INFO[session.elective].label} specialist` : 'Owner';
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', style: { textDecoration: 'none', color: 'inherit' } }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Friday Electives'),
    h('span', { class: 'who' }, whoText,
      session.role !== 'owner' ? [' · ', h('button', { class: 'btn small', onclick: () => {
        if (session.role === 'teacher') { session.confirmed = false; session.classId = null; }
        if (session.role === 'specialist') session.elective = null;
        saveSession(session);
        boot();
      } }, session.role === 'teacher' ? 'Change class' : 'Change elective')] : null),
    unread ? h('a', { class: 'pill', href: '#/board' }, `📬 ${unread} new`) : null,
    h('span', { id: 'save-pill', class: 'pill', 'data-state': 'saved' }, '✓ All saved'),
    h('button', { class: 'btn small', 'aria-label': 'Help for this page', onclick: () => openHelp(r.help) }, '? Help'),
    h('button', { class: 'btn small', onclick: lockNow }, '🔒 Lock'));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Main' }, Object.entries(ROUTES)
    .filter(([, x]) => x.roles.includes(session.role) && !x.hidden)
    .map(([k, x]) => h('a', { href: `#/${k}`, 'aria-current': k === name ? 'page' : null }, x.label)));
  const main = h('main', { id: 'main', tabindex: '-1' });
  const bar = store.mode === 'local'
    ? h('div', { class: 'localbar' }, 'Local test mode — data is saved only in this browser on this computer.',
      db.testToday ? h('strong', {}, ` Test clock: ${db.testToday.date} ${db.testToday.time}.`) : null)
    : null;
  app.append(...[top, bar, tabs, main].filter(Boolean));
  try {
    r.render(main, { session, params, go, rerender: () => renderLayout(getSession()) });
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'banner bad', role: 'alert' }, `Something went wrong on this page: ${e.message}`));
  }
}

// ---------------- boot ----------------
let ticker = null;
let booting = null;
export function boot() {
  if (booting) return booting;
  booting = bootInner().finally(() => (booting = null));
  return booting;
}
async function bootInner() {
  if (!db) await initDb();
  if (!db.codes) return renderSetup();
  if (db.needsUnlock) return renderUnlock('none');
  if (db.needsBootstrap) return renderBootstrap();
  const session = getSession();
  const problem = sessionProblem(session, db, new Date());
  if (problem) {
    if (session) saveSession(null);
    return renderUnlock(problem === 'none' ? 'none' : problem);
  }
  if (!device().nickname) await askNickname();
  if (session.role === 'teacher' && !session.confirmed) return renderClassPicker(session);
  if (session.role === 'specialist' && !session.elective) return renderElectivePicker(session);
  tick();
  renderLayout(session);
}

window.addEventListener('hashchange', () => {
  document.getElementById('toasts')?.replaceChildren(); // messages belong to the page they were shown on
  document.querySelector('.helppanel')?.remove();
  boot();
});
let lastTouch = 0;
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => {
    if (Date.now() - lastTouch > 15_000) {
      lastTouch = Date.now();
      touchSession();
    }
  }, { passive: true });
}
clearInterval(ticker);
ticker = setInterval(() => {
  if (!db?.codes) return;
  const s = getSession();
  const p = sessionProblem(s, db, new Date()); // sessions always use real time, not the test clock
  if (s && p) {
    saveSession(null);
    renderUnlock(p);
    return;
  }
  if (s && tick()) renderLayout(s);
}, 30_000);

onChange(() => {});
boot().catch((e) => {
  console.error(e);
  app.append(h('main', { id: 'main' }, h('div', { class: 'banner bad', role: 'alert' }, `The app could not start: ${e.message}`)));
});

export { openHelp, whoLabel, todayISO };
