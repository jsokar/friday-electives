// The app's database (one object), saving, the clock and the change log.
import { localStore } from './local-store.js';
import { SCHOOL_CONFIG } from '../data/school-config.js';
import { suggestRotations, toISO } from './engine/calendar.js';
import { newSeed } from './engine/rng.js';
import { GRADES } from './engine/constants.js';
import { getSession, whoLabel } from './auth.js';

export const SCHEMA_VERSION = 1;
export let store = localStore;

async function chooseStore() {
  // Developer testing on this Mac only: ?local forces local test mode (data stays in this browser).
  const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocalHost && new URLSearchParams(location.search).has('local')) return;
  try {
    const { CLOUD_CONFIG } = await import('../data/cloud-config.js');
    if (CLOUD_CONFIG?.url && CLOUD_CONFIG?.publishableKey) {
      const { makeSupabaseStore } = await import('./supabase-store.js');
      const { rotationTimetable } = await import('./engine/calendar.js');
      store = await makeSupabaseStore(CLOUD_CONFIG, rotationTimetable);
    }
  } catch (e) {
    console.warn('Cloud config not loaded; using local test mode.', e);
  }
}
export let db = null;
const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emptyGradeState() {
  return { runId: null, groupsAt: null, helpRerunAt: null, approvals: {}, publishedAt: null, completionLockedAt: null };
}

export function newRotation(r, settings) {
  return {
    id: r.id || `R${r.number}`,
    number: r.number,
    fridays: r.fridays,
    tracks: r.tracks,
    seed: newSeed(),
    grades: Object.fromEntries(GRADES.map((g) => [g, emptyGradeState()])),
    schoolYear: settings.schoolYear,
  };
}

export async function initDb() {
  if (store === localStore) await chooseStore();
  db = await store.load();
  if (store.mode === 'cloud') {
    if (!db) {
      const signedIn = await store.hasSession();
      if (signedIn) {
        db = { schemaVersion: SCHEMA_VERSION, codes: { server: true }, settings: structuredClone(SCHOOL_CONFIG), needsBootstrap: true, inbox: [], unlockLog: [], audit: [] };
        return db;
      }
      const setup = await store.setupNeeded().catch(() => false);
      db = { schemaVersion: SCHEMA_VERSION, codes: setup ? null : { server: true }, settings: structuredClone(SCHOOL_CONFIG), needsUnlock: !setup, inbox: [], unlockLog: [], audit: [] };
    }
    return db;
  }
  if (db && db.schemaVersion === SCHEMA_VERSION) return db;
  const roster = await store.loadRoster();
  const settings = structuredClone(SCHOOL_CONFIG);
  db = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    settings,
    codes: null, // set on first run (Owner sets the three passcodes)
    classes: roster.classes,
    students: roster.students.map((s) => ({ ...s, enrolledOn: settings.firstFriday, leftOn: null, pending: false })),
    rotations: suggestRotations(settings).map((r) => newRotation(r, settings)),
    registrations: {}, // rotId -> studentId -> {ranking, anyFine, helpAnswer, by, at}
    assignments: {}, // rotId -> studentId -> {elective, rank, source, pinned, placedByApp, needsHelp, hadChoices, availableCount, completion}
    runs: [],
    attendance: {}, // rotId -> date -> studentId -> 'absent'|'excused'
    cancelled: [], // {date, grade|null, elective|null, reason, by, at}
    exceptions: [],
    audit: [],
    inbox: [], // {id, to:'MUSIC'|'owner'|classId, text, at, read:false}
    requests: [], // {id, from, classId, studentId|null, text, status, at}
    unlockLog: [],
    testToday: null, // owner "pretend today is" (local test mode only)
    tourSeen: {},
  };
  await store.save(db);
  return db;
}

let saveTimer = null;
let saving = Promise.resolve();
export let saveState = 'saved';

export function changed({ save = true } = {}) {
  for (const fn of listeners) fn();
  if (!save) return;
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving
      .then(() => store.save(db))
      .then(() => setSaveState('saved'))
      .catch((e) => {
        console.error(e);
        setSaveState('error');
      });
  }, 150);
}

/** Save right away and wait for the result (used before steps that depend on the save). */
export async function saveNow() {
  clearTimeout(saveTimer);
  setSaveState('saving');
  saving = saving.then(() => store.save(db));
  await saving;
  setSaveState('saved');
}

function setSaveState(s) {
  saveState = s;
  const pill = document.getElementById('save-pill');
  if (pill) {
    pill.dataset.state = s;
    pill.textContent = s === 'saved' ? '✓ All saved' : s === 'saving' ? 'Saving…' : '⚠ Not saved — will retry';
  }
}

window.addEventListener('beforeunload', (e) => {
  if (saveState !== 'saved') {
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function resetDb() {
  await store.reset();
  db = null;
  return initDb();
}

// ---------- clock ----------
export function now() {
  const real = new Date();
  if (db?.testToday) {
    const [y, m, d] = db.testToday.date.split('-').map(Number);
    const [hh, mm] = (db.testToday.time || '08:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm);
  }
  return real;
}
export const todayISO = () => toISO(now());
export const nowTime = () => {
  const n = now();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

// ---------- change log ----------
export function who() {
  return whoLabel(getSession());
}

export function log(action, details = {}) {
  db.audit.push({ at: now().toISOString(), who: who(), action, ...details });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
}

export function notify(to, text) {
  db.inbox.push({ id: Math.random().toString(36).slice(2), to, text, at: now().toISOString(), read: false });
}

// ---------- look-ups ----------
export const classById = (id) => db.classes.find((c) => c.id === id);
export const studentById = (id) => db.students.find((s) => s.id === id);
export const rotationById = (id) => db.rotations.find((r) => r.id === id);
export const studentTrack = (s) => s.track ?? classById(s.classId)?.track;
export const activeStudents = () => db.students.filter((s) => s.active);
export const studentsInClass = (classId) =>
  activeStudents().filter((s) => s.classId === classId).sort((a, b) => (a.lastSort || a.last).localeCompare(b.lastSort || b.last) || a.first.localeCompare(b.first));
export const classLabel = (c) => (c ? `${c.code} · ${c.teacher || 'Teacher TBD'}` : '—');
export const sortByName = (list) => [...list].sort((a, b) => (a.lastSort || a.last).localeCompare(b.lastSort || b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first));
