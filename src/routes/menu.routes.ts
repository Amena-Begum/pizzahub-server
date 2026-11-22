import { Router } from "express";
import { Types } from "mongoose";
import { verifyJWT } from "../middleware/auth.js";
import { CATEGORIES, CATEGORY_SLUGS, MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { buildMenuMatch, cardProjection, resolveSort, SORTS, vendorLookup } from "../services/menuQuery.js";
import { assertObjectId, notFound, pageParams } from "../utils/http.js";

export const menuRouter = Router();

/**
 * GET /api/menu — public browse endpoint.
 * Query: q, category (slug or name), location, minPrice, maxPrice, rating,
 *        sort = newest | price-asc | price-desc | rating | popular, page, limit
 */
menuRouter.get("/", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 12, 48);
  const { match, textMatch } = buildMenuMatch(req.query);
  const sort = resolveSort(req.query.sort);

  const [result] = await MenuItem.aggregate([
    { $match: match },
    ...vendorLookup(),
    ...(textMatch.length ? [{ $match: { $or: textMatch } }] : []),
    {
      $facet: {
        items: [{ $sort: { ...SORTS[sort], _id: -1 } }, { $skip: skip }, { $limit: limit }, cardProjection],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count ?? 0;
  res.json({
    success: true,
    data: result?.items ?? [],
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), sort },
  });
});

/** GET /api/menu/featured — Premium vendors' items first, then the best rated. */
menuRouter.get("/featured", async (req, res) => {
  const limit = Math.min(12, Math.max(6, Number(req.query.limit) || 8));
  const items = await MenuItem.aggregate([
    { $match: { status: "approved" } },
    ...vendorLookup(),
    { $sort: { "vendor.isPremium": -1, ratingAverage: -1, orderCount: -1, createdAt: -1 } },
    { $limit: limit },
    cardProjection,
  ]);
  res.json({ success: true, data: items });
});

/** GET /api/menu/meta — category counts, locations and price range for the filters. */
menuRouter.get("/meta", async (_req, res) => {
  const [facets] = await MenuItem.aggregate([
    { $match: { status: "approved" } },
    ...vendorLookup(),
    {
      $facet: {
        categories: [{ $group: { _id: "$category", count: { $sum: 1 }, image: { $first: { $arrayElemAt: ["$images", 0] } } } }],
        locations: [{ $group: { _id: "$location", count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        price: [{ $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } }],
        totals: [{ $group: { _id: null, items: { $sum: 1 }, vendors: { $addToSet: "$vendorId" } } }],
      },
    },
  ]);

  const counts = new Map<string, { count: number; image?: string }>(
    (facets?.categories ?? []).map((c: { _id: string; count: number; image?: string }) => [c._id, { count: c.count, image: c.image }]),
  );
  const slugs = Object.entries(CATEGORY_SLUGS);
  res.json({
    success: true,
    data: {
      categories: CATEGORIES.map((name) => ({
        name,
        slug: slugs.find(([, n]) => n === name)?.[0] ?? name,
        count: counts.get(name)?.count ?? 0,
        image: counts.get(name)?.image ?? null,
      })),
      locations: (facets?.locations ?? []).map((l: { _id: string; count: number }) => ({ name: l._id, count: l.count })),
      price: { min: facets?.price?.[0]?.min ?? 0, max: facets?.price?.[0]?.max ?? 0 },
      totals: { items: facets?.totals?.[0]?.items ?? 0, vendors: facets?.totals?.[0]?.vendors?.length ?? 0 },
    },
  });
});

/** GET /api/menu/reviews/latest — recent 4-5 star reviews for the home page testimonials. */
menuRouter.get("/reviews/latest", async (_req, res) => {
  const reviews = await MenuItem.aggregate([
    { $match: { status: "approved" } },
    { $unwind: "$reviews" },
    { $match: { "reviews.rating": { $gte: 4 } } },
    { $sort: { "reviews.createdAt": -1 } },
    { $limit: 6 },
    {
      $project: {
        _id: "$reviews._id",
        itemId: "$_id",
        itemName: 1,
        rating: "$reviews.rating",
        comment: "$reviews.comment",
        userName: "$reviews.userName",
        userImage: "$reviews.userImage",
        createdAt: "$reviews.createdAt",
      },
    },
  ]);
  res.json({ success: true, data: reviews });
});

/**
 * GET /api/menu/:id — item details (signed-in users only, like the details page).
 * Customers only see approved items. The owner vendor and admins can preview any status.
 */
menuRouter.get("/:id", verifyJWT, async (req, res) => {
  const id = assertObjectId(req.params.id, "menu item id");
  const viewer = req.user!;

  const [item] = await MenuItem.aggregate([{ $match: { _id: new Types.ObjectId(id) } }, ...vendorLookup()]);
  const isOwner = item && String(item.vendorId) === viewer.id;
  if (!item || (item.status !== "approved" && !isOwner && viewer.role !== "admin")) {
    throw notFound("This menu item does not exist or is not available right now.");
  }

  const [hasAcceptedOrder, favUser, related] = await Promise.all([
    viewer.role === "customer"
      ? Order.exists({ itemId: item._id, customerId: viewer.id, status: "accepted" })
      : Promise.resolve(null),
    User.exists({ _id: viewer.id, favorites: item._id }),
    MenuItem.aggregate([
      { $match: { status: "approved", category: item.category, _id: { $ne: item._id } } },
      ...vendorLookup(),
      { $sort: { ratingAverage: -1, createdAt: -1 } },
      { $limit: 4 },
      cardProjection,
    ]),
  ]);

  const alreadyReviewed = item.reviews.some((r: { userId: Types.ObjectId }) => String(r.userId) === viewer.id);
  delete item.vendor.isBlocked;
  delete item.vendor.subscriptionExpiresAt;
  delete item.vendor.subscriptionPlan;

  res.json({
    success: true,
    data: {
      ...item,
      reviews: [...item.reviews].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      viewer: {
        isOwner: Boolean(isOwner),
        isFavorite: Boolean(favUser),
        canOrder: viewer.role === "customer" && item.status === "approved",
        canReview: viewer.role === "customer" && Boolean(hasAcceptedOrder) && !alreadyReviewed,
        alreadyReviewed,
      },
      related,
    },
  });
});
