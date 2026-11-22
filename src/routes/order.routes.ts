import { Router } from "express";
import { Types } from "mongoose";
import { verifyCustomer, verifyJWT } from "../middleware/auth.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order, ORDER_STATUSES } from "../models/Order.js";
import { User } from "../models/User.js";
import { earliestDeliveryDate, parseDateOnly } from "../utils/dates.js";
import { assertObjectId, badRequest, conflict, forbidden, HttpError, notFound, pageParams, validate } from "../utils/http.js";
import { orderSchema } from "../utils/schemas.js";

export const orderRouter = Router();
orderRouter.use(verifyJWT);

const MAX_DAYS_AHEAD = 30;

/** The last n calendar months as YYYY-MM, oldest first, so charts show empty months too. */
function lastMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * POST /api/orders — customer, vendor and item come from the token and the database, never from
 * the request body (only itemId is accepted, and the item decides the vendor and price).
 */
orderRouter.post("/", verifyCustomer, async (req, res) => {
  const body = validate(orderSchema, req.body);
  const itemId = assertObjectId(body.itemId, "menu item id");
  const deliveryDate = parseDateOnly(body.deliveryDate);
  if (!deliveryDate) throw badRequest("Choose a valid delivery date.");

  const earliest = earliestDeliveryDate();
  const latest = new Date(earliest.getTime() + MAX_DAYS_AHEAD * 86_400_000);
  if (deliveryDate < earliest) throw badRequest("Delivery date cannot be in the past.");
  if (deliveryDate > latest) throw badRequest(`You can schedule delivery up to ${MAX_DAYS_AHEAD} days ahead.`);

  const item = await MenuItem.findById(itemId).select("vendorId itemName images price status").lean();
  if (!item) throw notFound("This menu item does not exist.");
  if (item.status !== "approved") throw conflict("This item is not available for ordering right now.");
  if (String(item.vendorId) === req.user!.id) throw forbidden("You cannot order your own menu item.");

  const vendor = await User.findById(item.vendorId).select("isBlocked").lean();
  if (!vendor || vendor.isBlocked) throw conflict("This restaurant is not taking orders right now.");

  const duplicate = await Order.exists({
    customerId: req.user!.id,
    itemId,
    deliveryDate,
    status: { $in: ["pending", "accepted"] },
  });
  if (duplicate) throw conflict("You already have an active order for this item on that delivery date.");

  const total = Math.round(item.price * body.quantity * 100) / 100;
  const order = await Order.create({
    itemId,
    vendorId: item.vendorId,
    customerId: req.user!.id,
    deliveryDate,
    deliveryAddress: body.deliveryAddress,
    message: body.message,
    quantity: body.quantity,
    itemName: item.itemName,
    itemImage: item.images?.[0] ?? "",
    unitPrice: item.price,
    totalPrice: total,
    status: "pending",
    timeline: [{ status: "pending", by: "customer", note: "Order placed" }],
  });

  res.status(201).json({ success: true, message: "Order placed! The restaurant will confirm it soon.", data: order });
});

/** GET /api/orders/mine — the signed-in customer's orders. */
orderRouter.get("/mine", verifyCustomer, async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 20, 100);
  const filter: Record<string, unknown> = { customerId: req.user!.id };
  if (typeof req.query.status === "string" && (ORDER_STATUSES as readonly string[]).includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("vendorId", "name businessName image").lean(),
    Order.countDocuments(filter),
  ]);
  res.json({ success: true, data: orders, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

/** GET /api/orders/overview — customer dashboard cards and chart data. */
orderRouter.get("/overview", verifyCustomer, async (req, res) => {
  const customerId = new Types.ObjectId(req.user!.id);
  const [byStatus, monthly, recent, favoritesCount] = await Promise.all([
    Order.aggregate([
      { $match: { customerId } },
      { $group: { _id: "$status", count: { $sum: 1 }, spent: { $sum: "$totalPrice" } } },
    ]),
    Order.aggregate([
      { $match: { customerId, createdAt: { $gte: new Date(Date.now() - 180 * 86_400_000) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          orders: { $sum: 1 },
          spent: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, "$totalPrice", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.find({ customerId }).sort({ createdAt: -1 }).limit(4).populate("vendorId", "name businessName").lean(),
    User.findById(customerId).select("favorites").lean(),
  ]);

  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let spent = 0;
  byStatus.forEach((s) => {
    counts[s._id] = s.count;
    if (s._id === "accepted") spent = s.spent;
  });

  res.json({
    success: true,
    data: {
      stats: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        pending: counts.pending,
        accepted: counts.accepted,
        rejected: counts.rejected,
        cancelled: counts.cancelled,
        spent: Math.round(spent * 100) / 100,
        favorites: favoritesCount?.favorites?.length ?? 0,
      },
      byStatus: counts,
      monthly: lastMonths(6).map((month) => {
        const m = monthly.find((x) => x._id === month);
        return { month, orders: m?.orders ?? 0, spent: Math.round((m?.spent ?? 0) * 100) / 100 };
      }),
      recent,
    },
  });
});

/** GET /api/orders/:id — visible to the customer who placed it, the vendor it belongs to, and admins. */
orderRouter.get("/:id", async (req, res) => {
  const id = assertObjectId(req.params.id, "order id");
  const order = await Order.findById(id)
    .populate("vendorId", "name businessName image email phone city")
    .populate("customerId", "name email image phone")
    .lean();
  if (!order) throw notFound("Order not found.");

  const me = req.user!;
  const vendorId = String((order.vendorId as { _id?: unknown })?._id ?? order.vendorId);
  const customerId = String((order.customerId as { _id?: unknown })?._id ?? order.customerId);
  const allowed = me.role === "admin" || vendorId === me.id || customerId === me.id;
  if (!allowed) throw forbidden("Forbidden: you can only view your own orders.");

  const item = await MenuItem.findById(order.itemId).select("status category location").lean();
  res.json({ success: true, data: { ...order, item } });
});

/** PATCH /api/orders/:id/cancel — a customer may cancel their own order only while it is pending. */
orderRouter.patch("/:id/cancel", verifyCustomer, async (req, res) => {
  const id = assertObjectId(req.params.id, "order id");
  const order = await Order.findOneAndUpdate(
    { _id: id, customerId: req.user!.id, status: "pending" },
    { $set: { status: "cancelled" }, $push: { timeline: { status: "cancelled", by: "customer", note: "Cancelled by customer" } } },
    { new: true },
  );
  if (!order) {
    const existing = await Order.findById(id).select("customerId status").lean();
    if (!existing) throw notFound("Order not found.");
    if (String(existing.customerId) !== req.user!.id) throw forbidden("Forbidden: you can only cancel your own orders.");
    throw new HttpError(409, `This order is already ${existing.status} and can no longer be cancelled.`);
  }
  res.json({ success: true, message: "Order cancelled.", data: order });
});
