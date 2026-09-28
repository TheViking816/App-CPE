import { mergeNorayJornales, norayPremium } from "./noray-jornales.js";

export function mapNorayJournalRows(base = [], vigente = [], { premiums = false } = {}) {
  return mergeNorayJornales(base, vigente).map((row) => {
    const premium = premiums ? norayPremium(row?.liquidacion) : null;
    const production = premium
      ? premium.amount.toFixed(2).replace(".", ",")
      : "";
    return {
      jornal: String(row?.numero ?? ""),
      parte: String(row?.parte ?? ""),
      dia: String(row?.dia ?? row?.fecha ?? "").match(/\d{1,2}$/)?.[0] || "",
      tipo: String(row?.tipo ?? ""),
      jornada: String(row?.jornada ?? ""),
      especialidad: String(row?.especialidad ?? ""),
      empresa: String(row?.empresa ?? ""),
      buque: String(row?.buque ?? ""),
      operacion: String(row?.operacion ?? ""),
      produccion: production,
      produccionEstado: premium?.status || "unknown"
    };
  }).filter((row) => row.parte && row.dia);
}

export function mapNorayRequestedDoubles(calendar, dates, journeys = []) {
  if (!Array.isArray(calendar?.dias)) throw new Error("Calendario de dobles incompleto");
  const dateSet = new Set(dates);
  const journeyById = new Map(journeys.map((item) => [String(item.id), String(item.nombre || "")]));
  const specialtyById = { "01": "CAPATAZ", "02": "CLASIFICADOR", "03": "ESPECIALISTA", "10": "TRINCADOR", "11": "CONDUCTOR 1a", "12": "CONDUCTOR 2a", "15": "MAFIS", "19": "CONTAINER", "20": "ELEVADORAS", "22": "TRASTAINERS RTT", "23": "SOBORDISTA", "29": "APOYO OPERACION" };
  const rows = [];
  for (const day of calendar.dias) {
    const date = `${String(day.dia).padStart(2, "0")}/${String(calendar.mes).padStart(2, "0")}/${calendar.anyo}`;
    if (!dateSet.has(date)) continue;
    for (const item of day.dobles || []) {
      const shift = journeyById.get(String(item.jornada)) || "";
      const hours = shift.match(/(\d{1,2})\s*A\s*(\d{1,2})/i);
      if (!hours) throw new Error(`Jornada de doble no reconocida: ${item.jornada}`);
      rows.push({
        date,
        specialty: specialtyById[String(item.especialidad || "").padStart(2, "0")] || String(item.especialidad || "").trim(),
        journey: `${hours[1].padStart(2, "0")}/${hours[2].padStart(2, "0")}`,
        holiday: [0, 6].includes(new Date(`${calendar.anyo}-${String(calendar.mes).padStart(2, "0")}-${String(day.dia).padStart(2, "0")}T12:00:00Z`).getUTCDay())
      });
    }
  }
  return rows;
}
