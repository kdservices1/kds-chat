const WebSocket = require('ws');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const ADMIN_PASSWORD = "DeinSuperGeheimesPasswort123"; // Hier dein eigenes Passwort festlegen!

// Dateien zum dauerhaften Speichern von Admin-IP und Ban-Liste
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

wss.on('connection', (ws, req) => {
    // IP-Adresse des Nutzers auslesen
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    // 1. Ist die IP gebannt?
    if (bannedIPs.has(clientIP)) {
        ws.send(JSON.stringify({ type: 'system', message: '❌ Du bist dauerhaft von diesem Server gebannt!' }));
        ws.close();
        return;
    }

    // 2. Erstelle Client-Objekt & prüfe, ob es DEINE Admin-IP ist
    const isAutoAdmin = (adminIP !== null && adminIP === clientIP);
    clients.set(ws, { nick: 'Anonymous', color: '#00bfff', ip: clientIP, isAdmin: isAutoAdmin });

    // Wenn IP erkannt wird, direkt Admin-Rechte geben
    if (isAutoAdmin) {
        ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Willkommen zurück, Owner! Automatisch als Admin eingeloggt.' }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const client = clients.get(ws);

            // ADMIN ERSTANMELDUNG
            if (data.type === 'admin_auth') {
                if (adminIP !== null && adminIP !== clientIP) {
                    ws.send(JSON.stringify({ type: 'system', message: '⛔ Ein Admin ist bereits registriert! Zugriff verweigert.' }));
                    return;
                }

                if (data.password === ADMIN_PASSWORD) {
                    saveAdminIP(clientIP);
                    client.isAdmin = true;
                    ws.send(JSON.stringify({ type: 'admin_ok', message: '👑 Erfolgreich! Deine IP wurde als einziger Admin registriert.' }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Falsches Passwort!' }));
                }
                return;
            }

            // USER BANNNEN PER NICKNAME
            if (data.type === 'admin_ban') {
                if (!client.isAdmin) {
                    ws.send(JSON.stringify({ type: 'system', message: '❌ Keine Berechtigung!' }));
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
                    ws.send(JSON.stringify({ type: 'system', message: `✅ User "${data.target}" wurde erfolgreich per IP gebannt!` }));
                } else {
                    ws.send(JSON.stringify({ type: 'system', message: `⚠️ User "${data.target}" wurde im Server nicht gefunden.` }));
                }
                return;
            }

            // PROTKOLLIERUNG DER NICKNAMES
            if (data.type === 'join') {
                client.nick = data.nick || 'Anonymous';
                client.color = data.color || '#00bfff';
                return;
            }

            // NORMALE NACHRICHTEN SENDEN & ALLER CHAT-VERLAUF AN ADMIN SPIONIEREN
            if (data.type === 'message') {
                // Sende Nachricht an alle Admins (Gesamte Chat-History/Verlauf sehen)
                for (let [targetWs, targetClient] of clients.entries()) {
                    if (targetClient.isAdmin && targetWs !== ws) {
                        targetWs.send(JSON.stringify({
                            type: 'message',
                            nick: `[SPY] ${client.nick}`,
                            color: '#ff8800',
                            text: data.text
                        }));
                    }
                }
            }

        } catch (e) {
            console.error("Fehler beim Verarbeiten der Nachricht", e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});
