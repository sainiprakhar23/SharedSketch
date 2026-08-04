# Collaborative Canvas — Project Understanding Notes

Reference notes for presenting/defending this project to teachers. Covers folder
structure, file responsibilities, data flow, storage, and known issues.

---

## 1. What the project is

A real-time collaborative whiteboard. Multiple users open a "room" URL and draw
on an HTML5 `<canvas>` together, seeing each other's strokes and cursors live.

**Stack**: vanilla HTML/CSS/JavaScript on the frontend, Node.js + Express +
Socket.IO on the backend. **No database** — all state lives in server memory.

**Not** a MERN/MongoDB project — no persistence layer of any kind exists here.

---

## 2. Folder structure

```
Collaborative-Canvas-main/
├── package.json            → dependencies + npm scripts
├── package-lock.json
├── README.md
├── ARCHITECTURE.md          → author's own architecture notes
├── screenshots/             → landing page / canvas / live collab screenshots
├── client/                  → SOURCE copy of frontend files (edited during dev)
│   ├── index.html           → landing page (enter name, create/join room)
│   ├── main.js               → room creation/join logic for index.html
│   ├── style.css             → landing page styling
│   ├── canvas.html          → the whiteboard page
│   ├── canvas.js             → all drawing + socket-event logic (core file)
│   ├── canvas-style.css     → whiteboard styling
│   └── websocket.js          → wraps Socket.IO client into a reusable manager
└── server/
    ├── server.js             → Express + Socket.IO backend (the brain)
    └── public/               → files ACTUALLY served to the browser
        ├── index.html, main.js, style.css
        └── canvas.html, canvas.js, canvas-style.css, websocket.js
```

> **Important**: `client/` and `server/public/` are two copies of the same 6
> frontend files. Only `server/public/` is wired up — see section 6.

---

## 3. Backend — `server/server.js`

The only file with real server-side logic.

- **Express**: serves static files from `server/public`, plus small REST
  routes — `/` (index), `/canvas`, `/health`, `/stats` (debug: live room/user
  counts).
- **Socket.IO**: runs on top of the same HTTP server, handles all real-time
  events.
- **Data storage**: a single in-memory `Map()` called `rooms`. No DB, no file
  writes. Each room object:
  ```js
  {
    roomId, roomName, capacity,
    users: Map,              // userId -> {id, name, color, x, y}
    drawingHistory: [],      // array of stroke objects, source of truth
    userRedoStacks: Map,     // userId -> [{strokes: [...]}]
    createdAt: Date
  }
  ```
  **All drawings disappear when the server restarts or the room empties.**

### Socket.IO event handlers

| Event received | What the server does |
|---|---|
| `join-room` | Creates room if host; adds user to `room.users`; sends back `users-list` + existing `drawingHistory` |
| `draw` | Appends stroke to `room.drawingHistory` (brush/eraser only); re-broadcasts to everyone else in the room |
| `draw-line` | Same, for shapes (line/rect/circle), sent once on mouse-up |
| `cursor-move` | Updates user's `x, y`; re-broadcasts to others (drives colored cursor labels) |
| `undo` | Finds the last stroke group matching the user's `strokeId`, removes it, pushes it onto that user's `userRedoStacks`, broadcasts the **entire updated history** to the room |
| `redo` | Pops from `userRedoStacks`, pushes strokes back into `drawingHistory`, broadcasts full history |
| `clear-canvas` | Wipes `drawingHistory` for the room; broadcasts empty history |
| `disconnect` | Removes user; deletes the room entirely if now empty |

**Design decision to defend**: the server is server-authoritative (source of
truth for drawing state), and undo/redo work by **replaying the entire
history** to all clients rather than sending a diff. Simple and safe, but not
bandwidth-efficient at scale — legitimate tradeoff to discuss if asked.

---

## 4. Frontend workflow

**Step 1 — `index.html` + `main.js`**
User enters a name, then either:
- **Creates** a room → generates a random 12-character `roomId`, stores
  `userName`, `roomId`, `roomName`, `roomCapacity`, `isHost` in `localStorage`.
- **Joins** a room → enters an existing 12-char room ID, stores `userName`,
  `roomId`, `isHost=false`.

Either way, redirects to `canvas.html`.

**Step 2 — `canvas.html`** loads `websocket.js` then `canvas.js` (order
matters: `canvas.js` uses the `wsManager` singleton created by
`websocket.js`).

**Step 3 — `websocket.js` (`WebSocketManager` class)**
A thin wrapper around the Socket.IO client. Connects to the server and
re-emits every server event through its own internal pub/sub
(`this.callbacks`), so `canvas.js` never touches the raw socket directly —
just does `wsManager.on('remote-draw', fn)`. Clean separation of concerns.

**Step 4 — `canvas.js`** (largest file, ~700 lines)
- Reads `localStorage` values from Step 1 to identify the user and target room.
- Calls `wsManager.connect()` then `wsManager.joinRoom(...)`.
- On `mousemove` while drawing: draws locally instantly (zero-latency feel)
  **and** emits a `draw` event with
  `{fromX, fromY, toX, toY, color, width, tool, strokeId}`.
- On `mouseup`: for shapes (line/rect/circle) sends one `draw-line` event with
  final coordinates — shapes are sent once, not streamed segment-by-segment
  like brush strokes.
- Listens for `remote-draw` / `remote-draw-line` and renders other users'
  strokes on a **second, overlaid canvas** (`remoteCanvas`) — keeps your own
  drawing smooth while remote strokes render separately.
- Maintains a **local `history[]` array of full canvas snapshots**
  (`ctx.getImageData`) purely for instant local shape-preview while dragging.
  This is separate from the server's `drawingHistory` (stroke objects). Don't
  conflate the two:
  - Client `history[]` → pixel snapshots, ephemeral, capped at 50, local only.
  - Server `drawingHistory[]` → stroke objects, source of truth, capped at
    1000, shared across all users.
- `cursor-move` is emitted on every mousemove regardless of drawing state —
  drives the colored name-tag cursors for other users.

---

## 5. End-to-end example: one brush stroke

1. Mouse-down → `startDrawing()` generates a `strokeId`, saves a local canvas
   snapshot.
2. Drag → `handleMouseMove()` draws the segment on your canvas immediately,
   emits `draw` to the server with that `strokeId`.
3. Server appends the segment to `room.drawingHistory`, clears your redo
   stack, re-broadcasts `draw` to everyone else in the room (not back to you).
4. Their `canvas.js` receives `remote-draw` → draws the same segment on their
   `remoteCanvas`.
5. Mouse-up → `stopDrawing()` saves a final local snapshot; `strokeId` resets
   to `null`.
6. Undo → server finds all history entries with your last `strokeId`, removes
   them, sends `full-history-update` with the trimmed array to **everyone**;
   every client wipes and fully redraws both canvases from that array.

---

## 6. `client/` vs `server/public/` — why two folders exist

- **`server.js`** does `app.use(express.static(path.join(__dirname, 'public')))`
  — only files inside `server/public` are ever sent to the browser.
- `client/` is a leftover working/source copy, **never referenced by any
  server code**.
- Comparing all 6 shared files: `index.html`, `canvas.html`, `style.css`,
  `canvas-style.css` are byte-identical. `canvas.js` and `websocket.js` have
  drifted:
  - `client/canvas.js` (newer) dynamically resolves the server URL:
    ```js
    const SERVER_URL = localStorage.getItem('serverUrl')
      || window.location.origin
      || 'https://real-time-collaborative-drawing-canvas-ni5j.onrender.com';
    ```
  - `server/public/canvas.js` (older, **actually deployed**) hardcodes one URL:
    ```js
    const SERVER_URL = 'https://real-time-collaborative-drawing-canvas-ni5j.onrender.com';
    ```
  - Same pattern in `websocket.js` — `client/` defaults to
    `window.location.origin`, `server/public/` defaults to
    `http://localhost:3000`.
  - `client/websocket.js` also has a copy-paste artifact: the
    `WebSocketManager` class body is accidentally duplicated inside itself
    (likely from an AI-assisted edit that pasted a "fixed" version without
    removing the old one). It still runs because JS just uses the second
    class definition, but it's messy.

**Practical implication**: bug fixes made in `client/` never reach production,
because nothing copies `client/` → `server/public/`. The live app runs on the
older, hardcoded-URL version.

**Viva-ready answer**: "`client/` was the working copy during development,
`server/public/` is what Express statically serves. They should be kept in
sync — ideally via a build step that copies `client/` → `server/public/` on
deploy, or by removing `client/` entirely. Right now they've drifted, which is
a real bug."

---

## 7. Where data is stored — summary

- **No database.** Zero MongoDB/SQL/files.
- Everything lives in server RAM inside the `rooms` Map, scoped per room,
  wiped when the room empties or the server restarts.
- Client-side `localStorage` only stores session identity (`userName`,
  `roomId`, `isHost`) to survive navigation from `index.html` to
  `canvas.html` — **not** drawing data.
- The only real "persistence" a user gets is the **Download Canvas** button,
  which calls `canvas.toDataURL('image/png')` to save a PNG snapshot locally.

---

## 8. Quick-reference: API / WebSocket events

**Client → Server**: `join-room`, `draw`, `draw-line`, `cursor-move`, `undo`,
`redo`, `clear-canvas`, `ping`

**Server → Client**: `users-list`, `user-joined`, `user-left`, `draw`,
`draw-line`, `cursor-move`, `drawing-history`, `full-history-update`,
`room-error`, `pong`

**REST**: `GET /`, `GET /canvas`, `GET /health`, `GET /stats`

---

## 9. Talking points for viva / future-improvement questions

- **Why no database?** Deliberate simplicity for a fast build; drawings are
  ephemeral by design. Natural next step: persist `drawingHistory` to
  MongoDB/Redis so rooms survive a restart.
- **Why replay full history on undo/redo instead of a diff?** Simpler and
  guarantees consistency across clients, at the cost of bandwidth as history
  grows — capped at 1000 entries as a safety valve.
- **Why two canvases (`canvas` + `remoteCanvas`)?** Keeps the local user's
  drawing perfectly smooth (no waiting on network round-trips) while remote
  strokes are composited separately.
- **Known bug to acknowledge**: `client/` and `server/public/` have drifted —
  a real deployment/versioning issue, and a good example of why a single
  source of truth for static assets matters.
