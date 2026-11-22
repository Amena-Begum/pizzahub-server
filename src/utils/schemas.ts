import { z } from "zod";
import { CATEGORIES } from "../models/MenuItem.js";

// Menu item images must come from the ImgBB upload, never an arbitrary link
const imgbbUrl = z
  .string()
  .url("Each image must be a valid URL.")
  .refine((url) => /^https:\/\/(i\.)?ibb\.co\//.test(url), "Images must be uploaded through PizzaHub (ImgBB).");

const optionalImage = z
  .union([z.string().url("Profile image must be a valid URL."), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const menuItemSchema = z.object({
  itemName: z.string().trim().min(3, "Item name needs at least 3 characters.").max(80, "Item name is too long."),
  category: z.enum(CATEGORIES, { message: "Please choose one of the PizzaHub categories." }),
  description: z.string().trim().min(20, "Description needs at least 20 characters.").max(1200, "Description is too long."),
  price: z.coerce.number({ message: "Price must be a number." }).min(0.5, "Price must be at least $0.50.").max(500, "Price looks too high."),
  location: z.string().trim().min(2, "Please add the area or city.").max(80, "Location is too long."),
  images: z.array(imgbbUrl).min(1, "Upload at least one item image.").max(5, "You can upload up to 5 images."),
});

export const menuItemUpdateSchema = menuItemSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a delivery date.");

export const orderSchema = z.object({
  itemId: z.string().min(1, "Menu item is missing."),
  deliveryDate: dateOnly,
  deliveryAddress: z.string().trim().min(8, "Please enter the full delivery address.").max(240, "Address is too long."),
  message: z.string().trim().max(500, "Message is too long (max 500 characters).").optional().default(""),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1.").max(20, "You can order up to 20 at once.").optional().default(1),
});

export const orderDecisionSchema = z.object({
  status: z.enum(["accepted", "rejected"], { message: "Status must be accepted or rejected." }),
  note: z.string().trim().max(300, "Note is too long.").optional().default(""),
});

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
  comment: z.string().trim().min(10, "Please write at least 10 characters.").max(600, "Review is too long."),
});

export const profileSchema = z
  .object({
    name: z.string().trim().min(2, "Name needs at least 2 characters.").max(60, "Name is too long."),
    image: optionalImage,
    phone: z.string().trim().max(30, "Phone number is too long.").regex(/^[+\d\s()-]*$/, "Phone can contain digits, spaces, +, - and brackets only."),
    address: z.string().trim().max(200, "Address is too long."),
    city: z.string().trim().max(60, "City is too long."),
    bio: z.string().trim().max(300, "Bio is too long."),
    businessName: z.string().trim().max(80, "Restaurant name is too long."),
  })
  .partial()
  .strict();

export const adminItemStatusSchema = z.object({
  status: z.enum(["approved", "rejected", "inactive"], { message: "Choose approved, rejected or inactive." }),
  note: z.string().trim().max(300, "Note is too long.").optional().default(""),
});

export const blockSchema = z.object({ blocked: z.boolean({ message: "blocked must be true or false." }) });
export const availabilitySchema = z.object({ available: z.boolean({ message: "available must be true or false." }) });
