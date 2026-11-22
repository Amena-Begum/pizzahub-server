import Stripe from "stripe";
import { env } from "./env.js";

let stripe: Stripe | null = null;

export function getStripe() {
  if (!stripe) stripe = new Stripe(env.stripeSecret());
  return stripe;
}

export const PREMIUM_PLAN = {
  name: "PizzaHub Premium",
  amountCents: 1499,
  currency: "usd",
  interval: "month" as const,
  perks: ["Unlimited active menu items", "Premium vendor badge", "Featured placement on the home page", "Everything in Free"],
};
