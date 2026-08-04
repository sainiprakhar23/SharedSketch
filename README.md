# Real-Time Collaborative Drawing Canvas 🎨

A modern, fast, and beautiful real-time collaborative whiteboard where multiple users can draw together with live synchronization, cursor tracking, and global undo/redo functionality.

👉 **Live Demo**: https://collaborative-canvas-y4d9.onrender.com  
👉 **Tech Stack**: HTML5 Canvas, JavaScript, Node.js, Express, Socket.IO

---

## 📌 Table of Contents

- [Features](#features)
- [Live Demo](#live-demo)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

<a name="features"></a>
## ✨ Features

### 🎨 Drawing Tools
- **Brush** - Freehand drawing with smooth strokes
- **Eraser** - Remove unwanted marks
- **Line** - Draw straight lines
- **Rectangle** - Create rectangular shapes
- **Circle** - Draw perfect circles
- **Color Picker** - Choose any color with live preview
- **Adjustable Brush Size** - From 1px to 50px with slider control

### ⚡ Real-Time Collaboration
- Multi-user drawing with instant synchronization
- Live cursor tracking with user names and colors
- User join/leave notifications
- Full canvas sync for new users joining mid-session
- Room-based collaboration with unique room IDs
- Configurable room capacity (2-20 users)

### ↩️ Advanced Undo & Redo
- **Per-user undo/redo** - Each user can undo only their own strokes
- Full history re-sync for all connected users
- Atomic stroke operations (complete shapes/strokes)
- Server-side history management

### 🎯 User Experience
- **Modern UI Design** - Glassmorphism effects with gradient backgrounds
- **Left Sidebar Layout** - Intuitive vertical tool organization
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Touch Support** - Full touch drawing capabilities for mobile devices
- **Fullscreen Mode** - Distraction-free drawing experience
- **Download Canvas** - Save your artwork as PNG

### 🔐 Room Management
- Create private rooms with custom names
- Join existing rooms with 12-character room IDs
- Real-time user count display
- Host privileges for room creators
- Automatic room cleanup when empty

---

<a name="live-demo"></a>
## 🚀 Live Demo

🔗 **https://collaborative-canvas-y4d9.onrender.com**

Try opening it in multiple tabs or devices to see real-time synchronization in action!

### How to Test:
1. Open the demo link
2. Enter your name and create a room
3. Share the generated Room ID with friends
4. Draw together in real-time!

---

<a name="screenshots"></a>
## 📸 Screenshots

### 🏠 Landing Page
<p align="center">
  <img src="screenshots/Landing_page.png" alt="Landing Page" width="800">
</p>

Modern gradient background with glassmorphism effects. Users can create a new room or join an existing one with a room ID.

**Features shown:**
- Clean, intuitive interface
- Room creation with custom name and capacity
- Room joining with 12-character ID
- Responsive design with beautiful gradients

### 🎨 Canvas Interface
<p align="center">
  <img src="screenshots/Canvas_interface.png" alt="Canvas Interface" width="800">
</p>

Full-featured drawing workspace with left sidebar containing all tools.

**Features shown:**
- Vertical toolbar with all drawing tools
- Color picker with live preview
- Brush size slider
- Real-time user list
- Room information display

### 👥 Live Collaboration
<p align="center">
  <img src="screenshots/Live_collaboration.png" alt="Live Collaboration" width="800">
</p>

Multiple users drawing together with instant synchronization.

**Features shown:**
- Real-time drawing sync
- Colored cursor tracking
- User name labels
- Multi-user canvas state

---

<a name="quick-start"></a>
## 🛠️ Quick Start (Local)

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### 1. Clone the repository

```bash
git clone https://github.com/harshitsingh4321/Collaborative-Canvas
cd Collaborative-Canvas
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the server

```bash
npm start
```

### 4. Open in browser

```
http://localhost:3000
```

That's it! The server will start on port 3000 by default.

---

<a name="project-structure"></a>
## 📁 Project Structure

```
Collaborative-Canvas/
│
├── client/                      # Frontend files
│   ├── index.html              # Landing page (create/join room)
│   ├── canvas.html             # Drawing canvas page
│   ├── style.css               # Landing page styles
│   ├── canvas-style.css        # Canvas page styles with left sidebar
│   ├── main.js                 # Room creation/joining logic
│   ├── canvas.js               # Canvas drawing logic
│   └── websocket.js            # WebSocket client manager
│
├── server/                      # Backend files
│   └── server.js               # Express + Socket.IO server
│
├── package.json                # Project dependencies
├── package-lock.json           # Dependency lock file
└── README.md                   # Documentation
```

---

<a name="how-it-works"></a>
## 🔧 How It Works

### 🖌️ Drawing Synchronization

1. **Local Drawing**: User draws on their canvas (instant feedback)
2. **Stroke Broadcast**: Stroke data sent to server via WebSockets
3. **Server Relay**: Server broadcasts to all users in the room
4. **Remote Rendering**: Other clients draw the exact same stroke

```javascript
// Stroke data structure
{
  fromX, fromY,      // Start position
  toX, toY,          // End position
  color,             // Stroke color
  width,             // Stroke width
  tool,              // brush/eraser/line/rectangle/circle
  strokeId,          // Unique identifier for undo/redo
  userId             // User who created the stroke
}
```

### ↩️ Undo/Redo System

- Each stroke group has a unique `strokeId`
- Server maintains complete drawing history per room
- Per-user redo stacks for undone strokes
- On undo: Server removes user's last stroke group
- Server broadcasts updated full history to all clients
- Clients redraw entire canvas from history

### 👆 Cursor Tracking

- Client sends mouse/touch position every frame
- Server broadcasts position to all other users
- Each user sees colored cursors with usernames
- Cursors are color-coded per user for easy identification

### 🏠 Room Management

- Room IDs: 12-character alphanumeric codes
- Server stores: room name, capacity, users, drawing history
- Automatic room deletion when last user leaves
- New users receive full drawing history on join

---

<a name="api-reference"></a>
## 📡 API Reference

### WebSocket Events

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{roomId, roomName, userName, userColor, capacity, isHost}` | Join or create a room |
| `draw` | `{fromX, fromY, toX, toY, color, width, tool, strokeId}` | Send drawing stroke |
| `draw-line` | `{fromX, fromY, toX, toY, color, width, tool, strokeId}` | Send shape (line/rect/circle) |
| `cursor-move` | `{x, y}` | Update cursor position |
| `undo` | `{}` | Undo last stroke group |
| `redo` | `{}` | Redo last undone stroke |
| `clear-canvas` | `{}` | Clear entire canvas |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `users-list` | `{users: []}` | Current users in room |
| `user-joined` | `{userId, userName, userColor}` | New user joined |
| `user-left` | `{userId}` | User left room |
| `draw` | `{userId, userName, fromX, fromY, toX, toY, color, width, tool}` | Remote drawing stroke |
| `draw-line` | `{userId, userName, fromX, fromY, toX, toY, color, width, tool}` | Remote shape |
| `cursor-move` | `{userId, userName, userColor, x, y}` | Remote cursor position |
| `drawing-history` | `{history: []}` | Initial canvas state |
| `full-history-update` | `{history: []}` | Complete history after undo/redo |
| `room-error` | `{message}` | Room full or not found |

---

<a name="deployment"></a>
## 🌐 Deployment

### Deploy to Render

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New +" → "Web Service"
4. Connect your repository

#### Configuration

| Field | Value |
|-------|-------|
| **Name** | `collaborative-canvas` |
| **Root Directory** | `/` |
| **Environment** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |
| **Auto-Deploy** | `Yes` |

5. Click "Create Web Service"
6. Wait for deployment (2-3 minutes)
7. Your app will be live at `https://your-app-name.onrender.com`

### Environment Variables

No environment variables are required for basic deployment. The server automatically uses:
- `PORT`: Provided by Render (default: 3000 locally)

### Custom Domain (Optional)

1. Go to Settings → Custom Domain
2. Add your domain
3. Update DNS records as instructed

---

<a name="troubleshooting"></a>
## 🐛 Troubleshooting

### ❌ Cannot connect to server

**Symptoms**: "Connection Failed" message, drawings not syncing

**Solutions**:
- Ensure server is running (`npm start`)
- Check browser console for WebSocket errors
- Verify firewall isn't blocking WebSocket connections
- Try a different browser
- Check server URL in `canvas.js` (line 96)

### ❌ Undo not working

**Symptoms**: Undo button doesn't remove strokes

**Possible Causes**:
- Undo only affects **your own strokes**, not others'
- Requires active WebSocket connection
- Check if you have any strokes to undo

**Solutions**:
- Verify connection status in bottom info bar
- Check browser console for errors
- Refresh page and reconnect

### ❌ Cursor not visible

**Symptoms**: Can't see other users' cursors

**Solutions**:
- Cursors appear only when users move their mouse
- User may have left the room (cursor removed)
- Refresh the page
- Check if user is actually in the same room

### ❌ Drawing lag or delay

**Symptoms**: Strokes appear slowly or choppy

**Solutions**:
- Check internet connection
- Server may be under heavy load (free tier limitations)
- Try drawing with smaller brush size
- Reduce number of concurrent users

### ❌ Canvas not clearing

**Symptoms**: Clear button doesn't work

**Solutions**:
- Requires WebSocket connection
- Check if you have permission (any user can clear)
- Refresh page if issue persists

### ❌ Room full error

**Symptoms**: Cannot join room

**Solutions**:
- Room has reached maximum capacity
- Ask host to increase room capacity when creating
- Create a new room instead

---

<a name="contributing"></a>
## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues

🔗 **Issues**: https://github.com/harshitsingh4321/Collaborative-Canvas/issues

Please include:
- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Test on multiple browsers
- Update documentation for new features
- Keep commits atomic and well-described

---

<a name="license"></a>
## 📝 License

This project is licensed under the **MIT License** - free for personal and commercial use.

```
MIT License

Copyright (c) 2024 Harshit Singh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- Built with [Socket.IO](https://socket.io/) for real-time communication
- Inspired by collaborative tools like Figma and Miro
- UI design inspired by modern glassmorphism trends

---

## 📧 Contact

**Harshit Singh**
- GitHub: [@harshitsingh4321](https://github.com/harshitsingh4321)
- Project Link: [https://github.com/harshitsingh4321/Collaborative-Canvas](https://github.com/harshitsingh4321/Collaborative-Canvas)

---

⭐ **Star this repo** if you find it useful!

---

Made with ❤️ by Harshit Singh
