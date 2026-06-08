# Deploy on Render

This bot runs as a Render Web Service and uses Telegram webhooks.

## Important Free Plan Notes

Render Free web services can sleep after inactivity. This means:

- `Check time left` works because the progress is calculated when the button is pressed.
- scheduled reminders are best-effort on the free plan and may be delayed if the service is asleep.
- local JSON storage can be lost on redeploy or sleep. For production, use a database or paid persistent storage.

Render provides `RENDER_EXTERNAL_URL` automatically for Web Services, and the bot uses it to set the Telegram webhook.

Source: https://render.com/docs/environment-variables

## Before Deploy

Your previous token appeared in chat. Open BotFather and revoke it:

```text
/revoke
```

Then create a new token and use the new token in Render.

## Deploy Steps

1. Open Render.
2. Click `New` > `Web Service`.
3. Connect this GitHub repo:

```text
tas-digitalmarket/vpnprogectbot
```

4. Use these settings:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Plan: Free
```

5. Add Environment Variables:

```text
TELEGRAM_BOT_TOKEN=your-new-bot-token
ADMIN_USER_IDS=5898959977
WEBHOOK_PATH=/webhook
REMINDER_MINUTES=1440,180,30,0
```

6. Deploy.

The bot sets its Telegram webhook automatically on startup.

## Test

Open your bot in Telegram and send:

```text
/start
```

Create a task:

```text
/newtask Test task | 5898959977 | 30m | Check progress bar
```

Then tap:

```text
Check time left
```

## Logs

In Render, open the service and check `Logs`. You should see:

```text
Telegram task bot is running.
Webhook server listening on port ...
Telegram webhook set to ...
```
