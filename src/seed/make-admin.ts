/**
 * Promotes an existing account to admin. Admin access is never available through public
 * registration; only someone with database access can run this.
 *   npm run make-admin -- someone@example.com
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";

const email = process.argv[2]?.toLowerCase().trim();
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

await connectDB();
const res = await User.updateOne({ email }, { role: "admin", updatedAt: new Date() });
console.log(res.matchedCount ? `${email} is now an admin.` : `No account found for ${email}.`);
await mongoose.disconnect();
