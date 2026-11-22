import { Router } from "express";
import { verifyCustomer, verifyJWT } from "../middleware/auth.js";
import { MenuItem, recalcRating } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { cardProjection, vendorLookup } from "../services/menuQuery.js";
import { assertObjectId, conflict, forbidden, notFound, validate } from "../utils/http.js";
import { reviewSchema } from "../utils/schemas.js";
import { Types } from "mongoose";

export const customerRouter = Router();
customerRouter.use(verifyJWT, verifyCustomer);

/** GET /api/customer/favorites — saved items that are still live. */
customerRouter.get("/favorites", async (req, res) => {
  const me = await User.findById(req.user!.id).select("favorites").lean();
  const ids = (me?.favorites ?? []).map((id) => new Types.ObjectId(String(id)));
  const items = ids.length
    ? await MenuItem.aggregate([{ $match: { _id: { $in: ids }, status: "approved" } }, ...vendorLookup(), cardProjection])
    : [];
  res.json({ success: true, data: items, ids: ids.map(String) });
});

/** POST /api/customer/favorites/:itemId — toggles the item in the wishlist. */
customerRouter.post("/favorites/:itemId", async (req, res) => {
  const itemId = assertObjectId(req.params.itemId, "menu item id");
  const exists = await MenuItem.exists({ _id: itemId, status: "approved" });
  if (!exists) throw notFound("This item is not available.");

  const already = await User.exists({ _id: req.user!.id, favorites: itemId });
  await User.updateOne({ _id: req.user!.id }, already ? { $pull: { favorites: itemId } } : { $addToSet: { favorites: itemId } });
  res.json({
    success: true,
    favorite: !already,
    message: already ? "Removed from your favourites." : "Saved to your favourites.",
  });
});

/**
 * POST /api/customer/reviews/:itemId — only customers whose order for this item was accepted can
 * review it, once. This keeps ratings honest.
 */
customerRouter.post("/reviews/:itemId", async (req, res) => {
  const itemId = assertObjectId(req.params.itemId, "menu item id");
  const body = validate(reviewSchema, req.body);

  const item = await MenuItem.findById(itemId);
  if (!item || item.status !== "approved") throw notFound("This item is not available for reviews.");

  const ordered = await Order.exists({ itemId, customerId: req.user!.id, status: "accepted" });
  if (!ordered) throw forbidden("You can review an item after the restaurant accepts your order for it.");
  if (item.reviews.some((r) => String(r.userId) === req.user!.id)) throw conflict("You have already reviewed this item.");

  item.reviews.push({
    userId: new Types.ObjectId(req.user!.id),
    userName: req.user!.name,
    userImage: req.user!.image,
    rating: body.rating,
    comment: body.comment,
    createdAt: new Date(),
  });
  recalcRating(item);
  await item.save();
  res.status(201).json({ success: true, message: "Thanks for your review!", data: { ratingAverage: item.ratingAverage, ratingCount: item.ratingCount } });
});

/** DELETE /api/customer/reviews/:itemId — removes the signed-in customer's own review. */
customerRouter.delete("/reviews/:itemId", async (req, res) => {
  const itemId = assertObjectId(req.params.itemId, "menu item id");
  const item = await MenuItem.findById(itemId);
  if (!item) throw notFound("Menu item not found.");
  const mine = item.reviews.find((r) => String(r.userId) === req.user!.id);
  if (!mine) throw notFound("You have not reviewed this item.");
  item.reviews.pull(mine._id);
  recalcRating(item);
  await item.save();
  res.json({ success: true, message: "Your review was removed." });
});
