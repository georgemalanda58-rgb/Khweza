# Khweza Digital Platform — Prototype

A single web application with a public customer website at `/` and a private staff portal at `/staff-control`.

Features include backend-enforced staff login and role permissions, a SQLite database for rooms, updates, menu items and enquiries, staff image uploads, admin management tools, staff account creation and an activity log.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env` and set unique values for `SESSION_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. Run `npm install` and `npm start`.
4. Open `http://localhost:3000`.

## Prototype limitations

This is not yet production-ready. FrontDeskMaster booking integration, live availability, payment processing and email/SMS/WhatsApp notifications are not included. Verify all room details and prices before publishing. Obtain permission before reusing hotel photographs. Before real guest data is used, arrange an authorised hotel review, HTTPS, production-grade session storage, backups, monitoring, CSRF protection, privacy notices and security testing.
