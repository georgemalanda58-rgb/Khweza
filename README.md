# Khweza Hotel Platform

A Node.js website for Khweza Bed & Breakfast with a public guest-facing site and a separate, login-protected staff portal.

## Included
- Public hotel information, room listings, updates, menu and enquiry form.
- Private staff sign-in at `/staff-control`.
- Admin account seeded from environment variables on first start.
- Staff can manage room details, published announcements and restaurant menu entries, and review enquiries.
- Admin can create staff accounts.
- SQLite database and uploaded images are stored under `DATA_DIR`.

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a unique `SESSION_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Run `npm start` and open `http://localhost:3000`.

## Deploy on Render
Connect this repository to Render as a Web Service. The included `render.yaml` describes the service. Set `ADMIN_EMAIL` and a strong, unique `ADMIN_PASSWORD` in the Render environment settings. Render's persistent disk is mounted at `/var/data`; set `DATA_DIR=/var/data` if not automatically supplied. Never put credentials in GitHub.

## Important
This is a working starter platform, not a verified live hotel booking engine. Enquiries are requests, not confirmed reservations. No payment processing, FrontDeskMaster integration, email/SMS notifications or live room inventory is configured. Room rates and operational details must be confirmed by an authorised hotel representative. Do not enter real guest data until the hotel has approved the system, its privacy notice, access controls and deployment. Use only photos the hotel has authorised.

The public website uses the hotel's published contact details and references sample image URLs from its existing public website; confirm permission and accuracy before production.