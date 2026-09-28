export async function activateMenuItem({ click, waitForLoaded, firstWaitMs = 1200, secondWaitMs = 6000 }) {
  await click();
  if (await waitForLoaded(firstWaitMs)) return 1;

  await click();
  if (await waitForLoaded(secondWaitMs)) return 2;
  return 0;
}

export function hasLoadedMenuFrameText(value, section) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (section === "¿Dónde voy? - Orden Servicio") {
    return /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)
      || /(?:sin|no hay|no tiene|ninguna?)\s+(?:contrataci[oó]n|asignaci[oó]n|jornada)/i.test(text);
  }
  return text.length >= 20 && !/^cargando\.?\.?\.?$/i.test(text);
}
