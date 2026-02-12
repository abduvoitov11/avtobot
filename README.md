# eMaktab Telegram Bot

Telegram bot that logs into [eMaktab](https://login.emaktab.uz/) for multiple accounts every morning and sends dashboard screenshots to the admin.

## Tech stack

- Node.js
- Telegraf
- Playwright
- MongoDB (via Mongoose)
- node-cron
- Docker (Playwright image) + Railway

## Environment variables

Set these on Railway (or locally in a `.env` file):

- `BOT_TOKEN` – Telegram bot token
- `ADMIN_ID` – Telegram user ID of the admin (e.g. `6291811673`)
- `MONGODB_URI` – MongoDB connection string

## Running locally

```bash
npm install
node index.js
```

Make sure MongoDB is running and `MONGODB_URI` is set.

## Docker

Build and run:

```bash
docker build -t emaktab-bot .
docker run --env BOT_TOKEN=xxx --env ADMIN_ID=6291811673 --env MONGODB_URI=... emaktab-bot
```

