/* canvas.js - updated */

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const remoteCtx = remoteCanvas.getContext('2d');

function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    remoteCanvas.width = container.clientWidth;
    remoteCanvas.height = container.clientHeight;
    redrawCanvas();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', resizeCanvas);

let currentTool = 'brush';
let currentColor = '#000000';
let currentStrokeWidth = 3;
let isDrawing = false;
let startX = 0;
let startY = 0;

const history = [];
const redoStack = [];
const MAX_HISTORY = 50;

let currentStrokeId = null;

let currentUser = {
    name: localStorage.getItem('userName') || 'Anonymous',
    roomId: localStorage.getItem('roomId') || 'LOADING',
    isHost: localStorage.getItem('isHost') === 'true',
    color: generateUserColor()
};

const remoteUsers = new Map();

function initCanvas() {
    console.log('Initializing canvas...');
    console.log('Current User:', currentUser);

    const userNameDisplay = document.getElementById('userNameDisplay');
    const roomIdDisplay = document.getElementById('roomIdDisplay');

    if (userNameDisplay) userNameDisplay.textContent = currentUser.name;
    if (roomIdDisplay) roomIdDisplay.textContent = currentUser.roomId;

    // initial blank history snapshot
    saveHistory();

    // mouse events
    if (canvas) {
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);

        // touch events (non-passive so we can preventDefault)
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
    }

    connectWebSocket();

    console.log(`Canvas initialized for ${currentUser.name} in room ${currentUser.roomId}`);
}

async function connectWebSocket() {
    try {
        const SERVER_URL = localStorage.getItem('serverUrl') || window.location.origin || 'https://real-time-collaborative-drawing-canvas-ni5j.onrender.com';
        await wsManager.connect(SERVER_URL);

        wsManager.joinRoom({
            roomId: currentUser.roomId,
            roomName: localStorage.getItem('roomName') || 'Room',
            userName: currentUser.name,
            userColor: currentUser.color,
            capacity: Number(localStorage.getItem('roomCapacity')) || 5,
            isHost: currentUser.isHost
        });

        setupWebSocketListeners();

    } catch (error) {
        console.error('WebSocket connection failed:', error);
        const statusEl = document.getElementById('statusDisplay');
        if (statusEl) {
            statusEl.textContent = 'Connection Failed';
            statusEl.classList.add('error');
        }
    }
}

function setupWebSocketListeners() {
    wsManager.on('users-list', (data) => {
        if (!data || !Array.isArray(data.users)) return;
        data.users.forEach(user => {
            if (user.id !== wsManager.socket?.id) {
                addRemoteUser(user.id, user.name, user.color);
            }
        });
        updateUsersCount();
    });

    wsManager.on('user-joined', (data) => {
        if (!data) return;
        console.log(`${data.userName} joined the room`);
        addRemoteUser(data.userId, data.userName, data.userColor);
        updateUsersCount();
    });

    wsManager.on('user-left', (data) => {
        if (!data) return;
        console.log(`User left the room`);
        removeRemoteUser(data.userId);
        updateUsersCount();
    });

    wsManager.on('remote-draw', (data) => {
        if (!data) return;
        drawLineRemote(data.fromX, data.fromY, data.toX, data.toY, data.color, data.width, data.tool);
    });

    wsManager.on('remote-draw-line', (data) => {
        if (!data) return;
        drawLineRemote(data.fromX, data.fromY, data.toX, data.toY, data.color, data.width, data.tool);
    });

    wsManager.on('remote-clear-canvas', () => {
        console.log('Received remote clear-canvas');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        remoteCtx.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
        history.length = 0;
        redoStack.length = 0;
        saveHistory();
    });

    wsManager.on('full-history-update', (data) => {
        console.log('Full history update received');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        remoteCtx.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

        history.length = 0;
        redoStack.length = 0;

        if (data && Array.isArray(data.history) && data.history.length > 0) {
            data.history.forEach((stroke) => {
                // draw to remote canvas and primary canvas to keep visuals consistent
                drawStrokeFromHistory(remoteCtx, stroke);
                drawStrokeFromHistory(ctx, stroke);
            });
        }

        saveHistory();
    });

    wsManager.on('drawing-history', (data) => {
        if (!data || !Array.isArray(data.history)) return;
        data.history.forEach(stroke => {
            drawLineRemote(stroke.fromX, stroke.fromY, stroke.toX, stroke.toY, stroke.color, stroke.width, stroke.tool);
        });
    });

    wsManager.on('remote-cursor-move', (data) => {
        if (!data) return;
        updateRemoteCursor(data.userId, data.x, data.y);
        if (remoteUsers.has(data.userId)) {
            const u = remoteUsers.get(data.userId);
            u.x = data.x;
            u.y = data.y;
        }
    });

    wsManager.on('room-error', (data) => {
        if (data && data.message) alert(data.message);
        window.location.href = 'index.html';
    });
}

function drawStrokeFromHistory(targetCtx, stroke) {
    if (!targetCtx || !stroke) return;
    const { fromX, fromY, toX, toY, color, width, tool } = stroke;

    if (tool === 'eraser') {
        targetCtx.clearRect(fromX - width / 2, fromY - width / 2, width, width);
        targetCtx.clearRect(toX - width / 2, toY - width / 2, width, width);
    } else if (tool === 'rectangle') {
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = width;
        targetCtx.strokeRect(fromX, fromY, toX - fromX, toY - fromY);
    } else if (tool === 'circle') {
        const radius = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = width;
        targetCtx.beginPath();
        targetCtx.arc(fromX, fromY, radius, 0, 2 * Math.PI);
        targetCtx.stroke();
    } else {
        targetCtx.beginPath();
        targetCtx.moveTo(fromX, fromY);
        targetCtx.lineTo(toX, toY);
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = width;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.stroke();
        targetCtx.closePath();
    }
}

function startDrawing(e) {
    isDrawing = true;

    // record start coordinates
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const rect = canvas.getBoundingClientRect();
    startX = clientX - rect.left;
    startY = clientY - rect.top;

    // new stroke id for grouping
    currentStrokeId = `s-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    // Save the canvas before user starts drawing so undo can revert to previous state
    saveHistory();

    // For shapes we keep the snapshot and draw preview while moving
    if (currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') {
        // nothing else needed here; preview handled in mousemove
    }
}

function handleMouseMove(e) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const posEl = document.getElementById('posDisplay');
    if (posEl) posEl.textContent = `${Math.round(x)}, ${Math.round(y)}`;

    if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
        wsManager.sendCursorMove(x, y);
    }

    if (!isDrawing) return;

    if (currentTool === 'brush') {
        drawLine(startX, startY, x, y, currentColor, currentStrokeWidth);

        if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
            wsManager.sendDraw({
                fromX: startX,
                fromY: startY,
                toX: x,
                toY: y,
                color: currentColor,
                width: currentStrokeWidth,
                tool: 'brush',
                strokeId: currentStrokeId
            });
        }
        startX = x;
        startY = y;
    } else if (currentTool === 'eraser') {
        erase(x, y, currentStrokeWidth);

        if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
            wsManager.sendDraw({
                fromX: startX,
                fromY: startY,
                toX: x,
                toY: y,
                color: 'transparent',
                width: currentStrokeWidth,
                tool: 'eraser',
                strokeId: currentStrokeId
            });
        }
        startX = x;
        startY = y;
    } else if (currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') {
        // preview: restore last saved image and draw preview shape
        if (history.length > 0) {
            ctx.putImageData(history[history.length - 1], 0, 0);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (currentTool === 'line') {
            drawLine(startX, startY, x, y, currentColor, currentStrokeWidth);
        } else if (currentTool === 'rectangle') {
            drawRectangle(startX, startY, x, y, currentColor, currentStrokeWidth);
        } else if (currentTool === 'circle') {
            drawCircle(startX, startY, x, y, currentColor, currentStrokeWidth);
        }
    }
}

function handleTouchStart(e) {
    if (!e) return;
    e.preventDefault();
    startDrawing(e);
}

function handleTouchMove(e) {
    if (!e) return;
    e.preventDefault();
    if (!isDrawing) return;

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (currentTool === 'brush') {
        drawLine(startX, startY, x, y, currentColor, currentStrokeWidth);
        if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
            wsManager.sendDraw({
                fromX: startX,
                fromY: startY,
                toX: x,
                toY: y,
                color: currentColor,
                width: currentStrokeWidth,
                tool: 'brush',
                strokeId: currentStrokeId
            });
        }
        startX = x;
        startY = y;
    } else if (currentTool === 'eraser') {
        erase(x, y, currentStrokeWidth);
        if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
            wsManager.sendDraw({
                fromX: startX,
                fromY: startY,
                toX: x,
                toY: y,
                color: 'transparent',
                width: currentStrokeWidth,
                tool: 'eraser',
                strokeId: currentStrokeId
            });
        }
        startX = x;
        startY = y;
    } else {
        // For shape preview use same logic as mousemove — restore snapshot and draw preview
        if (history.length > 0) {
            ctx.putImageData(history[history.length - 1], 0, 0);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (currentTool === 'line') {
            drawLine(startX, startY, x, y, currentColor, currentStrokeWidth);
        } else if (currentTool === 'rectangle') {
            drawRectangle(startX, startY, x, y, currentColor, currentStrokeWidth);
        } else if (currentTool === 'circle') {
            drawCircle(startX, startY, x, y, currentColor, currentStrokeWidth);
        }
    }
}

function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;

    // compute final end coordinates for shapes
    const rect = canvas.getBoundingClientRect();
    let endX = startX;
    let endY = startY;

    if (e) {
        if (e.clientX !== undefined) {
            endX = e.clientX - rect.left;
            endY = e.clientY - rect.top;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            endX = e.changedTouches[0].clientX - rect.left;
            endY = e.changedTouches[0].clientY - rect.top;
        }
    }

    if ((currentTool === 'line' || currentTool === 'rectangle' || currentTool === 'circle') && wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
        wsManager.sendDrawLine({
            fromX: startX,
            fromY: startY,
            toX: endX,
            toY: endY,
            color: currentColor,
            width: currentStrokeWidth,
            tool: currentTool,
            strokeId: `s-${Date.now()}-${Math.floor(Math.random() * 100000)}`
        });

        // draw final shape locally (ensure preview is committed)
        if (history.length > 0) {
            ctx.putImageData(history[history.length - 1], 0, 0);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (currentTool === 'line') {
            drawLine(startX, startY, endX, endY, currentColor, currentStrokeWidth);
        } else if (currentTool === 'rectangle') {
            drawRectangle(startX, startY, endX, endY, currentColor, currentStrokeWidth);
        } else if (currentTool === 'circle') {
            drawCircle(startX, startY, endX, endY, currentColor, currentStrokeWidth);
        }
    }

    // commit final canvas state to history so undo works
    saveHistory();

    currentStrokeId = null;
}

function drawLine(fromX, fromY, toX, toY, color, width) {
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();
}

function drawLineRemote(fromX, fromY, toX, toY, color, width, tool) {
    if (tool === 'eraser') {
        remoteCtx.clearRect(fromX - width / 2, fromY - width / 2, width, width);
        remoteCtx.clearRect(toX - width / 2, toY - width / 2, width, width);
    } else if (tool === 'rectangle') {
        remoteCtx.strokeStyle = color;
        remoteCtx.lineWidth = width;
        remoteCtx.strokeRect(fromX, fromY, toX - fromX, toY - fromY);
    } else if (tool === 'circle') {
        const radius = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
        remoteCtx.strokeStyle = color;
        remoteCtx.lineWidth = width;
        remoteCtx.beginPath();
        remoteCtx.arc(fromX, fromY, radius, 0, 2 * Math.PI);
        remoteCtx.stroke();
    } else {
        remoteCtx.beginPath();
        remoteCtx.moveTo(fromX, fromY);
        remoteCtx.lineTo(toX, toY);
        remoteCtx.strokeStyle = color;
        remoteCtx.lineWidth = width;
        remoteCtx.lineCap = 'round';
        remoteCtx.lineJoin = 'round';
        remoteCtx.stroke();
        remoteCtx.closePath();
    }
}

function erase(x, y, size) {
    ctx.clearRect(x - size / 2, y - size / 2, size, size);
}

function drawRectangle(fromX, fromY, toX, toY, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(fromX, fromY, toX - fromX, toY - fromY);
}

function drawCircle(fromX, fromY, toX, toY, color, width) {
    const radius = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(fromX, fromY, radius, 0, 2 * Math.PI);
    ctx.stroke();
}

function selectTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    const toolButton = document.getElementById(tool + 'Tool');
    if (toolButton) toolButton.classList.add('active');

    const toolDisplay = document.getElementById('toolDisplay');
    if (!toolDisplay) return;

    if (tool === 'brush') {
        canvas.style.cursor = 'crosshair';
        toolDisplay.textContent = 'Brush';
    } else if (tool === 'eraser') {
        canvas.style.cursor = 'cell';
        toolDisplay.textContent = 'Eraser';
    } else if (tool === 'line') {
        canvas.style.cursor = 'crosshair';
        toolDisplay.textContent = 'Line';
    } else if (tool === 'rectangle') {
        canvas.style.cursor = 'crosshair';
        toolDisplay.textContent = 'Rectangle';
    } else if (tool === 'circle') {
        canvas.style.cursor = 'crosshair';
        toolDisplay.textContent = 'Circle';
    }
}

function changeColor(color) {
    currentColor = color;
    const preview = document.getElementById('colorPreview');
    if (preview) preview.style.background = color;
}

function changeStrokeWidth(width) {
    currentStrokeWidth = width;
    const sd = document.getElementById('strokeDisplay');
    if (sd) sd.textContent = width + 'px';
}

function saveHistory() {
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        history.push(imageData);

        if (history.length > MAX_HISTORY) history.shift();

        // clear redo stack when new history state is created
        redoStack.length = 0;
    } catch (err) {
        console.warn('saveHistory() failed:', err);
    }
}

function undoAction() {
    console.log('=== UNDO BUTTON CLICKED ===');

    if (!wsManager || typeof wsManager.isSocketConnected !== 'function' || !wsManager.isSocketConnected()) {
        console.warn('WebSocket not connected, cannot send undo');
        return;
    }

    if (undoAction._last && (Date.now() - undoAction._last) < 500) {
        console.log('Undo ignored (debounced)');
        return;
    }
    undoAction._last = Date.now();

    try {
        console.log('Sending undo request to server...');
        wsManager.sendUndo();
        console.log('Undo request sent — waiting for server full-history-update');
    } catch (err) {
        console.error('Failed to send undo request:', err);
    }
}

function redoAction() {
    console.log('=== REDO BUTTON CLICKED ===');

    if (!wsManager || typeof wsManager.isSocketConnected !== 'function' || !wsManager.isSocketConnected()) {
        console.warn('WebSocket not connected, cannot send redo');
        return;
    }

    if (redoAction._last && (Date.now() - redoAction._last) < 500) {
        console.log('Redo ignored (debounced)');
        return;
    }
    redoAction._last = Date.now();

    try {
        console.log('Sending redo request to server...');
        wsManager.sendRedo();
        console.log('Redo request sent — waiting for server full-history-update');
    } catch (err) {
        console.error('Failed to send redo request:', err);
    }
}

function clearCanvas() {
    if (!confirm('Are you sure you want to clear the entire canvas?')) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    remoteCtx.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
    saveHistory();

    if (wsManager && typeof wsManager.isSocketConnected === 'function' && wsManager.isSocketConnected()) {
        wsManager.clearCanvas();
    }
}

function redrawCanvas() {
    if (history.length > 0) {
        try {
            ctx.putImageData(history[history.length - 1], 0, 0);
        } catch (err) {
            console.warn('redrawCanvas failed', err);
        }
    }
}

function downloadCanvas() {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `canvas-${currentUser.roomId}-${Date.now()}.png`;
    link.click();
    console.log('Canvas downloaded');
}

function toggleFullscreen() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => console.log('Fullscreen error:', err));
    } else {
        document.exitFullscreen();
    }
}

function generateUserColor() {
    const colors = ['#7e22ce', '#1e3c72', '#f59e0b', '#ef4444', '#10b981', '#3b82f6'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function updateUsersCount() {
    const count = remoteUsers.size + 1;
    const usersCountEl = document.getElementById('usersCount');
    if (usersCountEl) usersCountEl.textContent = count;

    const usersList = document.getElementById('usersList');
    if (!usersList) return;
    usersList.innerHTML = '';

    const userBadge = document.createElement('span');
    userBadge.className = 'user-badge';
    userBadge.textContent = `${currentUser.name} (You)`;
    usersList.appendChild(userBadge);

    remoteUsers.forEach((user) => {
        const badge = document.createElement('span');
        badge.className = 'user-badge';
        badge.style.borderLeft = `3px solid ${user.color}`;
        badge.textContent = `${user.name}`;
        usersList.appendChild(badge);
    });
}

function addRemoteUser(userId, name, color) {
    remoteUsers.set(userId, { name, color, x: 0, y: 0 });
    updateUsersCount();
}

function removeRemoteUser(userId) {
    remoteUsers.delete(userId);
    const cursor = document.getElementById(`cursor-${userId}`);
    if (cursor) cursor.remove();
    updateUsersCount();
}

function updateRemoteCursor(userId, x, y) {
    if (!userId) return;
    let cursor = document.getElementById(`cursor-${userId}`);

    const user = remoteUsers.get(userId);

    if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = `cursor-${userId}`;
        cursor.className = 'remote-cursor';

        const pointerDiv = document.createElement('div');
        pointerDiv.className = 'cursor-pointer';
        pointerDiv.style.borderColor = user ? user.color : '#7e22ce';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'cursor-label';
        labelDiv.textContent = user ? user.name : 'User';
        labelDiv.style.background = user ? user.color : '#7e22ce';

        cursor.appendChild(pointerDiv);
        cursor.appendChild(labelDiv);

        const container = document.getElementById('cursorsContainer');
        if (container) container.appendChild(cursor);
    }

    cursor.style.left = (x - 10) + 'px';
    cursor.style.top = (y - 10) + 'px';
}

function leaveRoom() {
    if (!confirm('Are you sure you want to leave this room?')) return;

    if (wsManager) wsManager.disconnect();

    localStorage.removeItem('userName');
    localStorage.removeItem('roomId');
    localStorage.removeItem('isHost');
    window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
});
