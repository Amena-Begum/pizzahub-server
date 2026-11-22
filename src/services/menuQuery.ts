import type { PipelineStage } from "mongoose";
import { CATEGORIES, CATEGORY_SLUGS } from "../models/MenuItem.js";
import { escapeRegex } from "../utils/http.js";

export const SORTS = {
  newest: { createdAt: -1 },
  "price-asc": { price: 1, createdAt: -1 },
  "price-desc": { price: -1, createdAt: -1 },
  rating: { ratingAverage: -1, ratingCount: -1 },
  popular: { orderCount: -1, ratingAverage: -1 },
} as const;
export type SortKey = keyof typeof SORTS;

export function resolveCategory(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (CATEGORY_SLUGS[value]) return CATEGORY_SLUGS[value];
  return (CATEGORIES as readonly string[]).includes(value) ? value : null;
}

/** Joins the vendor onto each item and hides items whose vendor is blocked. */
export function vendorLookup(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "users",
        localField: "vendorId",
        foreignField: "_id",
        as: "vendor",
        pipeline: [
          {
            $project: {
              name: 1,
              businessName: 1,
              image: 1,
              city: 1,
              isBlocked: 1,
              subscriptionPlan: 1,
              subscriptionExpiresAt: 1,
            },
          },
        ],
      },
    },
    { $unwind: "$vendor" },
    { $match: { "vendor.isBlocked": { $ne: true } } },
    {
      $addFields: {
        "vendor.isPremium": {
          $and: [
            { $eq: ["$vendor.subscriptionPlan", "premium"] },
            {
              $or: [
                { $eq: [{ $ifNull: ["$vendor.subscriptionExpiresAt", null] }, null] },
                { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] },
              ],
            },
          ],
        },
      },
    },
  ];
}

export const cardProjection = {
  $project: {
    itemName: 1,
    category: 1,
    price: 1,
    location: 1,
    images: { $slice: ["$images", 1] },
    ratingAverage: 1,
    ratingCount: 1,
    orderCount: 1,
    createdAt: 1,
    "vendor._id": 1,
    "vendor.name": 1,
    "vendor.businessName": 1,
    "vendor.image": 1,
    "vendor.isPremium": 1,
  },
} satisfies PipelineStage;

/** Turns the browse page's query string into a MongoDB match on approved items only. */
export function buildMenuMatch(query: Record<string, unknown>) {
  const match: Record<string, unknown> = { status: "approved" };
  const textMatch: Record<string, unknown>[] = [];

  const q = typeof query.q === "string" ? query.q.trim().slice(0, 60) : "";
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    textMatch.push({ itemName: rx }, { description: rx }, { category: rx }, { location: rx }, { "vendor.businessName": rx });
  }

  const category = resolveCategory(query.category);
  if (category) match.category = category;

  const location = typeof query.location === "string" ? query.location.trim().slice(0, 60) : "";
  if (location) match.location = new RegExp(`^${escapeRegex(location)}$`, "i");

  const price: Record<string, number> = {};
  const min = Number(query.minPrice);
  const max = Number(query.maxPrice);
  if (Number.isFinite(min) && min > 0) price.$gte = min;
  if (Number.isFinite(max) && max > 0) price.$lte = max;
  if (Object.keys(price).length) match.price = price;

  const rating = Number(query.rating);
  if (Number.isFinite(rating) && rating > 0) match.ratingAverage = { $gte: Math.min(5, rating) };

  return { match, textMatch };
}

export function resolveSort(value: unknown): SortKey {
  return typeof value === "string" && value in SORTS ? (value as SortKey) : "newest";
}
