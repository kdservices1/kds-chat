const WebSocket = require('ws');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// PASSWORT HIER ÄNDERN!
const ADMIN_PASSWORD = "Kaanbesiktas1904";

// Pfade zum Speichern von Admin-IP und Ban-Liste
const ADMIN_FILE = './admin_ip.json';
const BANNED_FILE = './banned_ips.json';

let adminIP = fs.existsSync(ADMIN_FILE) ? JSON.parse(fs.readFileSync(ADMIN_FILE)) : null;
let bannedIPs = fs.existsSync(BANNED_FILE) ? new Set(JSON.parse(fs.readFileSync(BANNED_FILE))) : new Set();

function saveBannedIPs() {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(Array.from(bannedIPs)));
}

function saveAdminIP(ip) {
    adminIP = ip;
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminIP));
}

const clients = new Map(); // Speichert ws -> { nick, color, ip, isAdmin }

console.log(`Server gestartet auf Port ${PORT}`);

wss.on('connection', (ws, req) => {
    // Liest die echte IP des Nutzers aus (auch hinter Render-Proxy)
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    // 1. IP-Ban Prüfung
    if (bannedIPs.has(clientIP)) {
        ws.send(JSON.stringify({ type: 'system', message: '❌ Du bist dauerhaft von diesem Server gebannt!' }));
        ws.close();
        return;
    }

    // 2. Automatischer Admin-Check über die abgespeicherte IP
    const isAutoAdmin = (adminIP !== null && adminIP === clientIP);
    clients.set(ws, { nick: 'Anonymous', color: '#00bfff', ip: clientIP, isAdmin: isAutoAdmin });

    if (isAutoAdmin) {
        ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Willkommen zurück, Owner! Du wurdest automatisch als Admin erkannt.' }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const client = clients.get(ws);

            // NICKNAME SETZEN
            if (data.type === 'join') {
                client.nick = data.nick || 'Anonymous';
                client.color = data.color || '#00bfff';
                return;
            }

            // ADMIN ERSTANMELDUNG (/admin PASSWORT)
            if (data.type === 'admin_auth') {
                if (adminIP !== null && adminIP !== clientIP) {
                    ws.send(JSON.stringify({ type: 'system', message: '⛔ Es existiert bereits ein registrierter Admin! Zugriff verweigert.' }));
                    return;
                }

                if (data.password === ADMIN_PASSWORD) {
                    saveAdminIP(clientIP);
                    client.isAdmin = true;
                    ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Erfolgreich! Deine IP wurde dauerhaft als einziger Admin gespeichert.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Falsches Admin-Passwort!' }));
                }
                return;
            }

            // BAN-BEFEHL PER NICKNAME (/ban NICKNAME)
            if (data.type === 'admin_ban') {
                if (!client.isAdmin) {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Fehler: Keine Admin-Rechte!' }));
                    return;
                }

                let targetFound = false;
                for (let [targetWs, targetClient] of clients.entries()) {
                    if (targetClient.nick.toLowerCase() === data.target.toLowerCase()) {
                        bannedIPs.add(targetClient.ip);
                        saveBannedIPs();
                        
                        targetWs.send(JSON.stringify({ type: 'system', message: '🔨 Du wurdest vom Admin gebannt.' }));
                        targetWs.close();
                        targetFound = true;
                        break;
                    }
                }

                if (targetFound) {
                    ws.send(JSON.stringify({ type: 'system', message: `✅ User "${data.target}" wurde erfolgreich gebannt!` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: `⚠️ User "${data.target}" ist aktuell nicht online.` }));
                }
                return;
            }

            // NACHRICHTEN VERARBEITEN & SPIONAGE-FUNKTION
            if (data.type === 'message') {
                // Broadcast an alle Chat-Partner
                for (let [otherWs, otherClient] of clients.entries()) {
                    if (otherWs !== ws && !otherClient.isAdmin) {
                        otherWs.send(JSON.stringify({
                            type: 'message',
                            nick: client.nick,
                            color: client.color,
                            text: data.text
                        }));
                    }
                    // Admin bekommt ALLE Nachrichten als Spionage-Protokoll [SPY]
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

            // SKIP BEFEHL
            if (data.type === 'skip') {
                ws.send(JSON.stringify({ type: 'system', message: 'Suche nach neuem Chat-Partner...' }));
            }

        } catch (e) {
            console.error("Fehler bei Verarbeitung:", e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});
