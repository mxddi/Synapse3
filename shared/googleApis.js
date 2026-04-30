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

