export type VenueField = { id: string; name: string };
export type FieldComplexMembership = { location_id: string; field_complex: string | null };

const complexPrefix = "complex:";

export function isComplexVenueFilter(value: string) {
  return value.startsWith(complexPrefix);
}

/** Complex names are explicit organization-local settings, not inferred field names. */
export function complexVenueFilterValue(organizationId: string, name: string) {
  return `${complexPrefix}${encodeURIComponent(organizationId)}:${encodeURIComponent(name.trim())}`;
}

export function fieldComplexMap(rows: FieldComplexMembership[]) {
  return Object.fromEntries(rows
    .filter((row) => row.field_complex?.trim())
    .map((row) => [row.location_id, row.field_complex!.trim()]));
}

/** null means unrestricted; [] means a selected complex has no current members. */
export function resolveVenueLocationIds(
  values: string[],
  organizationId: string | undefined,
  complexes: Record<string, string>,
): string[] | null {
  if (!values.length) return null;
  const selected = new Set(values);
  // Raw location IDs remain compatible with existing field-only saved views.
  const ids = new Set(values.filter((value) => !isComplexVenueFilter(value)));
  if (organizationId) {
    for (const [locationId, name] of Object.entries(complexes)) {
      if (selected.has(complexVenueFilterValue(organizationId, name))) ids.add(locationId);
    }
  }
  return [...ids];
}

export function assignmentVenueOptions(
  organizationId: string | undefined,
  complexes: Record<string, string>,
  fields: VenueField[],
  visibleFields: VenueField[],
  selected: string[],
): [string, string][] {
  const complexOptions: [string, string][] = organizationId
    ? [...new Set(Object.values(complexes))].sort((a, b) => a.localeCompare(b))
      .map((name) => [complexVenueFilterValue(organizationId, name), `Complex: ${name} (all fields)`])
    : [];
  // The full directory keeps options stable after a filter produces few/no games.
  // Historical game fields remain selectable even if no longer in the directory.
  const fieldNames = new Map([...visibleFields, ...fields].map((field) => [field.id, field.name]));
  const fieldOptions: [string, string][] = [...fieldNames].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => [id, `Field: ${name}`]);
  const options = [...complexOptions, ...fieldOptions];
  const known = new Set(options.map(([value]) => value));
  for (const value of selected) {
    if (!known.has(value)) {
      options.push([value, isComplexVenueFilter(value) ? "Unavailable complex (clear to choose another)" : "Unavailable field (clear to choose another)"]);
      known.add(value);
    }
  }
  return options;
}
