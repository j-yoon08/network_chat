const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const os = require('os');

let mainWindow;
let server;
let io;
let connectedUsers = new Map();
let fileMetadata = new Map();

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/', 'text/', 'application/pdf', 'application/zip'];
    const isAllowed = allowedMimes.some(mime => file.mimetype.startsWith(mime));
    cb(null, isAllowed);
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
}

function createServer() {
  const expressApp = express();
  server = http.createServer(expressApp);
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  expressApp.use(express.static('.'));
  expressApp.use(express.json());

  expressApp.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) {
      const fileInfo = {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        timestamp: Date.now(),
        uploader: req.body.uploader || 'Unknown'
      };
      
      fileMetadata.set(req.file.filename, {
        originalName: req.file.originalname,
        uploader: req.body.uploader || 'Unknown'
      });
      
      io.emit('file-shared', fileInfo);
      res.json({ success: true, file: fileInfo });
    } else {
      res.status(400).json({ success: false, message: 'No file uploaded' });
    }
  });

  expressApp.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filepath = path.join(__dirname, 'uploads', filename);
    const metadata = fileMetadata.get(filename);
    
    if (fs.existsSync(filepath) && filepath.startsWith(path.join(__dirname, 'uploads'))) {
      const originalName = metadata ? metadata.originalName : filename;
      res.download(filepath, originalName);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (username) => {
      username = username.replace(/[<>"'&]/g, '').trim();
      
      if (!username || username.length > 20) {
        socket.emit('error', { message: '유효하지 않은 사용자명입니다.' });
        return;
      }
      
      if (connectedUsers.has(username)) {
        socket.emit('error', { message: '이미 사용중인 사용자명입니다.' });
        return;
      }
      
      socket.username = username;
      connectedUsers.set(username, socket.id);
      socket.broadcast.emit('user-joined', username);
      
      const userList = Array.from(connectedUsers.keys()).filter(u => u !== username);
      socket.emit('users-list', userList);
    });

    socket.on('chat-message', (data) => {
      if (!socket.username) return;
      
      const message = data.message.replace(/[<>"'&]/g, '').trim();
      if (!message || message.length > 500) return;
      
      io.emit('chat-message', {
        username: socket.username,
        message: message,
        timestamp: Date.now()
      });
    });

    socket.on('notification', (data) => {
      if (!socket.username) return;
      
      const message = data.message.replace(/[<>"'&]/g, '').trim();
      if (!message || message.length > 100) return;
      
      socket.broadcast.emit('notification', {
        from: socket.username,
        message: message,
        timestamp: Date.now()
      });
    });

    socket.on('disconnect', () => {
      if (socket.username) {
        connectedUsers.delete(socket.username);
        socket.broadcast.emit('user-left', socket.username);
      }
      console.log('User disconnected:', socket.id);
    });
  });

  server.listen(3000, '0.0.0.0', () => {
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    for (const interfaceName in networkInterfaces) {
      const networkInterface = networkInterfaces[interfaceName];
      for (const network of networkInterface) {
        if (network.family === 'IPv4' && !network.internal) {
          localIP = network.address;
          break;
        }
      }
      if (localIP !== 'localhost') break;
    }
    
    console.log('Server running on port 3000');
    console.log(`Local access: http://localhost:3000`);
    console.log(`Network access: http://${localIP}:3000`);
  });
}

app.whenReady().then(() => {
  createMainWindow();
  createServer();
  
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (server) {
      server.close();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});