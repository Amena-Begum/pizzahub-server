import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Read lazily so a missing optional value never crashes the whole API on cold start.
export const env = {
  port: () => Number(process.env.PORT) || 5000,
  clientUrls: () =>
    (process.env.CLIENT_URL ?? "http://localhost:3000")
      .split(",")
      .map((url) => url.trim().replace(/\/$/, ""))
      .filter(Boolean),
  mongoUri: () => required("MONGODB_URI"),
  dbName: () => process.env.DB_NAME || "pizzahub",
  jwtSecret: () => new TextEncoder().encode(required("JWT_SECRET")),
  stripeSecret: () => required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET"),
  stripePremiumPriceId: () => process.env.STRIPE_PREMIUM_PRICE_ID || "",
  smtp: () => ({
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  }),
};

export const JWT_ISSUER = "pizzahub-client";
export const JWT_AUDIENCE = "pizzahub-api";
