export type StatementPeriod = {
  inicio: string;
  fim: string;
};

function validIso(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate.toISOString().slice(0, 10);
}

function distanceFromPeriod(iso: string, period: StatementPeriod) {
  const value = Date.parse(`${iso}T00:00:00Z`);
  const start = Date.parse(`${period.inicio}T00:00:00Z`);
  const end = Date.parse(`${period.fim}T00:00:00Z`);
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

/**
 * Infere DD/MM usando exclusivamente o período oficial do extrato.
 * Candidatos na virada do ano são comparados pela proximidade do intervalo,
 * nunca pela data do saldo anterior.
 */
export function inferEventDate(day: number, month: number, period: StatementPeriod) {
  const startYear = Number(period.inicio.slice(0, 4));
  const endYear = Number(period.fim.slice(0, 4));
  const years = [...new Set([startYear - 1, startYear, endYear, endYear + 1])];
  return years
    .map((year) => validIso(year, month, day))
    .filter((date): date is string => date !== null)
    .sort(
      (a, b) =>
        distanceFromPeriod(a, period) - distanceFromPeriod(b, period) || a.localeCompare(b),
    )[0] ?? null;
}

export function eventDateFromHistory(description: string, period: StatementPeriod) {
  const match = description.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!match) return null;
  if (match[3]) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    return validIso(year, Number(match[2]), Number(match[1]));
  }
  return inferEventDate(Number(match[1]), Number(match[2]), period);
}