// Shared, framework-agnostic logic used by both web and mobile.

export const CAL_START_HOUR = 6; // 6 AM
export const CAL_END_HOUR = 22; // 10 PM

export function urgencyScoreFromDueDate(dueDate) {
  if (!dueDate) return 1;
  const days = (new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return 4;
  if (days <= 2) return 4;
  if (days <= 5) return 3;
  if (days <= 10) return 2;
  return 1;
}

export function getQuadrant(importance, urgency) {
  const hi = importance >= 3;
  const hu = urgency >= 3;
  if (hi && hu) return "importantUrgent";
  if (!hi && hu) return "notImportantUrgent";
  if (hi && !hu) return "importantNotUrgent";
  return "notImportantNotUrgent";
}

export function buildFallbackImportance(task, goals) {
  const title = `${task.title} ${task.notes || ""}`.toLowerCase();
  const hits = goals.filter((g) =>
    g.name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .some((w) => title.includes(w))
  ).length;
  if (hits >= 2) return 4;
  if (hits === 1) return 3;
  if (task.notes) return 2;
  return 1;
}

export function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

export function weekKeyFromDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function minutesToDisplay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${String(m).padStart(2, "0")} ${period}`;
}

export function normalizeAndLimitSuggestions(rawSuggestions, busyByDay, taskTitleById = new Map(), idFactory = null) {
  return (Array.isArray(rawSuggestions) ? rawSuggestions : [])
    .map((s, idx) => {
      const taskId = s.taskId || s.task_id || "";
      const resolvedTitle =
        s.taskTitle ||
        s.task_title ||
        taskTitleById.get(taskId) ||
        "Untitled task";
      const existingSugId = s.sugId || s.sug_id;

      return {
        ...s,
        taskId,
        day: Number(s.day),
        startMinute: Number(s.startMinute),
        endMinute: Number(s.endMinute),
        taskTitle: String(resolvedTitle),
        reason: String(s.reason || "Scheduled by AI."),
        sugId: String(existingSugId || (idFactory ? idFactory(idx) : `sug-${idx}`)),
      };
    })
    .filter((s) => Number.isInteger(s.day) && s.day >= 0 && s.day <= 6)
    .filter((s) => Number.isFinite(s.startMinute) && Number.isFinite(s.endMinute))
    .filter((s) => s.startMinute >= CAL_START_HOUR * 60 && s.endMinute <= CAL_END_HOUR * 60)
    .filter((s) => s.startMinute < s.endMinute)
    .filter((s) => {
      const blocks = busyByDay[s.day] || [];
      return !blocks.some((b) => s.startMinute < b.endMinute && s.endMinute > b.startMinute);
    })
    .slice(0, 6);
}

export function calendarEventFromGoogleEvent(gEvent, weekStart) {
  const start = gEvent.start?.dateTime || gEvent.start?.date;
  const end = gEvent.end?.dateTime || gEvent.end?.date;
  if (!start || !end) return null;

  const startDate = new Date(start);
  const endDate = new Date(end);
  const ws = new Date(weekStart);
  ws.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((startDate - ws) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > 6) return null;

  return {
    id: gEvent.id,
    title: gEvent.summary || "Busy",
    day: diffDays,
    startMinute: startDate.getHours() * 60 + startDate.getMinutes(),
    endMinute: endDate.getHours() * 60 + endDate.getMinutes(),
    source: "google",
  };
}

