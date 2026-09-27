import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Clock3 } from "lucide-react";
import RestExchangePanel from "../RestExchangePanel.jsx";
import VacationExchangePanel from "../VacationExchangePanel.jsx";
import { AppHeader, BottomNav, ContactFooter, PortalCalendarPreview, PortalVacationPreview } from "./AppContext.jsx";
import { session, descansos, vacaciones } from "./client.js";
import "../styles.css";
import "../exchangeRedesign.css";
import "./preview.css";
function Preview() {
 const version = new URLSearchParams(location.search).get("version") === "b" ? "b" : "a";
 const [section, setSection] = useState("descansos");
 const [selectedRest, setSelectedRest] = useState(null);
 const [selectedVacation, setSelectedVacation] = useState(null);
 const [info, setInfo] = useState("");
 const rests = section === "descansos";
 const navigate = id => {
  if (["descansos", "vacaciones"].includes(id)) { setSection(id); window.scrollTo(0, 0); }
  else setInfo("Esta vista previa incluye Descansos y Vacaciones. El resto de la app no se modifica.");
 };
 return <div className="mobile-app contextual-preview" data-design={version} onClickCapture={event => {
  if (event.target.closest('a[href^="https://portal."]')) { event.preventDefault(); setInfo("Vista previa: no se tramitan solicitudes en el portal oficial."); }
 }}>
  <AppHeader onMenuOpen={() => setInfo("Cambia entre Descansos y Vacaciones desde la barra inferior.")} onNotificationsOpen={() => setInfo("La demostración no incluye notificaciones reales.")}/>
  <main className="content">
   <aside className="preview-switch"><span>Vista previa {version.toUpperCase()} · Datos de ejemplo</span><a href={`?version=${version === "a" ? "b" : "a"}`}>Ver versión {version === "a" ? "B" : "A"}</a><a href="#tablon">Ir al tablón ↓</a></aside>
   <section className="page-panel portal-panel">
    <div className="section-heading"><p>{rests ? "Calendario personal" : "Planificación"}</p><h1>{rests ? "Descansos" : "Vacaciones"}</h1></div>
    <div className="portal-results">
     <section className="portal-sync-card" aria-label="Última sincronización"><Clock3 size={13}/><span>Última sincronización ·</span><time>15:02</time></section>
     <div className="portal-scroll-anchor">{rests
      ? <PortalCalendarPreview descansos={descansos} vacaciones={vacaciones} onDaySelect={setSelectedRest} selectedDay={selectedRest}/>
      : <PortalVacationPreview vacaciones={vacaciones} onDaySelect={setSelectedVacation} selectedDay={selectedVacation}/>}</div>
     <div id="tablon">{rests
      ? <RestExchangePanel session={session} descansos={descansos} vacaciones={vacaciones} selectedDay={selectedRest}/>
      : <VacationExchangePanel session={session} vacaciones={vacaciones} selectedDay={selectedVacation}/>}</div>
    </div>
   </section><ContactFooter/>
  </main>
  <BottomNav activeTab={section} onChange={navigate}/>
  {info && <div className="design-message" role="status">{info}<button onClick={() => setInfo("")}>Entendido</button></div>}
 </div>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
