import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Anchor, ArrowUpRight, Moon, Sun } from "lucide-react";
import RestExchangePanel from "../RestExchangePanel.jsx";
import VacationExchangePanel from "../VacationExchangePanel.jsx";
import { session, descansos, vacaciones } from "./client.js";
import "../styles.css";
import "../exchangeRedesign.css";
import "./preview.css";

function Preview() {
  const version = new URLSearchParams(location.search).get("version") === "b" ? "b" : "a";
  const [section, setSection] = useState("rest");
  const [dark, setDark] = useState(false);
  const [info, setInfo] = useState("");
  useEffect(() => {
    const showChat = () => { setInfo("La conversación mantiene su funcionamiento en la app. Esta demostración solo permite revisar el diseño de los intercambios."); history.replaceState(null, "", location.pathname + location.search); };
    window.addEventListener("hashchange", showChat);
    return () => window.removeEventListener("hashchange", showChat);
  }, []);
  return <div className="design-page" data-design={version} onClickCapture={(event) => {
    if (event.target.closest('a[href^="https://portal."]')) {
      event.preventDefault();
      setInfo("En la app este enlace abre el portal oficial. En esta demostración no se tramita ninguna solicitud.");
    }
  }}>
    <header className="design-top"><a className="design-brand" href={`?version=${version}`}><Anchor size={25}/><span>App CPE<small>ENTRE COMPAÑEROS</small></span></a><span className="design-badge">Vista previa · sin datos reales</span><button className="design-theme" aria-label="Cambiar tema" onClick={() => { setDark(!dark); document.documentElement.dataset.theme = !dark ? "dark" : "light"; }}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button></header>
    <main className="design-main">
      <div className="design-review"><div><span>PROPUESTA {version.toUpperCase()} / 02</span><h1>{version === "a" ? "Marea" : "Agenda"}</h1><p>{version === "a" ? "Más visual. Más cercana. Todo a primera vista." : "Orden, espacio y una lectura más directa."}</p></div><a href={`?version=${version === "a" ? "b" : "a"}`}>Ver propuesta {version === "a" ? "B" : "A"} <ArrowUpRight size={16}/></a></div>
      <nav className="design-sections" aria-label="Sección de la app"><button aria-pressed={section === "rest"} onClick={() => setSection("rest")}>Descansos</button><button aria-pressed={section === "vacation"} onClick={() => setSection("vacation")}>Vacaciones</button></nav>
      {section === "rest" ? <RestExchangePanel session={session} descansos={descansos} vacaciones={{ rows: [] }}/> : <VacationExchangePanel session={session} vacaciones={vacaciones}/>}
      <footer className="design-footer">Prueba Tablón, Publicar y Mis Ofertas. Los nombres y fechas son ficticios.<br/>Esta propuesta cambia solo la presentación. No envía solicitudes ni modifica producción.</footer>
      {info && <div className="design-message" role="status">{info}<button onClick={() => setInfo("")}>Entendido</button></div>}
    </main>
  </div>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
