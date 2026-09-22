// Runs inside the authenticated portal frame. It reads the numbered tiles and
// their abbreviations without relying on the portal's changing CSS classes.
export function readAvailabilityDom() {
  const monthNames = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(" ");
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("body *")];
  const headings = nodes.filter((node) =>
    /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+20\d{2}$/i.test(clean(node.textContent))
    && ![...node.children].some((child) => clean(child.textContent) === clean(node.textContent)));
  const months = [];
  for (const heading of headings) {
    const title = clean(heading.textContent).toLowerCase().split(" ");
    const month = monthNames.indexOf(title[0]) + 1;
    const year = Number(title[1]);
    let card = heading.parentElement;
    while (card && card !== document.body) {
      const dayNumbers = new Set([...card.querySelectorAll("*")]
        .map((node) => clean(node.textContent).match(/^(\d{1,2})(?:\s*[A-ZÁÉÍÓÚÑ]{2,4})?$/)?.[1])
        .filter(Boolean).map(Number));
      if (dayNumbers.size >= 24) break;
      card = card.parentElement;
    }
    if (!card || card === document.body) continue;
    const days = new Map();
    for (const tile of card.querySelectorAll("*")) {
      const match = clean(tile.textContent).match(/^(\d{1,2})\s*([A-ZÁÉÍÓÚÑ]{2,4})$/);
      if (!match || [...tile.children].some((child) => clean(child.textContent) === clean(tile.textContent))) continue;
      const day = Number(match[1]);
      if (day < 1 || day > new Date(year, month, 0).getDate()) continue;
      days.set(day, { day, code: match[2] });
    }
    months.push({ year, month, days: [...days.values()].sort((a, b) => a.day - b.day) });
  }
  return months;
}
