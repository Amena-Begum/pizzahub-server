import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null | undefined;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  const smtp = env.smtp();
  transporter =
    smtp.host && smtp.user && smtp.pass
      ? nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } })
      : null;
  return transporter;
}

const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

interface OrderMail {
  to: string;
  customerName: string;
  itemName: string;
  restaurant: string;
  status: "accepted" | "rejected";
  deliveryDate: Date;
  orderId: string;
  note?: string;
}

/**
 * Emails the customer when a vendor accepts or rejects their order. Sending is optional: when no
 * SMTP settings are configured the function quietly does nothing, and a mail failure never fails
 * the order update itself.
 */
export async function sendOrderStatusEmail(mail: OrderMail) {
  const t = getTransporter();
  if (!t) return false;
  const accepted = mail.status === "accepted";
  const accent = accepted ? "#1f8a4c" : "#c2341b";
  const link = `${env.clientUrls()[0]}/dashboard/customer/orders/${mail.orderId}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#fff7ee;padding:32px">
    <div style="max-width:520px;margin:auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #f1dcc5">
      <p style="font-size:20px;font-weight:700;color:#b3261e;margin:0 0 24px">PizzaHub</p>
      <h1 style="font-size:22px;color:#2b1a12;margin:0 0 12px">Your order was ${accepted ? "accepted" : "declined"}</h1>
      <p style="color:#5b4636;line-height:1.6">Hi ${escapeHtml(mail.customerName)},<br/>
      <strong>${escapeHtml(mail.restaurant)}</strong> has
      <span style="color:${accent};font-weight:700">${accepted ? "accepted" : "rejected"}</span>
      your order for <strong>${escapeHtml(mail.itemName)}</strong> on ${fmtDate(mail.deliveryDate)}.</p>
      ${mail.note ? `<p style="color:#5b4636;background:#fff3e3;border-radius:10px;padding:12px">Note from the restaurant: ${escapeHtml(mail.note)}</p>` : ""}
      <a href="${link}" style="display:inline-block;margin-top:16px;background:#b3261e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">View order</a>
    </div>
  </div>`;
  try {
    await t.sendMail({
      from: `PizzaHub <${env.smtp().from}>`,
      to: mail.to,
      subject: accepted ? `Order accepted: ${mail.itemName}` : `Order declined: ${mail.itemName}`,
      html,
      text: `Hi ${mail.customerName}, ${mail.restaurant} has ${mail.status} your order for ${mail.itemName} on ${fmtDate(mail.deliveryDate)}. View it at ${link}`,
    });
    return true;
  } catch (err) {
    console.error("Order email failed:", err);
    return false;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
