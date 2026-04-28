import React, { useEffect, useMemo, useRef, useState } from "react";

// ─── Google API scopes ────────────────────────────────────────────────────────
const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_COMBINED_SCOPE = `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// ─── Calendar display constants ───────────────────────────────────────────────
const CAL_START_HOUR = 6;   // 6 AM
const CAL_END_HOUR = 22;  // 10 PM
const HOUR_PX = 64;  // px per hour in the grid

const EVENT_COLORS = {
  google: { bg: "#4285F4", text: "#fff" },
  manual: { bg: "#34A853", text: "#fff" },
  suggested: { bg: "#FBBC05", text: "#1a1a1a" },
};

// ─── Mock data ────────────────────────────────────────────────────────────────
const mockGoals = [
  { id: "g1", name: "Prepare for data structures exam", weeklyHours: 8 },
  { id: "g2", name: "Finish product demo deck", weeklyHours: 5 },
  { id: "g3", name: "Exercise and sleep consistency", weeklyHours: 4 },
];

const mockTasks = [
  { id: "t1", title: "Review binary trees notes", due: inDays(1), notes: "study" },
  { id: "t2", title: "Design slides for demo", due: inDays(3), notes: "work project" },
  { id: "t3", title: "Book dentist appointment", due: inDays(9), notes: "personal admin" },
  { id: "t4", title: "Watch random YouTube", due: inDays(14), notes: "optional" },
];

function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ─── Pure helper functions ────────────────────────────────────────────────────
function urgencyScoreFromDueDate(dueDate) {
  if (!dueDate) return 1;
  const days = (new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return 4;
  if (days <= 2) return 4;
  if (days <= 5) return 3;
  if (days <= 10) return 2;
  return 1;
}

function getQuadrant(importance, urgency) {
  const hi = importance >= 3, hu = urgency >= 3;
  if (hi && hu) return "importantUrgent";
  if (!hi && hu) return "notImportantUrgent";
  if (hi && !hu) return "importantNotUrgent";
  return "notImportantNotUrgent";
}

function buildFallbackImportance(task, goals) {
  const title = `${task.title} ${task.notes || ""}`.toLowerCase();
  const hits = goals.filter((g) =>
    g.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => title.includes(w))
  ).length;
  if (hits >= 2) return 4;
  if (hits === 1) return 3;
  if (task.notes) return 2;
  return 1;
}

// ─── Calendar date helpers ────────────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDayHeader(date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function weekKeyFromDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function minutesToDisplay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${String(m).padStart(2, "0")} ${period}`;
}

function timeStringToMinutes(str) {
  const [h, m] = (str || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTimeInput(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toDateInputValue(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toGoogleDueDate(dateValue) {
  if (!dateValue) return null;
  return `${dateValue}T12:00:00.000Z`;
}

function normalizeAndLimitSuggestions(rawSuggestions, busyByDay, taskTitleById = new Map(), idFactory = null) {
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

function calendarEventFromGoogleEvent(gEvent, weekStart) {
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

// ─── Groq helper ─────────────────────────────────────────────────────────────
async function fetchGroqJson(promptText, apiKey) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You output strict minified JSON only." },
        { role: "user", content: promptText },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Groq returned empty content.");
  const unfenced = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(unfenced);
}

// ─── Sub-component: WeeklyCalendar ───────────────────────────────────────────
function WeeklyCalendar({ weekStart, calendarEvents, suggestions, onSlotClick, onAddSuggestion, onRemoveSuggestion }) {
  const hours = [];
  for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) hours.push(h);
  const totalPx = hours.length * HOUR_PX;
  const dayLabels = Array.from({ length: 7 }, (_, i) => formatDayHeader(addDays(weekStart, i)));

  function minuteToY(minute) {
    const clipped = Math.max(CAL_START_HOUR * 60, Math.min(CAL_END_HOUR * 60, minute));
    return ((clipped - CAL_START_HOUR * 60) / 60) * HOUR_PX;
  }

  function handleColumnClick(e, dayIndex) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawY = e.clientY - rect.top;
    const minute = Math.round(((rawY / HOUR_PX) * 60 + CAL_START_HOUR * 60) / 15) * 15;
    const clamped = Math.max(CAL_START_HOUR * 60, Math.min((CAL_END_HOUR - 1) * 60, minute));
    onSlotClick(dayIndex, clamped);
  }

  const dayEvents = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    calendarEvents.forEach((ev) => {
      if (ev.day >= 0 && ev.day < 7) map[ev.day].push(ev);
    });
    return map;
  }, [calendarEvents]);

  const daySuggestions = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    suggestions.forEach((s) => {
      if (s.day >= 0 && s.day < 7) map[s.day].push(s);
    });
    return map;
  }, [suggestions]);

  return (
    <div className="cal-wrap">
      {/* Day header row */}
      <div className="cal-header-row">
        <div className="cal-time-gutter" />
        {dayLabels.map((label, i) => (
          <div key={i} className="cal-day-header">{label}</div>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="cal-body-scroll">
        <div className="cal-body" style={{ height: totalPx }}>
          {/* Time gutter */}
          <div className="cal-time-gutter">
            {hours.map((h) => (
              <div key={h} className="cal-hour-label" style={{ top: (h - CAL_START_HOUR) * HOUR_PX }}>
                {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {Array.from({ length: 7 }, (_, dayIdx) => (
            <div
              key={dayIdx}
              className="cal-day-col"
              style={{ height: totalPx }}
              onClick={(e) => handleColumnClick(e, dayIdx)}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div
                  key={h}
                  className="cal-hour-line"
                  style={{ top: (h - CAL_START_HOUR) * HOUR_PX }}
                />
              ))}

              {/* Calendar events */}
              {dayEvents[dayIdx].map((ev) => {
                const top = minuteToY(ev.startMinute);
                const height = Math.max(20, minuteToY(ev.endMinute) - top);
                const colors = EVENT_COLORS[ev.source] || EVENT_COLORS.manual;
                return (
                  <div
                    key={ev.id}
                    className="cal-event"
                    style={{ top, height, backgroundColor: colors.bg, color: colors.text }}
                    onClick={(e) => e.stopPropagation()}
                    title={`${ev.title}\n${minutesToDisplay(ev.startMinute)} – ${minutesToDisplay(ev.endMinute)}`}
                  >
                    <span className="cal-event-title">{ev.title}</span>
                    <span className="cal-event-time">
                      {minutesToDisplay(ev.startMinute)}–{minutesToDisplay(ev.endMinute)}
                    </span>
                  </div>
                );
              })}

              {/* AI suggested slots */}
              {daySuggestions[dayIdx].map((s, i) => {
                const top = minuteToY(s.startMinute);
                const height = Math.max(24, minuteToY(s.endMinute) - top);
                return (
                  <div
                    key={s.sugId || `sug-${i}`}
                    className="cal-event cal-event-suggested"
                    style={{ top, height }}
                    onClick={(e) => e.stopPropagation()}
                    title={s.reason}
                  >
                    <span className="cal-event-title">✨ {s.taskTitle}</span>
                    <span className="cal-event-time">
                      {minutesToDisplay(s.startMinute)}–{minutesToDisplay(s.endMinute)}
                    </span>
                    <div className="cal-sug-actions">
                      <button
                        className="cal-sug-add-btn"
                        onClick={() => onAddSuggestion(s)}
                        title="Lock this suggestion into the calendar"
                      >
                        + Add
                      </button>
                      <button
                        className="cal-sug-add-btn cal-sug-dismiss-btn"
                        onClick={() => onRemoveSuggestion(s)}
                        title="Dismiss this suggestion"
                      >
                        ✕
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component: AddEventModal ─────────────────────────────────────────────
function AddEventModal({ slot, weekStart, onConfirm, onCancel }) {
  const [title, setTitle] = useState("");
  const [startTime, setStart] = useState(minutesToTimeInput(slot.startMinute));
  const [endTime, setEnd] = useState(minutesToTimeInput(Math.min(slot.startMinute + 60, CAL_END_HOUR * 60)));

  function handleConfirm() {
    if (!title.trim()) return;
    onConfirm({
      title: title.trim(),
      day: slot.day,
      startMinute: timeStringToMinutes(startTime),
      endMinute: timeStringToMinutes(endTime),
    });
  }

  const dayDate = addDays(weekStart, slot.day);
  const dayLabel = formatDayHeader(dayDate);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Add Event — {dayLabel}</h3>
        <div className="modal-field">
          <label>Title</label>
          <input
            autoFocus
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          />
        </div>
        <div className="modal-field">
          <label>Start</label>
          <input type="time" step="900" value={startTime} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>End</label>
          <input type="time" step="900" value={endTime} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button onClick={handleConfirm}>Add Event</button>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  // ── existing state ──────────────────────────────────────────────────────────
  const [goals, setGoals] = useState(mockGoals);
  const [tasks, setTasks] = useState(
    mockTasks.map((t) => ({
      ...t,
      source: "mock",
      urgency: urgencyScoreFromDueDate(t.due),
      importance: 3,
      completed: false,
    }))
  );
  const [newGoal, setNewGoal] = useState({ name: "", weeklyHours: "" });
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [editingGoal, setEditingGoal] = useState({ name: "", weeklyHours: "" });
  const [newTask, setNewTask] = useState({ title: "", due: "", notes: "" });
  const [status, setStatus] = useState("Using mock data. Connect Google Tasks or add tasks manually.");
  const [isScoring, setIsScoring] = useState(false);
  const [suggestionText, setSuggestionText] = useState("Suggestions will appear here after scoring your tasks.");
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [tokenClientReady, setTokenClientReady] = useState(false);
  const [googleTokenClient, setGoogleTokenClient] = useState(null);
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState({ title: "", due: "", notes: "" });
  const googleAuthPendingRef = useRef(null); // { resolve, reject } for in-flight token requests

  // ── calendar state ──────────────────────────────────────────────────────────
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarStatus, setCalendarStatus] = useState("Connect Google Calendar or click a time slot to add events.");
  const [isSyncingCal, setIsSyncingCal] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));
  const [addEventSlot, setAddEventSlot] = useState(null);  // {day, startMinute} or null
  const [calSuggestions, setCalSuggestions] = useState([]);
  const [isGenCalSug, setIsGenCalSug] = useState(false);
  const [calSugStatus, setCalSugStatus] = useState("");
  const calEventIdCounter = useRef(1000);
  const calSuggestionIdCounter = useRef(1);
  const currentWeekStartRef = useRef(currentWeekStart);

  useEffect(() => {
    currentWeekStartRef.current = currentWeekStart;
  }, [currentWeekStart]);

  // ── load Google Identity script ─────────────────────────────────────────────
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setTokenClientReady(true);
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  async function requestGoogleAccessToken({ prompt = "" } = {}) {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Missing REACT_APP_GOOGLE_CLIENT_ID.");
    if (!tokenClientReady || !window.google?.accounts?.oauth2) throw new Error("Google script not ready yet.");

    // If there's already a request in flight, reuse it.
    if (googleAuthPendingRef.current?.promise) return googleAuthPendingRef.current.promise;

    const promise = new Promise((resolve, reject) => {
      googleAuthPendingRef.current = { resolve, reject, promise: null };
    });
    googleAuthPendingRef.current.promise = promise;

    const tc = googleTokenClient || window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_COMBINED_SCOPE,
      callback: (resp) => {
        const pending = googleAuthPendingRef.current;
        googleAuthPendingRef.current = null;
        if (!pending) return;
        if (!resp?.access_token) {
          pending.reject(new Error("Google auth failed."));
          return;
        }
        setGoogleAccessToken(resp.access_token);
        pending.resolve(resp.access_token);
      },
    });
    if (!googleTokenClient) setGoogleTokenClient(tc);

    try {
      tc.requestAccessToken({ prompt });
    } catch (err) {
      googleAuthPendingRef.current = null;
      throw err;
    }

    return promise;
  }

  async function ensureGoogleAccessToken({ forceConsent = false } = {}) {
    if (googleAccessToken) return googleAccessToken;
    return await requestGoogleAccessToken({ prompt: forceConsent ? "consent" : "consent" });
  }

  // ── derived task data ───────────────────────────────────────────────────────
  const activeTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.completed), [tasks]);

  const scoredTasks = useMemo(
    () => activeTasks.map((t) => ({
      ...t,
      urgency: urgencyScoreFromDueDate(t.due),
      quadrant: getQuadrant(t.importance, urgencyScoreFromDueDate(t.due)),
    })),
    [activeTasks]
  );

  const quadrantTasks = useMemo(() => {
    return scoredTasks.reduce(
      (acc, t) => { acc[t.quadrant].push(t); return acc; },
      { importantUrgent: [], notImportantUrgent: [], importantNotUrgent: [], notImportantNotUrgent: [] }
    );
  }, [scoredTasks]);

  const quadrantCounts = useMemo(() => {
    return scoredTasks.reduce(
      (acc, t) => { acc[t.quadrant] += 1; return acc; },
      { importantUrgent: 0, notImportantUrgent: 0, importantNotUrgent: 0, notImportantNotUrgent: 0 }
    );
  }, [scoredTasks]);

  // ── goal functions ──────────────────────────────────────────────────────────
  function addGoal(event) {
    event.preventDefault();
    if (!newGoal.name.trim() || !newGoal.weeklyHours) return;
    setGoals((prev) => [...prev, { id: `g-${Date.now()}`, name: newGoal.name.trim(), weeklyHours: Number(newGoal.weeklyHours) }]);
    setNewGoal({ name: "", weeklyHours: "" });
  }

  function startEditingGoal(goal) {
    setEditingGoalId(goal.id);
    setEditingGoal({ name: goal.name, weeklyHours: String(goal.weeklyHours) });
  }

  function cancelEditingGoal() {
    setEditingGoalId(null);
    setEditingGoal({ name: "", weeklyHours: "" });
  }

  function saveGoalEdit(goalId) {
    if (!editingGoal.name.trim() || !editingGoal.weeklyHours) return;
    setGoals((prev) =>
      prev.map((g) => g.id === goalId ? { ...g, name: editingGoal.name.trim(), weeklyHours: Number(editingGoal.weeklyHours) } : g)
    );
    cancelEditingGoal();
  }

  // ── task functions ──────────────────────────────────────────────────────────
  function addManualTask(event) {
    event.preventDefault();
    if (!newTask.title.trim()) return;
    setTasks((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        title: newTask.title.trim(),
        due: newTask.due || null,
        notes: newTask.notes.trim(),
        source: "manual",
        urgency: urgencyScoreFromDueDate(newTask.due),
        importance: 3,
        completed: false,
      },
    ]);
    setStatus("Manual task added.");
    setNewTask({ title: "", due: "", notes: "" });
  }

  function toggleTaskCompleted(taskId) {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, completed: !t.completed } : t));
  }

  function startEditingTask(task) {
    setEditingTaskId(task.id);
    setEditingTaskDraft({
      title: task.title || "",
      due: toDateInputValue(task.due),
      notes: task.notes || "",
    });
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setEditingTaskDraft({ title: "", due: "", notes: "" });
  }

  async function saveTaskEdit(task) {
    const title = editingTaskDraft.title.trim();
    if (!title) return;

    const notes = editingTaskDraft.notes.trim();
    const dueIso = editingTaskDraft.due ? toGoogleDueDate(editingTaskDraft.due) : null;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, title, notes, due: dueIso }
          : t
      )
    );
    cancelEditingTask();

    if (task.source === "google" && task.taskListId) {
      if (!googleAccessToken) {
        setStatus("Task edited locally. Reconnect Google Tasks to sync edits to Google.");
        return;
      }
      try {
        const updateRes = await fetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${task.taskListId}/tasks/${task.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${googleAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: task.id,
              title,
              notes,
              due: dueIso || undefined,
            }),
          }
        );
        if (!updateRes.ok) {
          const text = await updateRes.text();
          throw new Error(`Google update failed (${updateRes.status}): ${text}`);
        }
        setStatus("Task updated and synced to Google Tasks.");
      } catch (error) {
        setStatus(`Task updated locally, but Google sync failed: ${error.message}`);
      }
      return;
    }

    setStatus("Task updated.");
  }

  // ── Google Tasks ────────────────────────────────────────────────────────────
  async function connectGoogleTasks() {
    try {
      const token = await ensureGoogleAccessToken({ forceConsent: !googleAccessToken });
      await loadGoogleTasks(token);
    } catch (err) {
      setStatus(err?.message || "Google auth failed.");
    }
  }

  async function loadGoogleTasks(accessToken) {
    try {
      setStatus("Loading Google Tasks...");
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
      if (!all.length) { setStatus("Connected but no active tasks found."); return; }
      setTasks(all);
      setStatus(`Imported ${all.length} tasks from Google Tasks.`);
    } catch (err) {
      setStatus(`Failed to load Google Tasks: ${err.message}`);
    }
  }

  // ── Google Calendar ─────────────────────────────────────────────────────────
  async function connectGoogleCalendar() {
    try {
      const token = await ensureGoogleAccessToken({ forceConsent: !googleAccessToken });
      await loadGoogleCalendarEvents(token, currentWeekStartRef.current);
    } catch (err) {
      setCalendarStatus(err?.message || "Google Calendar auth failed.");
    }
  }

  async function loadGoogleCalendarEvents(accessToken, targetWeekStart = currentWeekStartRef.current) {
    setIsSyncingCal(true);
    setCalendarStatus("Loading Google Calendar events...");
    try {
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

      // Keep all other weeks; replace google events only for selected week
      setCalendarEvents((prev) => [
        ...prev.filter((e) => !(e.source === "google" && e.weekKey === selectedWeekKey)),
        ...mapped,
      ]);
      setCalendarStatus(`Synced ${mapped.length} Google Calendar event${mapped.length !== 1 ? "s" : ""} for this week.`);
    } catch (err) {
      setCalendarStatus(`Failed to load Google Calendar: ${err.message}`);
    } finally {
      setIsSyncingCal(false);
    }
  }

  // ── Manual calendar events ──────────────────────────────────────────────────
  function handleSlotClick(dayIndex, startMinute) {
    setAddEventSlot({ day: dayIndex, startMinute });
  }

  function confirmAddEvent({ title, day, startMinute, endMinute }) {
    const activeWeekKey = weekKeyFromDate(currentWeekStart);
    const newEv = {
      id: `cal-${calEventIdCounter.current++}`,
      title,
      day,
      startMinute,
      endMinute: endMinute > startMinute ? endMinute : startMinute + 60,
      source: "manual",
      weekKey: activeWeekKey,
    };
    setCalendarEvents((prev) => [...prev, newEv]);
    setCalendarStatus("Manual event added.");
    setAddEventSlot(null);
    // Clear any suggestions that now overlap this slot
    setCalSuggestions((prev) =>
      prev.filter((s) => s.day !== day || s.endMinute <= startMinute || s.startMinute >= newEv.endMinute)
    );
  }

  // ── AI calendar scheduling suggestions ─────────────────────────────────────
  async function generateCalendarSuggestions() {
    const apiKey = process.env.REACT_APP_GROQ_KEY;
    setIsGenCalSug(true);
    setCalSugStatus("Analyzing your schedule for open slots…");
    setCalSuggestions([]);
    const activeWeekKey = weekKeyFromDate(currentWeekStart);
    const weekEvents = calendarEvents.filter((ev) => ev.weekKey === activeWeekKey);

    // Build a list of busy blocks per day
    const busyByDay = Array.from({ length: 7 }, () => []);
    weekEvents.forEach((ev) => {
      if (ev.day >= 0 && ev.day < 7) {
        busyByDay[ev.day].push({ startMinute: ev.startMinute, endMinute: ev.endMinute });
      }
    });

    // Sort tasks by priority (importance desc, urgency desc)
    const prioritized = [...scoredTasks]
      .filter((t) => !t.completed)
      .sort((a, b) => (b.importance * 2 + b.urgency) - (a.importance * 2 + a.urgency))
      .slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title, importance: t.importance, urgency: t.urgency, quadrant: t.quadrant }));

    const fallback = buildLocalCalSuggestions(busyByDay, prioritized);

    if (!apiKey) {
      setTasks((prev) =>
        prev.map((task) => ({
          ...task,
          importance: buildFallbackImportance(task, goals),
        }))
      );
      setStatus("Groq key not set. Used local importance scoring.");
      return;
    }

    try {
      const busySummary = busyByDay.map((blocks, d) => ({
        dayIndex: d,
        busy: blocks.map((b) => `${minutesToDisplay(b.startMinute)}–${minutesToDisplay(b.endMinute)}`),
      }));

      const prompt = `
You are a scheduling assistant. Follow this exactly! Return ONLY strict minified JSON in this exact shape:
{"suggestions":[{"taskId":"string","taskTitle":"string","day":0,"startMinute":540,"endMinute":660,"reason":"short sentence"}]}

Rules:
- day is 0=Sunday through 6=Saturday
- startMinute and endMinute are minutes from midnight (e.g. 9:00 AM = 540)
- Only schedule between ${CAL_START_HOUR * 60} (${CAL_START_HOUR}AM) and ${CAL_END_HOUR * 60} (${CAL_END_HOUR === 12 ? "12PM" : `${CAL_END_HOUR - 12}PM`})
- Never overlap with existing busy blocks
- Higher importance/urgency tasks get earlier and longer slots
- Apply human-centered scheduling: do not front-load everything at the start of the day or week; spread work realistically, include buffer time for travel/context-switching, and avoid common meal windows (roughly 12:00-1:00 PM and 6:00-7:00 PM) unless necessary.
- Provide at most 6 suggestions total
- Add sleeping hours at the highest priority as a default on the calendar for the entire week
- Fill suggestions on the calendar for the entire week based on the prioritized tasks and the busy blocks

Current busy blocks this week:
${JSON.stringify(busySummary)}

Prioritized tasks (importance 1-4, urgency 1-4):
${JSON.stringify(prioritized)}
`;

      const parsed = await Promise.race([
        fetchGroqJson(prompt, apiKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Groq calendar request timed out.")), 15000)),
      ]);
      const titleByTaskId = new Map(prioritized.map((t) => [t.id, t.title]));
      const sug = normalizeAndLimitSuggestions(
        parsed.suggestions,
        busyByDay,
        titleByTaskId,
        () => `sug-${calSuggestionIdCounter.current++}`
      ).map((s) => ({ ...s, weekKey: activeWeekKey }));
      if (sug.length === 0) throw new Error("No valid suggestions returned.");
      setCalSuggestions(sug);
      setCalSugStatus(`${sug.length} scheduling suggestion${sug.length !== 1 ? "s" : ""} ready. Click "+ Add" on any to lock it in.`);
    } catch (err) {
      setCalSuggestions(fallback.map((s) => ({ ...s, weekKey: activeWeekKey })));
      setCalSugStatus(`Groq failed; showing local suggestions. (${err.message})`);
    } finally {
      setIsGenCalSug(false);
    }
  }

  function buildLocalCalSuggestions(busyByDay, prioritized) {
    const suggestions = [];
    const usedSlots = busyByDay.map((blocks) => [...blocks]); // copy

    for (let taskIndex = 0; taskIndex < prioritized.length; taskIndex++) {
      const task = prioritized[taskIndex];
      const duration = task.importance >= 3 ? 90 : 60; // minutes
      let placed = false;
      const preferredStart = task.urgency >= 3 ? 1 : 3; // urgent tasks still start earlier in week
      const dayOrder = Array.from({ length: 7 }, (_, i) => (preferredStart + taskIndex + i) % 7);

      for (const di of dayOrder) {
        if (placed) break;
        for (let start = CAL_START_HOUR * 60; start + duration <= CAL_END_HOUR * 60; start += 30) {
          const end = start + duration;
          const overlaps = usedSlots[di].some((b) => start < b.endMinute && end > b.startMinute);
          if (!overlaps) {
            const readableQuadrant = {
              importantUrgent: "Important + Urgent",
              notImportantUrgent: "Not Important + Urgent",
              importantNotUrgent: "Important + Not Urgent",
              notImportantNotUrgent: "Not Important + Not Urgent",
            }[task.quadrant] || "priority category";
            suggestions.push({
              taskId: task.id,
              taskTitle: task.title,
              day: di,
              startMinute: start,
              endMinute: end,
              reason: `Scheduled based on ${readableQuadrant}.`,
            });
            usedSlots[di].push({ startMinute: start, endMinute: end });
            placed = true;
          }
        }
      }
      if (suggestions.length >= 6) break;
    }
    const titleByTaskId = new Map(prioritized.map((t) => [t.id, t.title]));
    return normalizeAndLimitSuggestions(
      suggestions,
      busyByDay,
      titleByTaskId,
      () => `sug-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  function deleteSuggestionFromCalendar(suggestion) {
    setCalSuggestions((prev) => prev.filter((s) => s.sugId !== suggestion.sugId));
    setCalSugStatus("Suggestion removed from calendar.");
  }

  function addSuggestionToCalendar(suggestion) {
    const newEv = {
      id: `cal-${calEventIdCounter.current++}`,
      title: suggestion.taskTitle,
      day: suggestion.day,
      startMinute: suggestion.startMinute,
      endMinute: suggestion.endMinute,
      source: "manual",
      weekKey: suggestion.weekKey || weekKeyFromDate(currentWeekStart),
    };
    setCalendarEvents((prev) => [...prev, newEv]);
    setCalSuggestions((prev) => prev.filter((s) => s.sugId !== suggestion.sugId));
    setCalSugStatus("Suggestion added to your calendar!");
  }

  // ── Groq importance scoring ─────────────────────────────────────────────────
  async function scoreTaskImportanceWithGroq() {
    if (!tasks.length) { setStatus("No tasks to score."); return; }
    const apiKey = process.env.REACT_APP_GROQ_KEY;
    if (!apiKey) { setStatus("Missing REACT_APP_GROQ_KEY."); return; }

    setIsScoring(true);
    setStatus("Scoring task importance with Groq...");
    try {
      const prompt = `
Return strict JSON: {"scores":[{"taskId":"string","importance":1-4,"reason":"short"}]}
Goals: ${JSON.stringify(goals)}
Tasks: ${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, due: t.due, notes: t.notes })))}
Rules: Score importance 1-4 by goal alignment. 4=strongly aligned this week; 1=weak/none. Include every task ID.
`;
      const parsed = await fetchGroqJson(prompt, apiKey);
      const map = new Map((parsed.scores || []).map((s) => [s.taskId, Number(s.importance)]));
      setTasks((prev) =>
        prev.map((t) => ({
          ...t,
          importance: [1, 2, 3, 4].includes(map.get(t.id)) ? map.get(t.id) : buildFallbackImportance(t, goals),
        }))
      );
      setStatus("Importance scoring complete.");
    } catch (err) {
      setTasks((prev) => prev.map((t) => ({ ...t, importance: buildFallbackImportance(t, goals) })));
      setStatus(`Groq scoring failed, used fallback: ${err.message}`);
    } finally {
      setIsScoring(false);
    }
  }

  async function generateSuggestions() {
    const apiKey = process.env.REACT_APP_GROQ_KEY;
    const fallback = buildLocalSuggestion(scoredTasks, goals, quadrantCounts);

    if (!apiKey) {
      setSuggestionText(`${fallback}\n\n(Local suggestion mode: set REACT_APP_GROQ_KEY to enable AI suggestions.)`);
      setStatus("Groq key not set. Showing local suggestions.");
      return;
    }

    setIsSuggesting(true);
    try {
      const prompt = `
You are a productivity coach. Return strict JSON: {"suggestion":"2-4 short actionable sentences with alerts if needed"}
Goals with weekly hours: ${JSON.stringify(goals)}
Tasks with urgency and importance: ${JSON.stringify(scoredTasks.map((t) => ({ title: t.title, due: t.due, urgency: t.urgency, importance: t.importance, quadrant: t.quadrant })))}
`;
      const parsed = await fetchGroqJson(prompt, apiKey);
      setSuggestionText(parsed.suggestion || fallback);
    } catch (err) {
      setSuggestionText(`${fallback}\n\n(AI suggestion fallback: ${err.message})`);
    } finally {
      setIsSuggesting(false);
    }
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────
  function renderTaskCard(task) {
    const isEditing = editingTaskId === task.id;
    return (
      <article key={task.id} className={`task-card ${task.completed ? "task-card-completed" : ""} ${task.notes ? "task-card-has-notes" : ""}`}>
        {isEditing ? (
          <div className="task-edit-form">
            <input
              value={editingTaskDraft.title}
              onChange={(e) => setEditingTaskDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Task title"
            />
            <input
              type="date"
              value={editingTaskDraft.due}
              onChange={(e) => setEditingTaskDraft((prev) => ({ ...prev, due: e.target.value }))}
            />
            <input
              value={editingTaskDraft.notes}
              onChange={(e) => setEditingTaskDraft((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Notes"
            />
            <div className="task-card-actions">
              <button type="button" onClick={() => saveTaskEdit(task)}>Save</button>
              <button type="button" className="btn-ghost" onClick={cancelEditingTask}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {task.notes && (
              <div className="task-notes-tooltip">
                {task.notes}
              </div>
            )}
            <div className="task-card-top">
              <div>
                <h4>{task.title}</h4>
                <p>Due: {task.due ? new Date(task.due).toLocaleDateString() : "No date"}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <label className="task-complete-control" title="Mark complete">
                  <input
                    type="checkbox"
                    className="task-complete-checkbox"
                    checked={Boolean(task.completed)}
                    onChange={() => toggleTaskCompleted(task.id)}
                    aria-label={`Mark ${task.title} as completed`}
                  />
                </label>
                <button
                  type="button"
                  className="task-edit-icon-button"
                  onClick={() => startEditingTask(task)}
                  aria-label="Edit task"
                  title="Edit task"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </article>
    );
  }

  function renderDoneTaskCard(task) {
    return (
      <article key={task.id} className="task-card task-card-completed">
        <div className="task-card-top">
          <div>
            <h4>{task.title}</h4>
            <p>Completed</p>
          </div>
          <label className="task-complete-control" title="Mark as active again">
            <input
              type="checkbox"
              className="task-complete-checkbox"
              checked={Boolean(task.completed)}
              onChange={() => toggleTaskCompleted(task.id)}
              aria-label={`Mark ${task.title} as active`}
            />
          </label>
        </div>
      </article>
    );
  }

  const prevWeek = () => setCurrentWeekStart((w) => addDays(w, -7));
  const nextWeek = () => setCurrentWeekStart((w) => addDays(w, 7));
  const thisWeek = () => setCurrentWeekStart(getWeekStart(new Date()));

  const weekLabel = (() => {
    const end = addDays(currentWeekStart, 6);
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(currentWeekStart)} – ${fmt(end)}, ${end.getFullYear()}`;
  })();
  const safeCalSuggestions = useMemo(
    () => calSuggestions
      .filter((s) => s.weekKey === weekKeyFromDate(currentWeekStart))
      .slice(0, 6),
    [calSuggestions, currentWeekStart]
  );
  const visibleCalendarEvents = useMemo(
    () => calendarEvents.filter((ev) => ev.weekKey === weekKeyFromDate(currentWeekStart)),
    [calendarEvents, currentWeekStart]
  );

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <header className="header">
        <h1>S Y N Λ P S E</h1>
        <p>Automated time management for students and professionals.</p>
      </header>

      {/* ── Goals + Tasks panels ── */}
      <section className="controls-grid">
        <div className="panel">
          <h2>Weekly Goals</h2>
          <form onSubmit={addGoal} className="inline-form">
            <input
              placeholder="Goal for the week"
              value={newGoal.name}
              onChange={(e) => setNewGoal((p) => ({ ...p, name: e.target.value }))}
            />
            <input
              type="number" min="1" placeholder="Hours/week"
              value={newGoal.weeklyHours}
              onChange={(e) => setNewGoal((p) => ({ ...p, weeklyHours: e.target.value }))}
            />
            <button type="submit">Add Goal</button>
          </form>
          <ul>
            {goals.map((goal) => (
              <li key={goal.id} className="goal-item">
                {editingGoalId === goal.id ? (
                  <div className="goal-edit-row">
                    <input value={editingGoal.name} onChange={(e) => setEditingGoal((p) => ({ ...p, name: e.target.value }))} placeholder="Goal name" />
                    <input type="number" min="1" value={editingGoal.weeklyHours} onChange={(e) => setEditingGoal((p) => ({ ...p, weeklyHours: e.target.value }))} placeholder="Hours/week" />
                    <div className="goal-actions">
                      <button type="button" onClick={() => saveGoalEdit(goal.id)}>Save</button>
                      <button type="button" onClick={cancelEditingGoal}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="goal-view-row">
                    <span><strong>{goal.name}</strong> — {goal.weeklyHours} hrs/week</span>
                    <button type="button" className="edit-icon-button" onClick={() => startEditingGoal(goal)} aria-label="Edit goal" title="Edit goal">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>To-Do List</h2>
          <div className="button-row">
            <button onClick={connectGoogleTasks}>Connect Google Tasks</button>
            <button onClick={scoreTaskImportanceWithGroq} disabled={isScoring}>{isScoring ? "Scoring…" : "Score Importance"}</button>
            <button onClick={generateSuggestions} disabled={isSuggesting}>{isSuggesting ? "Analyzing…" : "Generate Suggestions"}</button>
          </div>
          <form onSubmit={addManualTask} className="stack-form">
            <input placeholder="Manual task title" value={newTask.title} onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))} />
            <input type="date" value={newTask.due} onChange={(e) => setNewTask((p) => ({ ...p, due: e.target.value }))} />
            <input placeholder="Notes / context" value={newTask.notes} onChange={(e) => setNewTask((p) => ({ ...p, notes: e.target.value }))} />
            <button type="submit">Add Manual Task</button>
          </form>
          <p className="status">{status}</p>
        </div>
      </section>

      {/* ── Eisenhower Matrix ── */}
      <section className="matrix-section">
        <h2>Eisenhower Matrix</h2>
        <div className="axis-shell">
          <div className="matrix-grid">
            {[
              { key: "importantUrgent", label: "Important + Urgent" },
              { key: "notImportantUrgent", label: "Not Important + Urgent" },
              { key: "importantNotUrgent", label: "Important + Not Urgent" },
              { key: "notImportantNotUrgent", label: "Not Important + Not Urgent" },
            ].map(({ key, label }) => (
              <div key={key} className={`matrix-cell ${key}`}>
                <div className="cell-header">{label}</div>
                {quadrantTasks[key].length === 0
                  ? <div className="empty-cell">No tasks</div>
                  : quadrantTasks[key].map((t) => renderTaskCard(t))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="done-tasks-section">
        <h2>Done Tasks</h2>
        <p className="status">
          {doneTasks.length
            ? `${doneTasks.length} completed task${doneTasks.length === 1 ? "" : "s"}`
            : "No completed tasks yet."}
        </p>
        <div className="done-task-list">
          {doneTasks.map((t) => renderDoneTaskCard(t))}
        </div>
      </section>

      <section className="suggestions">
        <h2>Prioritization Insights</h2>
        <p className="status">{suggestionText}</p>
      </section>

      {/* ── Weekly Calendar ── */}
      <section className="calendar-section">
        <h2>Weekly Calendar</h2>

        {/* Controls bar */}
        <div className="cal-controls">
          <div className="cal-nav">
            <button onClick={prevWeek} title="Previous week">‹</button>
            <span className="cal-week-label">{weekLabel}</span>
            <button onClick={nextWeek} title="Next week">›</button>
            <button className="btn-ghost btn-small" onClick={thisWeek}>Today</button>
          </div>
          <div className="cal-actions">
            <button onClick={connectGoogleCalendar} disabled={isSyncingCal}>
              {isSyncingCal ? "Syncing…" : "⟳ Sync Google Calendar"}
            </button>
            <button
              onClick={generateCalendarSuggestions}
              disabled={isGenCalSug}
              title="AI will find gaps and suggest where to schedule your top tasks"
            >
              {isGenCalSug ? "Analyzing…" : "✨ Suggest Schedule"}
            </button>
          </div>
        </div>

        <p className="status">{calendarStatus}</p>

        {/* Legend */}
        <div className="cal-legend">
          <span className="legend-dot" style={{ background: EVENT_COLORS.google.bg }} /> Google Calendar
          <span className="legend-dot" style={{ background: EVENT_COLORS.manual.bg }} /> Manual event
          <span className="legend-dot" style={{ background: EVENT_COLORS.suggested.bg }} /> AI suggestion — click + Add to lock in
        </div>

        {/* Calendar grid */}
        <WeeklyCalendar
          weekStart={currentWeekStart}
          calendarEvents={visibleCalendarEvents}
          suggestions={safeCalSuggestions}
          onSlotClick={handleSlotClick}
          onAddSuggestion={addSuggestionToCalendar}
          onRemoveSuggestion={deleteSuggestionFromCalendar}
        />

        {/* Scheduling suggestions list (below grid) */}
        {safeCalSuggestions.length > 0 && (
          <div className="sug-list-panel">
            <h3>✨ AI Scheduling Suggestions</h3>
            <p className="status">{calSugStatus}</p>
            <div className="sug-list">
              {safeCalSuggestions.map((s, i) => {
                const dayDate = addDays(currentWeekStart, s.day);
                const dayLabel = formatDayHeader(dayDate);
                return (
                  <div key={s.sugId || i} className="sug-card">
                    <div className="sug-card-body">
                      <strong>{s.taskTitle}</strong>
                      <span className="sug-time">{dayLabel} · {minutesToDisplay(s.startMinute)} – {minutesToDisplay(s.endMinute)}</span>
                      <span className="sug-reason">{s.reason}</span>
                    </div>
                    <div className="sug-card-actions">
                      <button className="btn-accent" onClick={() => addSuggestionToCalendar(s)}>+ Add</button>
                      <button className="btn-dismiss" onClick={() => deleteSuggestionFromCalendar(s)} title="Dismiss suggestion">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {calSugStatus && safeCalSuggestions.length === 0 && (
          <p className="status">{calSugStatus}</p>
        )}
      </section>

      {/* ── Add-event modal ── */}
      {addEventSlot && (
        <AddEventModal
          slot={addEventSlot}
          weekStart={currentWeekStart}
          onConfirm={confirmAddEvent}
          onCancel={() => setAddEventSlot(null)}
        />
      )}
    </div>
  );
}

// ─── Local suggestion fallback (existing) ─────────────────────────────────────
function buildLocalSuggestion(scoredTasks, goals, quadrantCounts) {
  const totalGoalHours = goals.reduce((s, g) => s + Number(g.weeklyHours || 0), 0);
  const highPriority = scoredTasks.filter((t) => t.importance >= 3 && t.urgency >= 3).length;
  const lowLow = quadrantCounts.notImportantNotUrgent;

  if (totalGoalHours > 50) return `Alert: you allotted ${totalGoalHours} hours this week, which may be unrealistic. Consider moving lower priority tasks to next week.`;
  if (lowLow > highPriority) return "Alert: you have more tasks in the not important / not urgent zone than in your top-priority zone. Consider eliminating or deferring some.";
  if (highPriority === 0) return "Alert: no tasks are currently both important and urgent. Double-check due dates and goal alignment.";
  return "Great todo list — this aligns well with your weekly goals. Keep momentum on important and urgent tasks first.";
}

export default App;