import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const TRANSACTION_STATUSES = ["pending", "paid", "failed", "expired", "refunded", "cancelled"] as const;

// Written only by the checkout endpoint and the verified Stripe webhook. There is no update
// route for admins, so payment records cannot be edited from the dashboard.
const transactionSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plan: { type: String, enum: ["premium"], default: "premium" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    stripeSessionId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    stripeInvoiceId: { type: String, default: null },
    kind: { type: String, enum: ["checkout", "renewal"], default: "checkout" },
    status: { type: String, enum: TRANSACTION_STATUSES, default: "pending", index: true },
    periodEnd: { type: Date, default: null },
  },
  { collection: "transactions", timestamps: true },
);

// Checkout sessions and renewal invoices are each recorded once, even if Stripe retries a webhook
transactionSchema.index({ stripeSessionId: 1 }, { unique: true, partialFilterExpression: { stripeSessionId: { $type: "string" } } });
transactionSchema.index({ stripeInvoiceId: 1 }, { unique: true, partialFilterExpression: { stripeInvoiceId: { $type: "string" } } });

export type TransactionDoc = InferSchemaType<typeof transactionSchema> & { _id: Types.ObjectId };
export const Transaction = model("Transaction", transactionSchema);
