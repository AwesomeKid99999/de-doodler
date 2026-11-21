# DE DOODLER

DE DOODLER is a party board game. Players take turns rolling,
drawing, and judging doodles while navigating a board with special spaces and
round modifiers.

This is the online version of the game. It supports:

- **Solo play with AI bots**
- **Multiplayer rooms** using short room codes
- Rotating judges, timed drawing rounds, live opponent boards, and scoring
- In-room chat, player profiles, and host-controlled AI bots

## Requirements

- Node.js 18 or newer
- A modern browser
- Internet access for the Tailwind CSS and Google Fonts CDN resources used by
  the game UI

## Start the multiplayer server

From the project directory:

```bash
cd de-doodler-server
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Choose **Play with
Bots** for a local game, or choose **Create a Room** and share the displayed
room code with other players.

The server hosts the game page and its WebSocket endpoint on the same port.
Players on another device must use the host machine's reachable address, for
example `http://192.168.1.25:3000`, and the host's firewall must allow that
port.

## Preview and embed

When running locally, open `http://localhost:3000` or add the game to another
website with an iframe:

```html
<iframe
  src="https://your-domain.example/"
  title="DE DOODLER"
  width="100%"
  height="720"
  loading="lazy"
  allowfullscreen
  style="border: 3px solid #111827; border-radius: 16px;"
></iframe>
```

Replace `https://your-domain.example/` with the public HTTPS address of your
DE DOODLER server.

## Configuration

The server reads these environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket listen port |
| `GAME_FILE` | `../de doodler.html` | Path to the HTML game file |

Example:

```bash
PORT=8080 npm start
```

## Health check

Use the health endpoint to verify that the server is running:

```bash
curl http://localhost:3000/health
```

It returns JSON containing `ok: true` and the current number of active rooms.

## Project layout

```text
de doodler.html           Browser game UI and game logic
de-doodler-server/
  server.js               HTTP and WebSocket room server
  package.json             Server scripts and dependencies
```

Rooms are held in memory, so restarting the server closes active rooms and
does not persist game state. For a public deployment, place the server behind
HTTPS and use the corresponding secure URL when sharing it with players.
