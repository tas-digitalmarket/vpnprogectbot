# Telegram Task Bot

A simple Telegram bot for team tasks, deadlines, status buttons, and an on-demand progress bar.

## Features

- Create tasks with an assignee and deadline
- Inline status buttons: `Start`, `Done`, `Need help`, `Cancel`
- `Check time left` button calculates the current progress only when pressed
- ASCII progress bar, for example `[######----] 60%`
- Telegram webhook mode for Render

## Commands

```text
/start
/tasks
/mytasks
/newtask Title | assignee numeric chat id | deadline | optional description
```

Example:

```text
/newtask Test task | 5898959977 | 30m | Check progress bar
```

Deadline formats:

- `30m`
- `6h`
- `2d`
- `2026-06-10 18:00`

## Render Deploy

Use the guide here:

[deploy/RENDER.md](deploy/RENDER.md)

## Important Security Note

Never commit your real Telegram bot token. Add it only in Render Environment Variables.

Because an older token was shared in chat during setup, revoke it in BotFather and create a new one before deploying.
