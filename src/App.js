import React, { useEffect, useMemo, useState } from "react";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/tasks.readonly";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const mockGoals = [
  { id: "g1", name: "Prepare for data structures exam", weeklyHours: 8 },
  { id: "g2", name: "Finish product demo deck", weeklyHours: 5 },
  { id: "g3", name: "Exercise and sleep consistency", weeklyHours: 4 },
];

const mockTasks = [
  { id: "t1", title: "Review binary trees notes", due: inDays(1), notes: "study" },
  { id: "t2", title: "Design slides for demo", due: inDays(3), notes: "work project" },
  { id: "t3", title: "Book dentist appointment", due: inDays(9), notes: "personal admin" },
  { id: "t4", title: "Watch random YouTube backlog", due: inDays(14), notes: "optional leisure" },
];

function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function urgencyScoreFromDueDate(dueDate) {
  if (!dueDate) {
    return 1;
  }

  const now = new Date();
  const due = new Date(dueDate);
  const ms = due.getTime() - now.getTime();
  const days = ms / (1000 * 60 * 60 * 24);

  if (days <= 0) return 4;
  if (days <= 2) return 4;
  if (days <= 5) return 3;
  if (days <= 10) return 2;
  return 1;
}

function getQuadrant(importance, urgency) {
  const highImportance = importance >= 3;
  const highUrgency = urgency >= 3;

  if (highImportance && highUrgency) return "importantUrgent";
  if (!highImportance && highUrgency) return "notImportantUrgent";
  if (highImportance && !highUrgency) return "importantNotUrgent";
  return "notImportantNotUrgent";
}

function buildFallbackImportance(task, goals) {
  const title = `${task.title} ${task.notes || ""}`.toLowerCase();
  const hits = goals.filter((goal) => {
    const keywords = goal.name.toLowerCase().split(/\s+/).filter(Boolean);
    return keywords.some((word) => word.length > 3 && title.includes(word));
  }).length;

  if (hits >= 2) return 4;
  if (hits === 1) return 3;
  if (task.notes) return 2;
  return 1;
}

async function fetchGroqJson(promptText, apiKey) {
  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You output strict minified JSON only.",
        },
        {
          role: "user",
          content: promptText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Groq returned empty content.");
  }
  return JSON.parse(content);
}

function App() {
  const [goals, setGoals] = useState(mockGoals);
  const [tasks, setTasks] = useState(
    mockTasks.map((t) => ({
      ...t,
      source: "mock",
      urgency: urgencyScoreFromDueDate(t.due),
      importance: 2,
      completed: false,
    }))
  );
  const [newGoal, setNewGoal] = useState({ name: "", weeklyHours: "" });
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [editingGoal, setEditingGoal] = useState({ name: "", weeklyHours: "" });
  const [newTask, setNewTask] = useState({ title: "", due: "", notes: "" });
  const [status, setStatus] = useState("Using mock data. Connect Google Tasks or add tasks manually.");
  const [isScoring, setIsScoring] = useState(false);
  const [suggestionText, setSuggestionText] = useState(
    "Suggestions will appear here after scoring your tasks."
  );
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [tokenClientReady, setTokenClientReady] = useState(false);
  const [googleTokenClient, setGoogleTokenClient] = useState(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setTokenClientReady(true);
    };
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  const scoredTasks = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        urgency: urgencyScoreFromDueDate(task.due),
        quadrant: getQuadrant(task.importance, urgencyScoreFromDueDate(task.due)),
      })),
    [tasks]
  );

  const quadrantTasks = useMemo(() => {
    return scoredTasks.reduce(
      (acc, task) => {
        acc[task.quadrant].push(task);
        return acc;
      },
      {
        importantUrgent: [],
        notImportantUrgent: [],
        importantNotUrgent: [],
        notImportantNotUrgent: [],
      }
    );
  }, [scoredTasks]);

  const quadrantCounts = useMemo(() => {
    return scoredTasks.reduce(
      (acc, task) => {
        acc[task.quadrant] += 1;
        return acc;
      },
      {
        importantUrgent: 0,
        notImportantUrgent: 0,
        importantNotUrgent: 0,
        notImportantNotUrgent: 0,
      }
    );
  }, [scoredTasks]);

  function addGoal(event) {
    event.preventDefault();
    if (!newGoal.name.trim() || !newGoal.weeklyHours) return;
    setGoals((prev) => [
      ...prev,
      {
        id: `g-${Date.now()}`,
        name: newGoal.name.trim(),
        weeklyHours: Number(newGoal.weeklyHours),
      },
    ]);
    setNewGoal({ name: "", weeklyHours: "" });
  }

  function startEditingGoal(goal) {
    setEditingGoalId(goal.id);
    setEditingGoal({
      name: goal.name,
      weeklyHours: String(goal.weeklyHours),
    });
  }

  function cancelEditingGoal() {
    setEditingGoalId(null);
    setEditingGoal({ name: "", weeklyHours: "" });
  }

  function saveGoalEdit(goalId) {
    if (!editingGoal.name.trim() || !editingGoal.weeklyHours) return;
    setGoals((prev) =>
      prev.map((goal) =>
        goal.id === goalId
          ? { ...goal, name: editingGoal.name.trim(), weeklyHours: Number(editingGoal.weeklyHours) }
          : goal
      )
    );
    cancelEditingGoal();
  }

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
        importance: 2,
        completed: false,
      },
    ]);
    setStatus("Manual task added.");
    setNewTask({ title: "", due: "", notes: "" });
  }

  async function connectGoogleTasks() {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setStatus("Missing REACT_APP_GOOGLE_CLIENT_ID in your environment.");
      return;
    }

    if (!tokenClientReady || !window.google?.accounts?.oauth2) {
      setStatus("Google Identity script not loaded yet. Try again in a second.");
      return;
    }

    const tokenClient =
      googleTokenClient ||
      window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: async (tokenResponse) => {
          if (!tokenResponse?.access_token) {
            setStatus("Google auth did not return an access token.");
            return;
          }
          await loadGoogleTasks(tokenResponse.access_token);
        },
      });

    if (!googleTokenClient) {
      setGoogleTokenClient(tokenClient);
    }

    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  async function loadGoogleTasks(accessToken) {
    try {
      setStatus("Loading tasks from Google Tasks...");
      const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!listsRes.ok) throw new Error(`Lists request failed: ${listsRes.status}`);
      const listsData = await listsRes.json();
      const lists = listsData.items || [];

      const allTasks = [];
      for (const list of lists) {
        const tasksRes = await fetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false&maxResults=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!tasksRes.ok) continue;
        const tasksData = await tasksRes.json();
        (tasksData.items || []).forEach((task) => {
          allTasks.push({
            id: task.id,
            title: task.title || "Untitled task",
            due: task.due || null,
            notes: task.notes || "",
            source: "google",
            importance: 2,
            urgency: urgencyScoreFromDueDate(task.due),
            completed: false,
          });
        });
      }

      if (allTasks.length === 0) {
        setStatus("Connected to Google, but no active tasks were found.");
        return;
      }

      setTasks(allTasks);
      setStatus(`Imported ${allTasks.length} tasks from Google Tasks.`);
    } catch (error) {
      setStatus(`Failed to load Google Tasks: ${error.message}`);
    }
  }

  async function scoreTaskImportanceWithGroq() {
    if (tasks.length === 0) {
      setStatus("No tasks to score yet.");
      return;
    }

    const apiKey = process.env.REACT_APP_GROQ_KEY;
    if (!apiKey) {
      setStatus("Missing REACT_APP_GROQ_KEY in your environment.");
      return;
    }

    setIsScoring(true);
    setStatus("Scoring task importance with Groq...");
    try {
      const prompt = `
Return strict JSON in this exact shape:
{"scores":[{"taskId":"string","importance":1-4,"reason":"short"}]}

Goals:
${JSON.stringify(goals)}

Tasks:
${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, due: t.due, notes: t.notes })))}

Rules:
- Score "importance" from 1-4 based on alignment with goals and weekly hours.
- 4 means strongly aligned to core goals this week; 1 means weak/no alignment.
- Include every task ID exactly once.
`;

      const parsed = await fetchGroqJson(prompt, apiKey);
      const map = new Map((parsed.scores || []).map((s) => [s.taskId, Number(s.importance)]));

      setTasks((prev) =>
        prev.map((task) => ({
          ...task,
          importance: [1, 2, 3, 4].includes(map.get(task.id))
            ? map.get(task.id)
            : buildFallbackImportance(task, goals),
        }))
      );
      setStatus("Importance scoring complete.");
    } catch (error) {
      setTasks((prev) =>
        prev.map((task) => ({
          ...task,
          importance: buildFallbackImportance(task, goals),
        }))
      );
      setStatus(`Groq scoring failed, used fallback logic: ${error.message}`);
    } finally {
      setIsScoring(false);
    }
  }

  async function generateSuggestions() {
    const apiKey = process.env.REACT_APP_GROQ_KEY;
    const fallback = buildLocalSuggestion(scoredTasks, goals, quadrantCounts);

    if (!apiKey) {
      setSuggestionText(`${fallback}\n\n(Set REACT_APP_GROQ_KEY for AI suggestions.)`);
      return;
    }

    setIsSuggesting(true);
    try {
      const prompt = `
You are a productivity coach. Return strict JSON:
{"suggestion":"2-4 short actionable sentences with alerts if needed"}

Goals with weekly hours:
${JSON.stringify(goals)}

Tasks with urgency and importance:
${JSON.stringify(
        scoredTasks.map((t) => ({
          title: t.title,
          due: t.due,
          urgency: t.urgency,
          importance: t.importance,
          quadrant: t.quadrant,
        }))
      )}
`;
      const parsed = await fetchGroqJson(prompt, apiKey);
      setSuggestionText(parsed.suggestion || fallback);
    } catch (error) {
      setSuggestionText(`${fallback}\n\n(AI suggestion fallback used: ${error.message})`);
    } finally {
      setIsSuggesting(false);
    }
  }

  function toggleTaskCompleted(taskId) {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  }

  function renderTaskCard(task) {
    return (
      <article key={task.id} className={`task-card ${task.completed ? "task-card-completed" : ""}`}>
        <div className="task-card-top">
          <h4>{task.title}</h4>
          <label className="task-complete-control" title="Mark task complete">
            <input
              type="checkbox"
              className="task-complete-checkbox"
              checked={Boolean(task.completed)}
              onChange={() => toggleTaskCompleted(task.id)}
              aria-label={`Mark ${task.title} as completed`}
            />
          </label>
        </div>
        <p>Due: {task.due ? new Date(task.due).toLocaleDateString() : "No date"}</p>
      </article>
    );
  }

  return (
    <div className="app-shell">
      <header className="header">
        <h1>Synapse</h1>
        <p>Automated time management for students and professionals.</p>
      </header>

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
              type="number"
              min="1"
              placeholder="Hours/week"
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
                    <input
                      value={editingGoal.name}
                      onChange={(e) => setEditingGoal((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Goal name"
                    />
                    <input
                      type="number"
                      min="1"
                      value={editingGoal.weeklyHours}
                      onChange={(e) =>
                        setEditingGoal((prev) => ({ ...prev, weeklyHours: e.target.value }))
                      }
                      placeholder="Hours/week"
                    />
                    <div className="goal-actions">
                      <button type="button" onClick={() => saveGoalEdit(goal.id)}>
                        Save
                      </button>
                      <button type="button" onClick={cancelEditingGoal}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="goal-view-row">
                    <span>
                      <strong>{goal.name}</strong> - {goal.weeklyHours} hrs/week
                    </span>
                    <button
                      type="button"
                      className="edit-icon-button"
                      onClick={() => startEditingGoal(goal)}
                      aria-label="Edit goal"
                      title="Edit goal"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>To-do List</h2>
          <div className="button-row">
            <button onClick={connectGoogleTasks}>Connect Google Tasks</button>
            <button onClick={scoreTaskImportanceWithGroq} disabled={isScoring}>
              {isScoring ? "Scoring..." : "Score Importance"}
            </button>
            <button onClick={generateSuggestions} disabled={isSuggesting}>
              {isSuggesting ? "Analyzing..." : "Generate Suggestions"}
            </button>
          </div>

          <form onSubmit={addManualTask} className="stack-form">
            <input
              placeholder="Manual task title"
              value={newTask.title}
              onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
            />
            <input
              type="date"
              value={newTask.due}
              onChange={(e) => setNewTask((p) => ({ ...p, due: e.target.value }))}
            />
            <input
              placeholder="Notes / context"
              value={newTask.notes}
              onChange={(e) => setNewTask((p) => ({ ...p, notes: e.target.value }))}
            />
            <button type="submit">Add Manual Task</button>
          </form>
          <p className="status">{status}</p>
        </div>
      </section>

      <section className="matrix-section">
        <h2>Eisenhower Matrix</h2>
        <div className="axis-shell">
          <div className="matrix-grid">
            <div className="matrix-cell importantUrgent">
              <div className="cell-header">Important + Urgent</div>
              {quadrantTasks.importantUrgent.length === 0 ? (
                <div className="empty-cell">No tasks</div>
              ) : (
                quadrantTasks.importantUrgent.map((task) => renderTaskCard(task))
              )}
            </div>
            <div className="matrix-cell notImportantUrgent">
              <div className="cell-header">Not Important + Urgent</div>
              {quadrantTasks.notImportantUrgent.length === 0 ? (
                <div className="empty-cell">No tasks</div>
              ) : (
                quadrantTasks.notImportantUrgent.map((task) => renderTaskCard(task))
              )}
            </div>
            <div className="matrix-cell importantNotUrgent">
              <div className="cell-header">Important + Not Urgent</div>
              {quadrantTasks.importantNotUrgent.length === 0 ? (
                <div className="empty-cell">No tasks</div>
              ) : (
                quadrantTasks.importantNotUrgent.map((task) => renderTaskCard(task))
              )}
            </div>
            <div className="matrix-cell notImportantNotUrgent">
              <div className="cell-header">Not Important + Not Urgent</div>
              {quadrantTasks.notImportantNotUrgent.length === 0 ? (
                <div className="empty-cell">No tasks</div>
              ) : (
                quadrantTasks.notImportantNotUrgent.map((task) => renderTaskCard(task))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="suggestions">
        <h2>Suggestions & Alerts</h2>
        <textarea readOnly value={suggestionText} rows={7} />
      </section>
    </div>
  );
}

function buildLocalSuggestion(scoredTasks, goals, quadrantCounts) {
  const totalGoalHours = goals.reduce((sum, goal) => sum + Number(goal.weeklyHours || 0), 0);
  const highPriorityTasks = scoredTasks.filter((t) => t.importance >= 3 && t.urgency >= 3).length;
  const lowLow = quadrantCounts.notImportantNotUrgent;

  if (totalGoalHours > 50) {
    return `Alert: you allotted ${totalGoalHours} hours this week, which may be unrealistic. Consider moving lower priority tasks to next week.`;
  }
  if (lowLow > highPriorityTasks) {
    return "Alert: you have more tasks in the not important / not urgent zone than in your top-priority zone. Consider eliminating or deferring some tasks.";
  }
  if (highPriorityTasks === 0) {
    return "Alert: no tasks are currently both important and urgent. Double-check whether your due dates and goal alignment are accurate.";
  }
  return "Great todo list, this aligns well with your weekly goals. Keep momentum on important and urgent tasks first.";
}

export default App;
