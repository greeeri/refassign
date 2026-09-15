export type StripeConnectMode = "sandbox" | "live";

export function stripeConnectMode(): StripeConnectMode {
  return process.env.STRIPE_CONNECT_MODE === "live" ? "live" : "sandbox";
}

export function stripeConnectConfig() {
  const mode = stripeConnectMode();
  const secretKey = mode === "live"
    ? process.env.STRIPE_CONNECT_LIVE_SECRET_KEY || ""
    : process.env.STRIPE_CONNECT_TEST_SECRET_KEY || "";
  const connectWebhookSecret = mode === "live"
    ? process.env.STRIPE_CONNECT_LIVE_WEBHOOK_SECRET || ""
    : process.env.STRIPE_CONNECT_TEST_WEBHOOK_SECRET || "";
  const payrollWebhookSecret = mode === "live"
    ? process.env.STRIPE_PAYROLL_LIVE_WEBHOOK_SECRET || ""
    : process.env.STRIPE_PAYROLL_TEST_WEBHOOK_SECRET || "";
  const payrollPaymentMethodConfigurationId = mode === "live"
    ? process.env.STRIPE_PAYROLL_LIVE_PAYMENT_METHOD_CONFIGURATION_ID || ""
    : process.env.STRIPE_PAYROLL_TEST_PAYMENT_METHOD_CONFIGURATION_ID || "pmc_1UBkJ6EeVYrhX6SUJhcRmmN3";
  const expectedKey = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!expectedKey.test(secretKey)) {
    throw new Error(`Stripe ${mode} credentials are not configured for Connect payroll.`);
  }
  return { mode, secretKey, connectWebhookSecret, payrollWebhookSecret, payrollPaymentMethodConfigurationId };
}

