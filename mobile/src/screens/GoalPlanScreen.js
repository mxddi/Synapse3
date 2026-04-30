import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const PLAN_STORAGE_KEY = "synapse_goal_plan_v1";

const PALETTE = ["#4285F4", "#34A853", "#FBBC05", "#EA4335", "#A142F4", "#00BFA5"];

const stylesVars = {
  bg: "#F7F7F8",
  fg: "#0C0C0D",
  fgMuted: "#6B6B70",
  border: "#E7E7EA",
  card: "#FFFFFF",
  card2: "#FBFBFC",
};

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

function safeYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n)) return new Date().getFullYear();
  return Math.round(n);
}

function colorForGoal(seed) {
  const n = Number(String(seed).replace(/\D/g, "")) || 0;
  return PALETTE[Math.abs(n) % PALETTE.length];
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function jitter(seed, idx) {
  const x = Math.sin(seed * 999 + idx * 17) * 10000;
  return x - Math.floor(x);
}

function FloatingOrb({ seed, idx, diameter, bg, borderColor, title, subtitle, expanded, children, content, onPress }) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 6000 + jitter(seed, idx) * 2500,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      })
    ).start();
  }, [drift, idx, seed]);

  const dx = drift.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] });
  const dy = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-4, 4, -4] });

  return (
    <Animated.View style={{ transform: [{ translateX: dx }, { translateY: dy }] }}>
      <Pressable
        onPress={onPress}
        style={{
          width: diameter,
          minHeight: expanded ? undefined : diameter,
          padding: expanded ? 10 : 0,
          borderRadius: diameter / 2,
          backgroundColor: bg,
          borderWidth: expanded ? 1 : 0,
          borderColor: borderColor || "rgba(0,0,0,0.10)",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", textAlign: "center" }} numberOfLines={expanded ? 3 : 2}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              marginTop: 4,
              color: "rgba(255,255,255,0.88)",
              fontSize: 11,
              fontWeight: "800",
              textAlign: "center",
            }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
        {content}
      </Pressable>
      {children ? <View style={{ marginTop: expanded ? 10 : 12, width: "100%" }}>{children}</View> : null}
    </Animated.View>
  );
}

function SnapBackDrag({ enabled, mergeDistance, onMerge, children }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => enabled,
        onPanResponderGrant: () => {
          pos.stopAnimation?.();
        },
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          const dist = Math.hypot(g.dx, g.dy);
          Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(({ finished }) => {
            if (!finished) return;
            if (dist < mergeDistance) onMerge?.();
          });
        },
      }),
    [enabled, mergeDistance, onMerge, pos]
  );

  return (
    <Animated.View style={{ transform: [{ translateX: pos.x }, { translateY: pos.y }] }} {...pan.panHandlers}>
      {children}
    </Animated.View>
  );
}

function matchTasksForLeaf(tasks, leafTitle, longTitle) {
  const hay = `${String(longTitle || "")} ${String(leafTitle || "")}`.toLowerCase();
  const tokens = hay
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 4)
    .slice(0, 8);
  if (!tokens.length) return [];

  return (tasks || [])
    .filter((t) => {
      const txt = `${t.title || ""} ${t.notes || ""}`.toLowerCase();
      return tokens.some((w) => txt.includes(w));
    })
    .slice(0, 30);
}

export function GoalPlanScreen({ state }) {
  const groqKey = process.env.EXPO_PUBLIC_GROQ_KEY || "";

  const [hydrated, setHydrated] = useState(false);
  const [ltGoals, setLtGoals] = useState([]); // {id,title,year,color,mids:[{id,title,shorts:[{id,title}], weeklyHoursTarget?}]}
  const [expandedLt, setExpandedLt] = useState(null);
  const [expandedMid, setExpandedMid] = useState(null);
  const [leafPick, setLeafPick] = useState(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content: "What long-term goals are you aiming for (with years)? I’ll help break them into milestones and weekly focus areas.",
    },
  ]);

  const seed = useMemo(() => hashString("synapse-bubbles-v1"), []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PLAN_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.longTermGoals)) setLtGoals(parsed.longTermGoals);
        }
      } catch {
        // ignore
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ longTermGoals: ltGoals, updatedAtMs: Date.now() })).catch(() => {});
  }, [hydrated, ltGoals]);

  async function sendChat() {
    const msg = chatText.trim();
    if (!msg) return;

    setChatMessages((m) => [...m, { role: "user", content: msg }]);
    setChatText("");

    if (!groqKey) {
      setChatMessages((m) => [...m, { role: "assistant", content: "Add EXPO_PUBLIC_GROQ_KEY to enable AI planning." }]);
      return;
    }

    setChatBusy(true);
    try {
      const prompt = `
Return ONLY strict JSON:
{
  "reply":"short acknowledgement + one follow-up question",
  "longTerm":[{"title":"string","year":2035}],
  "monthly":[{"title":"string","year":2035}],
  "weekly":[{"title":"string","year":2026,"weeklyHoursTarget": number}]
}

User message:
${msg}

Existing long-term goals:
${JSON.stringify(ltGoals.map((g) => ({ title: g.title, year: g.year })))}
`;
      const parsed = await fetchGroqJson(prompt, groqKey);
      const reply = String(parsed.reply || "Sounds good.");

      setLtGoals((prev) => {
        let next = [...prev];
        for (const lt of Array.isArray(parsed.longTerm) ? parsed.longTerm : []) {
          const title = String(lt.title || "").trim();
          const year = safeYear(lt.year);
          if (!title) continue;
          if (next.some((g) => g.title.toLowerCase() === title.toLowerCase() && g.year === year)) continue;
          next.push({
            id: `lt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title,
            year,
            color: colorForGoal(`${title}:${year}`),
            mids: [],
          });
        }

        const monthly = Array.isArray(parsed.monthly) ? parsed.monthly : [];
        const weekly = Array.isArray(parsed.weekly) ? parsed.weekly : [];
        next = next.map((g) => {
          const adds = []
            .concat(monthly.filter((x) => safeYear(x.year) === g.year).map((x) => ({ kind: "m", ...x })))
            .concat(weekly.filter((x) => safeYear(x.year) === g.year).map((x) => ({ kind: "w", ...x })));
          if (!adds.length) return g;

          const mids = [...(g.mids || [])];
          adds.forEach((x, idx) => {
            const title = String(x.title || "").trim();
            if (!title) return;
            if (x.kind === "w") {
              mids.push({
                id: `mid-${g.id}-${hashString(title)}-${idx}`,
                title,
                weeklyHoursTarget: Number(x.weeklyHoursTarget || 5),
                shorts: [{ id: `st-${hashString(title)}-${idx}`, title: `Weekly rhythm: ${title}` }],
              });
            } else {
              mids.push({
                id: `mid-${g.id}-${hashString(title)}-${idx}`,
                title,
                shorts: [
                  { id: `st-${hashString(title)}-${idx}a`, title: `First step: ${title}` },
                  { id: `st-${hashString(title)}-${idx}b`, title: `Next step: refine plan for ${title}` },
                ],
              });
            }
          });
          return { ...g, mids: mids.slice(0, 10) };
        });

        return next;
      });

      setChatMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `I couldn’t parse that cleanly (${err.message}). Try again with a goal plus a specific year.`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Goal map</Text>
          <Text style={styles.subtle}>
            Tap bubbles to split. Drag a smaller bubble lightly back toward the parent stack to collapse the selected layer.
          </Text>
        </View>
        <Pressable style={styles.chatFab} onPress={() => setChatOpen(true)}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {!hydrated ? <Text style={styles.subtle}>Loading saved goals…</Text> : null}

      <ScrollView contentContainerStyle={{ paddingVertical: 10, paddingBottom: 96 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 14 }}>
          {ltGoals.map((g, idx) => {
            const expanded = expandedLt === g.id;
            const diam = expanded ? Math.min(300, Math.max(180, ltGoals.length <= 3 ? 220 : 180)) : Math.min(248, ltGoals.length <= 3 ? 220 : 170);
            return (
              <View key={g.id} style={{ width: ltGoals.length === 1 ? "100%" : "48%", alignItems: "center", marginBottom: 10 }}>
                <SnapBackDrag enabled={expanded} mergeDistance={22} onMerge={() => setExpandedLt(null)}>
                  <FloatingOrb
                    seed={seed}
                    idx={idx}
                    diameter={diam}
                    bg={g.color || colorForGoal(`${g.title}:${g.year}`)}
                    expanded={expanded}
                    title={g.title}
                    subtitle={`by ${g.year}`}
                    onPress={() => {
                      setExpandedLt((prev) => (prev === g.id ? null : g.id));
                      setExpandedMid(null);
                      setLeafPick(null);
                    }}
                    content={
                      expanded ? (
                        <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "800", textAlign: "center" }}>
                          {(g.mids || []).length ? "Intermediate goals" : "Use the coach to generate milestones"}
                        </Text>
                      ) : null
                    }
                  >
                    {expanded ? (
                      <View style={{ gap: 10, alignItems: "stretch" }}>
                        {(g.mids || []).slice(0, 6).map((mid, j) => {
                          const midExpanded = expandedMid === mid.id;
                          const mdiam = midExpanded ? 150 : 122;
                          return (
                            <View key={mid.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", justifyContent: "center" }}>
                              <SnapBackDrag enabled={midExpanded} mergeDistance={18} onMerge={() => setExpandedMid(null)}>
                                <FloatingOrb
                                  seed={seed + 101}
                                  idx={idx * 13 + j}
                                  diameter={mdiam}
                                  bg={g.color}
                                  borderColor="rgba(255,255,255,0.25)"
                                  expanded={midExpanded}
                                  title={mid.title}
                                  subtitle={mid.weeklyHoursTarget ? `${mid.weeklyHoursTarget} hrs/wk` : "Milestone"}
                                  onPress={() => setExpandedMid((prev) => (prev === mid.id ? null : mid.id))}
                                />
                              </SnapBackDrag>

                              {midExpanded ? (
                                <View style={{ flex: 1, gap: 10 }}>
                                  {(mid.shorts || []).slice(0, 6).map((st) => (
                                    <SnapBackDrag key={st.id} enabled mergeDistance={12} onMerge={() => setExpandedMid(null)}>
                                      <FloatingOrb
                                        seed={seed + 907}
                                        idx={hashString(st.id)}
                                        diameter={94}
                                        bg={g.color}
                                        borderColor="rgba(255,255,255,0.35)"
                                        expanded
                                        title={st.title}
                                        subtitle="tap for tasks"
                                        onPress={() => setLeafPick({ longId: g.id, midId: mid.id, leafId: st.id })}
                                      />
                                    </SnapBackDrag>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </FloatingOrb>
                </SnapBackDrag>
              </View>
            );
          })}
        </View>

        {ltGoals.length === 0 && hydrated ? (
          <Text style={styles.subtle}>Start with the coach: add 1–3 long horizon goals + years.</Text>
        ) : null}
      </ScrollView>

      <Modal transparent visible={Boolean(leafPick)} animationType="fade" onRequestClose={() => setLeafPick(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLeafPick(null)}>
          <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.modalTitle}>Related tasks</Text>
              <Pressable hitSlop={10} onPress={() => setLeafPick(null)}>
                <Ionicons name="close" size={22} color={stylesVars.fgMuted} />
              </Pressable>
            </View>

            <Text style={[styles.subtle, { marginTop: 10 }]}>
              Heuristic matching from keywords in bubble titles (we can wire explicit task↔goal links next).
            </Text>

            <ScrollView style={{ marginTop: 12, maxHeight: 380 }}>
              {(() => {
                const lt = ltGoals.find((g) => g.id === leafPick?.longId);
                const mid = lt?.mids?.find((m) => m.id === leafPick?.midId);
                const leaf = mid?.shorts?.find((s) => s.id === leafPick?.leafId);
                const tasks = matchTasksForLeaf(state.tasks, leaf?.title, lt?.title);
                if (!tasks.length) return <Text style={styles.subtle}>No obvious matches.</Text>;
                return tasks.map((t) => (
                  <View key={t.id} style={styles.taskRow}>
                    <Text style={styles.taskTitle}>{t.title}</Text>
                    <Text style={styles.taskMeta}>{t.due ? `Due: ${String(t.due)}` : "No due date"}</Text>
                  </View>
                ));
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={chatOpen} animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setChatOpen(false)}>
          <Pressable style={[styles.modalBox, { maxHeight: "86%" }]} onPress={(e) => e.stopPropagation()}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.modalTitle}>Goal coach</Text>
              <Pressable hitSlop={10} onPress={() => setChatOpen(false)}>
                <Ionicons name="close" size={22} color={stylesVars.fgMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ marginTop: 12, marginBottom: 12, maxHeight: 420 }}>
              {chatMessages.map((m, i) => (
                <View key={i} style={{ marginBottom: 10 }}>
                  <Text style={[styles.role, m.role === "user" ? styles.roleUser : styles.roleAssist]}>
                    {m.role === "user" ? "You" : "Coach"}
                  </Text>
                  <Text style={styles.msg}>{m.content}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={chatBusy ? "Working…" : "Message"}
                editable={!chatBusy}
                value={chatText}
                onChangeText={setChatText}
              />
              <Pressable style={styles.sendBtn} onPress={sendChat} disabled={chatBusy}>
                <Ionicons name="arrow-up" size={18} color="#fff" />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: stylesVars.bg, paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 28, fontWeight: "900", letterSpacing: -0.3, color: stylesVars.fg },
  subtle: { color: stylesVars.fgMuted, fontSize: 12, lineHeight: 16, marginTop: 6 },

  chatFab: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  modalBox: {
    backgroundColor: stylesVars.card,
    borderWidth: 1,
    borderColor: stylesVars.border,
    borderRadius: 18,
    padding: 14,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  modalTitle: { color: stylesVars.fg, fontWeight: "900", fontSize: 16 },

  taskRow: {
    borderTopWidth: 1,
    borderTopColor: stylesVars.border,
    paddingVertical: 10,
  },
  taskTitle: { color: stylesVars.fg, fontWeight: "900", fontSize: 13 },
  taskMeta: { color: stylesVars.fgMuted, marginTop: 4, fontSize: 12 },

  input: {
    backgroundColor: stylesVars.card2,
    borderColor: stylesVars.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: stylesVars.fg,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  role: { fontSize: 11, fontWeight: "900", marginBottom: 4 },
  roleUser: { color: stylesVars.fg },
  roleAssist: { color: stylesVars.fgMuted },
  msg: { color: stylesVars.fg, fontWeight: "700", fontSize: 13, lineHeight: 18 },
});
