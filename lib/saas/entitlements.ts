import {
  FEATURE_KEYS,
  OFFICIAL_BLOCK_SIZE,
  PLAN_CATALOG,
  type FeatureKey,
  type PlanCode,
} from "./planCatalog";

export type EntitlementOverrides = Partial<Record<FeatureKey, boolean>> & {
  officialLimit?: number | null;
};

export type EffectiveEntitlements = {
  plan: PlanCode;
  officialLimit: number | null;
  features: Record<FeatureKey, boolean>;
};

export function resolveEntitlements(
  plan: PlanCode,
  additionalOfficialBlocks = 0,
  overrides: EntitlementOverrides = {},
): EffectiveEntitlements {
  const definition = PLAN_CATALOG[plan];
  const safeBlocks = Math.max(0, Math.trunc(additionalOfficialBlocks));
  const calculatedLimit =
    definition.includedOfficials === null
      ? null
      : definition.includedOfficials + safeBlocks * OFFICIAL_BLOCK_SIZE;

  return {
    plan,
    officialLimit:
      overrides.officialLimit === undefined ? calculatedLimit : overrides.officialLimit,
    features: Object.fromEntries(
      FEATURE_KEYS.map((feature) => [
        feature,
        overrides[feature] ?? definition.features.has(feature),
      ]),
    ) as Record<FeatureKey, boolean>,
  };
}

export function canActivateOfficial(
  activeOfficialCount: number,
  entitlements: EffectiveEntitlements,
): boolean {
  return (
    entitlements.officialLimit === null ||
    activeOfficialCount < entitlements.officialLimit
  );
}

export function officialCapacityStatus(
  activeOfficialCount: number,
  entitlements: EffectiveEntitlements,
): "available" | "warning" | "at_limit" | "unlimited" {
  const limit = entitlements.officialLimit;
  if (limit === null) return "unlimited";
  if (activeOfficialCount >= limit) return "at_limit";
  if (activeOfficialCount / limit >= 0.8) return "warning";
  return "available";
}
