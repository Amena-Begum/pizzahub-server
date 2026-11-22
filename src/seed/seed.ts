/**
 * Demo data for PizzaHub.
 *   npm run seed                      wipe the PizzaHub database and load the demo data
 *   npm run seed -- --premium-extras  add the extra items of vendors that are now on Premium
 *
 * Passwords are read from SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD (never committed).
 * Menu photos (Unsplash License) are uploaded once to ImgBB and cached in images.json.
 */
import { hashPassword } from "better-auth/crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose, { Types } from "mongoose";
import { connectDB } from "../config/db.js";
import { MenuItem, recalcRating } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Transaction } from "../models/Transaction.js";
import { hasActivePremium, User, type UserDoc } from "../models/User.js";
import { ADMIN, CUSTOMERS, ITEMS, REVIEW_TEXTS, VENDORS, type SeedItem } from "./data.js";

const here = dirname(fileURLToPath(import.meta.url));
const photoIds: Record<string, string[]> = JSON.parse(readFileSync(join(here, "photo-ids.json"), "utf8"));
const cacheFile = join(here, "images.json");
const imageCache: Record<string, string> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

const day = 86_400_000;
const utcMidnight = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

async function uploadToImgbb(photoId: string) {
  if (imageCache[photoId]) return imageCache[photoId];
  const key = process.env.IMGBB_API_KEY;
  if (!key) throw new Error("IMGBB_API_KEY is needed the first time images are uploaded");
  const body = new FormData();
  body.append("image", `https://images.unsplash.com/photo-${photoId}?w=1400&q=82&auto=format&fit=crop&fm=jpg`);
  body.append("name", `pizzahub-${photoId}`);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: "POST", body });
  const json = (await res.json()) as { success?: boolean; data?: { display_url?: string } };
  if (!json.success || !json.data?.display_url) throw new Error(`ImgBB upload failed for ${photoId}`);
  imageCache[photoId] = json.data.display_url;
  writeFileSync(cacheFile, JSON.stringify(imageCache, null, 2));
  return imageCache[photoId];
}

async function imagesFor(item: SeedItem) {
  const ids = photoIds[item.photos];
  if (!ids?.length) throw new Error(`No photos for ${item.photos}`);
  const urls: string[] = [];
  for (const id of ids) urls.push(await uploadToImgbb(id));
  return urls;
}

async function createUser(data: Record<string, unknown>, password: string, createdAt: Date) {
  const _id = new Types.ObjectId();
  await mongoose.connection.collection("users").insertOne({
    _id,
    emailVerified: true,
    image: null,
    isBlocked: false,
    businessName: "",
    subscriptionPlan: "free",
    phone: "",
    address: "",
    city: "",
    bio: "",
    favorites: [],
    ...data,
    createdAt,
    updatedAt: createdAt,
  });
  await mongoose.connection.collection("account").insertOne({
    accountId: String(_id),
    providerId: "credential",
    userId: _id,
    password: await hashPassword(password),
    createdAt,
    updatedAt: createdAt,
  });
  return _id;
}

function makeItemDoc(item: SeedItem, vendorId: Types.ObjectId, images: string[], createdAt: Date) {
  return {
    vendorId,
    itemName: item.itemName,
    category: item.category,
    description: item.description,
    price: item.price,
    location: item.location,
    images,
    status: item.status,
    wasApproved: item.status === "approved" || item.status === "inactive",
    inactiveBy: (item.status === "inactive" ? "vendor" : null) as "vendor" | null,
    reviewNote: item.reviewNote ?? "",
    createdAt,
    updatedAt: createdAt,
  };
}

async function premiumExtras() {
  const vendors = await User.find({ role: "vendor" }).lean<UserDoc[]>();
  let added = 0;
  for (const v of VENDORS) {
    const vendor = vendors.find((u) => u.email === v.email);
    if (!vendor || !hasActivePremium(vendor)) continue;
    for (const item of ITEMS.filter((i) => i.vendor === v.key && i.premiumExtra)) {
      if (await MenuItem.exists({ vendorId: vendor._id, itemName: item.itemName })) continue;
      await MenuItem.create(makeItemDoc(item, vendor._id, await imagesFor(item), new Date()));
      added++;
    }
  }
  console.log(`Added ${added} Premium items.`);
}

async function seed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!adminPassword || !demoPassword) throw new Error("Set SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD first");

  console.log("Uploading menu photos to ImgBB (cached after the first run)…");
  const itemImages = new Map<string, string[]>();
  for (const item of ITEMS) itemImages.set(item.itemName, await imagesFor(item));

  console.log("Clearing PizzaHub data…");
  for (const name of ["users", "account", "session", "verification", "menuItems", "orders", "transactions"]) {
    await mongoose.connection.collection(name).deleteMany({});
  }

  const adminId = await createUser({ name: ADMIN.name, email: ADMIN.email, role: "admin", city: "Dhaka" }, adminPassword, new Date(Date.now() - 40 * day));

  const vendorIds = new Map<string, Types.ObjectId>();
  for (const [i, v] of VENDORS.entries()) {
    const id = await createUser(
      { name: v.name, email: v.email, role: "vendor", businessName: v.businessName, city: v.city, phone: v.phone, address: v.address, bio: v.bio },
      demoPassword,
      new Date(Date.now() - (35 - i * 2) * day),
    );
    vendorIds.set(v.key, id);
  }

  const customerIds = new Map<string, Types.ObjectId>();
  for (const [i, c] of CUSTOMERS.entries()) {
    const id = await createUser(
      { name: c.name, email: c.email, role: "customer", city: c.city, address: c.address },
      demoPassword,
      new Date(Date.now() - (25 - i * 3) * day),
    );
    customerIds.set(c.key, id);
  }

  const items: InstanceType<typeof MenuItem>[] = [];
  for (const [i, item] of ITEMS.filter((it) => !it.premiumExtra).entries()) {
    items.push(await MenuItem.create(makeItemDoc(item, vendorIds.get(item.vendor)!, itemImages.get(item.itemName)!, new Date(Date.now() - (30 - i) * day))));
  }
  const approved = items.filter((i) => i.status === "approved");

  // Orders spread over the last three weeks so the dashboards have real history
  const plan: { c: string; item: number; ago: number; deliver: number; status: "pending" | "accepted" | "rejected" | "cancelled"; qty: number }[] = [
    { c: "ayesha", item: 0, ago: 19, deliver: -18, status: "accepted", qty: 2 },
    { c: "ayesha", item: 4, ago: 15, deliver: -14, status: "accepted", qty: 1 },
    { c: "ayesha", item: 11, ago: 9, deliver: -8, status: "accepted", qty: 3 },
    { c: "ayesha", item: 2, ago: 2, deliver: 2, status: "pending", qty: 1 },
    { c: "ayesha", item: 13, ago: 1, deliver: 3, status: "pending", qty: 2 },
    { c: "mahir", item: 3, ago: 17, deliver: -16, status: "accepted", qty: 1 },
    { c: "mahir", item: 5, ago: 12, deliver: -11, status: "rejected", qty: 1 },
    { c: "mahir", item: 1, ago: 6, deliver: -5, status: "accepted", qty: 2 },
    { c: "mahir", item: 9, ago: 3, deliver: 1, status: "pending", qty: 2 },
    { c: "tasnim", item: 6, ago: 14, deliver: -13, status: "accepted", qty: 1 },
    { c: "tasnim", item: 7, ago: 10, deliver: -9, status: "cancelled", qty: 1 },
    { c: "tasnim", item: 0, ago: 5, deliver: -4, status: "accepted", qty: 1 },
    { c: "tasnim", item: 12, ago: 1, deliver: 2, status: "pending", qty: 4 },
    { c: "arif", item: 8, ago: 11, deliver: -10, status: "accepted", qty: 2 },
    { c: "arif", item: 10, ago: 8, deliver: -7, status: "accepted", qty: 2 },
    { c: "arif", item: 14, ago: 4, deliver: -3, status: "rejected", qty: 1 },
    { c: "arif", item: 3, ago: 0, deliver: 1, status: "pending", qty: 1 },
  ];

  const reviewsByItem = new Map<string, { userId: Types.ObjectId; userName: string; rating: number; comment: string; createdAt: Date }[]>();
  let r = 0;
  for (const o of plan) {
    const item = approved[o.item % approved.length];
    const customer = CUSTOMERS.find((c) => c.key === o.c)!;
    const placedAt = new Date(Date.now() - o.ago * day - 3 * 3_600_000);
    const timeline: { status: string; by: string; note: string; at: Date }[] = [{ status: "pending", by: "customer", note: "Order placed", at: placedAt }];
    if (o.status === "accepted") timeline.push({ status: "accepted", by: "vendor", note: "See you soon!", at: new Date(placedAt.getTime() + 25 * 60_000) });
    if (o.status === "rejected") timeline.push({ status: "rejected", by: "vendor", note: "Fully booked for that day, sorry!", at: new Date(placedAt.getTime() + 40 * 60_000) });
    if (o.status === "cancelled") timeline.push({ status: "cancelled", by: "customer", note: "Cancelled by customer", at: new Date(placedAt.getTime() + 15 * 60_000) });

    await Order.collection.insertOne({
      itemId: item._id,
      vendorId: item.vendorId,
      customerId: customerIds.get(o.c)!,
      deliveryDate: utcMidnight(o.deliver),
      deliveryAddress: customer.address,
      message: o.qty > 2 ? "Please ring the bell twice, we have a party!" : "Extra napkins please.",
      quantity: o.qty,
      itemName: item.itemName,
      itemImage: item.images[0],
      unitPrice: item.price,
      totalPrice: Math.round(item.price * o.qty * 100) / 100,
      status: o.status,
      vendorNote: o.status === "rejected" ? "Fully booked for that day, sorry!" : "",
      timeline,
      createdAt: placedAt,
      updatedAt: timeline[timeline.length - 1].at,
    });

    if (o.status === "accepted") {
      await MenuItem.updateOne({ _id: item._id }, { $inc: { orderCount: o.qty } });
      const list = reviewsByItem.get(String(item._id)) ?? [];
      if (!list.some((x) => String(x.userId) === String(customerIds.get(o.c)))) {
        list.push({
          userId: customerIds.get(o.c)!,
          userName: customer.name,
          rating: [5, 5, 4, 5, 4, 5][r % 6],
          comment: REVIEW_TEXTS[r % REVIEW_TEXTS.length],
          createdAt: new Date(placedAt.getTime() + 2 * day),
        });
        r++;
      }
      reviewsByItem.set(String(item._id), list);
    }
  }

  for (const [itemId, reviews] of reviewsByItem) {
    const doc = await MenuItem.findById(itemId);
    if (!doc) continue;
    for (const rev of reviews) doc.reviews.push({ ...rev, userImage: null });
    recalcRating(doc);
    await doc.save();
  }

  // A couple of favourites for the demo customer
  await User.updateOne({ _id: customerIds.get("ayesha") }, { $set: { favorites: [approved[1]._id, approved[5]._id, approved[9]._id] } });

  await Transaction.syncIndexes();
  await MenuItem.syncIndexes();
  await Order.syncIndexes();

  console.log(`Seeded: 1 admin (${String(adminId)}), ${VENDORS.length} vendors, ${CUSTOMERS.length} customers, ${items.length} items, ${plan.length} orders.`);
}

await connectDB();
try {
  if (process.argv.includes("--premium-extras")) await premiumExtras();
  else await seed();
} finally {
  await mongoose.disconnect();
}
