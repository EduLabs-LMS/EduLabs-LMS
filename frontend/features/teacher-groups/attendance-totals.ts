'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GroupPage, GroupRow } from '@/shared/contracts/groups';
import { ATTENDANCE_PAGES, attendanceTotals, type AttendanceTotal } from '@/shared/teacher-groups';
import { groupCall, limited } from './api';

export type Totals = { totals: ReadonlyMap<string, AttendanceTotal>; truncated: boolean };

/**
 * How each student has attended in one Group, added up from the Group's attendance history (the existing staff read). No read holds these totals.
 * A Group larger than the cap comes back `truncated`, so the screen shows a dash rather than a wrong number.
 */
export async function readAttendanceTotals(groupId: string, signal?: AbortSignal): Promise<Totals> {
  const rows: GroupRow[] = [];
  for (let page = 0; page < ATTENDANCE_PAGES; page++) {
    const result = await limited(() => groupCall<GroupPage<GroupRow>>('view', groupId, { section: 'history', page, search: '' }, null, signal));
    rows.push(...result.rows);
    if (!result.hasMore) return { totals: attendanceTotals(rows), truncated: false };
  }
  return { totals: new Map(), truncated: true };
}

/** The same figures for several Groups, read for the Groups on screen only. A Group that fails or is too long simply has no figures: its students show a dash. */
export function useGroupsAttendance(groupIds: readonly string[], refresh = 0) {
  const [read, setRead] = useState<Record<string, { totals: Totals | null; stamp: number }>>({});
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = groupIds.join(',');
  useEffect(() => {
    for (const id of key ? key.split(',') : []) {
      const flight = `${id}:${refresh}`;
      if (read[id]?.stamp === refresh || inflight.current.has(flight)) continue;
      inflight.current.add(flight);
      const settle = (totals: Totals | null) => { inflight.current.delete(flight); if (mounted.current) setRead(r => ({ ...r, [id]: { totals, stamp: refresh } })); };
      readAttendanceTotals(id).then(settle, () => settle(null));
    }
  }, [key, read, refresh]);
  return useMemo(() => ({
    /** A student's figures across the given Groups, or null while any of them is unread, failed or too long. */
    of(userId: string, groups: readonly { id: string }[] | undefined): AttendanceTotal | null {
      if (!groups?.length) return null;
      let attended = 0, total = 0;
      for (const g of groups) {
        const entry = read[g.id]?.totals;
        if (!entry || entry.truncated) return null;
        const figures = entry.totals.get(userId);
        attended += figures?.attended ?? 0; total += figures?.total ?? 0;
      }
      return { attended, total };
    },
  }), [read]);
}
