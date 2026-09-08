export const FEATURE_KEYS = [
  "game_management",
  "official_assignments",
  "basic_reporting",
  "payroll_processing",
  "advanced_reporting",
  "custom_rules",
  "multi_sport",
  "advanced_analytics",
  "custom_integrations",
  "priority_support",
  "dedicated_account_manager",
  "onboarding_and_training",
  "custom_development",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type PlanCode = "starter" | "pro" | "pro_founding" | "premier" | "enterprise";

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  annualPriceCents: number | null;
  includedOfficials: number | null;
  features: ReadonlySet<FeatureKey>;
  supportLevel: "email" | "priority" | "dedicated";
};

const starterFeatures: FeatureKey[] = [
  "game_management",
  "official_assignments",
  "basic_reporting",
];

const proFeatures: FeatureKey[] = [
  ...starterFeatures,
  "payroll_processing",
  "advanced_reporting",
  "custom_rules",
  "priority_support",
];

const premierFeatures: FeatureKey[] = [
  ...proFeatures,
  "multi_sport",
  "advanced_analytics",
  "custom_integrations",
];

export const PLAN_CATALOG: Readonly<Record<PlanCode, PlanDefinition>> = {
  starter: {
    code: "starter",
    name: "Starter",
    annualPriceCents: 29_900,
    includedOfficials: 50,
    features: new Set(starterFeatures),
    supportLevel: "email",
  },
  pro: {
    code: "pro",
    name: "Pro",
    annualPriceCents: 59_900,
    includedOfficials: 100,
    features: new Set(proFeatures),
    supportLevel: "priority",
  },
  pro_founding: {
    code: "pro_founding",
    name: "Pro — Founding Organization",
    annualPriceCents: 49_900,
    includedOfficials: 100,
    features: new Set(proFeatures),
    supportLevel: "priority",
  },
  premier: {
    code: "premier",
    name: "Premier",
    annualPriceCents: 99_900,
    includedOfficials: 250,
    features: new Set(premierFeatures),
    supportLevel: "priority",
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    annualPriceCents: null,
    includedOfficials: null,
    features: new Set([
      ...premierFeatures,
      "dedicated_account_manager",
      "onboarding_and_training",
      "custom_development",
    ]),
    supportLevel: "dedicated",
  },
};

export const OFFICIAL_BLOCK_SIZE = 25;
export const OFFICIAL_BLOCK_ANNUAL_PRICE_CENTS = 5_000;
