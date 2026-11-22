# PizzaHub API (Server)

REST API for **PizzaHub**, a pizza ordering and delivery platform where customers discover local pizzerias, restaurants (vendors) publish menus and manage orders, and admins moderate users, menu items and payments.

- **Live API:** https://pizzahub-api-six.vercel.app
- **Live website:** https://pizzahub-client-one.vercel.app
- **Server repository:** https://github.com/Amena-Begum/pizzahub-server
- **Client repository:** https://github.com/Amena-Begum/pizzahub-client

## Important features

- **JWT verification middleware** on every private route. Tokens are short-lived HS256 JWTs (issuer, audience and expiry checked). Invalid or expired tokens get `401`; wrong roles get `403`.
- **Role-based middleware** for Admin, Vendor and Customer. The role is always read from the database, never from the token or the request body.
- **Ownership checks** before every update or delete (vendors only touch their own items and orders, customers only their own orders).
- **Advanced menu search**: keyword search across name, description, category, location and restaurant name, plus filters for category, location, price range and rating, and sorting by price (ascending/descending), newest, rating and popularity.
- **Order rules**: only approved items can be ordered, vendors cannot order their own items, admins cannot order, past dates are rejected, and duplicate active orders for the same item and delivery date are blocked. Orders can be accepted or rejected only while pending, exactly once (atomic update).
- **Free / Premium plans**: Free vendors can have 3 active (pending or approved) items; Premium is unlimited and gets featured placement and a badge.
- **Stripe Checkout subscriptions with verified webhooks**: Premium is activated only by the signed `checkout.session.completed` webhook. Renewals, failed payments, cancellation at period end and expiry are handled; expired Premium falls back to Free and extra items are paused.
- **Read-only transactions** for admins (no endpoint can edit a payment record).
- **Admin tools**: platform overview with earnings and orders by date, user search and filters, block/unblock (blocked users are signed out and lose access), item approval, rejection, pausing and deletion.
- **Optional extras**: verified reviews and ratings, customer favourites, order status timeline and email notifications when an order is accepted or rejected (SMTP).
- Validation of every request body with **zod**, consistent JSON errors and a JSON 404 for unknown routes.

## Technology stack

| Area | Packages |
| --- | --- |
| Runtime | Node.js 20+, TypeScript, `tsx` |
| Web framework | `express@5`, `cors`, `cookie-parser` |
| Database | MongoDB Atlas with `mongoose@9` |
| Auth | `jose` (JWT verification) — tokens are issued by the Next.js client after Better Auth confirms the session |
| Payments | `stripe` (Checkout Sessions, subscriptions, webhooks) |
| Validation | `zod` |
| Email | `nodemailer` |
| Config | `dotenv` |
| Seeding | `better-auth` (dev only, for password hashing in the seed script) |

## Database collections

Better Auth manages `users`, `session`, `account` and `verification`. The business collections are:

- `users` (shared with Better Auth): name, email, image, role, isBlocked, businessName, subscriptionPlan, subscriptionExpiresAt (+ contact fields and favourites)
- `menuItems`: vendorId → users, itemName, category, description, price, location, images, status (pending / approved / rejected / inactive), embedded reviews, createdAt
- `orders`: itemId → menuItems, vendorId → users, customerId → users, deliveryDate, deliveryAddress, message, status (pending / accepted / rejected / cancelled), timeline, createdAt
- `transactions`: vendorId → users, plan, amount, currency, stripeSessionId, stripeSubscriptionId, status, createdAt

## Challenge implementation notes

### 1. Advanced search and sorting (`GET /api/menu`)

Query parameters (all optional, combinable):

| Parameter | Example | Effect |
| --- | --- | --- |
| `q` | `q=truffle` | Case-insensitive match on item name, description, category, location or restaurant name |
| `category` | `category=meat-lovers` | Category by URL slug (or full name) |
| `location` | `location=Gulshan, Dhaka` | Exact area / city |
| `minPrice`, `maxPrice` | `minPrice=5&maxPrice=15` | Price range |
| `rating` | `rating=4` | Minimum average rating |
| `sort` | `sort=price-asc` | `newest` (default), `price-asc`, `price-desc`, `rating`, `popular` |
| `page`, `limit` | `page=2&limit=9` | Pagination (max 48 per page) |

The query is built as a MongoDB aggregation: match `status: "approved"` plus the filters, `$lookup` the vendor (hiding items from blocked vendors), apply the keyword match, then a `$facet` returns the sorted page and the total count in one round trip. `GET /api/menu/meta` returns category counts, locations and the price range for the filter UI.

### 2. JWT / token verification (middleware flow)

1. The user signs in on the Next.js client with **Better Auth** (email/password or Google).
2. The browser asks the client's `/api/token` route for an API token. That route checks the Better Auth session and signs a **10-minute HS256 JWT** containing only the user id (`sub`), with issuer `pizzahub-client` and audience `pizzahub-api`.
3. The browser sends it as `Authorization: Bearer <token>` to this API.
4. `verifyJWT` verifies signature, algorithm, issuer, audience and expiry with `jose`. Missing, invalid or expired tokens → **401**.
5. It loads the user from MongoDB. Deleted accounts → **401**; blocked accounts → **403**. The role and plan come from the database.
6. `requireRole("admin" | "vendor" | "customer")` rejects other roles with **403**.
7. Route handlers then check **ownership** (e.g. `vendorId === req.user.id`) before any update or delete.

### 3. Payment security

- `POST /api/payments/checkout-session` takes the vendor from the token (no vendor id in the body), so nobody can start a subscription for another vendor.
- The webhook (`POST /api/payments/webhook`) verifies the Stripe signature on the raw request body before touching the database. Only this webhook sets `subscriptionPlan: "premium"` and marks transactions as paid.
- The success page only reads the stored status; the success redirect itself never activates anything.

## API overview

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/menu`, `/api/menu/featured`, `/api/menu/meta`, `/api/menu/reviews/latest` | Public |
| GET | `/api/menu/:id` | Signed in |
| POST | `/api/orders` | Customer |
| GET | `/api/orders/mine`, `/api/orders/overview` | Customer |
| GET | `/api/orders/:id` | Order's customer, its vendor, or admin |
| PATCH | `/api/orders/:id/cancel` | Customer (own pending order) |
| GET/POST | `/api/customer/favorites`, `/api/customer/favorites/:itemId` | Customer |
| POST/DELETE | `/api/customer/reviews/:itemId` | Customer with an accepted order |
| GET | `/api/vendor/overview`, `/api/vendor/items`, `/api/vendor/orders`, `/api/vendor/subscription` | Vendor |
| POST/PATCH/DELETE | `/api/vendor/items`, `/api/vendor/items/:id`, `/api/vendor/items/:id/availability` | Vendor (own items) |
| PATCH | `/api/vendor/orders/:id` | Vendor (own pending orders) |
| POST | `/api/payments/checkout-session`, `/api/payments/cancel`, `/api/payments/resume` | Vendor |
| GET | `/api/payments/session/:sessionId` | Vendor (own session) |
| POST | `/api/payments/webhook` | Stripe (signature verified) |
| GET/PATCH | `/api/users/me` | Signed in (role and plan cannot be changed) |
| GET | `/api/admin/overview`, `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/items`, `/api/admin/transactions` | Admin |
| PATCH | `/api/admin/users/:id/block`, `/api/admin/items/:id/status` | Admin |
| DELETE | `/api/admin/items/:id` | Admin |
| POST | `/api/contact` | Public (rate limited) |

## Environment variables

Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.

| Name | Purpose |
| --- | --- |
| `PORT` | Local port (default 5000) |
| `CLIENT_URL` | Allowed client origin(s), comma separated; also used for Stripe redirects |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `DB_NAME` | Database name (`pizzahub`) |
| `JWT_SECRET` | Shared secret used to verify client-issued tokens |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe webhook endpoint |
| `STRIPE_PREMIUM_PRICE_ID` | Stripe recurring price for Premium |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SUPPORT_EMAIL` | Optional email notifications and contact form |

## Installation and running locally

```bash
git clone https://github.com/Amena-Begum/pizzahub-server.git
cd pizzahub-server
npm install
cp .env.example .env        # then fill in the values
npm run dev                 # http://localhost:5000
```

Other scripts:

```bash
npm run typecheck           # TypeScript check
npm run seed                # demo data (needs SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD)
npm run make-admin -- you@example.com   # promote an existing account to admin
```

To receive Stripe webhooks locally, use the Stripe CLI: `stripe listen --forward-to localhost:5000/api/payments/webhook`.

## Deployment

Deployed on Vercel as a single serverless function (`api/index.ts`, all paths rewritten to it in `vercel.json`). Environment variables are set in the Vercel project settings.
