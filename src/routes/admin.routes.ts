import { Router } from "express";
import mongoose, { Types } from "mongoose";
import { verifyAdmin, verifyJWT } from "../middleware/auth.js";
import { CATEGORIES, ITEM_STATUSES, MenuItem } from "../models/MenuItem.js";
import { Order, ORDER_STATUSES } from "../models/Order.js";
import { Transaction, TRANSACTION_STATUSES } from "../models/Transaction.js";
import { hasActivePremium, ROLES, User, type UserDoc } from "../models/User.js";
import { resolveCategory } from "../services/menuQuery.js";
import { assertSlotAvailable } from "../services/plan.js";
import { daysAgo, fillDays } from "../utils/dates.js";
import { assertObjectId, conflict, escapeRegex, forbidden, notFound, pageParams, validate } from "../utils/http.js";
import { adminItemStatusSchema, blockSchema } from "../utils/schemas.js";

export const adminRouter = Router();
adminRouter.use(verifyJWT, verifyAdmin);

/** GET /api/admin/overview?days=30 — platform totals plus earnings and orders by date. */
adminRouter.get("/overview", async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = daysAgo(days - 1);

  const [roles, items, txTotals, earnings, orders, orderStatus, categories, recentTx, newUsers] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 }, premium: { $sum: { $cond: [{ $eq: ["$subscriptionPlan", "premium"] }, 1, 0] } } } }]),
    MenuItem.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Transaction.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    Transaction.aggregate([
      { $match: { status: "paid", createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, earnings: { $sum: "$amount" }, payments: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] } },
          value: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, "$totalPrice", 0] } },
        },
      },
    ]),
    Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    MenuItem.aggregate([{ $match: { status: "approved" } }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
    Transaction.find().sort({ createdAt: -1 }).limit(5).populate("vendorId", "name businessName email image").lean(),
    User.countDocuments({ createdAt: { $gte: since } }),
  ]);

  const roleCount = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<string, number>;
  let premiumVendors = 0;
  roles.forEach((r) => {
    roleCount[r._id ?? "customer"] = r.count;
    if (r._id === "vendor") premiumVendors = r.premium;
  });
  const itemCount = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  items.forEach((i) => (itemCount[i._id] = i.count));
  const txCount = Object.fromEntries(TRANSACTION_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let totalEarnings = 0;
  txTotals.forEach((t) => {
    txCount[t._id] = t.count;
    if (t._id === "paid") totalEarnings = t.amount;
  });
  const orderCount = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  orderStatus.forEach((o) => (orderCount[o._id] = o.count));

  const earningsSeries = fillDays(earnings, days, ["earnings", "payments"]);
  const ordersSeries = fillDays(orders, days, ["orders", "accepted", "value"]);

  res.json({
    success: true,
    data: {
      stats: {
        totalUsers: Object.values(roleCount).reduce((a, b) => a + b, 0),
        totalVendors: roleCount.vendor,
        totalCustomers: roleCount.customer,
        totalAdmins: roleCount.admin,
        premiumVendors,
        totalMenuItems: Object.values(itemCount).reduce((a, b) => a + b, 0),
        pendingMenuItems: itemCount.pending,
        totalTransactions: Object.values(txCount).reduce((a, b) => a + b, 0),
        paidTransactions: txCount.paid,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        periodEarnings: Math.round(earningsSeries.reduce((s, d) => s + d.earnings, 0) * 100) / 100,
        totalOrders: Object.values(orderCount).reduce((a, b) => a + b, 0),
        periodOrders: ordersSeries.reduce((s, d) => s + d.orders, 0),
        newUsers,
      },
      days,
      itemsByStatus: itemCount,
      ordersByStatus: orderCount,
      transactionsByStatus: txCount,
      earnings: earningsSeries,
      orders: ordersSeries,
      categories: CATEGORIES.map((c) => ({ name: c, count: categories.find((x) => x._id === c)?.count ?? 0 })),
      recentTransactions: recentTx,
    },
  });
});

/** GET /api/admin/users?q=&role=&status= — search by name or email, filter by role and block state. */
adminRouter.get("/users", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10, 100);
  const filter: Record<string, unknown> = {};
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), "i") }, { email: new RegExp(escapeRegex(q), "i") }];
  if (typeof req.query.role === "string" && (ROLES as readonly string[]).includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status === "blocked") filter.isBlocked = true;
  if (req.query.status === "active") filter.isBlocked = { $ne: true };

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("name email image role isBlocked businessName subscriptionPlan subscriptionExpiresAt createdAt city phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: users, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

/** GET /api/admin/users/:id — profile plus activity numbers for the details drawer. */
adminRouter.get("/users/:id", async (req, res) => {
  const id = assertObjectId(req.params.id, "user id");
  const user = await User.findById(id).select("-favorites -stripeCustomerId").lean<UserDoc>();
  if (!user) throw notFound("User not found.");
  const oid = new Types.ObjectId(id);
  const [items, ordersPlaced, ordersReceived, payments] = await Promise.all([
    MenuItem.aggregate([{ $match: { vendorId: oid } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.countDocuments({ customerId: oid }),
    Order.countDocuments({ vendorId: oid }),
    Transaction.aggregate([{ $match: { vendorId: oid, status: "paid" } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
  ]);
  res.json({
    success: true,
    data: {
      ...user,
      isPremium: hasActivePremium(user),
      activity: {
        items: Object.fromEntries(items.map((i) => [i._id, i.count])),
        ordersPlaced,
        ordersReceived,
        payments: payments[0]?.count ?? 0,
        paid: payments[0]?.amount ?? 0,
      },
    },
  });
});

/** PATCH /api/admin/users/:id/block — blocks or unblocks and signs a blocked user out everywhere. */
adminRouter.patch("/users/:id/block", async (req, res) => {
  const id = assertObjectId(req.params.id, "user id");
  const { blocked } = validate(blockSchema, req.body);
  if (id === req.user!.id) throw forbidden("You cannot block your own account.");

  const target = await User.findById(id).select("role name").lean();
  if (!target) throw notFound("User not found.");
  if (target.role === "admin") throw forbidden("Admin accounts cannot be blocked from the dashboard.");

  await User.updateOne({ _id: id }, { isBlocked: blocked, updatedAt: new Date() });
  if (blocked) {
    // Better Auth keeps sessions in its own "session" collection; removing them ends every login
    await mongoose.connection.collection("session").deleteMany({ $or: [{ userId: new Types.ObjectId(id) }, { userId: id }] });
  }
  res.json({ success: true, message: `${target.name} has been ${blocked ? "blocked" : "unblocked"}.` });
});

/** GET /api/admin/items?q=&status=&category= — every submitted item with its vendor. */
adminRouter.get("/items", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10, 100);
  const match: Record<string, unknown> = {};
  if (typeof req.query.status === "string" && (ITEM_STATUSES as readonly string[]).includes(req.query.status)) match.status = req.query.status;
  const category = resolveCategory(req.query.category);
  if (category) match.category = category;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rx = q ? new RegExp(escapeRegex(q), "i") : null;

  const [result] = await MenuItem.aggregate([
    { $match: match },
    { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor", pipeline: [{ $project: { name: 1, email: 1, businessName: 1, image: 1, isBlocked: 1, subscriptionPlan: 1 } }] } },
    { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    ...(rx ? [{ $match: { $or: [{ itemName: rx }, { location: rx }, { "vendor.businessName": rx }, { "vendor.email": rx }] } }] : []),
    {
      $facet: {
        items: [
          { $addFields: { pendingFirst: { $cond: [{ $eq: ["$status", "pending"] }, 0, 1] } } },
          { $sort: { pendingFirst: 1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { reviews: 0, pendingFirst: 0 } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  const total = result?.total?.[0]?.count ?? 0;
  res.json({ success: true, data: result?.items ?? [], meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

/**
 * PATCH /api/admin/items/:id/status — approve or reject pending items, and pause, restore or
 * reject published ones. Rejected items never appear on the public menu.
 */
adminRouter.patch("/items/:id/status", async (req, res) => {
  const id = assertObjectId(req.params.id, "menu item id");
  const { status, note } = validate(adminItemStatusSchema, req.body);
  const item = await MenuItem.findById(id);
  if (!item) throw notFound("Menu item not found.");
  if (item.status === status) throw conflict(`This item is already ${status}.`);

  if (status === "approved" && item.status !== "pending") {
    // Bringing a paused or rejected item back must still respect the vendor's free plan limit
    const vendor = await User.findById(item.vendorId).lean<UserDoc>();
    if (vendor) await assertSlotAvailable(vendor, String(item._id));
  }

  item.status = status;
  item.reviewNote = note;
  if (status === "approved") {
    item.wasApproved = true;
    item.inactiveBy = null;
  }
  if (status === "inactive") item.inactiveBy = "admin";
  if (status === "rejected") item.inactiveBy = null;
  await item.save();

  if (status !== "approved") {
    await Order.updateMany(
      { itemId: item._id, status: "pending" },
      { $set: { status: "cancelled", vendorNote: "This item was taken off the menu." }, $push: { timeline: { status: "cancelled", by: "admin", note: "Item removed from the public menu" } } },
    );
  }
  res.json({ success: true, message: `Item ${status === "inactive" ? "paused" : status}.`, data: item });
});

/** DELETE /api/admin/items/:id — removes inappropriate items. */
adminRouter.delete("/items/:id", async (req, res) => {
  const id = assertObjectId(req.params.id, "menu item id");
  const item = await MenuItem.findById(id);
  if (!item) throw notFound("Menu item not found.");
  await Order.updateMany(
    { itemId: item._id, status: "pending" },
    { $set: { status: "cancelled", vendorNote: "This item was removed by PizzaHub." }, $push: { timeline: { status: "cancelled", by: "admin", note: "Item removed by an admin" } } },
  );
  await item.deleteOne();
  await User.updateMany({ favorites: item._id }, { $pull: { favorites: item._id } });
  res.json({ success: true, message: "Menu item deleted." });
});

/** GET /api/admin/transactions — read only. There is deliberately no route to edit a payment. */
adminRouter.get("/transactions", async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 10, 100);
  const match: Record<string, unknown> = {};
  if (typeof req.query.status === "string" && (TRANSACTION_STATUSES as readonly string[]).includes(req.query.status)) match.status = req.query.status;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rx = q ? new RegExp(escapeRegex(q), "i") : null;

  const [result] = await Transaction.aggregate([
    { $match: match },
    { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor", pipeline: [{ $project: { name: 1, email: 1, businessName: 1, image: 1 } }] } },
    { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    ...(rx ? [{ $match: { $or: [{ "vendor.name": rx }, { "vendor.email": rx }, { "vendor.businessName": rx }, { stripeSessionId: rx }] } }] : []),
    {
      $facet: {
        items: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: "count" }],
        summary: [{ $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }],
      },
    },
  ]);
  const total = result?.total?.[0]?.count ?? 0;
  res.json({
    success: true,
    data: result?.items ?? [],
    summary: Object.fromEntries((result?.summary ?? []).map((s: { _id: string; count: number; amount: number }) => [s._id, { count: s.count, amount: s.amount }])),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});
