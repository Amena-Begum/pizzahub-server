import express, { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { getStripe, PREMIUM_PLAN } from "../config/stripe.js";
import { verifyJWT, verifyVendor } from "../middleware/auth.js";
import { Transaction } from "../models/Transaction.js";
import { hasActivePremium, User, type UserDoc } from "../models/User.js";
import { downgradeToFree } from "../services/plan.js";
import { conflict, HttpError, notFound } from "../utils/http.js";

export const paymentRouter = Router();

function clientUrl() {
  return env.clientUrls()[0];
}

/** Newer Stripe API versions keep the billing period on the subscription item. */
function periodEnd(sub: Stripe.Subscription) {
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  const seconds = fromItem ?? legacy;
  return seconds ? new Date(seconds * 1000) : null;
}

/** GET /api/payments/plan — public plan details for the pricing cards. */
paymentRouter.get("/plan", (_req, res) => {
  res.json({ success: true, data: { ...PREMIUM_PLAN, amount: PREMIUM_PLAN.amountCents / 100 } });
});

/**
 * POST /api/payments/checkout-session — creates a Stripe Checkout Session for the signed-in vendor.
 * The vendor comes from the token, so nobody can start a subscription for another vendor.
 */
paymentRouter.post("/checkout-session", verifyJWT, verifyVendor, async (req, res) => {
  const vendor = req.user!.doc;
  if (hasActivePremium(vendor)) throw conflict("You are already on the Premium plan.");

  const stripe = getStripe();
  let customerId = vendor.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: vendor.email,
      name: vendor.businessName || vendor.name,
      metadata: { vendorId: String(vendor._id) },
    });
    customerId = customer.id;
    await User.updateOne({ _id: vendor._id }, { stripeCustomerId: customerId });
  }

  const priceId = env.stripePremiumPriceId();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(vendor._id),
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: PREMIUM_PLAN.currency,
              unit_amount: PREMIUM_PLAN.amountCents,
              recurring: { interval: PREMIUM_PLAN.interval },
              product_data: { name: PREMIUM_PLAN.name, description: PREMIUM_PLAN.perks.join(" · ") },
            },
          },
    ],
    metadata: { vendorId: String(vendor._id), plan: "premium" },
    subscription_data: { metadata: { vendorId: String(vendor._id), plan: "premium" } },
    success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl()}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
    allow_promotion_codes: false,
  });

  await Transaction.create({
    vendorId: vendor._id,
    plan: "premium",
    amount: (session.amount_total ?? PREMIUM_PLAN.amountCents) / 100,
    currency: session.currency ?? PREMIUM_PLAN.currency,
    stripeSessionId: session.id,
    status: "pending",
  });

  res.status(201).json({ success: true, url: session.url, sessionId: session.id });
});

/**
 * GET /api/payments/session/:sessionId — what the Payment Success page polls. It only reports
 * what the webhook has saved, so the success redirect alone can never unlock Premium.
 */
paymentRouter.get("/session/:sessionId", verifyJWT, verifyVendor, async (req, res) => {
  const tx = await Transaction.findOne({ stripeSessionId: String(req.params.sessionId) }).lean();
  if (!tx) throw notFound("Payment session not found.");
  if (String(tx.vendorId) !== req.user!.id) throw new HttpError(403, "Forbidden: this payment belongs to another vendor.");
  const user = await User.findById(req.user!.id).select("subscriptionPlan subscriptionExpiresAt subscriptionStatus").lean<UserDoc>();
  res.json({
    success: true,
    data: {
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      createdAt: tx.createdAt,
      premiumActive: user ? hasActivePremium(user) : false,
      expiresAt: user?.subscriptionExpiresAt ?? null,
    },
  });
});

/** POST /api/payments/cancel — stops renewal; Premium stays until the paid period ends. */
paymentRouter.post("/cancel", verifyJWT, verifyVendor, async (req, res) => {
  const vendor = req.user!.doc;
  if (!vendor.stripeSubscriptionId || !hasActivePremium(vendor)) throw conflict("You do not have an active Premium subscription.");
  const sub = await getStripe().subscriptions.update(vendor.stripeSubscriptionId, { cancel_at_period_end: true });
  await User.updateOne({ _id: vendor._id }, { subscriptionStatus: "canceling", subscriptionExpiresAt: periodEnd(sub) ?? vendor.subscriptionExpiresAt });
  res.json({ success: true, message: "Auto-renew turned off. Premium stays active until the end of this billing period." });
});

/** POST /api/payments/resume — turns renewal back on before the period ends. */
paymentRouter.post("/resume", verifyJWT, verifyVendor, async (req, res) => {
  const vendor = req.user!.doc;
  if (!vendor.stripeSubscriptionId || vendor.subscriptionStatus !== "canceling") throw conflict("There is no cancelled subscription to resume.");
  await getStripe().subscriptions.update(vendor.stripeSubscriptionId, { cancel_at_period_end: false });
  await User.updateOne({ _id: vendor._id }, { subscriptionStatus: "active" });
  res.json({ success: true, message: "Premium will renew automatically again." });
});

// ---------------------------------------------------------------------------------------------
// Stripe webhook. Mounted before express.json() because the signature is computed on the raw body.
// ---------------------------------------------------------------------------------------------

async function activatePremium(vendorId: string, sub: Stripe.Subscription) {
  await User.updateOne(
    { _id: vendorId },
    {
      subscriptionPlan: "premium",
      subscriptionStatus: sub.cancel_at_period_end ? "canceling" : "active",
      subscriptionExpiresAt: periodEnd(sub),
      stripeSubscriptionId: sub.id,
      updatedAt: new Date(),
    },
  );
}

async function vendorIdFor(sub: Stripe.Subscription | string | null | undefined) {
  if (!sub) return null;
  const stripe = getStripe();
  const subscription = typeof sub === "string" ? await stripe.subscriptions.retrieve(sub) : sub;
  if (subscription.metadata?.vendorId) return { vendorId: subscription.metadata.vendorId, subscription };
  const user = await User.findOne({ stripeSubscriptionId: subscription.id }).select("_id").lean();
  return user ? { vendorId: String(user._id), subscription } : null;
}

async function handleEvent(event: Stripe.Event) {
  const stripe = getStripe();
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || session.payment_status !== "paid") return;
      const vendorId = session.metadata?.vendorId ?? session.client_reference_id;
      if (!vendorId) return;
      const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
      await Transaction.findOneAndUpdate(
        { stripeSessionId: session.id },
        {
          $set: {
            status: "paid",
            amount: (session.amount_total ?? 0) / 100,
            currency: session.currency ?? "usd",
            stripeSubscriptionId: subscription.id,
            stripeInvoiceId: typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null,
            periodEnd: periodEnd(subscription),
          },
          $setOnInsert: { vendorId, plan: "premium", kind: "checkout" },
        },
        { upsert: true },
      );
      await activatePremium(vendorId, subscription);
      return;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await Transaction.updateOne(
        { stripeSessionId: session.id, status: "pending" },
        { status: event.type === "checkout.session.expired" ? "expired" : "failed" },
      );
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      // The first invoice is already recorded through checkout.session.completed
      if (invoice.billing_reason !== "subscription_cycle") return;
      const subRef = invoice.parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string }).subscription;
      const found = await vendorIdFor(subRef as string);
      if (!found) return;
      await Transaction.updateOne(
        { stripeInvoiceId: invoice.id },
        {
          $setOnInsert: {
            vendorId: found.vendorId,
            plan: "premium",
            kind: "renewal",
            amount: invoice.amount_paid / 100,
            currency: invoice.currency,
            stripeSubscriptionId: found.subscription.id,
            status: "paid",
            periodEnd: periodEnd(found.subscription),
          },
        },
        { upsert: true },
      );
      await activatePremium(found.vendorId, found.subscription);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subRef = invoice.parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string }).subscription;
      const found = await vendorIdFor(subRef as string);
      if (!found) return;
      await Transaction.updateOne(
        { stripeInvoiceId: invoice.id },
        {
          $setOnInsert: {
            vendorId: found.vendorId,
            plan: "premium",
            kind: invoice.billing_reason === "subscription_cycle" ? "renewal" : "checkout",
            amount: invoice.amount_due / 100,
            currency: invoice.currency,
            stripeSubscriptionId: found.subscription.id,
            status: "failed",
          },
        },
        { upsert: true },
      );
      await User.updateOne({ _id: found.vendorId }, { subscriptionStatus: "past_due" });
      return;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const found = await vendorIdFor(sub);
      if (!found) return;
      if (["active", "trialing"].includes(sub.status)) await activatePremium(found.vendorId, sub);
      else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) await downgradeToFree(found.vendorId, sub.status);
      else await User.updateOne({ _id: found.vendorId }, { subscriptionStatus: sub.status });
      return;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const found = await vendorIdFor(sub);
      if (!found) return;
      await User.updateOne({ _id: found.vendorId }, { subscriptionExpiresAt: new Date(), stripeSubscriptionId: null });
      await downgradeToFree(found.vendorId, "canceled");
      await Transaction.updateMany({ stripeSubscriptionId: sub.id, status: "pending" }, { status: "cancelled" });
      return;
    }
    default:
      return;
  }
}

export const stripeWebhook = [
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ success: false, message: "Missing Stripe signature." });
      return;
    }
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, signature, env.stripeWebhookSecret());
    } catch {
      res.status(400).json({ success: false, message: "Invalid Stripe signature." });
      return;
    }
    await connectDB();
    await handleEvent(event);
    res.json({ received: true });
  },
];
