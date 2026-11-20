// §9.7 Owner page: passcodes, students, classes, settings, test clock, data checks, history, backup.
import { h, card, dialog, field, announce, select, info } from '../ui.js';
import { db, store, changed, log, classById, sortByName, resetDb, now, todayISO } from '../data.js';
import { makeCodeRecord, ROLE_LABEL, CODE_LENGTH, clearDeviceLock } from '../auth.js';
import { stage, currentRotation, timetable } from '../domain.js';
import { GRADES } from '../engine/constants.js';
import { gradeName } from './common.js';

function passcodes(rerender) {
  const row = (role) => {
    const input = h('input', { type: 'password', inputmode: 'numeric', maxlength: CODE_LENGTH[role], autocomplete: 'new-password', 'aria-label': `New ${ROLE_LABEL[role]} code` });
    const changedAt = db.codes?.[role]?.changedAt;
    return h('tr', {}, h('th', { scope: 'row' }, ROLE_LABEL[role]), h('td', {}, changedAt ? `Changed ${new Date(changedAt).toLocaleDateString()}` : 'Saved on the server'),
      h('td', {}, input), h('td', {}, h('button', { class: 'btn small', onclick: async () => {
        const v = input.value.trim();
        if (!new RegExp(`^\\d{${CODE_LENGTH[role]}}$`).test(v)) return announce(`The ${ROLE_LABEL[role]} code must be ${CODE_LENGTH[role]} digits.`, { kind: 'bad' });
        const isFriday = new Date(now()).getDay() === 5;
        const ok = await dialog({ title: `Change the ${ROLE_LABEL[role]} code?`, body: h('p', {}, `Everyone using the old code is signed out right away and sees “The code was changed — ask the owner for the new one.”${isFriday ? ' Today is a Friday — are you sure?' : ''}`), buttons: [{ label: 'Cancel', value: false }, { label: 'Change code', danger: true, value: true }] });
        if (!ok) return;
        if (store.setCode) {
          await store.setCode(role, v);
          announce(`${ROLE_LABEL[role]} code changed.`);
          return;
        }
        const rec = await makeCodeRecord(v);
        rec.version = (db.codes?.[role]?.version || 1) + 1;
        db.codes[role] = rec;
        log('passcode changed', { role });
        changed();
        announce(`${ROLE_LABEL[role]} code changed.`);
        rerender();
      } }, 'Change')));
  };
  return card('Passcodes',
    h('p', { class: 'hint' }, 'Don’t change codes on a Friday or while sign-up is open. Hand out codes in person, not by staff-wide email.'),
    h('table', {}, h('tbody', {}, ['teacher', 'specialist', 'owner'].map(row))),
    h('p', {}, h('button', { class: 'btn small', onclick: () => { clearDeviceLock(); announce('Wrong-code wait cleared on this device.'); } }, 'Clear wrong-code wait on this device'),
      info('wrong-code wait', 'After 5 wrong codes a device waits 15 minutes. In cloud mode you can clear any device from here.')));
}

function students(rerender) {
  const q = h('input', { type: 'search', placeholder: 'Search a name…', 'aria-label': 'Search students' });
  const out = h('div', {});
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const list = sortByName(db.students.filter((s) => !term || s.name.toLowerCase().includes(term))).slice(0, term ? 60 : 20);
    out.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Class', 'Photo', 'Active', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((s) => h('tr', {},
        h('td', {}, s.name, s.pending ? ' (pending)' : ''),
        h('td', {}, select(db.classes.map((c) => ({ value: c.id, label: c.code })), s.classId, { 'aria-label': `Class for ${s.name}`, onchange: (e) => {
          const from = s.classId;
          s.classId = e.target.value;
          s.grade = classById(s.classId).grade;
          (s.moves ||= []).push({ from, to: s.classId, at: todayISO() });
          log('student moved class', { student: s.id, from, to: s.classId });
          changed();
          announce(`${s.first} moved to ${s.classId}.`);
        } })),
        h('td', {}, h('label', {}, h('input', { type: 'checkbox', checked: s.photoOk, onchange: (e) => { s.photoOk = e.target.checked; log('photo permission', { student: s.id, ok: s.photoOk }); changed(); } }), ' show')),
        h('td', {}, h('label', {}, h('input', { type: 'checkbox', checked: s.active, onchange: (e) => { s.active = e.target.checked; s.leftOn = s.active ? null : todayISO(); log(s.active ? 'student reactivated' : 'student deactivated', { student: s.id }); changed(); } }), ' active')),
        h('td', {}, s.pending ? h('button', { class: 'btn small', onclick: () => { s.pending = false; log('pending student confirmed', { student: s.id }); changed(); draw(); } }, 'Confirm') : null))))),
    term ? null : h('p', { class: 'hint' }, 'Showing 20. Type in the search box to find anyone.'));
  };
  q.addEventListener('input', draw);
  draw();
  const add = h('button', { class: 'btn', onclick: async () => {
    const first = h('input', {}); const last = h('input', {});
    const cls = select(db.classes.map((c) => ({ value: c.id, label: `${c.code} · ${c.teacher || 'TBD'}` })), db.classes[0].id);
    const ok = await dialog({ title: 'Add a student', body: [field('First name', first), field('Last name', last), field('Class', cls)], buttons: [{ label: 'Cancel', value: false }, { label: 'Add', primary: true, value: true }], onOpen: () => first.focus() });
    if (!ok || !first.value.trim()) return;
    const name = `${first.value.trim()} ${last.value.trim()}`.trim();
    const dup = db.students.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      const again = await dialog({ title: 'Possible duplicate', body: h('p', {}, `${dup.name} already exists in ${dup.classId}${dup.active ? '' : ' (inactive)'}. ${dup.active ? '' : 'Reactivate instead?'}`), buttons: [{ label: 'Cancel', value: 'no' }, ...(dup.active ? [] : [{ label: 'Reactivate', primary: true, value: 're' }]), { label: 'Add anyway', value: 'add' }] });
      if (again === 're') { dup.active = true; dup.classId = cls.value; dup.grade = classById(cls.value).grade; changed(); rerender(); return; }
      if (again !== 'add') return;
    }
    const c = classById(cls.value);
    db.students.push({ id: 'stu_' + Math.random().toString(16).slice(2, 12), sourceId: null, name, first: first.value.trim(), last: last.value.trim(), lastSort: last.value.trim(), grade: c.grade, classId: c.id, photo: null, photoOk: false, active: true, enrolledOn: todayISO(), leftOn: null, pending: false });
    log('student added', { name });
    changed();
    announce(`${name} added to ${c.code}. If groups are already made, they appear under “Late changes” on the board.`);
    rerender();
  } }, 'Add a student');
  return card('Students', h('div', { class: 'row' }, q, add), out);
}

function classes() {
  const rows = db.classes.map((c) => {
    const teacher = h('input', { value: c.teacher || '', placeholder: 'Teacher TBD', 'aria-label': `Teacher for ${c.code}` });
    teacher.addEventListener('change', () => { c.teacher = teacher.value.trim() || null; log('teacher name', { class: c.id }); changed(); });
    const email = h('input', { type: 'email', value: c.teacherEmail || '', 'aria-label': `Email for ${c.code}` });
    email.addEventListener('change', () => { c.teacherEmail = email.value.trim() || null; changed(); });
    return h('tr', {}, h('td', {}, c.code), h('td', {}, c.track), h('td', {}, teacher), h('td', {}, email));
  });
  const head = h('thead', {}, h('tr', {}, ['Class', 'Track', 'Teacher', 'Teacher email (for reminders)'].map((x) => h('th', {}, x))));
  return card('Classes and homeroom teachers', h('div', { class: 'tablewrap' }, h('table', {}, head, h('tbody', {}, rows))));
}

function settings(rerender) {
  const rows = ['5', '4', '3', '1', 'K', '2'].map((g) => {
    const p = db.settings.periods[g];
    const s = h('input', { type: 'time', value: p.start, 'aria-label': `${gradeName(g)} start` });
    const e = h('input', { type: 'time', value: p.end, 'aria-label': `${gradeName(g)} end` });
    const save = () => { p.start = s.value; p.end = e.value; log('period times', { grade: g }); changed(); };
    s.addEventListener('change', save); e.addEventListener('change', save);
    return h('tr', {}, h('th', {}, gradeName(g)), h('td', {}, s), h('td', {}, e));
  });
  const rooms = Object.keys(db.settings.rooms).map((k) => h('div', {}, field(`${k} room`, h('input', { value: db.settings.rooms[k], onchange: (ev) => { db.settings.rooms[k] = ev.target.value; changed(); } }))));
  const schoolName = h('input', { value: db.settings.schoolName || '', placeholder: 'School name for printouts' });
  schoolName.addEventListener('change', () => { db.settings.schoolName = schoolName.value.trim(); log('school name'); changed(); });
  return card('Settings', field('School name (shown on printouts)', schoolName), h('h3', {}, 'Friday periods'), h('table', {}, h('tbody', {}, rows)), h('h3', {}, 'Rooms'), h('div', { class: 'grid2' }, rooms));
}

function testClock(rerender) {
  if (store.mode !== 'local') return null;
  const d = h('input', { type: 'date', value: db.testToday?.date || todayISO() });
  const t = h('input', { type: 'time', value: db.testToday?.time || '08:00' });
  const rot = currentRotation();
  const tt = timetable(rot);
  const jump = (label, p) => h('button', { class: 'btn small', onclick: () => { db.testToday = { date: p.date, time: p.time }; changed(); rerender(); } }, label);
  return card('Test clock (local test mode only)',
    h('p', { class: 'hint' }, 'Pretend today is another date to try each step. Automatic steps (making groups, publishing at the deadline) run when the clock passes them.'),
    h('div', { class: 'row' }, d, t,
      h('button', { class: 'btn primary small', onclick: () => { db.testToday = { date: d.value, time: t.value }; changed(); rerender(); } }, 'Set'),
      h('button', { class: 'btn small', onclick: () => { db.testToday = null; changed(); rerender(); } }, 'Use real time')),
    h('p', {}, `Jump to a step of ${rot.id}: `, jump('Sign-up open', { date: tt.signupOpens, time: '09:00' }), ' ', jump('Just after choices close', { date: tt.choicesClose.date, time: '15:05' }), ' ', jump('After deadline', { date: tt.publishBy.date, time: '15:30' }), ' ', jump('First Friday', { date: rot.fridays[0], time: '09:30' }), ' ', jump('After lock', { date: tt.completionLock.date, time: '15:30' })));
}

function dataChecks() {
  const problems = [];
  const noClass = db.students.filter((s) => s.active && !classById(s.classId));
  if (noClass.length) problems.push(`${noClass.length} active students have no class.`);
  const noPhoto = db.students.filter((s) => s.active && !s.photo).length;
  if (noPhoto) problems.push(`${noPhoto} students have no photo (initials shown).`);
  const pending = db.students.filter((s) => s.pending).length;
  if (pending) problems.push(`${pending} pending students added by specialists need confirming.`);
  const tbd = db.classes.filter((c) => !c.teacher).map((c) => c.code);
  if (tbd.length) problems.push(`Teacher name missing: ${tbd.join(', ')}.`);
  for (const r of db.rotations) for (const g of GRADES) if (stage(r, g) === 'running' && r.fridays[r.fridays.length - 1] < todayISO()) problems.push(`${r.id} ${gradeName(g)}: Fridays are over but completion isn’t locked yet.`);
  const open = db.requests.filter((r) => r.status === 'open').length;
  if (open) problems.push(`${open} open requests from teachers (see Inbox on the board).`);
  return card('Data checks', problems.length ? h('ul', {}, problems.map((p) => h('li', {}, p))) : h('p', { class: 'status done' }, '✓ Everything looks fine.'));
}

function historyCard() {
  const rows = db.audit.slice(-40).reverse();
  return h('details', { class: 'card' }, h('summary', {}, `Change history (${db.audit.length} entries)`),
    h('button', { class: 'btn small', onclick: () => download(`friday-electives-history-${todayISO()}.json`, JSON.stringify(db.audit, null, 1)) }, 'Export history'),
    h('ul', {}, rows.map((x) => h('li', {}, `${new Date(x.at).toLocaleString()} — ${x.action} — ${x.who}`))));
}

function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function backup(rerender) {
  const file = h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Backup file to restore' });
  return card('Backup and restore',
    h('p', { class: 'hint' }, 'Contains student records — store on the district drive or an encrypted folder only. Codes and photos are left out.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => {
        const copy = { ...db, codes: null, unlockLog: [] };
        download(`friday-electives-backup-${todayISO()}.json`, JSON.stringify(copy));
        log('backup downloaded');
        changed();
      } }, 'Download backup'),
      file,
      h('button', { class: 'btn danger', onclick: async () => {
        const f = file.files?.[0];
        if (!f) return announce('Choose a backup file first.', { kind: 'bad' });
        const data = JSON.parse(await f.text());
        const ok = await dialog({ title: 'Restore this backup?', body: h('p', {}, `Everything changed since ${data.audit?.at(-1)?.at ? new Date(data.audit.at(-1).at).toLocaleString() : 'that backup'} will be lost. A copy of the current data is downloaded first.`), buttons: [{ label: 'Cancel', value: false }, { label: 'Restore', danger: true, value: true }] });
        if (!ok) return;
        download(`friday-electives-before-restore-${todayISO()}.json`, JSON.stringify({ ...db, codes: null }));
        const codes = db.codes;
        Object.keys(db).forEach((k) => delete db[k]);
        Object.assign(db, data, { codes });
        log('backup restored');
        changed();
        rerender();
      } }, 'Restore')),
    h('details', {}, h('summary', {}, 'Start over (test mode)'),
      h('p', { class: 'hint' }, 'Deletes all test data in this browser and re-imports the roster. Passcodes must be set again.'),
      h('button', { class: 'btn danger', onclick: async () => {
        const ok = await dialog({ title: 'Delete all test data?', body: h('p', {}, 'This cannot be undone (download a backup first if you want one).'), buttons: [{ label: 'Cancel', value: false }, { label: 'Delete and start over', danger: true, value: true }] });
        if (!ok) return;
        await resetDb();
        location.hash = '#/home';
        location.reload();
      } }, 'Delete all test data')));
}

export function renderOwner(main, { rerender }) {
  main.append(h('h1', {}, 'Admin'),
    h('p', { class: 'muted' }, 'Only your 6-digit code opens this page. Here you manage the passcodes, the student list, class teachers, Friday times and backups.'),
    h('div', { class: 'row', style: { marginBottom: '1rem' } },
      h('a', { class: 'btn small', href: '#/reports' }, '🖨 All printouts'),
      h('a', { class: 'btn small', href: '#/attendance' }, 'Attendance (optional)')),
    dataChecks(), testClock(rerender), passcodes(rerender), students(rerender), classes(rerender), settings(rerender), backup(rerender), historyCard());
}
