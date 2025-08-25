const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');

let server;
let io;
let connectedUsers = new Map();
let fileMetadata = new Map();
let chatHistory = [];

// 파일 메타데이터를 JSON 파일로 저장/로드하는 함수들
function saveFileMetadata() {
  try {
    const data = Object.fromEntries(fileMetadata);
    fs.writeFileSync('file-metadata.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('파일 메타데이터 저장 실패:', error);
  }
}

function loadFileMetadata() {
  try {
    if (fs.existsSync('file-metadata.json')) {
      const data = JSON.parse(fs.readFileSync('file-metadata.json', 'utf8'));
      fileMetadata = new Map(Object.entries(data));
      console.log('파일 메타데이터 로드 완료:', fileMetadata.size, '개 파일');
    } else {
      // 기존 파일들에 대한 메타데이터가 없다면 생성
      generateMissingMetadata();
    }
  } catch (error) {
    console.error('파일 메타데이터 로드 실패:', error);
    fileMetadata = new Map();
    generateMissingMetadata();
  }
}

function generateMissingMetadata() {
  try {
    if (fs.existsSync('uploads')) {
      const files = fs.readdirSync('uploads');
      let newMetadataCount = 0;
      
      files.forEach(filename => {
        if (!fileMetadata.has(filename)) {
          const filepath = path.join(__dirname, 'uploads', filename);
          const stats = fs.statSync(filepath);
          
          // 파일 내용을 기반으로 확장자 추측
          const detectedExtension = detectFileExtension(filepath);
          const friendlyName = `파일_${filename.substring(0, 8)}${detectedExtension}`;
          
          fileMetadata.set(filename, {
            originalName: friendlyName,
            uploader: 'Unknown',
            size: stats.size,
            timestamp: stats.mtime.getTime()
          });
          newMetadataCount++;
        }
      });
      
      if (newMetadataCount > 0) {
        saveFileMetadata();
        console.log('기존 파일들의 메타데이터 생성 완료:', newMetadataCount, '개 파일');
      }
    }
  } catch (error) {
    console.error('기존 파일 메타데이터 생성 실패:', error);
  }
}

function detectFileExtension(filepath) {
  try {
    // 파일의 첫 몇 바이트를 읽어서 파일 형식 추측
    const buffer = fs.readFileSync(filepath, { start: 0, end: 10 });
    
    // 일반적인 파일 시그니처 확인
    const signature = buffer.toString('hex').toUpperCase();
    
    if (signature.startsWith('FFD8FF')) return '.jpg'; // JPEG
    if (signature.startsWith('89504E47')) return '.png'; // PNG
    if (signature.startsWith('47494638')) return '.gif'; // GIF
    if (signature.startsWith('25504446')) return '.pdf'; // PDF
    if (signature.startsWith('504B0304') || signature.startsWith('504B0506')) return '.zip'; // ZIP
    if (signature.startsWith('D0CF11E0')) return '.doc'; // MS Office
    if (signature.startsWith('504B0304') && filepath.includes('xl')) return '.xlsx'; // Excel
    
    // 텍스트 파일인지 확인
    const sampleSize = Math.min(1024, buffer.length);
    const sample = fs.readFileSync(filepath, { start: 0, end: sampleSize });
    const isText = sample.every(byte => byte === 0x09 || byte === 0x0A || byte === 0x0D || (byte >= 0x20 && byte <= 0x7E));
    
    if (isText) return '.txt';
    
    return '.bin'; // 알 수 없는 바이너리 파일
  } catch (error) {
    console.error('파일 형식 감지 실패:', error);
    return '.unknown';
  }
}

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/', 'text/', 'application/pdf', 'application/zip'];
    const isAllowed = allowedMimes.some(mime => file.mimetype.startsWith(mime));
    cb(null, isAllowed);
  }
});

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
        uploader: req.body.uploader || 'Unknown',
        size: req.file.size,
        timestamp: Date.now()
      });
      
      // 파일 메타데이터를 파일로 저장
      saveFileMetadata();
      
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
      
      // 더 명확한 헤더 설정
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      console.log(`파일 다운로드 요청: ${filename} -> ${originalName}`);
      res.download(filepath, originalName);
    } else {
      console.log(`파일을 찾을 수 없음: ${filename}`);
      res.status(404).json({ error: 'File not found' });
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // 새 사용자에게 최근 채팅 기록 전송 (최대 50개)
    socket.emit('chat-history', chatHistory.slice(-50));
    
    // 새 사용자에게 기존 파일 목록 전송
    const existingFiles = [];
    for (const [filename, metadata] of fileMetadata.entries()) {
      // 파일이 실제로 존재하는지 확인
      const filepath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(filepath)) {
        existingFiles.push({
          originalName: metadata.originalName,
          filename: filename,
          size: metadata.size || 0,
          timestamp: metadata.timestamp || Date.now(),
          uploader: metadata.uploader || 'Unknown'
        });
      }
    }
    
    // 기존 파일들을 파일 목록에만 추가 (채팅 메시지 없이)
    existingFiles.forEach(fileInfo => {
      socket.emit('existing-file', fileInfo);
    });

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
      
      // 시스템 메시지도 채팅 기록에 저장
      const joinMessage = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        username: '시스템',
        message: `${username}님이 채팅에 참여했습니다.`,
        timestamp: Date.now(),
        type: 'system'
      };
      chatHistory.push(joinMessage);
      if (chatHistory.length > 1000) {
        chatHistory.shift();
      }
    });

    socket.on('chat-message', (data) => {
      if (!socket.username) return;
      
      const message = data.message.replace(/[<>"'&]/g, '').trim();
      if (!message || message.length > 500) return;
      
      const messageData = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        username: socket.username,
        message: message,
        timestamp: Date.now(),
        type: 'chat'
      };
      
      // 채팅 기록에 저장 (최대 1000개 유지)
      chatHistory.push(messageData);
      if (chatHistory.length > 1000) {
        chatHistory.shift();
      }
      
      io.emit('chat-message', messageData);
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

    socket.on('typing-start', () => {
      if (socket.username) {
        socket.broadcast.emit('user-typing', { username: socket.username, typing: true });
      }
    });

    socket.on('typing-stop', () => {
      if (socket.username) {
        socket.broadcast.emit('user-typing', { username: socket.username, typing: false });
      }
    });

    socket.on('disconnect', () => {
      if (socket.username) {
        connectedUsers.delete(socket.username);
        socket.broadcast.emit('user-left', socket.username);
        
        // 나가는 사용자 메시지도 채팅 기록에 저장
        const leaveMessage = {
          id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          username: '시스템',
          message: `${socket.username}님이 채팅을 나갔습니다.`,
          timestamp: Date.now(),
          type: 'system'
        };
        chatHistory.push(leaveMessage);
        if (chatHistory.length > 1000) {
          chatHistory.shift();
        }
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
    
    console.log('🚀 네트워크 채팅 서버가 시작되었습니다!');
    console.log(`📱 로컬 접속: http://localhost:3000`);
    console.log(`🌐 네트워크 접속: http://${localIP}:3000`);
    console.log('📁 파일 업로드 폴더:', path.join(__dirname, 'uploads'));
  });
}

// 서버 시작
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 저장된 파일 메타데이터 로드
loadFileMetadata();

createServer();

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.log('\n서버를 종료합니다...');
  if (server) {
    server.close(() => {
      console.log('서버가 정상적으로 종료되었습니다.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.log('\n서버를 종료합니다...');
  if (server) {
    server.close(() => {
      console.log('서버가 정상적으로 종료되었습니다.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});