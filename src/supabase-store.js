// Cloud mode: the same database object, stored in Supabase as versioned documents (see supabase/migrations).
// Activated only when public/data/cloud-config.js has a project URL and publishable key.
// NOTE: written ahead of the cloud project; run the cloud checklist in README before trusting it with real use.
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';

const SPLIT = ['registrations']; // stored one document per student so teachers never overwrite each other
const KEYS = ['settings', 'classes', 'students', 'rotations', 'assignments', 'runs', 'attendance', 'cancelled', 'exceptions', 'audit', 'inbox', 'requests', 'tourSeen'];

export async function makeSupabaseStore(cfg, rotationTimetable) {
  const { createClient } = await import(SDK);
  const sb = createClient(cfg.url, cfg.publishableKey, { db: { schema: 'fe' }, auth: { persistSession: true, storageKey: 'fe-cloud-auth' } });
  const versions = {}; // key -> version
  const saved = {}; // key -> JSON last saved
  let thumbs = {}; // photo path -> signed URL

  const store = {
    mode: 'cloud',
    client: sb,
    async hasSession() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return false;
      const { data: role } = await sb.rpc('app_role');
      return !!role;
    },
    async unlock(code, deviceId, nickname) {
      const res = await fetch(`${cfg.url}/functions/v1/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
        body: JSON.stringify({ code, deviceId, nickname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: body.error || 'wrong', wait: body.wait };
      await sb.auth.setSession(body.session);
      return { role: body.role, codeVersion: body.codeVersion };
    },
    async call(body) {
      const res = await fetch(`${cfg.url}/functions/v1/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Server error ${res.status}`);
      return out;
    },
    async setupNeeded() {
      return (await store.call({ action: 'status' })).setupNeeded;
    },
    async setup(codes) {
      await store.call({ action: 'setup', codes });
    },
    async pick({ classId = null, elective = null, nickname = '' }) {
      await sb.rpc('pick', { p_class: classId, p_elective: elective, p_nickname: nickname });
    },
    async touch() {
      await sb.rpc('touch');
    },
    async setCode(role, code) {
      const { data } = await sb.auth.getSession();
      const res = await fetch(`${cfg.url}/functions/v1/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ action: 'set-code', role, newCode: code }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not change the code');
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async load() {
      if (!(await store.hasSession())) return null;
      const { data, error } = await sb.from('docs').select('key,data,version');
      if (error) throw error;
      if (!data.length) return null;
      const db = { schemaVersion: 1, codes: { server: true }, registrations: {} };
      for (const row of data) {
        versions[row.key] = row.version;
        saved[row.key] = JSON.stringify(row.data);
        if (row.key.startsWith('reg:')) {
          const [, rot, student] = row.key.split(':');
          (db.registrations[rot] ||= {})[student] = row.data;
        } else db[row.key] = row.data;
      }
      const paths = (db.students || []).filter((s) => s.photo && s.photoOk).map((s) => s.photo);
      thumbs = {};
      for (let i = 0; i < paths.length; i += 100) {
        const { data: urls } = await sb.storage.from('fe-thumbs').createSignedUrls(paths.slice(i, i + 100), 12 * 3600);
        for (const u of urls || []) if (u.signedUrl) thumbs[u.path] = u.signedUrl;
      }
      return db;
    },
    async save(db) {
      // rotations carry their server-checked closing time
      const rotations = (db.rotations || []).map((r) => {
        const t = rotationTimetable(db.settings, r);
        return { ...r, closesAt: new Date(`${t.choicesClose.date}T${t.choicesClose.time}:00`).toISOString() };
      });
      const docs = { ...Object.fromEntries(KEYS.map((k) => [k, db[k]])), rotations };
      for (const [key, value] of Object.entries(docs)) {
        if (value === undefined) continue;
        const text = JSON.stringify(value);
        if (saved[key] === text) continue;
        const { data, error } = await sb.rpc('save_doc', { p_key: key, p_data: value, p_expected_version: versions[key] || 0 });
        if (error) {
          if (error.code === '40001') throw Object.assign(new Error(`Someone else changed ${key}. Reload to see their change.`), { conflict: true });
          if (error.code === '42501') continue; // not allowed for this role — nothing to save
          throw error;
        }
        versions[key] = data;
        saved[key] = text;
      }
      for (const [rot, map] of Object.entries(db.registrations || {})) {
        for (const [student, value] of Object.entries(map)) {
          const key = `reg:${rot}:${student}`;
          const text = JSON.stringify(value);
          if (saved[key] === text) continue;
          const { error } = await sb.rpc('save_registration', { p_rotation: rot, p_student: student, p_data: value, p_made_at: value.at || new Date().toISOString() });
          if (error) throw error;
          saved[key] = text;
        }
      }
    },
    /** First owner unlock on an empty project: upload the starting documents and photo thumbnails. */
    async bootstrap(docs, students, photoBaseUrl, onProgress = () => {}) {
      for (const [key, value] of Object.entries(docs)) {
        const { error } = await sb.rpc('save_doc', { p_key: key, p_data: value, p_expected_version: 0 });
        if (error && error.code !== '40001') throw new Error(`${key}: ${error.message}`);
      }
      const withPhotos = students.filter((s) => s.photo);
      let done = 0;
      const failed = [];
      for (let i = 0; i < withPhotos.length; i += 6) {
        await Promise.all(withPhotos.slice(i, i + 6).map(async (s) => {
          try {
            const blob = await (await fetch(photoBaseUrl + s.photo)).blob();
            const { error } = await sb.storage.from('fe-thumbs').upload(s.photo, blob, { upsert: true, contentType: 'image/jpeg' });
            if (error) failed.push(s.photo);
          } catch {
            failed.push(s.photo);
          }
          onProgress(++done, withPhotos.length);
        }));
      }
      return { photos: done - failed.length, failed };
    },
    async reset() {
      throw new Error('Start over is only available in local test mode.');
    },
    async loadRoster() {
      throw new Error('In cloud mode the roster is uploaded with scripts/upload-to-cloud.mjs.');
    },
    photoBase: (path) => thumbs[path] || '',
  };
  return store;
}
