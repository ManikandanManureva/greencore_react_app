import { Shift } from '../types';

/** A shift closed this close to its end time hands over to the next one. Closed earlier, it's a mistake or a stop. */
export const HANDOVER_WINDOW_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;

function toMinutes(time: string): number {
  const parts = String(time || '').trim().split(':');
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

/** The shift whose hours include this time of day (minutes from midnight), overnight shifts included. */
export function shiftAtTime(shifts: Shift[], nowMin: number): Shift | null {
  return (
    shifts.find((s) => {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
    }) ?? null
  );
}

/**
 * The shift to start right after one closes, or null to start none.
 *  - Closed after its end time: the shift the clock is in now (a forgotten Shift 1 closed at 23:30 goes to Shift 3).
 *  - Closed in its last HANDOVER_WINDOW_MINUTES: the shift that follows it.
 *  - Closed earlier than that: none. Starting Shift 2 at 10:00 would put the rest of Shift 1's outputs under Shift 2.
 */
export function pickShiftAfterClose(shifts: Shift[], closedId: number, nowMin: number): Shift | null {
  const closed = shifts.find((s) => Number(s.id) === Number(closedId));
  const current = shiftAtTime(shifts, nowMin);
  if (!closed || !current) return null;
  if (Number(current.id) !== Number(closed.id)) return current;

  const closedEnd = toMinutes(closed.end_time);
  const minutesLeft = (closedEnd - nowMin + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (minutesLeft > HANDOVER_WINDOW_MINUTES) return null;
  return shifts.find((s) => toMinutes(s.start_time) === closedEnd) ?? null;
}
