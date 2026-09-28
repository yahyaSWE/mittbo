import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { categories, formatDate, roleLabel, statusLabel, ticketNumber, type Category, type Dashboard, type Ticket, type TicketStatus } from "@mittbo/shared";

let API_BASE = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "android" ? "http://10.0.2.2:3002" : "http://localhost:3002")).replace(/\/$/, "");
const STORAGE_KEY = "mittbo_session";
const SERVER_KEY = "mittbo_server_url";
type MobileSession = { token: string; refreshToken: string };
let mobileSession: MobileSession | null = null;
let tokenListener: ((value: string) => void) | null = null;
let refreshPromise: Promise<boolean> | null = null;
const C = { navy: "#132c49", green: "#087d68", pale: "#eaf8f4", bg: "#f6f9fd", white: "#fff", text: "#172a43", muted: "#65768c", line: "#e0e8f1", orange: "#a95a1b" };
type Tab = "home" | "tickets" | "info";

async function parseResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try { payload = JSON.parse(raw); }
    catch { throw new Error(`API:t svarade med ogiltigt format (HTTP ${response.status}).`); }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "Något gick fel.";
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  if (payload === null) throw new Error(`API:t svarade utan data (HTTP ${response.status}).`);
  return payload as T;
}

async function refreshMobileSession(): Promise<boolean> {
  if (!mobileSession?.refreshToken) return false;
  if (!refreshPromise) refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/api/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: mobileSession?.refreshToken }) });
      const refreshed = await parseResponse<MobileSession>(response);
      mobileSession = refreshed;
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(refreshed));
      tokenListener?.(refreshed.token);
      return true;
    } catch { return false; }
    finally { refreshPromise = null; }
  })();
  return refreshPromise;
}

async function fetchWithSession(path: string, init: RequestInit, token?: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${mobileSession?.token || token}` } : {}) } });
    if (response.status === 401 && token && await refreshMobileSession()) {
      response = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${mobileSession?.token}` } });
    }
  } catch {
    throw new Error(`Kunde inte nå MittBo-servern (${API_BASE}). Kontrollera att webben körs och att telefonen når datorn.`);
  }
  return response;
}

async function request<T>(path: string, token?: string, body?: object): Promise<T> {
  const response = await fetchWithSession(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }, token);
  return parseResponse<T>(response);
}

async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) throw new Error("Bilden får vara högst 5 MB.");
  if (asset.mimeType && !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)) throw new Error("Välj en JPEG-, PNG- eller WebP-bild.");
  return asset;
}

async function sendImage(token: string, ticketId: string, asset: ImagePicker.ImagePickerAsset) {
  const info = asset.fileSize ? null : await FileSystem.getInfoAsync(asset.uri);
  const size = asset.fileSize || (info?.exists ? info.size : undefined);
  if (!size || size > 5 * 1024 * 1024) throw new Error("Bilden får vara högst 5 MB.");
  const type = asset.mimeType || "image/jpeg";
  const upload = await request<{ uploadId: string; signedUrl: string; filename: string; contentType: string; size: number }>(`/api/tickets/${ticketId}/attachments/init`, token, {
    filename: asset.fileName || "bild.jpg", contentType: type, size,
  });
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", { uri: asset.uri, name: asset.fileName || "bild.jpg", type } as unknown as Blob);
  const sent = await fetch(upload.signedUrl, { method: "PUT", body: form });
  if (!sent.ok) throw new Error(`Bilden kunde inte laddas upp till Supabase (HTTP ${sent.status}).`);
  await request(`/api/tickets/${ticketId}/attachments`, token, { uploadId: upload.uploadId, filename: upload.filename, contentType: upload.contentType, size: upload.size });
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [serverUrl, setServerUrl] = useState(API_BASE);

  useEffect(() => { tokenListener = setToken; return () => { tokenListener = null; }; }, []);

  const reload = useCallback(async (session: string) => {
    setData(await request<Dashboard>("/api/dashboard", session));
  }, []);
  useEffect(() => {
    (async () => {
      const savedUrl = await SecureStore.getItemAsync(SERVER_KEY);
      if (savedUrl && !process.env.EXPO_PUBLIC_API_URL) { API_BASE = savedUrl; setServerUrl(savedUrl); }
      const saved = await SecureStore.getItemAsync(STORAGE_KEY);
      if (saved) {
        try {
          const session = JSON.parse(saved) as MobileSession;
          if (!session.token || !session.refreshToken) throw new Error("Ogiltig session");
          mobileSession = session;
          await reload(session.token); setToken(mobileSession?.token || session.token);
        }
        catch { await SecureStore.deleteItemAsync(STORAGE_KEY); }
      }
      setBooting(false);
    })();
  }, [reload]);

  async function login(email: string, password: string, url: string) {
    setBusy(true); setError("");
    try {
      const normalized = url.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^/]+(?::\d+)?$/.test(normalized)) throw new Error("Ange en giltig serveradress, till exempel http://192.168.1.10:3002.");
      API_BASE = normalized;
      await SecureStore.setItemAsync(SERVER_KEY, normalized);
      setServerUrl(normalized);
      const response = await request<MobileSession>("/api/login", undefined, { email, password });
      mobileSession = response;
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(response));
      await reload(response.token);
      setToken(response.token);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() { mobileSession = null; await SecureStore.deleteItemAsync(STORAGE_KEY); setToken(null); setData(null); setSelectedId(null); setTab("home"); }
  async function act(path: string, body: object): Promise<boolean> {
    if (!token) return false;
    setBusy(true); setError("");
    try { await request(path, token, body); await reload(token); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function createTicket(body: object, image: ImagePicker.ImagePickerAsset | null) {
    if (!token) return;
    setBusy(true); setError("");
    try {
      const ticket = await request<Ticket>("/api/tickets", token, body);
      setCreating(false); setTab("tickets"); setSelectedId(ticket.id);
      if (image) await sendImage(token, ticket.id, image);
      await reload(token);
    } catch (cause) { setError((cause as Error).message); await reload(token); }
    finally { setBusy(false); }
  }
  async function addImage(ticketId: string) {
    if (!token) return;
    try {
      const image = await pickImage();
      if (!image) return;
      setBusy(true); setError("");
      await sendImage(token, ticketId, image);
      await reload(token);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  if (booting) return <SafeAreaView style={s.loading}><ActivityIndicator color={C.green} size="large" /><Text style={s.muted}>Öppnar MittBo…</Text></SafeAreaView>;
  if (!token || !data) return <Login busy={busy} error={error} serverUrl={serverUrl} onSubmit={login} />;
  const selected = data.tickets.find((ticket) => ticket.id === selectedId);
  const user = data.user;
  const title = creating ? "Ny felanmälan" : selected ? ticketNumber(selected.id) : tab === "tickets" ? user.role === "worker" ? "Mina uppdrag" : "Ärenden" : tab === "info" ? "Boendeinformation" : `Hej ${user.name.split(" ")[0]} 👋`;

  return <SafeAreaView style={s.safe}><StatusBar barStyle="dark-content" backgroundColor={C.white} /><View style={s.header}><Pressable onPress={() => { if (creating) setCreating(false); else if (selected) setSelectedId(null); else setTab("home"); }}><Text style={s.brand}>{selected || creating ? "‹  MittBo" : "⌂  MittBo"}</Text></Pressable><Pressable onPress={logout}><Text style={s.logout}>Logga ut</Text></Pressable></View><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.flex}><ScrollView style={s.flex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text style={s.eyebrow}>{roleLabel[user.role].toUpperCase()}</Text><Text style={s.h1}>{title}</Text>{!selected && !creating && <Text style={s.subtitle}>{user.role === "admin" ? "Överblick över dina fastigheter." : user.role === "worker" ? "Dagens uppdrag och uppdateringar." : "Här är din boendeöversikt."}</Text>}{error ? <Pressable style={s.error} onPress={() => setError("")}><Text style={s.errorText}>{error}  ×</Text></Pressable> : null}
    {creating ? <CreateTicket busy={busy} onCancel={() => setCreating(false)} onSave={createTicket} />
      : selected ? <TicketDetail ticket={selected} data={data} busy={busy} token={token} onImage={() => addImage(selected.id)} onAction={(body) => act(`/api/tickets/${selected.id}`, body)} />
      : tab === "home" ? <HomeView data={data} onTicket={setSelectedId} onCreate={() => setCreating(true)} onTab={setTab} />
      : tab === "tickets" ? <TicketsView data={data} onTicket={setSelectedId} onCreate={() => setCreating(true)} />
      : <InfoView data={data} />}
  </ScrollView></KeyboardAvoidingView>{!selected && !creating && <View style={s.tabs}><TabButton label="Hem" symbol="⌂" active={tab === "home"} onPress={() => setTab("home")} /><TabButton label={user.role === "worker" ? "Uppdrag" : "Ärenden"} symbol="▤" active={tab === "tickets"} onPress={() => setTab("tickets")} /><TabButton label="Information" symbol="◉" active={tab === "info"} onPress={() => setTab("info")} /></View>}</SafeAreaView>;
}

function Login({ busy, error, serverUrl, onSubmit }: { busy: boolean; error: string; serverUrl: string; onSubmit: (email: string, password: string, url: string) => Promise<void> }) {
  const [email, setEmail] = useState("emma@demo.mittbo.se");
  const [password, setPassword] = useState("MittBo2026!");
  const [server, setServer] = useState(serverUrl);
  return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.navy} /><ScrollView keyboardShouldPersistTaps="handled"><View style={s.loginHero}><Text style={s.loginLogo}>⌂  MittBo</Text><Text style={s.loginTitle}>Hela boendet.{"\n"}<Text style={{ color: "#91dfc4" }}>På ett ställe.</Text></Text><Text style={s.loginIntro}>Samma ärende från boende till förvaltare och arbetare.</Text></View><View style={s.loginBody}><Text style={s.h2}>Välkommen tillbaka</Text><Text style={s.muted}>Välj ett demokonto eller skriv dina uppgifter.</Text><Text style={s.label}>E-postadress</Text><TextInput autoCapitalize="none" keyboardType="email-address" style={s.input} value={email} onChangeText={setEmail} /><Text style={s.label}>Lösenord</Text><TextInput secureTextEntry style={s.input} value={password} onChangeText={setPassword} /><Text style={s.label}>Serveradress för test</Text><TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} value={server} onChangeText={setServer} /><Text style={s.muted}>Telefonen måste nå datorn på samma nätverk.</Text>{error ? <Text style={s.errorText}>{error}</Text> : null}<Action label={busy ? "Loggar in…" : "Logga in"} disabled={busy} onPress={() => void onSubmit(email.trim().toLowerCase(), password, server)} /><Text style={[s.label, { marginTop: 25 }]}>Prova en roll</Text><View style={s.roleButtons}>{[{ label: "Boende", email: "emma@demo.mittbo.se" }, { label: "Förvaltare", email: "admin@demo.mittbo.se" }, { label: "Arbetare", email: "arbetare@demo.mittbo.se" }].map((item) => <Pressable key={item.email} style={[s.roleButton, email === item.email && s.roleButtonActive]} onPress={() => setEmail(item.email)}><Text style={[s.roleText, email === item.email && { color: C.green }]}>{item.label}</Text></Pressable>)}</View><Text style={s.demo}>Lösenord för alla demokonton: MittBo2026!</Text></View></ScrollView></SafeAreaView>;
}

function HomeView({ data, onTicket, onCreate, onTab }: { data: Dashboard; onTicket: (id: string) => void; onCreate: () => void; onTab: (tab: Tab) => void }) {
  const { user } = data;
  const open = data.tickets.filter((ticket) => !["closed", "resolved"].includes(ticket.status));
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === user.unitId && unit.buildingId === item.id)) || data.buildings[0];
  return <><View style={s.statGrid}><Stat label={user.role === "tenant" ? "Mitt boende" : "Öppna ärenden"} value={user.role === "tenant" ? building?.name || "MittBo" : String(open.length)} symbol="⌂" /><Stat label={user.role === "worker" ? "Bokade besök" : "Aktiva ärenden"} value={String(user.role === "worker" ? open.filter((item) => item.visitAt).length : open.length)} symbol="▤" /><Stat label="Information" value={String(data.notices.length)} symbol="◉" /></View>{user.role === "tenant" && <View style={s.heroCard}><Text style={s.heroTitle}>Behöver du hjälp hemma?</Text><Text style={s.heroText}>Gör en felanmälan på några minuter och följ varje steg.</Text><Action label="Skapa felanmälan  →" onPress={onCreate} /></View>}<View style={s.sectionHeading}><Text style={s.h2}>{user.role === "worker" ? "Mina uppdrag" : user.role === "admin" ? "Senaste ärenden" : "Mina ärenden"}</Text><Pressable onPress={() => onTab("tickets")}><Text style={s.link}>Visa alla →</Text></Pressable></View>{data.tickets.slice(0, 4).map((ticket) => <TicketCard key={ticket.id} ticket={ticket} data={data} onPress={() => onTicket(ticket.id)} />)}{!data.tickets.length && <Empty text="Inga ärenden ännu." />}{data.notices.length > 0 && <><View style={s.sectionHeading}><Text style={s.h2}>Aktuellt</Text><Pressable onPress={() => onTab("info")}><Text style={s.link}>Visa alla →</Text></Pressable></View><View style={s.card}><Text style={s.cardTitle}>{data.notices[0].title}</Text><Text style={s.bodyText}>{data.notices[0].body}</Text></View></>}</>;
}

function TicketsView({ data, onTicket, onCreate }: { data: Dashboard; onTicket: (id: string) => void; onCreate: () => void }) {
  return <>{data.user.role === "tenant" && <Action label="＋  Ny felanmälan" onPress={onCreate} />}{data.tickets.length ? data.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} data={data} onPress={() => onTicket(ticket.id)} />) : <Empty text="Inga ärenden finns här ännu." />}</>;
}
function InfoView({ data }: { data: Dashboard }) {
  return <>{data.notices.map((notice) => <View style={s.card} key={notice.id}><Text style={s.cardSymbol}>◉</Text><Text style={s.cardTitle}>{notice.title}</Text><Text style={s.date}>{formatDate(notice.publishedAt)}</Text><Text style={s.bodyText}>{notice.body}</Text></View>)}{!data.notices.length && <Empty text="Ingen ny information." />}</>;
}

function TicketDetail({ ticket, data, busy, token, onImage, onAction }: { ticket: Ticket; data: Dashboard; busy: boolean; token: string; onImage: () => Promise<void>; onAction: (body: object) => Promise<boolean> }) {
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [visit, setVisit] = useState("");
  const role = data.user.role;
  const assignee = data.users.find((item) => item.id === ticket.assigneeId);
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === ticket.unitId && unit.buildingId === item.id));
  return <><View style={s.card}><View style={s.rowBetween}><Status status={ticket.status} /><Text style={s.date}>{formatDate(ticket.createdAt)}</Text></View><Text style={[s.cardTitle, { marginTop: 15 }]}>{ticket.title}</Text><Text style={s.bodyText}>{ticket.description}</Text><View style={s.divider} /><Field label="Plats" value={`${building?.address || ""}, ${data.units.find((item) => item.id === ticket.unitId)?.label || ""}`} /><Field label="Kategori" value={ticket.category} /><Field label="Ansvarig" value={assignee?.name || (ticket.assigneeId ? "Tilldelad" : "Inte tilldelad")} /><Field label="Besök" value={ticket.visitAt ? new Date(ticket.visitAt).toLocaleString("sv-SE") : "Ingen tid planerad"} />{ticket.attachments?.length > 0 && <><View style={s.divider} /><Text style={s.h2}>Bilder</Text><View style={s.photoRow}>{ticket.attachments.map((photo) => <Image key={photo.id} style={s.photo} source={{ uri: `${API_BASE}/api/attachments/${photo.id}`, headers: { Authorization: `Bearer ${token}` } }} />)}</View></>}<Action label="Lägg till bild" secondary disabled={busy} onPress={() => void onImage()} /></View>{role === "admin" && <View style={s.card}><Text style={s.h2}>Förvaltarens åtgärder</Text><Text style={s.label}>Tilldela arbetare</Text>{data.users.filter((user) => user.role === "worker").map((worker) => <Pressable key={worker.id} style={s.choice} disabled={busy} onPress={() => void onAction({ action: "assign", assigneeId: worker.id })}><Text style={s.choiceText}>{worker.name}{ticket.assigneeId === worker.id ? "  ✓" : ""}</Text></Pressable>)}<Text style={s.label}>Prioritet</Text><View style={s.roleButtons}>{["low", "normal", "high"].map((priority) => <Pressable key={priority} style={[s.roleButton, ticket.priority === priority && s.roleButtonActive]} disabled={busy} onPress={() => void onAction({ action: "priority", priority })}><Text style={s.roleText}>{priority === "low" ? "Låg" : priority === "high" ? "Hög" : "Normal"}</Text></Pressable>)}</View></View>}{role !== "tenant" && ticket.status !== "closed" && <View style={s.card}><Text style={s.h2}>Utför arbete</Text><Text style={s.label}>Besökstid (ÅÅÅÅ-MM-DD TT:MM)</Text><TextInput style={s.input} value={visit} onChangeText={setVisit} placeholder="2026-10-01 09:00" placeholderTextColor="#9db0be" /><Action label="Spara besökstid" secondary disabled={busy || !/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(visit)} onPress={() => { const value = new Date(visit.replace(" ", "T")); if (!Number.isNaN(value.getTime())) void onAction({ action: "visit", visitAt: value.toISOString() }); }} />{ticket.status !== "in_progress" && ticket.status !== "resolved" && <Action label="Starta arbete" secondary disabled={busy} onPress={() => void onAction({ action: "status", status: "in_progress" })} />}{ticket.status !== "resolved" && <Action label="Markera åtgärdat" disabled={busy} onPress={() => void onAction({ action: "status", status: "resolved" })} />}</View>}{role === "tenant" && ticket.status === "resolved" && <Action label="Bekräfta att det är klart" onPress={() => void onAction({ action: "status", status: "closed" })} />}<View style={s.card}><Text style={s.h2}>Händelser och meddelanden</Text>{ticket.events.map((event) => <View style={s.event} key={event.id}><View style={s.eventDot} /><View style={s.flex}><Text style={s.eventActor}>{data.users.find((user) => user.id === event.actorId)?.name || "MittBo"}{event.visibility === "internal" ? "  · Intern anteckning" : ""}</Text><Text style={s.bodyText}>{event.body}</Text><Text style={s.date}>{formatDate(event.createdAt)}</Text></View></View>)}<View style={s.divider} /><Text style={s.label}>Nytt meddelande</Text><TextInput style={[s.input, s.multiline]} multiline value={message} onChangeText={setMessage} placeholder="Skriv din uppdatering…" placeholderTextColor="#9db0be" />{role !== "tenant" && <Pressable style={s.checkRow} onPress={() => setInternal(!internal)}><Text style={s.checkBox}>{internal ? "☑" : "□"}</Text><Text style={s.muted}>Endast intern anteckning</Text></Pressable>}<Action label="Skicka meddelande  →" disabled={busy || !message.trim()} onPress={async () => { if (await onAction({ action: "message", text: message, visibility: internal ? "internal" : "public" })) setMessage(""); }} /></View></>;
}

function CreateTicket({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (body: object, image: ImagePicker.ImagePickerAsset | null) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("VVS");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [imageError, setImageError] = useState("");
  return <View style={s.card}><Text style={s.bodyText}>Beskriv vad som hänt, så får din hyresvärd rätt information från början.</Text><Text style={s.label}>Vad gäller det?</Text><TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={100} placeholder="Till exempel: Kökskran läcker" placeholderTextColor="#9db0be" /><Text style={s.label}>Kategori</Text><View style={s.categoryGrid}>{categories.map((item) => <Pressable key={item} style={[s.category, category === item && s.categoryActive]} onPress={() => setCategory(item)}><Text style={[s.roleText, category === item && { color: C.green }]}>{item}</Text></Pressable>)}</View><Text style={s.label}>Beskriv problemet</Text><TextInput style={[s.input, s.multiline]} multiline value={description} onChangeText={setDescription} maxLength={2000} placeholder="Vad händer och när märkte du problemet?" placeholderTextColor="#9db0be" /><Action label={image ? "Byt bild" : "Välj bild (valfritt)"} secondary onPress={async () => { try { setImageError(""); const picked = await pickImage(); if (picked) setImage(picked); } catch (cause) { setImageError((cause as Error).message); } }} />{image && <Text style={s.muted}>{image.fileName || "Bild vald"}</Text>}{imageError ? <Text style={s.errorText}>{imageError}</Text> : null}<Action label="Skicka felanmälan  →" disabled={busy || title.trim().length < 4 || description.trim().length < 8} onPress={() => void onSave({ title: title.trim(), category, description: description.trim() }, image)} /><Action label="Avbryt" secondary onPress={onCancel} /></View>;
}

function TicketCard({ ticket, data, onPress }: { ticket: Ticket; data: Dashboard; onPress: () => void }) {
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === ticket.unitId && unit.buildingId === item.id));
  return <Pressable style={s.ticketCard} onPress={onPress}><View style={s.rowBetween}><Text style={s.ticketNumber}>{ticketNumber(ticket.id)} · {ticket.category}</Text><Status status={ticket.status} /></View><Text style={s.cardTitle}>{ticket.title}</Text><Text style={s.bodyText} numberOfLines={2}>{ticket.description}</Text><View style={s.rowBetween}><Text style={s.date}>{building?.address || ""}</Text><Text style={s.link}>Öppna →</Text></View></Pressable>;
}

function Status({ status }: { status: TicketStatus }) { return <View style={[s.status, status === "resolved" || status === "closed" ? s.statusGreen : status === "waiting" ? s.statusOrange : null]}><Text style={[s.statusText, status === "resolved" || status === "closed" ? { color: C.green } : status === "waiting" ? { color: C.orange } : null]}>{statusLabel[status]}</Text></View>; }
function Stat({ label, value, symbol }: { label: string; value: string; symbol: string }) { return <View style={s.stat}><Text style={s.statSymbol}>{symbol}</Text><Text style={s.statLabel}>{label}</Text><Text style={s.statValue} numberOfLines={1}>{value}</Text></View>; }
function Action({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) { return <Pressable style={[s.action, secondary && s.actionSecondary, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}><Text style={[s.actionText, secondary && { color: C.green }]}>{label}</Text></Pressable>; }
function Field({ label, value }: { label: string; value: string }) { return <View style={s.field}><Text style={s.muted}>{label}</Text><Text style={s.fieldValue}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { return <View style={s.empty}><Text style={s.emptySymbol}>▤</Text><Text style={s.muted}>{text}</Text></View>; }
function TabButton({ label, symbol, active, onPress }: { label: string; symbol: string; active: boolean; onPress: () => void }) { return <Pressable style={s.tab} onPress={onPress}><Text style={[s.tabSymbol, active && { color: C.green }]}>{symbol}</Text><Text style={[s.tabLabel, active && { color: C.green, fontWeight: "800" }]}>{label}</Text></Pressable>; }

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: C.bg },
  header: { backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line, height: 57, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, brand: { fontSize: 22, fontWeight: "900", color: C.navy, letterSpacing: -1 }, logout: { color: C.muted, fontSize: 12, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 40 }, eyebrow: { color: C.green, fontWeight: "800", fontSize: 10, letterSpacing: 2, marginBottom: 8 }, h1: { color: C.text, fontSize: 27, fontWeight: "800", letterSpacing: -0.7 }, h2: { color: C.text, fontSize: 17, fontWeight: "800" }, subtitle: { color: C.muted, fontSize: 13, marginTop: 5, marginBottom: 23 }, muted: { color: C.muted, fontSize: 12 }, bodyText: { color: "#4d6278", fontSize: 13, lineHeight: 20, marginTop: 8 }, date: { color: C.muted, fontSize: 11 }, link: { color: C.green, fontWeight: "800", fontSize: 12 },
  tabs: { backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line, flexDirection: "row", paddingBottom: Platform.OS === "ios" ? 12 : 6, paddingTop: 6 }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabSymbol: { fontSize: 23, color: "#7c91a2" }, tabLabel: { fontSize: 10, color: "#7c91a2" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 2, marginBottom: 16 }, stat: { minWidth: "47%", flexGrow: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, minHeight: 110 }, statSymbol: { color: C.green, fontSize: 25 }, statLabel: { color: C.muted, fontSize: 11, marginTop: 6 }, statValue: { fontSize: 19, fontWeight: "800", color: C.text, marginTop: 4 },
  heroCard: { backgroundColor: "#e9f8f3", borderRadius: 13, padding: 19, marginBottom: 25 }, heroTitle: { color: C.text, fontSize: 18, fontWeight: "800" }, heroText: { color: "#4e6d69", fontSize: 13, lineHeight: 20, marginTop: 5, marginBottom: 14 }, sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, marginBottom: 12 },
  card: { backgroundColor: C.white, borderRadius: 13, borderWidth: 1, borderColor: C.line, padding: 18, marginBottom: 12 }, cardTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginTop: 6 }, cardSymbol: { fontSize: 24, color: C.green }, ticketCard: { backgroundColor: C.white, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 15, marginBottom: 10, gap: 5 }, ticketNumber: { color: C.muted, fontSize: 11, fontWeight: "700" }, rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  status: { backgroundColor: "#edf1ff", borderRadius: 100, paddingVertical: 4, paddingHorizontal: 9 }, statusGreen: { backgroundColor: "#e5f6ef" }, statusOrange: { backgroundColor: "#fff1df" }, statusText: { color: "#5566a4", fontSize: 10, fontWeight: "800" }, divider: { height: 1, backgroundColor: C.line, marginVertical: 14 }, field: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, gap: 16 }, fieldValue: { color: C.text, fontWeight: "700", fontSize: 12, flexShrink: 1, textAlign: "right" },
  action: { marginTop: 10, minHeight: 46, backgroundColor: C.green, alignItems: "center", justifyContent: "center", borderRadius: 9, paddingHorizontal: 13 }, actionSecondary: { backgroundColor: C.white, borderWidth: 1, borderColor: "#b9ddd2" }, actionText: { color: C.white, fontWeight: "800", fontSize: 13 }, label: { color: C.text, fontSize: 12, fontWeight: "700", marginTop: 17, marginBottom: 7 }, input: { backgroundColor: C.white, color: C.text, borderWidth: 1, borderColor: "#d6e2e9", borderRadius: 8, minHeight: 43, paddingHorizontal: 12, fontSize: 13 }, multiline: { minHeight: 92, textAlignVertical: "top", paddingVertical: 11 }, categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, category: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: C.line }, categoryActive: { backgroundColor: C.pale, borderColor: "#abdbca" }, roleText: { color: C.muted, fontSize: 11, fontWeight: "700" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }, photo: { width: 100, height: 90, borderRadius: 8 },
  choice: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 11, marginTop: 5 }, choiceText: { color: C.text, fontSize: 12, fontWeight: "700" }, roleButtons: { flexDirection: "row", gap: 7 }, roleButton: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 9 }, roleButtonActive: { backgroundColor: C.pale, borderColor: "#abdbca" }, event: { flexDirection: "row", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eef2f5" }, eventDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.green, marginTop: 4 }, eventActor: { fontWeight: "800", fontSize: 12, color: C.text }, checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 }, checkBox: { fontSize: 19, color: C.green },
  empty: { alignItems: "center", padding: 30, gap: 8 }, emptySymbol: { color: "#abc0cf", fontSize: 30 }, error: { padding: 12, backgroundColor: "#ffefeb", borderRadius: 8, marginTop: 14, marginBottom: 9 }, errorText: { color: "#a54234", fontSize: 12, lineHeight: 17 },
  loginHero: { backgroundColor: C.navy, minHeight: 280, padding: 28, justifyContent: "space-between" }, loginLogo: { color: C.white, fontSize: 26, fontWeight: "900" }, loginTitle: { color: C.white, fontSize: 34, lineHeight: 40, fontWeight: "900" }, loginIntro: { color: "#c8dfeb", fontSize: 13, lineHeight: 19 }, loginBody: { padding: 23 }, demo: { color: C.muted, fontSize: 11, marginTop: 13 },
});
