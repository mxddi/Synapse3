import { StatusBar } from "expo-status-bar";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

import { fetchGoogleCalendarEvents, fetchGoogleTasks, updateGoogleTask } from "../shared/googleApis";
import { addDays, CAL_END_HOUR, CAL_START_HOUR, getQuadrant, getWeekStart, minutesToDisplay, normalizeAndLimitSuggestions, urgencyScoreFromDueDate, weekKeyFromDate } from "../shared/synapseCore";
import { disconnectGoogle, getGoogleAccessToken } from "./src/auth/googleAuth";

const Tab = createBottomTabNavigator();

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const HOUR_PX = 56;

const EVENT_COLORS = {
  google: { bg: "#4285F4", text: "#fff" },
  manual: { bg: "#34A853", text: "#fff" },
  suggested: { bg: "#FBBC05", text: "#1a1a1a" },
};

function OutlineButton({ title, onPress, disabled = false, rightIcon = null, style = null }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.outlineBtn,
        disabled ? styles.outlineBtnDisabled : null,
        style,
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.outlineBtnText, disabled ? styles.outlineBtnTextDisabled : null]}>
        {title}
      </Text>
      {rightIcon ? <View style={{ marginLeft: 8 }}>{rightIcon}</View> : null}
    </Pressable>
  );
}

const mockGoals = [
  { id: "g1", name: "Prepare for data structures exam", weeklyHours: 8 },
  { id: "g2", name: "Finish product demo deck", weeklyHours: 5 },
  { id: "g3", name: "Exercise and sleep consistency", weeklyHours: 4 },
];

function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const mockTasks = [
  { id: "t1", title: "Review binary trees notes", due: inDays(1), notes: "study" },
  { id: "t2", title: "Design slides for demo", due: inDays(3), notes: "work project" },
  { id: "t3", title: "Book dentist appointment", due: inDays(9), notes: "personal admin" },
  { id: "t4", title: "Watch random YouTube", due: inDays(14), notes: "optional" },
];

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

function useSynapseState() {
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

  const [googleStatus, setGoogleStatus] = useState("Not connected.");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isImportingTasks, setIsImportingTasks] = useState(false);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarStatus, setCalendarStatus] = useState("Not synced.");
  const [isSyncingCal, setIsSyncingCal] = useState(false);
  const [addEventSlot, setAddEventSlot] = useState(null);
  const [calSuggestions, setCalSuggestions] = useState([]);
  const [isGenCalSug, setIsGenCalSug] = useState(false);
  const [calSugStatus, setCalSugStatus] = useState("");
  const calEventIdCounter = useRef(1000);
  const calSuggestionIdCounter = useRef(1);

  const scoredTasks = useMemo(() => {
    return tasks
      .filter((t) => !t.completed)
      .map((t) => ({
        ...t,
        urgency: urgencyScoreFromDueDate(t.due),
        quadrant: getQuadrant(t.importance, urgencyScoreFromDueDate(t.due)),
      }));
  }, [tasks]);

  return {
    goals,
    setGoals,
    tasks,
    setTasks,
    scoredTasks,
    googleStatus,
    setGoogleStatus,
    isConnecting,
    setIsConnecting,
    isImportingTasks,
    setIsImportingTasks,
    currentWeekStart,
    setCurrentWeekStart,
    calendarEvents,
    setCalendarEvents,
    calendarStatus,
    setCalendarStatus,
    isSyncingCal,
    setIsSyncingCal,
    addEventSlot,
    setAddEventSlot,
    calSuggestions,
    setCalSuggestions,
    isGenCalSug,
    setIsGenCalSug,
    calSugStatus,
    setCalSugStatus,
    calEventIdCounter,
    calSuggestionIdCounter,
  };
}

function TopBar({ title, onPressProfile }) {
  return (
    <View style={styles.topBar}>
      <Text style={styles.topBarTitle}>{title}</Text>
      <Pressable onPress={onPressProfile} hitSlop={10} style={styles.topBarIconBtn} accessibilityLabel="Profile">
        <Ionicons name="person-circle-outline" size={28} color={stylesVars.fg} />
      </Pressable>
    </View>
  );
}

function ProfileModal({ visible, onClose, state }) {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";

  async function connectGoogle() {
    if (!clientId) {
      state.setGoogleStatus("Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    state.setIsConnecting(true);
    try {
      await getGoogleAccessToken({ clientId, forceReauth: true });
      state.setGoogleStatus("Connected to Google (Tasks + Calendar).");
    } catch (err) {
      state.setGoogleStatus(err?.message || "Google sign-in failed.");
    } finally {
      state.setIsConnecting(false);
    }
  }

  async function disconnect() {
    await disconnectGoogle();
    state.setGoogleStatus("Disconnected.");
  }

  async function importTasks() {
    if (!clientId) {
      state.setGoogleStatus("Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    state.setIsImportingTasks(true);
    try {
      const token = await getGoogleAccessToken({ clientId });
      const imported = await fetchGoogleTasks(token);
      if (!imported.length) {
        state.setGoogleStatus("Connected, but no active tasks found.");
        return;
      }
      state.setTasks(imported);
      state.setGoogleStatus(`Imported ${imported.length} tasks.`);
    } catch (err) {
      state.setGoogleStatus(err?.message || "Failed to import tasks.");
    } finally {
      state.setIsImportingTasks(false);
    }
  }

  async function syncCalendar() {
    if (!clientId) {
      state.setCalendarStatus("Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    state.setIsSyncingCal(true);
    state.setCalendarStatus("Syncing...");
    try {
      const token = await getGoogleAccessToken({ clientId });
      const { weekKey: wk, events } = await fetchGoogleCalendarEvents(token, state.currentWeekStart);
      state.setCalendarEvents((prev) => [
        ...prev.filter((e) => !(e.source === "google" && e.weekKey === wk)),
        ...events,
      ]);
      state.setCalendarStatus(`Synced ${events.length} events.`);
    } catch (err) {
      state.setCalendarStatus(err?.message || "Failed to sync calendar.");
    } finally {
      state.setIsSyncingCal(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          <View style={styles.profileHeaderRow}>
            <Text style={styles.modalTitle}>Profile</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={stylesVars.fgMuted} />
            </Pressable>
          </View>

          <Text style={styles.label}>Google</Text>
          <Text style={styles.statusMono}>{state.googleStatus}</Text>
          <View style={styles.row}>
            <Pressable style={styles.primaryBtn} onPress={connectGoogle} disabled={state.isConnecting}>
              <Text style={styles.primaryBtnText}>{state.isConnecting ? "Connecting…" : "Connect"}</Text>
            </Pressable>
            <View style={styles.spacer8} />
            <Pressable style={styles.ghostBtn} onPress={disconnect}>
              <Text style={styles.ghostBtnText}>Disconnect</Text>
            </Pressable>
          </View>

          <View style={styles.spacer12} />
          <Pressable style={styles.ghostBtn} onPress={importTasks} disabled={state.isImportingTasks}>
            <Text style={styles.ghostBtnText}>{state.isImportingTasks ? "Importing…" : "Import Google Tasks"}</Text>
          </Pressable>
          <View style={styles.spacer8} />
          <Pressable style={styles.ghostBtn} onPress={syncCalendar} disabled={state.isSyncingCal}>
            <Text style={styles.ghostBtnText}>{state.isSyncingCal ? "Syncing…" : "Sync Google Calendar"}</Text>
          </Pressable>

          <View style={styles.spacer12} />
          <Text style={styles.subtle}>Tip: keep using “Suggest Schedule” from the Calendar tab.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GoalsTasksScreen({ state }) {
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalHours, setNewGoalHours] = useState("");
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [editingGoalDraft, setEditingGoalDraft] = useState({ name: "", weeklyHours: "" });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskDraft, setEditingTaskDraft] = useState({ title: "", due: "", notes: "" });
  const [showCompleted, setShowCompleted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function addGoal() {
    if (!newGoalName.trim() || !newGoalHours) return;
    state.setGoals((prev) => [
      ...prev,
      { id: `g-${Date.now()}`, name: newGoalName.trim(), weeklyHours: Number(newGoalHours) },
    ]);
    setNewGoalName("");
    setNewGoalHours("");
  }

  function startEditingGoal(goal) {
    setEditingGoalId(goal.id);
    setEditingGoalDraft({ name: goal.name || "", weeklyHours: String(goal.weeklyHours ?? "") });
  }

  function saveGoalEdit() {
    if (!editingGoalId) return;
    const name = editingGoalDraft.name.trim();
    const hours = editingGoalDraft.weeklyHours;
    if (!name || !hours) return;
    state.setGoals((prev) =>
      prev.map((g) => (g.id === editingGoalId ? { ...g, name, weeklyHours: Number(hours) } : g))
    );
    setEditingGoalId(null);
    setEditingGoalDraft({ name: "", weeklyHours: "" });
  }

  function startEditingTask(task) {
    setEditingTaskId(task.id);
    setEditingTaskDraft({
      title: task.title || "",
      due: toDateInputValue(task.due),
      notes: task.notes || "",
    });
  }

  async function saveTaskEdit(task) {
    const title = editingTaskDraft.title.trim();
    if (!title) return;
    const notes = editingTaskDraft.notes.trim();
    const dueIso = editingTaskDraft.due ? toGoogleDueDate(editingTaskDraft.due) : null;

    state.setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, title, notes, due: dueIso } : t))
    );

    setEditingTaskId(null);
    setEditingTaskDraft({ title: "", due: "", notes: "" });

    if (task.source === "google" && task.taskListId) {
      try {
        const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";
        const token = await getGoogleAccessToken({ clientId });
        await updateGoogleTask(token, {
          taskId: task.id,
          taskListId: task.taskListId,
          title,
          notes,
          dueIsoOrNull: dueIso,
        });
        state.setGoogleStatus("Task updated and synced to Google Tasks.");
      } catch (err) {
        state.setGoogleStatus(err?.message || "Task updated locally, but Google sync failed.");
      }
    }
  }

  function toggleTaskCompleted(taskId) {
    state.setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)));
  }

  function renderSwipeAction(label, onPress, variant = "default") {
    const bg = variant === "danger" ? "#3B0A0A" : "#1C2740";
    const fg = variant === "danger" ? "#FFD6D6" : "#D7DEFF";
    return (
      <Pressable onPress={onPress} style={[styles.swipeAction, { backgroundColor: bg }]}>
        <Text style={[styles.swipeActionText, { color: fg }]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar title="Goals & Tasks" onPressProfile={() => setProfileOpen(true)} />

      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.h2}>Weekly Goals</Text>
        </View>
        <View style={styles.row}>
          <TextInput style={styles.input} placeholder="Goal" value={newGoalName} onChangeText={setNewGoalName} />
          <View style={styles.spacer8} />
          <TextInput style={[styles.input, styles.hoursInput]} placeholder="hrs" keyboardType="numeric" value={newGoalHours} onChangeText={setNewGoalHours} />
          <View style={styles.spacer8} />
          <OutlineButton title="Add" onPress={addGoal} style={{ paddingHorizontal: 12, paddingVertical: 10 }} />
        </View>
        <FlatList
          data={state.goals}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={() =>
                renderSwipeAction("Edit", () => startEditingGoal(item))
              }
            >
              <View style={styles.listRow}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.badge}>{item.weeklyHours}h</Text>
              </View>
            </Swipeable>
          )}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.h2}>To‑Do</Text>
          <Pressable style={styles.ghostPill} onPress={() => setShowCompleted((p) => !p)}>
            <Text style={styles.ghostPillText}>{showCompleted ? "Hide done" : "Show done"}</Text>
          </Pressable>
        </View>
        <FlatList
          data={state.tasks.filter((t) => !t.completed).slice(0, 30)}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={() => (
                <View style={styles.swipeActionsRow}>
                  {renderSwipeAction("Edit", () => startEditingTask(item))}
                  {renderSwipeAction(item.completed ? "Uncomplete" : "Complete", () => toggleTaskCompleted(item.id))}
                </View>
              )}
            >
              <View style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{item.title}</Text>
                  <Text style={styles.subtle}>
                    Due: {item.due ? new Date(item.due).toLocaleDateString() : "None"} · {item.source}
                  </Text>
                </View>
                <Text style={styles.badge}>I{item.importance}</Text>
              </View>
            </Swipeable>
          )}
          ListEmptyComponent={<Text style={styles.subtle}>No tasks</Text>}
        />

        {showCompleted && (
          <View style={styles.donePanel}>
            <Text style={styles.label}>Completed</Text>
            {(state.tasks.filter((t) => t.completed) || []).slice(0, 50).map((t) => (
              <Text key={t.id} style={styles.doneItemText} numberOfLines={1}>
                {t.title}
              </Text>
            ))}
            {state.tasks.filter((t) => t.completed).length === 0 && (
              <Text style={styles.subtle}>No completed tasks yet.</Text>
            )}
          </View>
        )}
      </View>

      {/* Goal edit modal */}
      <Modal visible={Boolean(editingGoalId)} transparent animationType="fade" onRequestClose={() => setEditingGoalId(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingGoalId(null)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit goal</Text>
            <TextInput style={styles.input} value={editingGoalDraft.name} onChangeText={(t) => setEditingGoalDraft((p) => ({ ...p, name: t }))} />
            <View style={styles.spacer8} />
            <TextInput style={styles.input} value={editingGoalDraft.weeklyHours} keyboardType="numeric" onChangeText={(t) => setEditingGoalDraft((p) => ({ ...p, weeklyHours: t }))} />
            <View style={styles.modalActions}>
              <OutlineButton title="Cancel" onPress={() => setEditingGoalId(null)} />
              <View style={styles.spacer8} />
              <OutlineButton title="Save" onPress={saveGoalEdit} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Task edit modal */}
      <Modal visible={Boolean(editingTaskId)} transparent animationType="fade" onRequestClose={() => setEditingTaskId(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingTaskId(null)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit task</Text>
            <TextInput style={styles.input} value={editingTaskDraft.title} onChangeText={(t) => setEditingTaskDraft((p) => ({ ...p, title: t }))} />
            <View style={styles.spacer8} />
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={editingTaskDraft.due} onChangeText={(t) => setEditingTaskDraft((p) => ({ ...p, due: t }))} />
            <View style={styles.spacer8} />
            <TextInput style={styles.input} value={editingTaskDraft.notes} onChangeText={(t) => setEditingTaskDraft((p) => ({ ...p, notes: t }))} />
            <View style={styles.modalActions}>
              <OutlineButton title="Cancel" onPress={() => setEditingTaskId(null)} />
              <View style={styles.spacer8} />
              <OutlineButton
                title="Save"
                onPress={() => {
                  const task = state.tasks.find((t) => t.id === editingTaskId);
                  if (task) saveTaskEdit(task);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)} state={state} />
    </SafeAreaView>
  );
}

function MatrixScreen({ state }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const groups = useMemo(() => {
    const acc = {
      importantUrgent: [],
      notImportantUrgent: [],
      importantNotUrgent: [],
      notImportantNotUrgent: [],
    };
    state.scoredTasks.forEach((t) => acc[t.quadrant].push(t));
    return acc;
  }, [state.scoredTasks]);

  const cells = [
    { key: "importantUrgent", title: "Important + Urgent" },
    { key: "importantNotUrgent", title: "Important + Not Urgent" },
    { key: "notImportantUrgent", title: "Not Important + Urgent" },
    { key: "notImportantNotUrgent", title: "Not Important + Not Urgent" },
  ];

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar title="Matrix" onPressProfile={() => setProfileOpen(true)} />
      <FlatList
        data={cells}
        keyExtractor={(c) => c.key}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.h2}>{item.title}</Text>
            {(groups[item.key] || []).length === 0 ? (
              <Text style={styles.subtle}>No tasks</Text>
            ) : (
              (groups[item.key] || []).slice(0, 8).map((t) => (
                <View key={t.id} style={styles.matrixTaskRow}>
                  <View style={styles.matrixDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle} numberOfLines={1}>{t.title}</Text>
                    <Text style={styles.subtle}>
                      Due: {t.due ? new Date(t.due).toLocaleDateString() : "None"}
                    </Text>
                  </View>
                  <Text style={styles.badge}>I{t.importance}</Text>
                </View>
              ))
            )}
          </View>
        )}
      />
      <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)} state={state} />
    </SafeAreaView>
  );
}

function CalendarScreen({ state }) {
  const weekKey = weekKeyFromDate(state.currentWeekStart);
  const groqKey = process.env.EXPO_PUBLIC_GROQ_KEY || "";
  const [profileOpen, setProfileOpen] = useState(false);

  const visible = useMemo(() => {
    return state.calendarEvents
      .filter((e) => e.weekKey === weekKey)
      .sort((a, b) => (a.day - b.day) || (a.startMinute - b.startMinute));
  }, [state.calendarEvents, weekKey]);

  const visibleSuggestions = useMemo(() => {
    return (state.calSuggestions || []).filter((s) => s.weekKey === weekKey).slice(0, 6);
  }, [state.calSuggestions, weekKey]);

  async function syncCalendar() {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";
    if (!clientId) {
      state.setCalendarStatus("Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    state.setIsSyncingCal(true);
    state.setCalendarStatus("Syncing...");
    try {
      const token = await getGoogleAccessToken({ clientId });
      const { weekKey: wk, events } = await fetchGoogleCalendarEvents(token, state.currentWeekStart);
      state.setCalendarEvents((prev) => [
        ...prev.filter((e) => !(e.source === "google" && e.weekKey === wk)),
        ...events,
      ]);
      state.setCalendarStatus(`Synced ${events.length} events.`);
    } catch (err) {
      state.setCalendarStatus(err?.message || "Failed to sync calendar.");
    } finally {
      state.setIsSyncingCal(false);
    }
  }

  function minuteToY(minute) {
    const clipped = Math.max(CAL_START_HOUR * 60, Math.min(CAL_END_HOUR * 60, minute));
    return ((clipped - CAL_START_HOUR * 60) / 60) * HOUR_PX;
  }

  function handleSlotPress(dayIndex, locationY) {
    const minute = Math.round(((locationY / HOUR_PX) * 60 + CAL_START_HOUR * 60) / 15) * 15;
    const clamped = Math.max(CAL_START_HOUR * 60, Math.min((CAL_END_HOUR - 1) * 60, minute));
    state.setAddEventSlot({ day: dayIndex, startMinute: clamped });
  }

  function confirmAddEvent({ title, day, startMinute, endMinute }) {
    const activeWeekKey = weekKeyFromDate(state.currentWeekStart);
    const newEv = {
      id: `cal-${state.calEventIdCounter.current++}`,
      title,
      day,
      startMinute,
      endMinute: endMinute > startMinute ? endMinute : startMinute + 60,
      source: "manual",
      weekKey: activeWeekKey,
    };
    state.setCalendarEvents((prev) => [...prev, newEv]);
    state.setCalendarStatus("Manual event added.");
    state.setAddEventSlot(null);
    state.setCalSuggestions((prev) =>
      prev.filter((s) => s.day !== day || s.endMinute <= startMinute || s.startMinute >= newEv.endMinute)
    );
  }

  function addSuggestionToCalendar(suggestion) {
    const newEv = {
      id: `cal-${state.calEventIdCounter.current++}`,
      title: suggestion.taskTitle,
      day: suggestion.day,
      startMinute: suggestion.startMinute,
      endMinute: suggestion.endMinute,
      source: "manual",
      weekKey: suggestion.weekKey || weekKeyFromDate(state.currentWeekStart),
    };
    state.setCalendarEvents((prev) => [...prev, newEv]);
    state.setCalSuggestions((prev) => prev.filter((s) => s.sugId !== suggestion.sugId));
    state.setCalSugStatus("Suggestion added to your calendar!");
  }

  function deleteSuggestionFromCalendar(suggestion) {
    state.setCalSuggestions((prev) => prev.filter((s) => s.sugId !== suggestion.sugId));
    state.setCalSugStatus("Suggestion removed from calendar.");
  }

  function buildLocalCalSuggestions(busyByDay, prioritized) {
    const suggestions = [];
    const usedSlots = busyByDay.map((blocks) => [...blocks]);

    for (let taskIndex = 0; taskIndex < prioritized.length; taskIndex++) {
      const task = prioritized[taskIndex];
      const duration = task.importance >= 3 ? 90 : 60;
      let placed = false;
      const preferredStart = task.urgency >= 3 ? 1 : 3;
      const dayOrder = Array.from({ length: 7 }, (_, i) => (preferredStart + taskIndex + i) % 7);

      for (const di of dayOrder) {
        if (placed) break;
        for (let start = CAL_START_HOUR * 60; start + duration <= CAL_END_HOUR * 60; start += 30) {
          const end = start + duration;
          const overlaps = usedSlots[di].some((b) => start < b.endMinute && end > b.startMinute);
          if (!overlaps) {
            suggestions.push({
              taskId: task.id,
              taskTitle: task.title,
              day: di,
              startMinute: start,
              endMinute: end,
              reason: "Scheduled based on priority.",
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

  async function generateCalendarSuggestions() {
    state.setIsGenCalSug(true);
    state.setCalSugStatus("Analyzing your schedule for open slots…");
    state.setCalSuggestions([]);
    const activeWeekKey = weekKeyFromDate(state.currentWeekStart);
    const weekEvents = state.calendarEvents.filter((ev) => ev.weekKey === activeWeekKey);

    const busyByDay = Array.from({ length: 7 }, () => []);
    weekEvents.forEach((ev) => {
      if (ev.day >= 0 && ev.day < 7) {
        busyByDay[ev.day].push({ startMinute: ev.startMinute, endMinute: ev.endMinute });
      }
    });

    const prioritized = [...state.scoredTasks]
      .filter((t) => !t.completed)
      .sort((a, b) => (b.importance * 2 + b.urgency) - (a.importance * 2 + a.urgency))
      .slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title, importance: t.importance, urgency: t.urgency, quadrant: t.quadrant }));

    const fallback = buildLocalCalSuggestions(busyByDay, prioritized);

    if (!groqKey) {
      state.setCalSuggestions(fallback.map((s) => ({ ...s, weekKey: activeWeekKey, sugId: `sug-${state.calSuggestionIdCounter.current++}` })));
      state.setCalSugStatus("Using local scheduling suggestions (set EXPO_PUBLIC_GROQ_KEY to enable AI).");
      state.setIsGenCalSug(false);
      return;
    }

    try {
      const busySummary = busyByDay.map((blocks, d) => ({
        dayIndex: d,
        busy: blocks.map((b) => `${minutesToDisplay(b.startMinute)}–${minutesToDisplay(b.endMinute)}`),
      }));

      const prompt = `
Return ONLY strict minified JSON:
{"suggestions":[{"taskId":"string","taskTitle":"string","day":0,"startMinute":540,"endMinute":660,"reason":"short sentence"}]}

Rules:
- day is 0=Sunday through 6=Saturday
- Only schedule between ${CAL_START_HOUR * 60} and ${CAL_END_HOUR * 60}
- Never overlap with busy blocks
- Provide at most 6 suggestions total

Busy blocks:
${JSON.stringify(busySummary)}

Prioritized tasks:
${JSON.stringify(prioritized)}
`;
      const parsed = await Promise.race([
        fetchGroqJson(prompt, groqKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Groq calendar request timed out.")), 15000)),
      ]);

      const titleByTaskId = new Map(prioritized.map((t) => [t.id, t.title]));
      const sug = normalizeAndLimitSuggestions(
        parsed.suggestions,
        busyByDay,
        titleByTaskId,
        () => `sug-${state.calSuggestionIdCounter.current++}`
      ).map((s) => ({ ...s, weekKey: activeWeekKey }));

      if (sug.length === 0) throw new Error("No valid suggestions returned.");
      state.setCalSuggestions(sug);
      state.setCalSugStatus(`${sug.length} scheduling suggestion${sug.length !== 1 ? "s" : ""} ready. Tap “Add” to lock one in.`);
    } catch (err) {
      state.setCalSuggestions(fallback.map((s) => ({ ...s, weekKey: activeWeekKey, sugId: `sug-${state.calSuggestionIdCounter.current++}` })));
      state.setCalSugStatus(`AI failed; showing local suggestions. (${err.message})`);
    } finally {
      state.setIsGenCalSug(false);
    }
  }

  const label = useMemo(() => {
    const end = addDays(state.currentWeekStart, 6);
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(state.currentWeekStart)} – ${fmt(end)}`;
  }, [state.currentWeekStart]);

  const hours = useMemo(() => {
    const a = [];
    for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) a.push(h);
    return a;
  }, []);
  const totalPx = hours.length * HOUR_PX;
  const dayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) =>
      addDays(state.currentWeekStart, i).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    );
  }, [state.currentWeekStart]);

  const dayEvents = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    visible.forEach((ev) => {
      if (ev.day >= 0 && ev.day < 7) map[ev.day].push(ev);
    });
    return map;
  }, [visible]);

  const daySuggestions = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    visibleSuggestions.forEach((s) => {
      if (s.day >= 0 && s.day < 7) map[s.day].push(s);
    });
    return map;
  }, [visibleSuggestions]);

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar title="Calendar" onPressProfile={() => setProfileOpen(true)} />

      <View style={styles.card}>
        <Text style={styles.h2}>Week</Text>
        <Text style={styles.subtle}>{label}</Text>
        <View style={styles.spacer12} />
        <View style={styles.row}>
          <OutlineButton title="Prev" onPress={() => state.setCurrentWeekStart((w) => addDays(w, -7))} />
          <View style={styles.spacer8} />
          <OutlineButton title="Today" onPress={() => state.setCurrentWeekStart(getWeekStart(new Date()))} />
          <View style={styles.spacer8} />
          <OutlineButton title="Next" onPress={() => state.setCurrentWeekStart((w) => addDays(w, 7))} />
        </View>
        <View style={styles.spacer12} />
        <View style={styles.row}>
          <OutlineButton title={state.isSyncingCal ? "Syncing..." : "Sync Google Calendar"} onPress={syncCalendar} disabled={state.isSyncingCal} />
          <View style={styles.spacer8} />
          <OutlineButton title={state.isGenCalSug ? "Analyzing..." : "Suggest Schedule"} onPress={generateCalendarSuggestions} disabled={state.isGenCalSug} />
        </View>
        <View style={styles.spacer8} />
        <Text style={styles.status}>{state.calendarStatus}</Text>
        {state.calSugStatus ? <Text style={styles.subtle}>{state.calSugStatus}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Weekly Calendar</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: EVENT_COLORS.google.bg }]} />
            <Text style={styles.legendText}>Google</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: EVENT_COLORS.manual.bg }]} />
            <Text style={styles.legendText}>Manual</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: EVENT_COLORS.suggested.bg }]} />
            <Text style={styles.legendText}>Suggested</Text>
          </View>
        </View>

        {state.isSyncingCal && <ActivityIndicator />}

        <View style={styles.calHeaderRow}>
          <View style={styles.calTimeGutter} />
          {dayLabels.map((d, i) => (
            <View key={i} style={styles.calDayHeader}>
              <Text style={styles.calDayHeaderText} numberOfLines={1}>{d}</Text>
            </View>
          ))}
        </View>

        <ScrollView style={{ maxHeight: 420 }}>
          <View style={[styles.calBody, { height: totalPx }]}>
            <View style={styles.calTimeGutter}>
              {hours.map((h) => (
                <Text key={h} style={[styles.calHourLabel, { top: (h - CAL_START_HOUR) * HOUR_PX }]}>
                  {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
                </Text>
              ))}
            </View>

            {Array.from({ length: 7 }, (_, dayIdx) => (
              <Pressable
                key={dayIdx}
                style={[styles.calDayCol, { height: totalPx }]}
                onPress={(e) => handleSlotPress(dayIdx, e.nativeEvent.locationY)}
              >
                {hours.map((h) => (
                  <View key={h} style={[styles.calHourLine, { top: (h - CAL_START_HOUR) * HOUR_PX }]} />
                ))}

                {dayEvents[dayIdx].map((ev) => {
                  const top = minuteToY(ev.startMinute);
                  const height = Math.max(20, minuteToY(ev.endMinute) - top);
                  const colors = ev.source === "google" ? EVENT_COLORS.google : EVENT_COLORS.manual;
                  return (
                    <View key={ev.id} style={[styles.calEvent, { top, height, backgroundColor: colors.bg }]}>
                      <Text style={[styles.calEventTitle, { color: colors.text }]} numberOfLines={1}>{ev.title}</Text>
                      <Text style={[styles.calEventTime, { color: colors.text }]}>
                        {minutesToDisplay(ev.startMinute)}–{minutesToDisplay(ev.endMinute)}
                      </Text>
                    </View>
                  );
                })}

                {daySuggestions[dayIdx].map((s) => {
                  const top = minuteToY(s.startMinute);
                  const height = Math.max(24, minuteToY(s.endMinute) - top);
                  return (
                    <View key={s.sugId} style={[styles.calEvent, { top, height, backgroundColor: EVENT_COLORS.suggested.bg }]}>
                      <Text style={[styles.calEventTitle, { color: EVENT_COLORS.suggested.text }]} numberOfLines={1}>✨ {s.taskTitle}</Text>
                      <Text style={[styles.calEventTime, { color: EVENT_COLORS.suggested.text }]}>
                        {minutesToDisplay(s.startMinute)}–{minutesToDisplay(s.endMinute)}
                      </Text>
                      <View style={styles.sugInlineActions}>
                        <Pressable style={styles.sugInlineBtn} onPress={() => addSuggestionToCalendar(s)}>
                          <Text style={[styles.sugInlineBtnText, { color: EVENT_COLORS.suggested.text }]}>Add</Text>
                        </Pressable>
                        <Pressable style={[styles.sugInlineBtn, styles.sugInlineBtnDismiss]} onPress={() => deleteSuggestionFromCalendar(s)}>
                          <Text style={[styles.sugInlineBtnText, { color: EVENT_COLORS.suggested.text }]}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {visibleSuggestions.length > 0 && (
          <View style={[styles.card, { marginBottom: 0, marginTop: 12 }]}>
            <Text style={styles.h2}>AI Scheduling Suggestions</Text>
            {visibleSuggestions.map((s) => {
              const dayLabel = addDays(state.currentWeekStart, s.day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              return (
                <View key={s.sugId} style={styles.sugRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{s.taskTitle}</Text>
                    <Text style={styles.subtle}>{dayLabel} · {minutesToDisplay(s.startMinute)}–{minutesToDisplay(s.endMinute)}</Text>
                    <Text style={styles.subtle} numberOfLines={2}>{s.reason}</Text>
                  </View>
                  <Pressable style={styles.sugAddBtn} onPress={() => addSuggestionToCalendar(s)}>
                    <Text style={styles.sugAddBtnText}>+ Add</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {state.addEventSlot && (
        <AddEventModal
          slot={state.addEventSlot}
          weekStart={state.currentWeekStart}
          onConfirm={confirmAddEvent}
          onCancel={() => state.setAddEventSlot(null)}
        />
      )}
      <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)} state={state} />
    </SafeAreaView>
  );
}

function AddEventModal({ slot, weekStart, onConfirm, onCancel }) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(minutesToTimeInput(slot.startMinute));
  const [endTime, setEndTime] = useState(minutesToTimeInput(Math.min(slot.startMinute + 60, CAL_END_HOUR * 60)));
  const dayLabel = addDays(weekStart, slot.day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  function handleConfirm() {
    if (!title.trim()) return;
    onConfirm({
      title: title.trim(),
      day: slot.day,
      startMinute: timeStringToMinutes(startTime),
      endMinute: timeStringToMinutes(endTime),
    });
    setTitle("");
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Add Event — {dayLabel}</Text>
          <TextInput style={styles.input} placeholder="Event title" value={title} onChangeText={setTitle} />
          <View style={styles.spacer8} />
          <TextInput style={styles.input} placeholder="Start (HH:MM)" value={startTime} onChangeText={setStartTime} />
          <View style={styles.spacer8} />
          <TextInput style={styles.input} placeholder="End (HH:MM)" value={endTime} onChangeText={setEndTime} />
          <View style={styles.modalActions}>
            <OutlineButton title="Cancel" onPress={onCancel} />
            <View style={styles.spacer8} />
            <OutlineButton title="Add" onPress={handleConfirm} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function App() {
  const state = useSynapseState();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowLabel: false,
            tabBarStyle: { backgroundColor: stylesVars.bg, borderTopColor: stylesVars.border },
            tabBarActiveTintColor: stylesVars.fg,
            tabBarInactiveTintColor: stylesVars.fgMuted,
            tabBarIcon: ({ color, size }) => {
              const name =
                route.name === "Tasks"
                  ? "checkbox-outline"
                  : route.name === "Matrix"
                    ? "grid-outline"
                    : "calendar-outline";
              return <Ionicons name={name} size={size ?? 22} color={color} />;
            },
          })}
        >
          <Tab.Screen name="Tasks" children={() => <GoalsTasksScreen state={state} />} />
          <Tab.Screen name="Matrix" children={() => <MatrixScreen state={state} />} />
          <Tab.Screen name="Calendar" children={() => <CalendarScreen state={state} />} />
        </Tab.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const stylesVars = {
  bg: "#F7F7F8",
  fg: "#0C0C0D",
  fgMuted: "#6B6B70",
  fgFaint: "#8B8B92",
  border: "#E7E7EA",
  card: "#FFFFFF",
  card2: "#FBFBFC",
  shadow: "rgba(0,0,0,0.08)",
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: stylesVars.bg,
    padding: 18,
  },
  h1: {
    fontSize: 32,
    fontWeight: "900",
    color: stylesVars.fg,
    marginBottom: 14,
    letterSpacing: -0.2,
    lineHeight: 36,
    fontFamily: Platform.select({ ios: "System", default: "System" }),
  },
  h2: {
    fontSize: 15,
    fontWeight: "800",
    color: stylesVars.fg,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  status: {
    color: stylesVars.fgMuted,
    marginBottom: 8,
  },
  statusMono: {
    color: stylesVars.fgMuted,
    marginBottom: 10,
    fontSize: 12,
  },
  label: {
    color: stylesVars.fgFaint,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  subtle: {
    color: stylesVars.fgMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  card: {
    backgroundColor: stylesVars.card,
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  topBarTitle: {
    color: stylesVars.fg,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  topBarIconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  spacer8: { width: 8, height: 8 },
  spacer12: { width: 12, height: 12 },
  input: {
    flex: 1,
    backgroundColor: stylesVars.card2,
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: stylesVars.fg,
  },
  hoursInput: {
    width: 70,
    flex: 0,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: stylesVars.border,
  },
  listTitle: {
    color: stylesVars.fg,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  badge: {
    color: stylesVars.fg,
    backgroundColor: stylesVars.card2,
    borderColor: stylesVars.border,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "800",
  },
  bullet: {
    color: stylesVars.fg,
    marginBottom: 4,
  },
  swipeActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  swipeAction: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    minWidth: 76,
  },
  swipeActionText: {
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 16,
  },
  modalBox: {
    backgroundColor: stylesVars.card,
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  modalTitle: {
    color: stylesVars.fg,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ghostPill: {
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ghostPillText: {
    color: stylesVars.fgMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  ghostBtn: {
    flex: 1,
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: stylesVars.card2,
  },
  ghostBtnText: {
    color: stylesVars.fg,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  outlineBtn: {
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  outlineBtnDisabled: {
    opacity: 0.5,
  },
  outlineBtnText: {
    color: stylesVars.fg,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  outlineBtnTextDisabled: {
    color: stylesVars.fgMuted,
  },
  donePanel: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: stylesVars.border,
    paddingTop: 12,
  },
  doneItemText: {
    color: stylesVars.fgMuted,
    paddingVertical: 4,
  },
  matrixTaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: stylesVars.border,
  },
  matrixDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: stylesVars.border,
    backgroundColor: stylesVars.card2,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },

  legendRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 99 },
  legendText: { color: "#AAB5D6", fontSize: 12 },
  legendText: { color: stylesVars.fgMuted, fontSize: 12 },

  calHeaderRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderTopColor: stylesVars.border,
    paddingTop: 8,
    marginTop: 8,
  },
  calTimeGutter: {
    width: 56,
    position: "relative",
  },
  calDayHeader: {
    flex: 1,
    paddingHorizontal: 4,
  },
  calDayHeaderText: {
    color: stylesVars.fgMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  calBody: {
    flexDirection: "row",
    position: "relative",
    marginTop: 6,
  },
  calHourLabel: {
    position: "absolute",
    left: 0,
    right: 0,
    color: "#6C7AA6",
    fontSize: 10,
  },
  calDayCol: {
    flex: 1,
    position: "relative",
    borderLeftWidth: 1,
    borderLeftColor: stylesVars.border,
  },
  calHourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: stylesVars.border,
  },
  calEvent: {
    position: "absolute",
    left: 3,
    right: 3,
    borderRadius: 10,
    padding: 6,
    overflow: "hidden",
  },
  calEventTitle: {
    fontWeight: "800",
    fontSize: 11,
  },
  calEventTime: {
    fontSize: 10,
    marginTop: 2,
  },
  sugInlineActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  sugInlineBtn: {
    backgroundColor: "rgba(0,0,0,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  sugInlineBtnDismiss: {
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  sugInlineBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#1a1a1a",
  },
  sugRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#1C2740",
  },
  sugAddBtn: {
    backgroundColor: "#FBBC05",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  sugAddBtnText: {
    color: "#1a1a1a",
    fontWeight: "900",
  },
});
