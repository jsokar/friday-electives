// Passcodes and sessions (§3.1). In local test mode codes are checked in this browser;
// in cloud mode the same rules run in the `unlock` Edge Function (supabase/functions/unlock).
const SESSION_KEY = 'fe-session';
const DEVICE_KEY = 'fe-device';
const ATTEMPTS_KEY = 'fe-attempts';

export const ROLE_LABEL = { teacher: 'Classroom Teacher', specialist: 'Specialist', owner: 'Owner' };
export const CODE_LENGTH = { teacher: 4, specialist: 4, owner: 6 };

export async function hashCode(code, salt) {
  // Slow hash (PBKDF2, 100k rounds) so guessing is slow; the cloud version also mixes in a server-only secret.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeCodeRecord(code) {
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  return { salt, hash: await hashCode(code, salt), changedAt: new Date().toISOString(), version: 1 };
}

export function device() {
  try {
    let d = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    if (!d) {
      d = { id: crypto.getRandomValues(new Uint32Array(2)).join(''), nickname: '' };
      localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
    }
    return d;
  } catch {
    return { id: 'no-storage', nickname: '' };
  }
}

export function setDeviceNickname(name) {
  const d = device();
  d.nickname = name;
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
  } catch {}
}

function attempts() {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{"fails":[],"lockedUntil":0}');
  } catch {
    return { fails: [], lockedUntil: 0 };
  }
}
function saveAttempts(a) {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
  } catch {}
}

export function lockedFor() {
  const a = attempts();
  return Math.max(0, a.lockedUntil - Date.now());
}

export function clearDeviceLock() {
  saveAttempts({ fails: [], lockedUntil: 0 });
}

/**
 * Try a code against all three roles. Returns {role} or {error}.
 * db.codes = { teacher:{salt,hash,version}, specialist:{...}, owner:{...} }
 * db.unlockLog = school-wide wrong-try log (cloud: server table).
 */
export async function tryUnlock(db, code) {
  const wait = lockedFor();
  if (wait > 0) return { error: 'locked', wait };
  // School-wide limit: after 20 wrong tries in an hour, slow down (cloud: per code on the server).
  const hourAgo = Date.now() - 3600_000;
  db.unlockLog = (db.unlockLog || []).filter((t) => t > hourAgo);
  if (db.unlockLog.length >= 20) return { error: 'slow', wait: 60_000, alert: true };
  for (const role of ['owner', 'specialist', 'teacher']) {
    const rec = db.codes?.[role];
    if (!rec || code.length !== CODE_LENGTH[role]) continue;
    if ((await hashCode(code, rec.salt)) === rec.hash) {
      clearDeviceLock();
      return { role, codeVersion: rec.version };
    }
  }
  db.unlockLog.push(Date.now());
  const a = attempts();
  a.fails = a.fails.filter((t) => t > hourAgo).concat(Date.now());
  if (a.fails.length >= 5) {
    a.lockedUntil = Date.now() + 15 * 60_000;
    a.fails = [];
  }
  saveAttempts(a);
  return { error: 'wrong', left: Math.max(0, 5 - a.fails.length) };
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function startSession(role, codeVersion) {
  const s = { role, codeVersion, started: Date.now(), lastActive: Date.now(), classId: null, elective: null, confirmed: false };
  saveSession(s);
  return s;
}

/** Is the session still valid? Teacher: until 4:30 pm and 10 minutes idle. Others: 12 hours. */
export function sessionProblem(s, db, now = new Date()) {
  if (!s) return 'none';
  if (!db.codes?.server) {
    const rec = db.codes?.[s.role];
    if (!rec || rec.version !== s.codeVersion) return 'code-changed';
  } // cloud: the server checks the code version on every request
  const ms = now.getTime();
  if (s.role === 'teacher') {
    if (ms - s.lastActive > 10 * 60_000) return 'idle';
    const cutoff = new Date(s.started);
    cutoff.setHours(16, 30, 0, 0);
    if (new Date(s.started) < cutoff && now >= cutoff) return 'day-ended';
    if (now.toDateString() !== new Date(s.started).toDateString()) return 'day-ended';
  } else if (ms - s.started > 12 * 3600_000) return 'expired';
  return null;
}

export function touchSession() {
  const s = getSession();
  if (!s) return;
  s.lastActive = Date.now();
  saveSession(s);
}

export function whoLabel(s) {
  if (!s) return 'Unknown';
  const dev = device().nickname || 'this device';
  const what = s.role === 'teacher' ? s.classId || 'no class' : s.role === 'specialist' ? s.elective || 'no elective' : '';
  return `${ROLE_LABEL[s.role]}${what ? ' · ' + what : ''} · ${dev}`;
}
