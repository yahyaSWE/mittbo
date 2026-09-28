"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, CheckCircle2, ClipboardList, Clock3, DoorOpen, Home, LogOut, MessageCircle, Plus, Search, Send, ShieldCheck, UserRound, Wrench } from "lucide-react";
import { categories, formatDate, roleLabel, statusLabel, ticketNumber, type Category, type Dashboard, type Ticket, type TicketStatus } from "@mittbo/shared";

type Screen = "overview" | "tickets" | "information" | "buildings";
const demoAccounts = [
  { label: "Boende", email: "emma@demo.mittbo.se", icon: Home },
  { label: "Förvaltare", email: "admin@demo.mittbo.se", icon: Building2 },
  { label: "Arbetare", email: "arbetare@demo.mittbo.se", icon: Wrench },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try { body = JSON.parse(raw); }
    catch { throw new Error(`API:t svarade med ogiltigt format (HTTP ${response.status}).`); }
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Något gick fel.";
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  if (body === null) throw new Error(`API:t svarade utan data (HTTP ${response.status}).`);
  return body as T;
}

function Status({ status }: { status: TicketStatus }) {
  return <span className={`status status-${status}`}>{statusLabel[status]}</span>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Home size={22} strokeWidth={3} /></span><span>MittBo</span></div>;
}

export default function Page() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setData(await api<Dashboard>("/api/dashboard")); }
    catch { setData(null); }
    finally { setBooting(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const selected = data?.tickets.find((ticket) => ticket.id === selectedId) || null;
  const visibleTickets = useMemo(() => data?.tickets.filter((ticket) => `${ticket.title} ${ticket.category} ${ticketNumber(ticket.id)}`.toLowerCase().includes(search.toLowerCase())) || [], [data, search]);

  async function mutate(url: string, body: object) {
    setBusy(true); setError("");
    try { await api(url, { method: "POST", body: JSON.stringify(body) }); await refresh(); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function createTicket(body: object, file: File | null) {
    setBusy(true); setError("");
    try {
      if (file && (file.size < 1 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
        throw new Error("Välj en JPEG-, PNG- eller WebP-bild på högst 5 MB.");
      }
      const ticket = await api<Ticket>("/api/tickets", { method: "POST", body: JSON.stringify(body) });
      setCreateOpen(false); setScreen("tickets"); setSelectedId(ticket.id);
      if (file) {
        const upload = await api<{ uploadId: string; signedUrl: string; filename: string; contentType: string; size: number }>(`/api/tickets/${ticket.id}/attachments/init`, {
          method: "POST", body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
        });
        const form = new FormData(); form.append("cacheControl", "3600"); form.append("", file);
        const sent = await fetch(upload.signedUrl, { method: "PUT", body: form });
        if (!sent.ok) throw new Error(`Bilden kunde inte laddas upp till Supabase (HTTP ${sent.status}).`);
        await api(`/api/tickets/${ticket.id}/attachments`, { method: "POST", body: JSON.stringify({ uploadId: upload.uploadId, filename: upload.filename, contentType: upload.contentType, size: upload.size }) });
      }
      await refresh();
    } catch (cause) { setError((cause as Error).message); await refresh(); }
    finally { setBusy(false); }
  }

  async function logout() { await api("/api/logout", { method: "POST" }); setData(null); setSelectedId(null); setScreen("overview"); }

  if (booting) return <div className="boot"><Brand /><p>Öppnar ditt boende…</p></div>;
  if (!data) return <Login onLogin={refresh} />;

  const { user } = data;
  const role = user.role;
  const nav: { key: Screen; label: string; icon: typeof Home }[] = [
    { key: "overview", label: "Översikt", icon: Home },
    { key: "tickets", label: role === "worker" ? "Mina uppdrag" : "Ärenden", icon: ClipboardList },
    { key: "information", label: "Boendeinformation", icon: Bell },
    ...(role === "admin" ? [{ key: "buildings" as Screen, label: "Fastigheter", icon: Building2 }] : []),
  ];
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === user.unitId && unit.buildingId === item.id)) || data.buildings[0];
  const active = data.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-caption">{role === "admin" ? "KONTROLLCENTER" : role === "worker" ? "ARBETSYTA" : "MITT BOENDE"}</div>
      <nav className="nav-list" aria-label="Huvudmeny">{nav.map((item) => <button key={item.key} className={`nav-item ${screen === item.key && !selected ? "active" : ""}`} onClick={() => { setScreen(item.key); setSelectedId(null); }}><item.icon size={19} /><span>{item.label}</span>{item.key === "tickets" && active.length > 0 && <span className="nav-count">{active.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="side-user"><span className="avatar">{user.name[0]}</span><span><strong>{user.name}</strong><small>{roleLabel[role]}</small></span></div><button className="logout" onClick={logout}><LogOut size={17} /> Logga ut</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="mobile-brand"><Brand /></div><div className="top-location"><Building2 size={18} /><span>{building?.name || "MittBo"}<small>{building?.address}</small></span></div><span className="top-role"><ShieldCheck size={16} /> {roleLabel[role]}</span><span className="avatar small">{user.name[0]}</span></header>
      <div className="page-content">
        {error && <div className="alert" role="alert"><AlertCircle size={18} />{error}<button onClick={() => setError("")}>Stäng</button></div>}
        {selected ? <TicketDetail ticket={selected} data={data} busy={busy} onBack={() => setSelectedId(null)} onAction={(body) => mutate(`/api/tickets/${selected.id}`, body)} />
          : screen === "overview" ? <>
            <div className="heading-row"><div><p className="eyebrow">{role === "admin" ? "KONTROLLCENTER" : role === "worker" ? "DINA UPPDRAG" : "VÄLKOMMEN HEM"}</p><h1>Hej {user.name.split(" ")[0]} <span className="wave">👋</span></h1><p className="subheading">{role === "admin" ? "Här är läget i dina fastigheter idag." : role === "worker" ? "Här ser du vad som behöver göras." : "Här är en översikt över ditt boende."}</p></div>{role === "tenant" && <button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={18} /> Ny felanmälan</button>}</div>
            {role === "admin" ? <AdminOverview data={data} onTicket={setSelectedId} onAll={() => setScreen("tickets")} /> : role === "worker" ? <WorkerOverview data={data} onTicket={setSelectedId} /> : <TenantOverview data={data} buildingName={building?.name} onTicket={setSelectedId} onCreate={() => setCreateOpen(true)} onAll={() => setScreen("tickets")} />}
          </> : screen === "tickets" ? <>
            <div className="heading-row"><div><p className="eyebrow">{role === "worker" ? "ARBETSLISTA" : "ÄRENDEN"}</p><h1>{role === "worker" ? "Mina uppdrag" : role === "admin" ? "Ärendehantering" : "Mina ärenden"}</h1><p className="subheading">{role === "admin" ? "Följ, prioritera och fördela inkommande ärenden." : "Följ uppdateringar och se nästa steg."}</p></div>{role === "tenant" && <button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={18} /> Ny felanmälan</button>}</div>
            <div className="search-box"><Search size={19} /><input aria-label="Sök ärenden" placeholder="Sök ärende, nummer eller kategori" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="card ticket-list">{visibleTickets.length ? visibleTickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} data={data} onClick={() => setSelectedId(ticket.id)} />) : <Empty text="Inga ärenden matchar din sökning." />}</div>
          </> : screen === "information" ? <>
            <div className="heading-row"><div><p className="eyebrow">FASTIGHETEN</p><h1>Boendeinformation</h1><p className="subheading">Aktuellt från din fastighet.</p></div></div><div className="info-grid">{data.notices.map((notice) => <article className="card notice-card" key={notice.id}><span className="icon-disc green"><Bell size={22} /></span><small>{formatDate(notice.publishedAt)}</small><h2>{notice.title}</h2><p>{notice.body}</p></article>)}</div>
          </> : <><div className="heading-row"><div><p className="eyebrow">ORGANISATION</p><h1>Fastigheter</h1><p className="subheading">Fastigheter och boenden i demomiljön.</p></div></div><div className="info-grid">{data.buildings.map((item) => <article className="card notice-card" key={item.id}><span className="icon-disc green"><Building2 size={22} /></span><h2>{item.name}</h2><p>{item.address}</p><span className="muted">{data.units.filter((unit) => unit.buildingId === item.id).length} boendeenheter</span></article>)}</div></>}
      </div>
      <div className="mobile-nav">{nav.slice(0, 3).map((item) => <button key={item.key} className={screen === item.key ? "active" : ""} onClick={() => { setScreen(item.key); setSelectedId(null); }}><item.icon size={21} /><span>{item.label}</span></button>)}</div>
    </main>
    {createOpen && <CreateTicket busy={busy} onClose={() => setCreateOpen(false)} onSave={createTicket} />}
  </div>;
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState("MittBo2026!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }); await onLogin(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-intro"><Brand /><div><p className="eyebrow">ENKLARE FÖR HYRESGÄSTEN · SMARTARE FÖR FÖRVALTAREN</p><h1>Hela boendet.<br /><em>På ett ställe.</em></h1><p>Följ ditt ärende från första felanmälan till färdig åtgärd. En enkel vardag för boende, förvaltare och arbetare.</p></div><div className="login-feature"><span className="icon-disc green"><CheckCircle2 size={22} /></span><span><strong>En sammanhängande upplevelse</strong><small>Webb och mobil delar samma ärenden och uppdateringar.</small></span></div></div><div className="login-side"><form className="login-card" onSubmit={submit}><span className="icon-disc green"><DoorOpen size={24} /></span><h2>Välkommen till MittBo</h2><p>Logga in för att öppna din översikt.</p><label>E-postadress<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Lösenord<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<button className="button primary full" disabled={busy}>{busy ? "Loggar in…" : "Logga in"}<ArrowRight size={18} /></button><div className="demo-select"><small>Prova en roll</small><div>{demoAccounts.map((account) => <button type="button" key={account.email} className={email === account.email ? "selected" : ""} onClick={() => setEmail(account.email)}><account.icon size={17} />{account.label}</button>)}</div></div><p className="demo-note">Demokonton använder lösenordet <strong>MittBo2026!</strong></p></form></div></div>;
}

function Metric({ icon: Icon, label, value, note, color = "green" }: { icon: typeof Home; label: string; value: string; note: string; color?: string }) {
  return <div className="metric card"><span className={`icon-disc ${color}`}><Icon size={22} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function AdminOverview({ data, onTicket, onAll }: { data: Dashboard; onTicket: (id: string) => void; onAll: () => void }) {
  const open = data.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  return <><div className="metric-grid"><Metric icon={ClipboardList} label="Öppna ärenden" value={String(open.length)} note="Behöver följas upp" /><Metric icon={AlertCircle} label="Hög prioritet" value={String(open.filter((ticket) => ticket.priority === "high").length)} note="Prioritera dessa först" color="orange" /><Metric icon={UserRound} label="Ej tilldelade" value={String(open.filter((ticket) => !ticket.assigneeId).length)} note="Väntar på ansvarig" color="purple" /><Metric icon={CheckCircle2} label="Åtgärdade" value={String(data.tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length)} note="Klart för uppföljning" color="blue" /></div><div className="overview-grid"><section className="card panel"><div className="panel-heading"><div><h2>Senaste ärenden</h2><p>Allt som händer i din fastighet</p></div><button className="text-button" onClick={onAll}>Visa alla <ArrowRight size={16} /></button></div>{data.tickets.slice(0, 5).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} data={data} onClick={() => onTicket(ticket.id)} />)}{!data.tickets.length && <Empty text="Inga ärenden ännu." />}</section><section className="card panel"><div className="panel-heading"><div><h2>Planerat arbete</h2><p>Kommande besök i ärenden</p></div><CalendarDays size={20} /></div>{data.tickets.filter((ticket) => ticket.visitAt).slice(0, 4).map((ticket) => <button className="compact-row" onClick={() => onTicket(ticket.id)} key={ticket.id}><span className="icon-disc blue"><CalendarDays size={18} /></span><span><strong>{ticket.title}</strong><small>{ticket.visitAt && formatDate(ticket.visitAt)}</small></span><ArrowRight size={16} /></button>)}{!data.tickets.some((ticket) => ticket.visitAt) && <Empty text="Inga besök är planerade än." />}</section></div></>;
}

function TenantOverview({ data, buildingName, onTicket, onCreate, onAll }: { data: Dashboard; buildingName?: string; onTicket: (id: string) => void; onCreate: () => void; onAll: () => void }) {
  const active = data.tickets.filter((ticket) => ticket.status !== "closed");
  return <><div className="metric-grid tenant-metrics"><Metric icon={Home} label="Mitt boende" value={buildingName || "MittBo"} note={data.units.find((unit) => unit.id === data.user.unitId)?.label || ""} /><Metric icon={ClipboardList} label="Aktiva ärenden" value={String(active.length)} note="Följ status och svar" color="purple" /><Metric icon={Bell} label="Aktuellt" value={String(data.notices.length)} note="Meddelanden från värden" color="orange" /></div><div className="overview-grid"><section className="card panel"><div className="panel-heading"><div><h2>Mina ärenden</h2><p>Du ser alltid vad som händer</p></div><button className="text-button" onClick={onAll}>Visa alla <ArrowRight size={16} /></button></div>{data.tickets.slice(0, 5).map((ticket) => <TicketRow key={ticket.id} ticket={ticket} data={data} onClick={() => onTicket(ticket.id)} />)}{!data.tickets.length && <Empty text="Du har inga ärenden ännu." />}<button className="button secondary panel-action" onClick={onCreate}><Plus size={18} /> Skapa felanmälan</button></section><section className="card panel"><div className="panel-heading"><div><h2>Aktuellt i fastigheten</h2><p>Information från din hyresvärd</p></div><Bell size={20} /></div>{data.notices.map((notice) => <div className="notice-row" key={notice.id}><span className="icon-disc blue"><Bell size={17} /></span><div><strong>{notice.title}</strong><small>{formatDate(notice.publishedAt)}</small><p>{notice.body}</p></div></div>)}</section></div></>;
}

function WorkerOverview({ data, onTicket }: { data: Dashboard; onTicket: (id: string) => void }) {
  const active = data.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  return <><div className="metric-grid tenant-metrics"><Metric icon={Wrench} label="Mina uppdrag" value={String(active.length)} note="Tilldelade till dig" /><Metric icon={CalendarDays} label="Bokade besök" value={String(active.filter((ticket) => ticket.visitAt).length)} note="Planerade tider" color="blue" /><Metric icon={CheckCircle2} label="Åtgärdade" value={String(data.tickets.filter((ticket) => ticket.status === "resolved").length)} note="Väntar på avslut" color="purple" /></div><section className="card panel wide-panel"><div className="panel-heading"><div><h2>Uppdrag att ta hand om</h2><p>Öppna ett uppdrag för att rapportera arbete</p></div></div>{active.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} data={data} onClick={() => onTicket(ticket.id)} />)}{!active.length && <Empty text="Du har inga öppna uppdrag." />}</section></>;
}

function TicketRow({ ticket, data, onClick }: { ticket: Ticket; data: Dashboard; onClick: () => void }) {
  const tenant = data.users.find((item) => item.id === ticket.tenantId);
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === ticket.unitId && unit.buildingId === item.id));
  return <button className="ticket-row" onClick={onClick}><span className="ticket-icon"><Wrench size={20} /></span><span className="ticket-main"><strong>{ticket.title}</strong><small>{ticketNumber(ticket.id)} · {ticket.category} · {data.user.role === "admin" ? `${tenant?.name || "Boende"} · ` : ""}{building?.address || ""}</small></span><Status status={ticket.status} /><ArrowRight className="row-arrow" size={17} /></button>;
}

function TicketDetail({ ticket, data, busy, onBack, onAction }: { ticket: Ticket; data: Dashboard; busy: boolean; onBack: () => void; onAction: (body: object) => Promise<boolean> }) {
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [visit, setVisit] = useState("");
  const role = data.user.role;
  const assignee = data.users.find((item) => item.id === ticket.assigneeId);
  const building = data.buildings.find((item) => data.units.some((unit) => unit.id === ticket.unitId && unit.buildingId === item.id));
  async function sendMessage(event: React.FormEvent) { event.preventDefault(); if (await onAction({ action: "message", text: message, visibility: internal ? "internal" : "public" })) setMessage(""); }
  return <><button className="back" onClick={onBack}><ArrowLeft size={18} /> Tillbaka till ärenden</button><div className="heading-row detail-title"><div><p className="eyebrow">ÄRENDE {ticketNumber(ticket.id)}</p><h1>{ticket.title}</h1><p className="subheading">{building?.address} · {data.units.find((unit) => unit.id === ticket.unitId)?.label} · Skapat {formatDate(ticket.createdAt)}</p></div><Status status={ticket.status} /></div><div className="detail-grid"><div className="detail-main"><section className="card panel"><h2>Beskrivning</h2><p className="detail-description">{ticket.description}</p><div className="detail-chips"><span>{ticket.category}</span><span>Prioritet: {ticket.priority === "high" ? "Hög" : ticket.priority === "low" ? "Låg" : "Normal"}</span></div>{ticket.attachments?.length > 0 && <div className="attachment-list"><h3>Bilder</h3>{ticket.attachments.map((image) => <a key={image.id} href={`/api/attachments/${image.id}`} target="_blank" rel="noreferrer"><img src={`/api/attachments/${image.id}`} alt={image.filename} /><span>{image.filename}</span></a>)}</div>}</section><section className="card panel"><div className="panel-heading"><div><h2>Händelser och meddelanden</h2><p>Följ ärendet från början till slut</p></div><MessageCircle size={20} /></div><div className="timeline">{ticket.events.map((event) => <div className="timeline-item" key={event.id}><span className={`timeline-dot ${event.kind}`} /><div><div className="event-head"><strong>{data.users.find((item) => item.id === event.actorId)?.name || "MittBo"}</strong>{event.visibility === "internal" && <span className="internal-badge">Intern anteckning</span>}<small>{formatDate(event.createdAt)}</small></div><p>{event.body}</p></div></div>)}</div><form className="message-form" onSubmit={sendMessage}><label htmlFor="message">Nytt meddelande</label><textarea id="message" placeholder="Skriv en uppdatering…" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} required />{role !== "tenant" && <label className="checkbox"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Endast intern anteckning</label>}<button className="button primary" disabled={busy || !message.trim()}><Send size={17} /> Skicka</button></form></section></div><div className="detail-side"><section className="card panel"><h2>Nästa steg</h2><div className="detail-field"><span>Ansvarig</span><strong>{assignee?.name || (ticket.assigneeId ? "Tilldelad" : "Inte tilldelad")}</strong></div><div className="detail-field"><span>Besök</span><strong>{ticket.visitAt ? new Date(ticket.visitAt).toLocaleString("sv-SE") : "Ingen tid planerad"}</strong></div>{role === "admin" && <><label className="form-label">Tilldela arbetare<select value={ticket.assigneeId || ""} onChange={(event) => { if (event.target.value) void onAction({ action: "assign", assigneeId: event.target.value }); }} disabled={busy}><option value="">Välj arbetare</option>{data.users.filter((item) => item.role === "worker").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-label">Prioritet<select value={ticket.priority} onChange={(event) => void onAction({ action: "priority", priority: event.target.value })} disabled={busy}><option value="low">Låg</option><option value="normal">Normal</option><option value="high">Hög</option></select></label></>}{role !== "tenant" && <><label className="form-label">Planera besök<input type="datetime-local" value={visit} onChange={(event) => setVisit(event.target.value)} /></label><button className="button secondary full" disabled={!visit || busy} onClick={() => void onAction({ action: "visit", visitAt: new Date(visit).toISOString() })}>Spara besökstid</button></>}{role !== "tenant" && ticket.status !== "closed" && <div className="status-actions">{ticket.status !== "in_progress" && ticket.status !== "resolved" && <button className="button secondary full" disabled={busy} onClick={() => void onAction({ action: "status", status: "in_progress" })}>Starta arbete</button>}{ticket.status !== "resolved" && <button className="button primary full" disabled={busy} onClick={() => void onAction({ action: "status", status: "resolved" })}>Markera åtgärdat</button>}</div>}{role === "tenant" && ticket.status === "resolved" && <button className="button primary full" disabled={busy} onClick={() => void onAction({ action: "status", status: "closed" })}>Bekräfta att det är klart</button>}</section></div></div></>;
}

function CreateTicket({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (body: object, file: File | null) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("VVS");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><span className="icon-disc green"><Wrench size={23} /></span><button onClick={onClose} aria-label="Stäng">×</button></div><h2 id="create-title">Skapa en felanmälan</h2><p>Beskriv vad som hänt så kan vi hjälpa dig vidare.</p><form onSubmit={(event) => { event.preventDefault(); void onSave({ title, category, description }, file); }}><label>Rubrik<input autoFocus required minLength={4} maxLength={100} placeholder="Till exempel: Kökskran läcker" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Kategori<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Beskrivning<textarea required minLength={8} maxLength={2000} placeholder="Berätta vad som händer och när du märkte problemet." value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Bild (valfritt, högst 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Avbryt</button><button className="button primary" disabled={busy}>Skicka felanmälan <ArrowRight size={17} /></button></div></form></div></div>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><Clock3 size={25} /><p>{text}</p></div>; }
