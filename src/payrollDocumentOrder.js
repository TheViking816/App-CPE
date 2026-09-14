function payrollPeriodValue(payroll) {
  const match = String(payroll?.period || payroll?.title || "")
    .match(/\b(0?[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})\b/);
  if (!match) return Number.NEGATIVE_INFINITY;

  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return year * 12 + Number(match[1]) - 1;
}

function payrollTypePriority(payroll) {
  const type = String(payroll?.type || payroll?.title || "").trim();
  if (/^mensual\b/i.test(type)) return 0;
  if (/^anticipo(?:\s+1\s*-\s*15)?\b/i.test(type)) return 1;
  return 2;
}

export function orderPayrollDocuments(payrolls = []) {
  return payrolls
    .map((payroll, index) => ({ payroll, index }))
    .sort((left, right) => (
      payrollPeriodValue(right.payroll) - payrollPeriodValue(left.payroll)
      || payrollTypePriority(left.payroll) - payrollTypePriority(right.payroll)
      || left.index - right.index
    ))
    .map(({ payroll }) => payroll);
}
