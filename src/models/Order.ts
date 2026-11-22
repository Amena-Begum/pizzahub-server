import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const timelineSchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: () => new Date() },
    by: { type: String, enum: ["customer", "vendor", "admin", "system"], required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deliveryDate: { type: Date, required: true },
    deliveryAddress: { type: String, required: true, trim: true, maxlength: 240 },
    message: { type: String, default: "", trim: true, maxlength: 500 },
    quantity: { type: Number, default: 1, min: 1, max: 20 },
    // Copies taken when the order is placed, so the order still makes sense if the item changes later
    itemName: { type: String, required: true },
    itemImage: { type: String, default: "" },
    unitPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    vendorNote: { type: String, default: "" },
    timeline: { type: [timelineSchema], default: [] },
  },
  { collection: "orders", timestamps: true },
);

// Fast duplicate check: one active order per customer, item and delivery day
orderSchema.index({ customerId: 1, itemId: 1, deliveryDate: 1, status: 1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };
export const Order = model("Order", orderSchema);
