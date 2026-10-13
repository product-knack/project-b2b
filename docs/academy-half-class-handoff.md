# Academy attendance: half / full class (web done 2026-09-28, Android pending)

Written by the web session for the Android session. Nothing in odds-app was changed.

## The rule
When a teacher marks attendance, the class is also marked Full or Half. One value per class (a class is a batch + date), stored on every student row of that class, like `session_time`.

## Backend (already live once the owner runs the migration)
- `academy_attendance.class_duration text not null default 'full'`, CHECK in (`full`, `half`). Migration `hub-track/supabase/migrations/20260928100000_academy_attendance_class_duration.sql`.
- No other change: no log table, no trigger, no new policies. The teacher RLS rules are unchanged (insert only pending, update only pending or rejected rows of the teacher's batches).
- Rows written without the column default to `full`. An upsert that omits the column leaves an existing row's value alone, so an app resubmission cannot flip a Half class back to Full.

## Android change (src/lib/academyAttendanceQueries.ts, useSubmitTeacherAttendance, ~line 255)
- Add `classDuration: 'full' | 'half'` to the input and put `class_duration: input.classDuration` on every row of the payload.
- Read it back in the batch-date query (`select('student_id, status, remarks, approval_status, class_duration')`) so the sheet preloads the current value: half only when every row of the class says half, else full.
- Teacher attendance sheet: a Full class / Half class choice at the top, once per class, default Full. Weekly or day list: a "Half class" badge once the class is submitted as half.
- Students never see it. No em dashes in copy.

## Web reference (hub-track)
- `src/hooks/academy-mgmt/useAcademyAttendance.ts`: `ClassDuration`, `classDurationOf(rows)`, `useSetClassDuration` (admin, pending classes only).
- `src/components/trainer/academy/LogAttendanceDialog.tsx` and `src/pages/trainer/OddsAcademy.tsx` for the teacher UI.
- Admin approval, banner, Mark Attendance and reports are web-only; nothing to port there.

## Until the app ships
App teachers can only submit Full. Ask them to tell the academy admin when a class was half; the admin switches the pending class to Half on the web before approving.
