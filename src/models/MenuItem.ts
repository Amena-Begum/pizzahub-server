import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
] as const;
export type Category = (typeof CATEGORIES)[number];

// URL-friendly keys so the browse page can use ?category=meat-lovers
export const CATEGORY_SLUGS: Record<string, Category> = {
  classic: "Classic Pizzas",
  vegetarian: "Vegetarian Pizzas",
  "meat-lovers": "Meat Lovers",
  gourmet: "Specialty / Gourmet Pizzas",
  sides: "Sides & Appetizers",
  "drinks-desserts": "Beverages & Desserts",
};

export const ITEM_STATUSES = ["pending", "approved", "rejected", "inactive"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

// Reviews live inside the item they describe, so no extra collection is needed
const reviewSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true },
    userImage: { type: String, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 600 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const menuItemSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    itemName: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, enum: CATEGORIES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1200 },
    price: { type: Number, required: true, min: 0.5 },
    location: { type: String, required: true, trim: true, maxlength: 80 },
    images: {
      type: [String],
      validate: { validator: (v: string[]) => v.length >= 1 && v.length <= 5, message: "Add between 1 and 5 images." },
    },
    status: { type: String, enum: ITEM_STATUSES, default: "pending", index: true },
    // Who switched the item off: a vendor may switch their own item back on, but not one an admin paused
    inactiveBy: { type: String, enum: ["vendor", "admin", null], default: null },
    wasApproved: { type: Boolean, default: false },
    reviewNote: { type: String, default: "" },
    reviews: { type: [reviewSchema], default: [] },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
  },
  { collection: "menuItems", timestamps: true },
);

menuItemSchema.index({ status: 1, category: 1, price: 1 });
menuItemSchema.index({ itemName: "text", description: "text", location: "text" });

export type MenuItemDoc = InferSchemaType<typeof menuItemSchema> & { _id: Types.ObjectId };
export const MenuItem = model("MenuItem", menuItemSchema);

export function recalcRating(item: { reviews: { rating: number }[]; ratingAverage: number; ratingCount: number }) {
  const count = item.reviews.length;
  item.ratingCount = count;
  item.ratingAverage = count ? Math.round((item.reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
}
