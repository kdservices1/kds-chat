const WebSocket = require('ws');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// PASSWORT HIER ÄNDERN!
const ADMIN_PASSWORD = "Kaan";

const ADMIN_FILE = './admin_ip.json';
const BANNED_FILE = './banned_ips.json';
const NICK_IP_FILE = './nick_ip_map.json'; // Speichert Nickname -> IP Zuordnung für Unbans

let adminIP = fs.existsSync(ADMIN_FILE) ? JSON.parse(fs.readFileSync(ADMIN_FILE)) : null;
let bannedIPs = fs.existsSync(BANNED_FILE) ? new Set(JSON.parse(fs.readFileSync(BANNED_FILE))) : new Set();
let nickIpMap = fs.existsSync(NICK_IP_FILE) ? JSON.parse(fs.readFileSync(NICK_IP_FILE)) : {};

function saveBannedIPs() {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(Array.from(bannedIPs)));
}

function saveAdminIP(ip) {
    adminIP = ip;
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminIP));
}

function saveNickIpMap() {
    fs.writeFileSync(NICK_IP_FILE, JSON.stringify(nickIpMap));
}

const clients = new Map();

console.log(`Server running on port ${PORT}`);

wss.on('connection', (ws, req) => {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    if (bannedIPs.has(clientIP)) {
        ws.send(JSON.stringify({ type: 'system', message: '❌ You are permanently banned from this server!' }));
        ws.close();
        return;
    }

    const isAutoAdmin = (adminIP !== null && adminIP === clientIP);
    clients.set(ws, { nick: 'Anonymous', color: '#00bfff', ip: clientIP, isAdmin: isAutoAdmin });

    if (isAutoAdmin) {
        ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Welcome back, Owner! You have been automatically recognized as Admin.' }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const client = clients.get(ws);

            if (data.type === 'join') {
                client.nick = data.nick || 'Anonymous';
                client.color = data.color || '#00bfff';
                // Merke die IP zum Nickname für spätere Unbans
                nickIpMap[client.nick.toLowerCase()] = clientIP;
                saveNickIpMap();
                return;
            }

            // ADMIN ERSTANMELDUNG
            if (data.type === 'admin_auth') {
                if (adminIP !== null && adminIP !== clientIP) {
                    ws.send(JSON.stringify({ type: 'system', message: '⛔ An admin is already registered! Access denied.' }));
                    return;
                }

                if (data.password === ADMIN_PASSWORD) {
                    saveAdminIP(clientIP);
                    client.isAdmin = true;
                    ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Success! Your IP has been permanently registered as the sole Admin.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Incorrect admin password!' }));
                }
                return;
            }

            // BAN PER NICKNAME
            if (data.type === 'admin_ban') {
                if (!client.isAdmin) {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Error: You do not have admin permissions!' }));
                    return;
                }

                let targetFound = false;
                for (let [targetWs, targetClient] of clients.entries()) {
                    if (targetClient.nick.toLowerCase() === data.target.toLowerCase()) {
                        bannedIPs.add(targetClient.ip);
                        saveBannedIPs();
                        
                        targetWs.send(JSON.stringify({ type: 'system', message: '🔨 You have been banned by the Admin.' }));
                        targetWs.close();
                        targetFound = true;
                        break;
                    }
                }

                if (targetFound) {
                    ws.send(JSON.stringify({ type: 'system', message: `✅ User "${data.target}" has been successfully banned!` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: `⚠️ User "${data.target}" was not found online.` }));
                }
                return;
            }

            // UNBAN PER NICKNAME
            if (data.type === 'admin_unban') {
                if (!client.isAdmin) {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Error: You do not have admin permissions!' }));
                    return;
                }

                const targetLower = data.target.toLowerCase();
                const targetIP = nickIpMap[targetLower];

                if (targetIP && bannedIPs.has(targetIP)) {
                    bannedIPs.delete(targetIP);
                    saveBannedIPs();
                    ws.send(JSON.stringify({ type: 'system', message: `✅ User "${data.target}" (IP: ${targetIP}) has been unbanned!` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: `⚠️ Could not find a banned user with nickname "${data.target}". Try /unbanip <IP>` }));
                }
                return;
            }

            // UNBAN DIRECTLY PER IP
            if (data.type === 'admin_unban_ip') {
                if (!client.isAdmin) {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Error: You do not have admin permissions!' }));
                    return;
                }

                if (bannedIPs.has(data.ip)) {
                    bannedIPs.delete(data.ip);
                    saveBannedIPs();
                    ws.send(JSON.stringify({ type: 'system', message: `✅ IP "${data.ip}" has been unbanned!` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: `⚠️ IP "${data.ip}" is not in the ban list.` }));
                }
                return;
            }

            // CHAT MESSAGES & LIVE SPYING FOR ADMIN
            if (data.type === 'message') {
                for (let [otherWs, otherClient] of clients.entries()) {
                    if (otherWs !== ws && !otherClient.isAdmin) {
                        otherWs.send(JSON.stringify({
                            type: 'message',
                            nick: client.nick,
                            color: client.color,
                            text: data.text
                        }));
                    }
                    else if (otherClient.isAdmin && otherWs !== ws) {
                        otherWs.send(JSON.stringify({
                            type: 'message',
                            nick: `[SPY] ${client.nick}`,
                            color: '#ff8800',
                            text: data.text
                        }));
                    }
                }
            }

            if (data.type === 'skip') {
                ws.send(JSON.stringify({ type: 'system', message: 'Searching for a new chat partner...' }));
            }

        } catch (e) {
            console.error("Processing error:", e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});
