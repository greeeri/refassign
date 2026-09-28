// A preview can reach a database before the field-move migration is applied.
// Only absence of this specific optional RPC should leave older screens usable.
export function fieldComplexRpcMissing(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      ["PGRST202", "42883"].includes(error.code || "") &&
      error.message?.includes("get_organization_field_complexes"),
  );
}
