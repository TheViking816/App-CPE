export function hasAuthoritativeNoAssignments(text = "") {
  return /no\s+hay\s+asignaciones\s+para\s+este\s+trabajador/i.test(String(text));
}
