// Shared, framework-agnostic logic used by both web and mobile.

export const CAL_START_HOUR = 0; // midnight
export const CAL_END_HOUR = 24; // end of day (exclusive hour index; grid shows 0–23, minutes through 23:59)

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Display Google Tasks–style due (RFC3339) as local date + time. */
export function formatTaskDueForDisplay(isoOrNull, { fallback = "None" } = {}) {
  if (!isoOrNull) return fallback;
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(isoOrNull);
  }
}

/** Split a due ISO into local YYYY-MM-DD and HH:mm for editors. */
export function dueIsoToLocalDateAndTime(isoOrNull) {
  if (!isoOrNull) return { date: "", time: "09:00" };
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return { date: "", time: "09:00" };
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

/** Build RFC3339 due for Google Tasks from local date + time fields. */
export function localDateAndTimeToDueIso(dateStr, timeStr) {
  if (!dateStr || !String(dateStr).trim()) return null;
  const tm = String(timeStr || "09:00").trim().match(/^(\d{1,2}):(\d{2})$/);
  const hh = tm ? Math.max(0, Math.min(23, parseInt(tm[1], 10))) : 9;
  const mm = tm ? Math.max(0, Math.min(59, parseInt(tm[2], 10))) : 0;
  const dm = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return null;
  const d = new Date(parseInt(dm[1], 10), parseInt(dm[2], 10) - 1, parseInt(dm[3], 10), hh, mm, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Local coaching copy when matrix insight is refreshed from goal changes (no Groq). */
export function buildMatrixInsightFallback(goals, scoredTasks) {
  const totalGoalHours = goals.reduce((s, g) => s + Number(g.weeklyHours || 0), 0);
  const quadrantCounts = scoredTasks.reduce(
    (acc, t) => {
      acc[t.quadrant] += 1;
      return acc;
    },
    { importantUrgent: 0, notImportantUrgent: 0, importantNotUrgent: 0, notImportantNotUrgent: 0 }
  );
  const highPriority = scoredTasks.filter((t) => t.importance >= 3 && t.urgency >= 3).length;
  const lowLow = quadrantCounts.notImportantNotUrgent;

  if (totalGoalHours > 50) {
    return `You allotted ${totalGoalHours} hours across goals this week, which may be unrealistic. Consider trimming or deferring lower priority work.`;
  }
  if (lowLow > highPriority) {
    return "You have more tasks in the Not Important / Not Urgent quadrant than in your top priority quadrant. Consider deleting, delegating, or scheduling less.";
  }
  if (highPriority === 0) {
    return "Nothing is currently both Important and Urgent. Double-check deadlines and goal alignment so your week has clear top priorities.";
  }
  return "Nice distribution — keep protecting time for Important / Not Urgent work so urgent work doesn’t crowd out strategy.";
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
  const normalized = (Array.isArray(rawSuggestions) ? rawSuggestions : [])
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
    .filter((s) => s.startMinute >= CAL_START_HOUR * 60 && s.endMinute <= CAL_END_HOUR * 60 - 1)
    .filter((s) => s.startMinute < s.endMinute)
    .filter((s) => {
      const blocks = busyByDay[s.day] || [];
      return !blocks.some((b) => s.startMinute < b.endMinute && s.endMinute > b.startMinute);
    });

  // Enforce at most one suggestion per task (AI sometimes repeats the same task across multiple slots).
  // When taskId is missing, fall back to normalized title so the same task string can't occupy 5 slots.
  const bestByTaskId = new Map();
  for (const s of normalized) {
    const idKey = String(s.taskId || "").trim();
    const titleKey = String(s.taskTitle || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const key = idKey ? `id:${idKey}` : titleKey ? `ttl:${titleKey}` : `sug:${String(s.sugId)}`;

    const prev = bestByTaskId.get(key);
    if (!prev) {
      bestByTaskId.set(key, s);
      continue;
    }

    const prevDur = prev.endMinute - prev.startMinute;
    const nextDur = s.endMinute - s.startMinute;
    const better =
      nextDur > prevDur ||
      (nextDur === prevDur && s.startMinute < prev.startMinute) ||
      (nextDur === prevDur && s.startMinute === prev.startMinute && s.endMinute < prev.endMinute);
    if (better) bestByTaskId.set(key, s);
  }

  return Array.from(bestByTaskId.values())
    .sort((a, b) => (a.day - b.day) || (a.startMinute - b.startMinute) || (a.endMinute - b.endMinute))
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

