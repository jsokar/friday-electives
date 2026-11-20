// Merge a fresh Classroom import into the app's student list WITHOUT losing anything.
// - Existing students (same ID) get their name / class / photo updated; the owner's own settings
//   (photo on/off, active, pending, past electives) and their whole elective history are kept.
// - New students are added.
// - Students missing from the import are marked inactive (never deleted), and come back if they reappear.
// - Students the owner added by hand (no Classroom ID) are never touched.
// - Classes: only missing classes are added; teacher names typed on the Admin page are kept.
export function mergeRoster(current, incoming, today) {
  const summary = { added: [], moved: [], renamed: [], left: [], returned: [], newPhotos: [], newClasses: [] };
  const students = current.students.map((s) => ({ ...s }));
  const index = new Map(students.map((s, i) => [s.id, i]));
  const incomingIds = new Set(incoming.students.map((s) => s.id));

  for (const n of incoming.students) {
    if (index.has(n.id)) {
      const s = students[index.get(n.id)];
      if (s.classId !== n.classId) {
        summary.moved.push(`${n.name}: ${s.classId} → ${n.classId}`);
        (s.moves ||= []).push({ from: s.classId, to: n.classId, at: today, by: 'Classroom update' });
      }
      if (s.name !== n.name) summary.renamed.push(`${s.name} → ${n.name}`);
      if (n.photo && !s.photo) summary.newPhotos.push(n.name);
      Object.assign(s, { sourceId: n.sourceId, name: n.name, first: n.first, last: n.last, lastSort: n.lastSort, grade: n.grade, classId: n.classId, photo: n.photo || s.photo });
      if (s.leftByImport) {
        s.active = true;
        s.leftOn = null;
        delete s.leftByImport;
        summary.returned.push(`${n.name} (${n.classId})`);
      }
    } else {
      students.push({ ...n, enrolledOn: today, leftOn: null, pending: false });
      summary.added.push(`${n.name} (${n.classId})`);
      if (n.photo) summary.newPhotos.push(n.name);
    }
  }
  for (const s of students) {
    if (s.sourceId && !incomingIds.has(s.id) && s.active) {
      s.active = false;
      s.leftOn = today;
      s.leftByImport = true;
      summary.left.push(`${s.name} (${s.classId})`);
    }
  }
  const classes = current.classes.map((c) => ({ ...c }));
  for (const c of incoming.classes) {
    if (!classes.some((x) => x.id === c.id)) {
      classes.push({ ...c });
      summary.newClasses.push(c.id);
    }
  }
  const changes = summary.added.length + summary.moved.length + summary.renamed.length + summary.left.length + summary.returned.length + summary.newPhotos.length + summary.newClasses.length;
  return { students, classes, summary, changes };
}
