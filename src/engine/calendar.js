// Calendar logic: Fridays, which tracks are in school, rotations and their timetable (§1, §4).
// Dates are plain 'YYYY-MM-DD' strings (school-local), so there are no time-zone surprises.

export const toDate = (iso) => new Date(`${iso}T12:00:00`);
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const weekday = (iso) => toDate(iso).getDay(); // 0 Sun .. 5 Fri

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function niceDate(iso, withDay = true) {
  const d = toDate(iso);
  return `${withDay ? DAY[d.getDay()] + ' ' : ''}${d.getDate()} ${MON[d.getMonth()]}`;
}
export function niceTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function tracksInSchool(config, iso) {
  if (isNoSchool(config, iso)) return [];
  const tracks = new Set();
  for (const s of config.trackSessions) if (iso >= s.start && iso <= s.end) tracks.add(s.track);
  return [...tracks].sort();
}

export function isNoSchool(config, iso) {
  const wd = weekday(iso);
  return wd === 0 || wd === 6 || config.noSchool.includes(iso);
}

/** All Fridays between two dates (inclusive). */
export function fridays(from, to) {
  const out = [];
  let d = from;
  while (weekday(d) !== 5) d = addDays(d, 1);
  for (; d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

/** §1 Suggest rotations: consecutive Friday-Elective dates with the same set of tracks form one rotation. */
export function suggestRotations(config) {
  const days = fridays(config.firstFriday, config.lastFriday)
    .map((date) => ({ date, tracks: tracksInSchool(config, date) }))
    .filter((d) => d.tracks.length >= 2); // a Friday with only one track (or none) is not used
  const rotations = [];
  for (const d of days) {
    const last = rotations[rotations.length - 1];
    if (last && last.tracks.join() === d.tracks.join()) last.fridays.push(d.date);
    else rotations.push({ tracks: d.tracks, fridays: [d.date] });
  }
  return rotations.map((r, i) => ({ number: i + 1, id: `R${i + 1}`, ...r }));
}

/** Previous school day on or before iso. */
export function schoolDayOnOrBefore(config, iso) {
  let d = iso;
  // during long breaks there are no track sessions; any weekday not in noSchool counts as a school day
  while (isNoSchool(config, d)) d = addDays(d, -1);
  return d;
}

/** §4.1 Timetable for a rotation, worked back from the publish Friday P. */
export function rotationTimetable(config, rotation) {
  const F = rotation.fridays[0];
  let P = addDays(F, -7);
  while (weekday(P) !== 5 || isNoSchool(config, P)) P = addDays(P, -1);
  const t = config.timetable;
  const closeDay = schoolDayOnOrBefore(config, addDays(P, -4)); // Monday before P
  const makeDay = schoolDayOnOrBefore(config, addDays(P, -3)); // Tuesday
  const helpDay = schoolDayOnOrBefore(config, addDays(P, -2)); // Wednesday
  const last = rotation.fridays[rotation.fridays.length - 1];
  let lock = addDays(last, 3);
  while (isNoSchool(config, lock)) lock = addDays(lock, 1);
  return {
    signupOpens: schoolDayOnOrBefore(config, addDays(closeDay, -14)),
    choicesClose: { date: closeDay, time: t.closeTime },
    groupsMade: { date: makeDay, time: '07:00' },
    helpDue: { date: helpDay, time: t.helpDueTime },
    publishBy: { date: P, time: t.publishTime },
    completionLock: { date: lock, time: '15:00' },
  };
}

/** Compare a date+time object with "now" (ISO date + HH:MM). */
export function isPast(point, nowISO, nowTime) {
  if (nowISO !== point.date) return nowISO > point.date;
  return nowTime >= point.time;
}

/** Fridays of a rotation that were actually held (not cancelled). */
export function heldFridays(rotation, cancelled = []) {
  return rotation.fridays.filter((d) => !cancelled.includes(d));
}

/** D2 completion rule: attended ≥ held − 1, minimum 1; excused absences don't count against. */
export function completedFromAttendance(heldCount, attendedCount, excusedCount = 0) {
  if (heldCount === 0) return true;
  const needed = Math.max(1, heldCount - 1);
  return attendedCount + excusedCount >= needed;
}
