// School calendar and settings (no student data). The owner can change these in the app;
// this file is only the starting point used the first time the app opens.
export const SCHOOL_CONFIG = {
  schoolName: '', // set on the Owner page (Settings)
  schoolYear: '2026-27',
  timezone: 'America/New_York',
  periods: {
    5: { start: '09:25', end: '10:10' },
    4: { start: '10:15', end: '11:00' },
    3: { start: '11:05', end: '11:50' },
    1: { start: '13:00', end: '13:45' },
    K: { start: '13:50', end: '14:35' },
    2: { start: '14:40', end: '15:25' },
  },
  rooms: { MUSIC: 'Music room', ART: 'Art room', PE: 'Gym', MEDIA: 'Media center' },
  // Track in-school sessions (owner's January–June 2027 table, plus Fall 2026 end).
  trackSessions: [
    { track: 1, start: '2027-01-03', end: '2027-03-05' },
    { track: 1, start: '2027-03-29', end: '2027-06-03' },
    { track: 3, start: '2027-01-03', end: '2027-01-22' },
    { track: 3, start: '2027-02-15', end: '2027-04-16' },
    { track: 3, start: '2027-05-10', end: '2027-06-29' },
    { track: 4, start: '2027-01-25', end: '2027-03-25' },
    { track: 4, start: '2027-04-19', end: '2027-06-29' },
    // Fall 2026 (from the Classroom schedule) — needed for December sign-ups
    { track: 1, start: '2026-10-08', end: '2026-12-04' },
    { track: 3, start: '2026-11-16', end: '2026-12-18' },
    { track: 4, start: '2026-10-26', end: '2026-12-18' },
  ],
  // Days with no students (from Classroom/others/schedule.js: holidays H, workdays W, annual leave A)
  noSchool: [
    '2026-11-11', '2026-11-25', '2026-11-26', '2026-11-27',
    '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25',
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',
    '2027-01-15', '2027-01-18', '2027-02-26', '2027-03-18', '2027-03-26',
    '2027-04-12', '2027-04-26', '2027-05-17', '2027-05-28', '2027-05-31',
    '2027-06-04', '2027-06-30',
  ],
  firstFriday: '2027-01-08',
  lastFriday: '2027-06-25',
  timetable: { closeTime: '15:00', helpDueTime: '12:00', publishTime: '15:00' },
  balance: { target: 2, max: 3 },
  completion: { rule: 'held-minus-one' },
};
