import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const ROLES = ["customer", "vendor", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const PLANS = ["free", "premium"] as const;
export type Plan = (typeof PLANS)[number];

// Better Auth owns this collection ("users") and creates the documents at sign-up.
// The API reads it and updates only the business fields below. versionKey/timestamps are off
// so Mongoose never adds fields Better Auth does not expect.
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String, default: null },
    role: { type: String, enum: ROLES, default: "customer" },
    isBlocked: { type: Boolean, default: false },
    businessName: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    bio: { type: String, default: "", trim: true },
    subscriptionPlan: { type: String, enum: PLANS, default: "free" },
    subscriptionExpiresAt: { type: Date, default: null },
    subscriptionStatus: { type: String, default: "none" },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    favorites: [{ type: Schema.Types.ObjectId, ref: "MenuItem" }],
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { collection: "users", versionKey: false, timestamps: false },
);

userSchema.index({ role: 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model("User", userSchema);

// Premium only counts while it has not run out. A missed webhook can therefore never leave
// a vendor on Premium forever.
export function hasActivePremium(user: Pick<UserDoc, "subscriptionPlan" | "subscriptionExpiresAt">) {
  if (user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return new Date(user.subscriptionExpiresAt).getTime() > Date.now();
}

export function publicVendor(user: Partial<UserDoc> | null | undefined) {
  if (!user) return null;
  return {
    _id: user._id ? String(user._id) : undefined,
    name: user.name,
    businessName: user.businessName || `${user.name ?? "PizzaHub"}'s Kitchen`,
    image: user.image ?? null,
    city: user.city ?? "",
    isPremium: hasActivePremium(user as UserDoc),
  };
}
