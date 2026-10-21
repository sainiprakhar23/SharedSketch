# SharedSketch

SharedSketch is a real-time collaborative drawing canvas application built with vanilla HTML5 Canvas, modern CSS, Node.js, Express, Socket.IO, and Redis.

## Features

- **Real-Time Synchronized Drawing:** Low-latency brush, lines, shapes, and eraser tools synchronized across all participants.
- **Dynamic Team Cursors:** Live cursor tracking displaying participant names and custom color indicators.
- **Undo / Redo & Canvas Clear:** Synchronized stroke management with per-user undo/redo stacks.
- **Multi-Replica Horizontal Scaling:** Backed by Redis Pub/Sub adapter (`@socket.io/redis-adapter`) and centralized Redis room storage, allowing multiple Node.js pods to seamlessly share state and broadcast events.
- **Observability Built-In:** Native Prometheus `/metrics` endpoint with request duration histograms and active socket counters.
- **Production-Ready Probes:** Lightweight `/health` (liveness) and `/ready` (readiness with Redis health checks) endpoints for Kubernetes orchestrators.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+ LTS (Tested on v24.x)
- npm v10+
- [Redis](https://redis.io/) (Optional for standalone local dev; required for multi-pod scaling and state sharing)

### Installation

Clone the repository and install dependencies using clean install:

```bash
git clone https://github.com/sainiprakhar23/SharedSketch.git
cd SharedSketch
npm ci
```

### Environment Configuration

Copy the example configuration:

```bash
cp .env.example .env
```

Available environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for Express & Socket.IO server |
| `HOST` | `0.0.0.0` | Network interface to bind to |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `NODE_ENV` | `development` | Node environment (`development`, `test`, `production`) |
| `REDIS_URL` | *(empty)* | Redis connection string (e.g. `redis://localhost:6379`). When omitted, in-memory store is used |

---

## Available Scripts

- **`npm start`**: Start the production server on the configured port.
- **`npm run dev`**: Start the development server (`node server/server.js`).
- **`npm run build`**: Deterministically synchronize canonical client assets from `client/` into `server/public/`.
- **`npm test`**: Run the automated test suite using Node's native test runner (`node:test`).

---

## Architecture: Shared State & Durability

### Multi-Replica Scaling
1. **Socket.IO Redis Adapter:** Broadcasts (`user-joined`, `draw`, `draw-line`, `cursor-move`, `undo`, `full-history-update`, `user-left`) are routed through Redis pub/sub channels to ensure clients connected to different Node instances receive identical events in real time.
2. **Redis Room Store:**
   - Active rooms: `sharedsketch:rooms:active` (Set)
   - Room metadata: `sharedsketch:room:{roomId}:meta` (Hash)
   - Room users: `sharedsketch:room:{roomId}:users` (Hash)
   - Drawing history: `sharedsketch:room:{roomId}:history` (List, capped at 1,000 strokes)
   - User redo stacks: `sharedsketch:room:{roomId}:redo:{userId}` (List)

### Storage Durability Semantics
- **Ephemeral Rooms:** Rooms are created dynamically when a host joins and are automatically cleaned up when the last participant disconnects.
- **Redis Durability:** Room state in Redis is ephemeral across room lifecycle. If Redis persistence (AOF or RDB snapshotting) is not enabled on the Redis instance/container, active room state will be lost on Redis restart. For learning and lab environments, Redis is configured in-memory.

---

## API & Probe Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | `GET` | Landing page (Create / Join room) |
| `/canvas` | `GET` | Collaborative canvas interface |
| `/health` | `GET` | Liveness probe: returns `{"status":"UP", "timestamp":"..."}` |
| `/ready` | `GET` | Readiness probe: returns `{"status":"READY", "checks":{"server":"UP", "storage":"UP"}}` (returns 503 if Redis is unreachable) |
| `/metrics` | `GET` | Prometheus scrape endpoint (prefixed with `sharedsketch_`) |
| `/stats` | `GET` | Aggregated non-sensitive room and user counts |

---

## Testing

Run the automated integration test suite:

```bash
npm test
```

This validates single-instance workflows, probe status, Prometheus metrics, and cross-instance multi-replica Socket.IO broadcasting and shared Redis drawing history.
