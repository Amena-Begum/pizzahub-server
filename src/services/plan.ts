import { MenuItem } from "../models/MenuItem.js";
import { hasActivePremium, User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/http.js";

export const FREE_ACTIVE_LIMIT = 3;
// Pending items count too, otherwise a free vendor could queue many items and have them all approved
export const SLOT_STATUSES = ["pending", "approved"] as const;

export async function countUsedSlots(vendorId: string, excludeItemId?: string) {
  return MenuItem.countDocuments({
    vendorId,
    status: { $in: SLOT_STATUSES },
    ...(excludeItemId ? { _id: { $ne: excludeItemId } } : {}),
  });
}

/** Throws 403 with an upgrade hint when a free vendor has no slot left. */
export async function assertSlotAvailable(vendor: UserDoc, excludeItemId?: string) {
  if (hasActivePremium(vendor)) return;
  const used = await countUsedSlots(String(vendor._id), excludeItemId);
  if (used >= FREE_ACTIVE_LIMIT) {
    throw new HttpError(
      403,
      `The Free plan allows ${FREE_ACTIVE_LIMIT} active menu items. Upgrade to Premium to publish unlimited items.`,
      { code: "PLAN_LIMIT" },
    );
  }
}

/**
 * Moves a vendor whose Premium ran out back to Free and switches off items above the free limit.
 * Called from the Stripe webhook and also lazily when the vendor dashboard loads, in case a
 * webhook was missed. Items are paused, not deleted, so the vendor can choose which three to keep.
 */
export async function downgradeIfExpired(vendor: UserDoc) {
  if (vendor.subscriptionPlan !== "premium" || hasActivePremium(vendor)) return vendor;
  return downgradeToFree(String(vendor._id), "expired");
}

export async function downgradeToFree(vendorId: string, status: string) {
  const updated = await User.findByIdAndUpdate(
    vendorId,
    { subscriptionPlan: "free", subscriptionStatus: status, updatedAt: new Date() },
    { new: true },
  ).lean<UserDoc>();

  const keep = await MenuItem.find({ vendorId, status: { $in: SLOT_STATUSES } })
    .sort({ status: 1, orderCount: -1, createdAt: 1 })
    .select("_id")
    .lean();
  const extra = keep.slice(FREE_ACTIVE_LIMIT).map((i) => i._id);
  if (extra.length) {
    await MenuItem.updateMany({ _id: { $in: extra } }, { status: "inactive", inactiveBy: "vendor" });
  }
  return updated!;
}
