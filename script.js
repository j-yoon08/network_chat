const socket = io();
let currentUser = '';
let connectedUsers = new Set();
let typingUsers = new Set();
let typingTimeout;
let isConnected = true;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

document.getElementById('username').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        joinChat();
    }
});

let isComposing = false; // IME 입력 상태 추적

// IME 입력 이벤트 리스너 (한글 입력 처리)
document.getElementById('message-input').addEventListener('compositionstart', function(e) {
    isComposing = true;
});

document.getElementById('message-input').addEventListener('compositionend', function(e) {
    isComposing = false;
});

document.getElementById('message-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            // Shift+Enter: 줄바꿈 (기본 동작 허용)
            startTyping();
            return;
        } else if (!isComposing) {
            // Enter: 메시지 전송 (IME 입력 중이 아닐 때만)
            e.preventDefault();
            sendMessage();
            stopTyping();
        }
    } else {
        if (!isComposing) {
            startTyping();
        }
    }
});

document.getElementById('message-input').addEventListener('input', function(e) {
    // 자동 크기 조정
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    
    // 전송 버튼 활성화/비활성화
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = !e.target.value.trim();
    
    if (e.target.value.trim()) {
        startTyping();
    } else {
        stopTyping();
    }
});

document.getElementById('notification-message').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendNotification();
    }
});

function joinChat() {
    const username = document.getElementById('username').value.trim();
    if (username) {
        currentUser = username;
        saveUsername(username); // 사용자명 저장
        socket.emit('join-room', username);
        document.getElementById('username').disabled = true;
        addSystemMessage(`${username}님이 채팅에 참여했습니다.`);
    }
}

let isSending = false; // 메시지 전송 상태 추적

function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    const sendBtn = document.getElementById('send-btn');
    
    // 빈 메시지, 전송 중, IME 입력 중이면 중복 방지
    if (!message || sendBtn.disabled || isSending || isComposing) {
        return;
    }
    
    if (!isConnected) {
        showConnectionStatus('연결이 끊어졌습니다. 메시지를 보낼 수 없습니다.', 'warning');
        return;
    }
    
    if (!currentUser) {
        alert('먼저 사용자명을 입력하고 채팅에 참여하세요.');
        return;
    }
    
    // 전송 상태 즉시 설정으로 중복 방지
    isSending = true;
    sendBtn.disabled = true;
    
    // 메시지 전송
    socket.emit('chat-message', { message: message });
    messageInput.value = '';
    messageInput.style.height = 'auto';
    stopTyping();
    
    // 짧은 딜레이 후 전송 상태 해제
    setTimeout(() => {
        isSending = false;
        sendBtn.disabled = !messageInput.value.trim();
    }, 200);
}

function startTyping() {
    if (!currentUser) return;
    
    socket.emit('typing-start');
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        stopTyping();
    }, 3000);
}

function stopTyping() {
    if (!currentUser) return;
    
    socket.emit('typing-stop');
    clearTimeout(typingTimeout);
}

function selectFile() {
    if (!currentUser) {
        alert('먼저 사용자명을 입력하고 채팅에 참여하세요.');
        return;
    }
    document.getElementById('file-input').click();
}

document.getElementById('file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        uploadFile(file);
    }
});

function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploader', currentUser);
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            alert('파일 업로드에 실패했습니다.');
        }
    })
    .catch(error => {
        console.error('Upload error:', error);
        alert('파일 업로드 중 오류가 발생했습니다.');
    });
    
    document.getElementById('file-input').value = '';
}

function sendNotification() {
    const notificationInput = document.getElementById('notification-message');
    const message = notificationInput.value.trim();
    
    if (message && currentUser) {
        socket.emit('notification', { message: message });
        notificationInput.value = '';
        showNotification(`알림을 전송했습니다: ${message}`, 'success');
    } else if (!currentUser) {
        alert('먼저 사용자명을 입력하고 채팅에 참여하세요.');
    }
}

function addMessage(username, message, timestamp) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    
    const isOwn = username === currentUser;
    messageElement.className = `message ${isOwn ? 'own' : ''}`;
    
    const time = new Date(timestamp).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    
    if (!isOwn) {
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'username';
        usernameSpan.textContent = username;
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = time;
        
        messageHeader.appendChild(usernameSpan);
        messageHeader.appendChild(timestampSpan);
        messageBubble.appendChild(messageHeader);
    }
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = message;
    messageBubble.appendChild(messageContent);
    
    if (isOwn) {
        const timestampSpan = document.createElement('div');
        timestampSpan.className = 'message-header';
        timestampSpan.innerHTML = `<span class="timestamp">${time}</span>`;
        messageBubble.appendChild(timestampSpan);
    }
    
    messageElement.appendChild(messageBubble);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(message) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message system';
    
    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    messageBubble.textContent = message;
    
    messageElement.appendChild(messageBubble);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateUsersList() {
    const usersList = document.getElementById('online-users');
    usersList.innerHTML = '';
    
    if (currentUser) {
        const userElement = document.createElement('li');
        const statusDot = document.createElement('span');
        statusDot.className = 'status-dot';
        const userText = document.createTextNode(`${currentUser} (나)`);
        userElement.appendChild(statusDot);
        userElement.appendChild(userText);
        usersList.appendChild(userElement);
    }
    
    connectedUsers.forEach(user => {
        if (user !== currentUser) {
            const userElement = document.createElement('li');
            const statusDot = document.createElement('span');
            statusDot.className = 'status-dot';
            const userText = document.createTextNode(user);
            
            // 타이핑 중인 사용자 표시
            if (typingUsers.has(user)) {
                const typingIndicator = document.createElement('span');
                typingIndicator.style.marginLeft = '5px';
                typingIndicator.style.color = '#3498db';
                typingIndicator.textContent = '(입력중...)';
                userElement.appendChild(statusDot);
                userElement.appendChild(userText);
                userElement.appendChild(typingIndicator);
            } else {
                userElement.appendChild(statusDot);
                userElement.appendChild(userText);
            }
            
            usersList.appendChild(userElement);
        }
    });
}

function addFileToList(fileInfo) {
    const fileList = document.getElementById('file-list');
    const fileElement = document.createElement('div');
    fileElement.className = 'file-item';
    
    const fileSize = formatFileSize(fileInfo.size);
    
    const fileInfoDiv = document.createElement('div');
    fileInfoDiv.className = 'file-info';
    
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = fileInfo.originalName;
    
    const fileSizeDiv = document.createElement('div');
    fileSizeDiv.className = 'file-size';
    fileSizeDiv.textContent = fileSize;
    
    fileInfoDiv.appendChild(fileName);
    fileInfoDiv.appendChild(fileSizeDiv);
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn';
    downloadBtn.textContent = '다운로드';
    downloadBtn.onclick = () => downloadFile(fileInfo.filename, fileInfo.originalName);
    
    fileElement.appendChild(fileInfoDiv);
    fileElement.appendChild(downloadBtn);
    
    fileList.appendChild(fileElement);
}

function downloadFile(filename, originalName) {
    try {
        const link = document.createElement('a');
        link.href = `/download/${filename}`;
        link.download = originalName || filename;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        
        // 스타일을 숨김으로 설정
        link.style.display = 'none';
        
        document.body.appendChild(link);
        
        // 약간의 지연을 주어 DOM에 추가된 후 클릭
        setTimeout(() => {
            link.click();
            setTimeout(() => {
                if (document.body.contains(link)) {
                    document.body.removeChild(link);
                }
            }, 100);
        }, 10);
        
        // 사용자에게 다운로드 시작 알림
        showNotification(`파일 다운로드를 시작합니다: ${originalName || filename}`, 'success');
        
    } catch (error) {
        console.error('다운로드 오류:', error);
        showNotification('파일 다운로드에 실패했습니다.', 'error');
        
        // 대체 방법: 새 창에서 열기
        try {
            window.open(`/download/${filename}`, '_blank');
        } catch (fallbackError) {
            console.error('대체 다운로드 방법도 실패:', fallbackError);
        }
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = 'notification';
    if (type === 'success') {
        notification.style.background = '#2ecc71';
    } else if (type === 'error') {
        notification.style.background = '#e74c3c';
    }
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    }, 3000);
}

function showTab(tabName) {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.tab-panel');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    panels.forEach(panel => panel.classList.add('hidden'));
    
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');
    
    // 모바일에서 탭 전환 시 사이드바 유지 (사용자가 명시적으로 닫을 때까지)
}

socket.on('chat-message', (data) => {
    addMessage(data.username, data.message, data.timestamp);
});

socket.on('user-joined', (username) => {
    connectedUsers.add(username);
    updateUsersList();
    addSystemMessage(`${username}님이 채팅에 참여했습니다.`);
});

socket.on('user-left', (username) => {
    connectedUsers.delete(username);
    updateUsersList();
    addSystemMessage(`${username}님이 채팅을 나갔습니다.`);
});

socket.on('file-shared', (fileInfo) => {
    addFileToList(fileInfo);
    addSystemMessage(`${fileInfo.uploader}님이 파일을 공유했습니다: ${fileInfo.originalName}`);
    
    // 이미지 파일인 경우 채팅창에 미리보기 표시
    if (fileInfo.originalName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        addImageToChat(fileInfo);
    }
});

// 기존 파일들을 사이드바에만 추가 (채팅 메시지 없이)
socket.on('existing-file', (fileInfo) => {
    addFileToList(fileInfo);
    // 채팅 메시지나 이미지 미리보기는 표시하지 않음
});

socket.on('notification', (data) => {
    showNotification(`${data.from}님의 알림: ${data.message}`, 'info');
    
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${data.from}님의 알림`, {
            body: data.message,
            icon: '/favicon.ico'
        });
    }
});

socket.on('error', (data) => {
    alert(data.message);
    // 오류 발생 시 입력창 다시 활성화
    document.getElementById('username').disabled = false;
    document.getElementById('username').focus();
    document.getElementById('username').select();
});

socket.on('users-list', (users) => {
    users.forEach(user => connectedUsers.add(user));
    updateUsersList();
});

// 네트워크 연결 상태 관리
socket.on('connect', () => {
    isConnected = true;
    reconnectAttempts = 0;
    hideConnectionStatus();
    
    // 재연결시 사용자가 이미 채팅 중이었다면 자동으로 재입장
    if (currentUser) {
        socket.emit('join-room', currentUser);
    }
});

socket.on('disconnect', () => {
    isConnected = false;
    showConnectionStatus('연결이 끊어졌습니다. 재연결 시도 중...', 'warning');
});

socket.on('connect_error', () => {
    reconnectAttempts++;
    if (reconnectAttempts >= maxReconnectAttempts) {
        showConnectionStatus('서버 연결에 실패했습니다. 페이지를 새로고침해주세요.', 'error');
    } else {
        showConnectionStatus(`재연결 시도 중... (${reconnectAttempts}/${maxReconnectAttempts})`, 'warning');
    }
});

function showConnectionStatus(message, type) {
    let statusElement = document.getElementById('connection-status');
    
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'connection-status';
        statusElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2000;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
        `;
        document.body.appendChild(statusElement);
    }
    
    statusElement.textContent = message;
    
    if (type === 'error') {
        statusElement.style.background = 'var(--error)';
        statusElement.style.color = 'white';
    } else if (type === 'warning') {
        statusElement.style.background = 'var(--warning)';
        statusElement.style.color = 'white';
    } else {
        statusElement.style.background = 'var(--success)';
        statusElement.style.color = 'white';
    }
}

function hideConnectionStatus() {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.remove();
    }
}

socket.on('chat-history', (history) => {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = ''; // 기존 메시지 클리어
    
    history.forEach(msg => {
        if (msg.type === 'system') {
            addSystemMessage(msg.message);
        } else {
            addMessage(msg.username, msg.message, msg.timestamp);
        }
    });
});

socket.on('user-typing', (data) => {
    if (data.typing) {
        typingUsers.add(data.username);
    } else {
        typingUsers.delete(data.username);
    }
    updateUsersList();
});

if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// 드래그 앤 드롭 기능
const chatMessages = document.getElementById('chat-messages');
const dropZone = document.getElementById('drop-zone');

chatMessages.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!currentUser) return;
    dropZone.classList.remove('hidden');
});

chatMessages.addEventListener('dragover', (e) => {
    e.preventDefault();
});

chatMessages.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!chatMessages.contains(e.relatedTarget)) {
        dropZone.classList.add('hidden');
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.add('hidden');
    
    if (!currentUser) {
        alert('먼저 사용자명을 입력하고 채팅에 참여하세요.');
        return;
    }
    
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
        if (file.size <= 50 * 1024 * 1024) { // 50MB 제한
            uploadFile(file);
        } else {
            alert(`${file.name}은(는) 50MB를 초과합니다.`);
        }
    });
});

// 이미지 미리보기 기능
function addImageToChat(fileInfo) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    
    const isOwn = fileInfo.uploader === currentUser;
    messageElement.className = `message image-message ${isOwn ? 'own' : ''}`;
    
    const time = new Date(fileInfo.timestamp).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    
    if (!isOwn) {
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'username';
        usernameSpan.textContent = fileInfo.uploader;
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'timestamp';
        timestampSpan.textContent = time;
        
        messageHeader.appendChild(usernameSpan);
        messageHeader.appendChild(timestampSpan);
        messageBubble.appendChild(messageHeader);
    }
    
    const img = document.createElement('img');
    img.className = 'message-image';
    img.src = `/download/${fileInfo.filename}`;
    img.alt = fileInfo.originalName;
    img.onclick = () => showImagePreview(img.src, fileInfo.originalName);
    
    messageBubble.appendChild(img);
    
    if (isOwn) {
        const timestampSpan = document.createElement('div');
        timestampSpan.className = 'message-header';
        timestampSpan.innerHTML = `<span class="timestamp">${time}</span>`;
        messageBubble.appendChild(timestampSpan);
    }
    
    messageElement.appendChild(messageBubble);
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showImagePreview(imageSrc, fileName) {
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    
    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = fileName;
    
    overlay.appendChild(img);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
}

window.addEventListener('beforeunload', () => {
    if (currentUser) {
        socket.disconnect();
    }
});

// 모바일 사이드바 기능
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
}

// 모바일 사이드바 이벤트 리스너
document.getElementById('mobile-menu-btn').addEventListener('click', toggleSidebar);
document.getElementById('sidebar-close-btn').addEventListener('click', closeSidebar);
document.getElementById('mobile-overlay').addEventListener('click', closeSidebar);

// ESC 키로 사이드바 닫기
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeSidebar();
    }
});

// 모바일 키보드 대응
let initialViewportHeight = window.innerHeight;

function handleViewportChange() {
    // 화면 크기 변경시 사이드바 상태 리셋
    if (window.innerWidth > 768) {
        closeSidebar();
    }
    
    const currentHeight = window.innerHeight;
    const heightDifference = initialViewportHeight - currentHeight;
    
    // 키보드가 올라왔다고 추정 (높이가 150px 이상 줄어든 경우)
    if (heightDifference > 150) {
        document.body.classList.add('keyboard-open');
        // 채팅 메시지 영역을 맨 아래로 스크롤
        setTimeout(() => {
            const chatMessages = document.getElementById('chat-messages');
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    } else {
        document.body.classList.remove('keyboard-open');
    }
}

// 뷰포트 변경 감지 (통합된 단일 이벤트 리스너)
window.addEventListener('resize', handleViewportChange);
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        initialViewportHeight = window.innerHeight;
        handleViewportChange();
    }, 500);
});

// 사용자명 기억 기능
function loadSavedUsername() {
    const savedUsername = localStorage.getItem('chatUsername');
    const usernameInput = document.getElementById('username');
    
    if (savedUsername) {
        usernameInput.value = savedUsername;
        // 저장된 사용자명이 있으면 선택 상태로 만들어서 쉽게 수정 가능
        setTimeout(() => {
            usernameInput.select();
        }, 100);
    }
}

function saveUsername(username) {
    if (username && username.trim()) {
        localStorage.setItem('chatUsername', username.trim());
    }
}

function clearSavedUsername() {
    localStorage.removeItem('chatUsername');
}

// 사용자명 입력창 더블클릭 시 저장된 이름 삭제 (고급 기능)
document.getElementById('username').addEventListener('dblclick', function(e) {
    if (confirm('저장된 사용자명을 삭제하시겠습니까?')) {
        clearSavedUsername();
        e.target.value = '';
        e.target.placeholder = '사용자명을 입력하세요';
        setTimeout(() => {
            e.target.placeholder = '사용자명 입력 (이전 이름이 기억됩니다)';
        }, 3000);
    }
});

// 초기 설정
loadSavedUsername();
document.getElementById('username').focus();
document.getElementById('send-btn').disabled = true;