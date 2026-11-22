import { Router } from "express";
import { verifyJWT } from "../middleware/auth.js";
import { hasActivePremium, User, type UserDoc } from "../models/User.js";
import { forbidden, validate } from "../utils/http.js";
import { profileSchema } from "../utils/schemas.js";

export const userRouter = Router();
userRouter.use(verifyJWT);

const PROFILE_FIELDS = "name email image role isBlocked businessName phone address city bio subscriptionPlan subscriptionExpiresAt subscriptionStatus createdAt";
const LOCKED_FIELDS = ["role", "isBlocked", "subscriptionPlan", "subscriptionExpiresAt", "subscriptionStatus", "email", "stripeCustomerId", "stripeSubscriptionId", "favorites", "_id"];

function shape(user: UserDoc) {
  return { ...user, isPremium: hasActivePremium(user) };
}

/** GET /api/users/me — the signed-in user's profile as the API sees it. */
userRouter.get("/me", async (req, res) => {
  const user = await User.findById(req.user!.id).select(PROFILE_FIELDS).lean<UserDoc>();
  res.json({ success: true, data: shape(user!) });
});

/**
 * PATCH /api/users/me — name, photo and contact details only. Role, block state, email and
 * subscription can never be changed here, whatever the request contains.
 */
userRouter.patch("/me", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const locked = LOCKED_FIELDS.filter((f) => f in body);
  if (locked.length) throw forbidden(`You cannot change ${locked.join(", ")} from your profile.`);

  const update = validate(profileSchema, body);
  if (update.businessName !== undefined && req.user!.role !== "vendor") delete update.businessName;

  const user = await User.findByIdAndUpdate(req.user!.id, { ...update, updatedAt: new Date() }, { new: true, runValidators: true })
    .select(PROFILE_FIELDS)
    .lean<UserDoc>();
  res.json({ success: true, message: "Profile updated.", data: shape(user!) });
});
