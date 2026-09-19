import { specialties } from "../src/censo.js";

export const censusTargets = specialties.map(({ id, name, kind }) => ({
  id,
  name,
  kind,
  portalName: name.replace(/^POL\.\s*/i, ""),
  portalType: kind === "polivalencia" ? "TP" : "TU"
}));

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseCensusCards(text) {
  const source = String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const headings = [];
  for (const target of censusTargets) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(target.portalName)}\\s+${target.portalType}\\s+(\\d{1,5})\\s+trabajadores\\b`, "gi");
    for (const match of source.matchAll(pattern)) headings.push({ target, start: match.index, end: match.index + match[0].length, declared: Number(match[1]) });
  }
  headings.sort((a, b) => a.start - b.start);
  const cards = [];
  const invalid = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const section = source.slice(heading.end, headings[index + 1]?.start ?? source.length);
    const doorPattern = /\b(Lab|Fes|NocFes|Noc)\s+(\d{5})\b/gi;
    const doors = {};
    let endOfDoors = 0;
    for (const match of section.matchAll(doorPattern)) {
      doors[match[1].toLowerCase()] = Number(match[2]);
      endOfDoors = Math.max(endOfDoors, match.index + match[0].length);
    }
    const censusPart = section.slice(endOfDoors).replace(/Contratado\s*:\s*\d+[\s\S]*$/i, "");
    const censo = censusPart.match(/(?<!\d)\d{5}(?!\d)/g) || [];
    const valid = heading.declared > 0 && censo.length === heading.declared
      && new Set(censo).size === censo.length
      && ["lab", "fes", "noc", "nocfes"].every((key) => Number.isInteger(doors[key]));
    if (!valid) {
      invalid.push({ id: heading.target.id, declared: heading.declared, read: censo.length });
      continue;
    }
    cards.push({ ...heading.target, expectedSize: heading.declared, censo, doors });
  }
  return { cards, invalid, headings: headings.length };
}

export function chooseCensusReaders(users, missingIds) {
  const missing = new Set(missingIds);
  const remaining = users.filter((user) => user.enabled);
  const ordered = [];
  while (remaining.length) {
    remaining.sort((a, b) => {
      const gain = (user) => (user.specialties || []).filter((id) => missing.has(id)).length;
      return gain(b) - gain(a) || String(a.chapa).localeCompare(String(b.chapa));
    });
    const next = remaining.shift();
    ordered.push(next);
    for (const id of next.specialties || []) missing.delete(id);
  }
  return ordered;
}
