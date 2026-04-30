import { addDays, calendarEventFromGoogleEvent, getWeekStart, weekKeyFromDate, urgencyScoreFromDueDate } from "./synapseCore";

export async function fetchGoogleTasks(accessToken) {
  const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listsRes.ok) throw new Error(`Lists request failed: ${listsRes.status}`);
  const lists = (await listsRes.json()).items || [];

  const all = [];
  for (const list of lists) {
    const res = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) continue;
    const tasksData = await res.json();
    (tasksData.items || []).forEach((task) => {
      all.push({
        id: task.id,
        title: task.title || "Untitled task",
        due: task.due || null,
        notes: task.notes || "",
        source: "google",
        taskListId: list.id,
        importance: 3,
        urgency: urgencyScoreFromDueDate(task.due),
        completed: false,
      });
    });
  }
  return all;
}

export async function updateGoogleTask(accessToken, { taskId, taskListId, title, notes, dueIsoOrNull }) {
  const updateRes = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: taskId,
        title,
        notes,
        due: dueIsoOrNull || undefined,
      }),
    }
  );
  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error(`Google update failed (${updateRes.status}): ${text}`);
  }
}

export async function fetchGoogleCalendarEvents(accessToken, targetWeekStart) {
  const selectedWeekStart = getWeekStart(targetWeekStart);
  const selectedWeekKey = weekKeyFromDate(selectedWeekStart);
  const weekEnd = addDays(selectedWeekStart, 7);
  const timeMin = selectedWeekStart.toISOString();
  const timeMax = weekEnd.toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Calendar request failed: ${res.status}`);
  const items = (await res.json()).items || [];

  const mapped = items
    .map((ev) => calendarEventFromGoogleEvent(ev, selectedWeekStart))
    .map((ev) => (ev ? { ...ev, weekKey: selectedWeekKey } : null))
    .filter(Boolean);

  return { weekKey: selectedWeekKey, events: mapped };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function minutesToHhMm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function buildDateTimeIsoLocal({ baseDate, minutesFromMidnight }) {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  const hhmm = minutesToHhMm(minutesFromMidnight);
  const datePart = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${datePart}T${hhmm}:00`;
}

/**
 * Create a Google Calendar event on the user's primary calendar.
 *
 * Returns a mapped "calendar event" for display in the weekly grid.
 */
export async function createGoogleCalendarEvent(accessToken, {
  weekStart,
  day,
  title,
  startMinute,
  endMinute,
  isAllDay = false,
  reminderMinutes = null, // null => calendar default; 0 => none; number => popup minutes
}) {
  if (!accessToken) throw new Error("Missing Google access token.");
  if (!title?.trim()) throw new Error("Event title is required.");

  const selectedWeekStart = getWeekStart(weekStart);
  const selectedWeekKey = weekKeyFromDate(selectedWeekStart);
  const dayDate = addDays(selectedWeekStart, day);

  const timeZone =
    (typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone) ||
    "UTC";

  const safeStart = Number.isFinite(startMinute) ? startMinute : 0;
  const safeEnd = Number.isFinite(endMinute) && endMinute > safeStart ? endMinute : safeStart + 60;

  const eventResource = {
    summary: title.trim(),
    ...(isAllDay
      ? {
          start: { date: dayDate.toISOString().slice(0, 10) },
          // For all-day events, Google expects end.date to be the day *after* the last day.
          end: { date: addDays(dayDate, 1).toISOString().slice(0, 10) },
        }
      : {
          start: { dateTime: buildDateTimeIsoLocal({ baseDate: dayDate, minutesFromMidnight: safeStart }), timeZone },
          end: { dateTime: buildDateTimeIsoLocal({ baseDate: dayDate, minutesFromMidnight: safeEnd }), timeZone },
        }),
    reminders:
      reminderMinutes == null
        ? { useDefault: true }
        : reminderMinutes === 0
          ? { useDefault: false, overrides: [] }
          : { useDefault: false, overrides: [{ method: "popup", minutes: Number(reminderMinutes) }] },
  };

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventResource),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar create failed (${res.status}): ${text}`);
  }

  const created = await res.json();
  const mapped = calendarEventFromGoogleEvent(created, selectedWeekStart);
  if (!mapped) throw new Error("Created event could not be mapped for display.");

  return { ...mapped, weekKey: selectedWeekKey };
}

