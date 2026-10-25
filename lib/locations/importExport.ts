import type { SupabaseClient } from '@supabase/supabase-js';

export type ImportLocation = { id: string; name: string; address: string | null; city: string | null; state: string | null; field_complex: string | null; active: boolean; venue_id: string | null };
export type ImportVenue = { id: string; name: string };
export type VenueAction = 'preserve' | 'set' | 'clear';
export type LocationImportRow = {
  row: number; id: string; name: string; address: string; city: string; state: string;
  field_complex: string; active: string; venue_id: string; venue_name: string;
  venue_action: VenueAction; expected_venue_id: string | null; action: 'Add' | 'Update';
  valid: boolean; issue: string;
};
export const requiredLocationHeaders = ['name', 'address', 'city', 'state', 'active'];
const normalized = (value: string) => value.trim().toLowerCase();
const csv = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
export function parseLocationCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some(value => value.trim())) rows.push(row); row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
export function exportVenueCatalogCSV(venues: ImportVenue[]): string {
  return ['venue_id,venue_name', ...venues.map(venue => [venue.id, venue.name].map(csv).join(','))].join('\n');
}
export function exportLocationsCSV(locations: ImportLocation[], venues: ImportVenue[]): string {
  const names = new Map(venues.map(venue => [venue.id, venue.name]));
  const header = ['id', ...requiredLocationHeaders, 'field_complex', 'venue_id', 'venue_name', 'venue_action'];
  return [header.join(','), ...locations.map(location => [
    location.id, location.name, location.address || '', location.city || '', location.state || '',
    location.active ? 'true' : 'false', location.field_complex || '', location.venue_id || '',
    names.get(location.venue_id || '') || '', 'preserve',
  ].map(csv).join(','))].join('\n');
}
export function validateLocationImport(raw: string[][], locations: ImportLocation[], venues: ImportVenue[], options: { workspaceOnly?: boolean } = {}): LocationImportRow[] {
  if (!raw.length) throw new Error('Import file is empty.');
  const header = raw[0].map(value => String(value).trim().toLowerCase().replace(/\s+/g, '_'));
  if (new Set(header).size !== header.length) throw new Error('Duplicate column headers are not allowed.');
  const missing = requiredLocationHeaders.filter(name => !header.includes(name));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`);
  const byId = new Map(locations.map(location => [location.id, location]));
  const venueById = new Map(venues.map(venue => [venue.id, venue]));
  const rows = raw.slice(1).filter(row => row.some(value => String(value).trim())).map((row, index) => {
    const get = (key: string) => String(row[header.indexOf(key)] ?? '').trim();
    const suppliedId = get('id'), name = get('name'), active = get('active').toLowerCase();
    const issues: string[] = [];
    let existing = suppliedId ? byId.get(suppliedId) : undefined;
    if (suppliedId && !existing) issues.push('Unknown, inaccessible or outside-workspace field ID. Export current workspace locations; do not guess IDs.');
    if (!suppliedId) {
      const matches = locations.filter(location => normalized(location.name) === normalized(name));
      if (matches.length > 1) issues.push('Ambiguous field name. Supply its exported ID.');
      else existing = matches[0];
    }
    if (options.workspaceOnly && !existing) issues.push('Add or connect new fields in Locations first, then refresh and export this workspace. Imports cannot create global fields.');
    if (!name) issues.push('Column name: missing value');
    if (!['true', 'false', 'yes', 'no', '1', '0'].includes(active)) issues.push('Column active: must be true/false');
    const venueId = get('venue_id');
    const action = get('venue_action').toLowerCase() || (venueId ? 'set' : 'preserve');
    if (!['preserve', 'set', 'clear'].includes(action)) issues.push('venue_action must be preserve, set or clear.');
    if (options.workspaceOnly && ['false','no','0'].includes(active) && (action === 'set' || action === 'clear')) issues.push('Associate the venue while the field is active, then deactivate it in a separate import.');
    if (action === 'set' || action === 'clear') {
      if (!suppliedId || !existing) issues.push('Venue changes require an existing exported field ID. Add new fields first, then export and associate them.');
      if (action === 'set' && (!venueId || !venueById.has(venueId))) issues.push('Set requires an available venue_id. Venue names never create or match a venue.');
      if (action === 'clear' && venueId) issues.push('Clear requires a blank venue_id to confirm unassignment.');
    }
    if (action === 'preserve' && venueId && venueId !== existing?.venue_id) issues.push('To change venue_id, choose venue_action=set. Blank parent values preserve the saved mapping.');
    const validAction = ['preserve', 'set', 'clear'].includes(action) ? action as VenueAction : 'preserve';
    return { row: index + 2, id: suppliedId || existing?.id || '', name, address: get('address'), city: get('city'), state: get('state'), field_complex: get('field_complex'), active,
      venue_id: venueId, venue_name: venueById.get(venueId)?.name || get('venue_name'), venue_action: validAction,
      expected_venue_id: existing?.venue_id ?? null, action: existing ? 'Update' as const : 'Add' as const, valid: !issues.length, issue: issues.join('; ') };
  });
  const counts = new Map<string, number>();
  for (const row of rows) { const key = row.id || `name:${normalized(row.name)}`; counts.set(key, (counts.get(key) || 0) + 1); }
  return rows.map(row => (counts.get(row.id || `name:${normalized(row.name)}`) || 0) > 1
    ? { ...row, valid: false, issue: [row.issue, 'Duplicate target in import. Keep one row per field.'].filter(Boolean).join('; ') } : row);
}
export type LocationImportResult = { added: number; updated: number; associations: number; error: string | null; stopped: boolean };
/** Sequential, explicitly non-atomic import. Counters report confirmed writes,
 * including metadata saved before a parent RPC failure. Never retry implicitly. */
export async function applyLocationImport(
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  rows: LocationImportRow[],
  authorize: (row: LocationImportRow) => Promise<void>,
  isCurrent: () => boolean = () => true,
): Promise<LocationImportResult> {
  const result: LocationImportResult = { added: 0, updated: 0, associations: 0, error: null, stopped: false };
  if (!rows.length || rows.some(row => !row.valid)) return { ...result, error: 'Validate every row before importing.' };
  for (const row of rows) {
    try {
      if (!isCurrent()) return { ...result, stopped: true };
      await authorize(row);
      if (!isCurrent()) return { ...result, stopped: true };
      const payload = { name: row.name, address: row.address || null, city: row.city || null, state: row.state || null,
        ...(row.field_complex ? { field_complex: row.field_complex } : {}), level_id: null,
        active: ['true', 'yes', '1'].includes(row.active) };
      const write = row.action === 'Update'
        ? await client.from('locations').update(payload).eq('id', row.id).select('id').single()
        : await client.from('locations').insert(payload).select('id').single();
      if (write.error) throw new Error(write.error.message);
      if (!write.data?.id || (row.action === 'Update' && write.data.id !== row.id)) throw new Error('Metadata save was not confirmed; no successful update is assumed.');
      if (row.action === 'Update') result.updated++; else result.added++;
      if (!isCurrent()) return { ...result, stopped: true };
      if (row.venue_action !== 'preserve') {
        await authorize(row);
        if (!isCurrent()) return { ...result, stopped: true };
        const parent = row.venue_action === 'clear' ? null : row.venue_id;
        const changed = await client.rpc('set_location_venue', { p_location_id: row.id, p_venue_id: parent, p_expected_venue_id: row.expected_venue_id });
        if (changed.error) throw new Error(`Metadata was saved, but venue association failed: ${changed.error.message}`);
        if (changed.data !== parent) throw new Error('Metadata was saved, but the venue save was not confirmed. Refresh before retrying.');
        result.associations++;
      }
    } catch (cause) {
      result.error = `Location row ${row.row} (${row.name}): ${cause instanceof Error ? cause.message : 'Import failed.'}`;
      return result;
    }
  }
  return result;
}
