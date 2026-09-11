function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeType(value) {
  const type = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return type.includes("ANTICIPADA") ? "anticipada" : "turno";
}

export function parseResponsiveBoardData({ title = "", cards = [] } = {}) {
  const header = clean(title);
  const match = header.match(/D[IÍ]A:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*JORNADA\s+(?:DE\s+)?(\d{2})\s*A\s*(\d{2})/i);
  const bloques = (Array.isArray(cards) ? cards : []).map((card) => ({
    parte: clean(card?.parte),
    buque: clean(card?.buque) || "--",
    empresa: clean(card?.empresa) || "Sin empresa",
    operacion: clean(card?.operacion) || "Sin operación",
    muelle: clean(card?.muelle),
    observaciones: clean(card?.observaciones),
    tipo: normalizeType(card?.tipo),
    especialidades: (Array.isArray(card?.especialidades) ? card.especialidades : [])
      .map((item) => ({
        nombre: clean(item?.nombre),
        solicitudes: Number(item?.solicitudes || 0),
        ceros: Number(item?.ceros || 0)
      }))
      .filter((item) => item.nombre && Number.isFinite(item.solicitudes))
  })).filter((card) => card.parte && card.especialidades.length);

  return {
    fecha: match?.[1] || "",
    jornada: match ? `${match[2]}-${match[3]}` : "",
    titulo: header,
    fuentes: bloques.length && bloques.every((card) => card.tipo === "anticipada")
      ? ["anticipada"]
      : (bloques.length ? ["turno"] : []),
    bloques
  };
}
