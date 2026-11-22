import { Router } from "express";
import { Types } from "mongoose";
import { verifyJWT, verifyVendor } from "../middleware/auth.js";
import { ITEM_STATUSES, MenuItem } from "../models/MenuItem.js";
import { Order, ORDER_STATUSES } from "../models/Order.js";
import { Transaction } from "../models/Transaction.js";
import { hasActivePremium, User, type UserDoc } from "../models/User.js";
import { sendOrderStatusEmail } from "../services/mailer.js";
import { assertSlotAvailable, countUsedSlots, downgradeIfExpired, FREE_ACTIVE_LIMIT } from "../services/plan.js";
import { daysAgo, fillDays } from "../utils/dates.js";
import { assertObjectId, conflict, escapeRegex, forbidden, HttpError, notFound, pageParams, validate } from "../utils/http.js";
import { availabilitySchema, menuItemSchema, menuItemUpdateSchema, orderDecisionSchema } from "../utils/schemas.js";

export const vendorRouter = Router();
vendorRouter.use(verifyJWT, verifyVendor);

// Every vendor request first catches up on an expired Premium plan
vendorRouter.use(async (req, _res, next) => {
  req.user!.doc = await downgradeIfExpired(req.user!.doc);
  next();
});

async function ownItem(vendorId: string, id: string) {
  const item = await MenuItem.findById(assertObjectId(id, "menu item id"));
  if (!item) throw notFound("Menu item not found.");
  if (String(item.vendorId) !== vendorId) throw forbidden("Forbidden: this menu item belongs to another restaurant.");
  return item;
}

function planSummary(vendor: UserDoc, usedSlots: number) {
  const premium = hasActivePremium(vendor);
  return {
    plan: premium ? "premium" : "free",
    status: vendor.subscriptionStatus ?? "none",
    expiresAt: vendor.subscriptionExpiresAt ?? null,
    activeLimit: premium ? null : FREE_ACTIVE_LIMIT,
    usedSlots,
    canAddMore: premium || usedSlots < FREE_ACTIVE_LIMIT,
  };
}

/** GET /api/vendor/overview — stat cards and chart data for the vendor dashboard. */
vendorRouter.get("/overview", async (req, res) => {
  const vendorId = new Types.ObjectId(req.user!.id);
  const since = daysAgo(13);

  const [itemStats, orderStats, daily, topItems, usedSlots, recentOrders] = await Promise.all([
    MenuItem.aggregate([{ $match: { vendorId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { vendorId } },
      { $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: "$totalPrice" } } },
    ]),
    Order.aggregate([
      { $match: { vendorId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, "$totalPrice", 0] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: { vendorId, status: { $in: ["pending", "accepted"] } } },
      { $group: { _id: "$itemName", orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
      { $limit: 5 },
    ]),
    countUsedSlots(req.user!.id),
    Order.find({ vendorId }).sort({ createdAt: -1 }).limit(5).populate("customerId", "name email image").lean(),
  ]);

  const byItem = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  itemStats.forEach((s) => (byItem[s._id] = s.count));
  const byOrder = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let revenue = 0;
  orderStats.forEach((s) => {
    byOrder[s._id] = s.count;
    if (s._id === "accepted") revenue = s.revenue;
  });

  res.json({
    success: true,
    data: {
      stats: {
        totalItems: Object.values(byItem).reduce((a, b) => a + b, 0),
        activeItems: byItem.approved,
        pendingItems: byItem.pending,
        pendingOrders: byOrder.pending,
        acceptedOrders: byOrder.accepted,
        rejectedOrders: byOrder.rejected,
        cancelledOrders: byOrder.cancelled,
        acceptedRevenue: Math.round(revenue * 100) / 100,
      },
      itemsByStatus: byItem,
      ordersByStatus: byOrder,
      daily: fillDays(daily, 14, ["orders", "accepted", "revenue"]),
      topItems: topItems.map((t) => ({ name: t._id, orders: t.orders })),
      recentOrders,
      subscription: planSummary(req.user!.doc, usedSlots),
    },
  });
});

/** GET /api/vendor/items — only this vendor's items, with approval status. */
vendorRouter.get("/items", async (req, res) => {
  const filter: Record<string, unknown> = { vendorId: req.user!.id };
  if (typeof req.query.status === "string" && (ITEM_STATUSES as readonly string[]).includes(req.query.status)) {
    filter.status = req.query.status;
  }
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    filter.itemName = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), "i");
  }
  const [items, usedSlots] = await Promise.all([
    MenuItem.find(filter).select("-reviews").sort({ createdAt: -1 }).lean(),
    countUsedSlots(req.user!.id),
  ]);
  res.json({ success: true, data: items, subscription: planSummary(req.user!.doc, usedSlots) });
});

vendorRouter.get("/items/:id", async (req, res) => {
  const item = await ownItem(req.user!.id, String(req.params.id));
  res.json({ success: true, data: item });
});

/** POST /api/vendor/items — new items always start as pending until an admin approves them. */
vendorRouter.post("/items", async (req, res) => {
  const body = validate(menuItemSchema, req.body);
  await assertSlotAvailable(req.user!.doc);
  const item = await MenuItem.create({ ...body, vendorId: req.user!.id, status: "pending" });
  res.status(201).json({ success: true, message: "Menu item submitted. It will go live once an admin approves it.", data: item });
});

/** PATCH /api/vendor/items/:id — edits send the item back for review so customers never see unchecked changes. */
vendorRouter.patch("/items/:id", async (req, res) => {
  const item = await ownItem(req.user!.id, String(req.params.id));
  const body = validate(menuItemUpdateSchema, req.body);
  if (item.status === "inactive" || item.status === "rejected") {
    await assertSlotAvailable(req.user!.doc, String(item._id));
  }
  Object.assign(item, body);
  item.status = "pending";
  item.inactiveBy = null;
  item.reviewNote = "";
  await item.save();
  res.json({ success: true, message: "Item updated and sent for admin review.", data: item });
});

/** PATCH /api/vendor/items/:id/availability — switch an approved item off or back on. */
vendorRouter.patch("/items/:id/availability", async (req, res) => {
  const { available } = validate(availabilitySchema, req.body);
  const item = await ownItem(req.user!.id, String(req.params.id));

  if (!available) {
    if (item.status !== "approved") throw conflict("Only live (approved) items can be marked unavailable.");
    item.status = "inactive";
    item.inactiveBy = "vendor";
  } else {
    if (item.status !== "inactive") throw conflict("This item is not paused.");
    if (item.inactiveBy === "admin") throw forbidden("An admin paused this item. Please contact PizzaHub support.");
    if (!item.wasApproved) throw conflict("This item has not been approved yet.");
    await assertSlotAvailable(req.user!.doc, String(item._id));
    item.status = "approved";
    item.inactiveBy = null;
  }
  await item.save();
  res.json({ success: true, message: available ? "Item is live again." : "Item marked unavailable.", data: item });
});

/** DELETE /api/vendor/items/:id — open orders for the item are cancelled so customers are not left waiting. */
vendorRouter.delete("/items/:id", async (req, res) => {
  const item = await ownItem(req.user!.id, String(req.params.id));
  await Order.updateMany(
    { itemId: item._id, status: "pending" },
    {
      $set: { status: "cancelled", vendorNote: "The restaurant removed this item." },
      $push: { timeline: { status: "cancelled", by: "vendor", note: "Item removed from the menu" } },
    },
  );
  await item.deleteOne();
  await User.updateMany({ favorites: item._id }, { $pull: { favorites: item._id } });
  res.json({ success: true, message: "Menu item deleted." });
});

/** GET /api/vendor/orders — orders placed for this vendor's items only. */
vendorRouter.get("/orders", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20, 100);
  const filter: Record<string, unknown> = { vendorId: req.user!.id };
  if (typeof req.query.status === "string" && (ORDER_STATUSES as readonly string[]).includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const [orders, total, counts] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("customerId", "name email image phone").lean(),
    Order.countDocuments(filter),
    Order.aggregate([{ $match: { vendorId: new Types.ObjectId(req.user!.id) } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  res.json({
    success: true,
    data: orders,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), counts: Object.fromEntries(counts.map((c) => [c._id, c.count])) },
  });
});

/**
 * PATCH /api/vendor/orders/:id — accept or reject. The update only matches a pending order owned
 * by this vendor, so an order can be decided exactly once, even with two clicks at the same time.
 */
vendorRouter.patch("/orders/:id", async (req, res) => {
  const id = assertObjectId(req.params.id, "order id");
  const { status, note } = validate(orderDecisionSchema, req.body);

  const order = await Order.findOneAndUpdate(
    { _id: id, vendorId: req.user!.id, status: "pending" },
    { $set: { status, vendorNote: note }, $push: { timeline: { status, by: "vendor", note } } },
    { new: true },
  ).populate<{ customerId: UserDoc }>("customerId", "name email");

  if (!order) {
    const existing = await Order.findById(id).select("vendorId status").lean();
    if (!existing) throw notFound("Order not found.");
    if (String(existing.vendorId) !== req.user!.id) throw forbidden("Forbidden: this order belongs to another restaurant.");
    throw new HttpError(409, `This order is already ${existing.status}. Only pending orders can be accepted or rejected.`);
  }

  if (status === "accepted") await MenuItem.updateOne({ _id: order.itemId }, { $inc: { orderCount: order.quantity ?? 1 } });

  const emailed = await sendOrderStatusEmail({
    to: order.customerId.email,
    customerName: order.customerId.name,
    itemName: order.itemName,
    restaurant: req.user!.doc.businessName || req.user!.name,
    status,
    deliveryDate: order.deliveryDate,
    orderId: String(order._id),
    note,
  });

  res.json({
    success: true,
    message: `Order ${status}.${emailed ? " The customer has been emailed." : ""}`,
    data: order,
  });
});

/** GET /api/vendor/subscription — plan details and this vendor's own payment history. */
vendorRouter.get("/subscription", async (req, res) => {
  const [usedSlots, transactions] = await Promise.all([
    countUsedSlots(req.user!.id),
    Transaction.find({ vendorId: req.user!.id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const fresh = await User.findById(req.user!.id).select("subscriptionPlan subscriptionExpiresAt subscriptionStatus").lean<UserDoc>();
  res.json({ success: true, data: { ...planSummary(fresh ?? req.user!.doc, usedSlots), transactions } });
});
