import { Router } from "express";
import { z } from "zod";
import { sendContactEmail } from "../services/mailer.js";
import { HttpError, validate } from "../utils/http.js";

export const contactRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(60, "Name is too long."),
  email: z.string().trim().email("Please enter a valid email address."),
  subject: z.string().trim().min(3, "Please add a subject.").max(120, "Subject is too long."),
  message: z.string().trim().min(15, "Please write at least 15 characters.").max(2000, "Message is too long."),
});

// Small in-memory limiter: 5 messages per address per 10 minutes on each server instance
const hits = new Map<string, number[]>();
function limited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > 5;
}

/** POST /api/contact — public contact form. */
contactRouter.post("/", async (req, res) => {
  const body = validate(contactSchema, req.body);
  if (limited(req.ip ?? "unknown")) throw new HttpError(429, "Too many messages. Please try again in a few minutes.");
  let sent = false;
  try {
    sent = await sendContactEmail(body);
  } catch (err) {
    console.error("Contact email failed:", err);
  }
  if (!sent) throw new HttpError(503, `Messaging is unavailable right now. Please email us directly instead.`);
  res.status(201).json({ success: true, message: "Thanks! Your message is on its way. We usually reply within one working day." });
});
