export function mergeGeneralBoardJourney(existing, current, mergeBlocks) {
  if (!existing) return current;
  const currentSources = Array.isArray(current?.fuentes) ? current.fuentes : [];

  // La contratación de Turno es la publicación oficial posterior. Cuando
  // aparece debe sustituir la anticipada, no acumular sus bloques antiguos.
  if (currentSources.includes("turno")) return current;

  return {
    ...existing,
    ...current,
    fuentes: [...new Set([...(existing.fuentes || []), ...currentSources])],
    bloques: mergeBlocks(existing.bloques, current.bloques)
  };
}
