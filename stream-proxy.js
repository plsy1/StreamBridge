// stream-proxy.js
const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000; // 从环境变量读取端口，默认 10000
const logFile = path.join(__dirname, 'access.log');

const streams = new Map(); // rtspUrl => { ffmpeg, clients: [], alive: true }

function logAccess(ip, rtsp) {
    const time = new Date().toISOString();
    const line = `[${time}] ${ip} requested ${rtsp}\n`;
    console.log(line.trim());
    fs.appendFile(logFile, line, err => {
        if (err) console.error('Failed to write access log:', err);
    });
}

http.createServer((req, res) => {
    try {
        const fullUrl = `http://${req.headers.host}${req.url}`;
        const parsed = new URL(fullUrl);

        const pathname = parsed.pathname; // /catchup/...
        const parts = pathname.split('/').filter(Boolean);

        if (parts.length < 2 || parts[0] !== 'catchup') {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ip = req.socket.remoteAddress;

        const rawUrl = parts.slice(1).join('/');
        let rtsp = `rtsp://${rawUrl}`;
        if (parsed.search) rtsp += parsed.search;

        logAccess(ip, rtsp);

        res.writeHead(200, {
            'Content-Type': 'video/MP2T',
            'Cache-Control': 'no-cache',
            'Connection': 'close'
        });

        const hasQuery = parsed.search.length > 0;
        let stream;

        if (!hasQuery && streams.has(rtsp) && streams.get(rtsp).alive) {
            stream = streams.get(rtsp);
            stream.clients.push(res);
            console.log(`[INFO] Reusing existing ffmpeg for ${rtsp}, clients=${stream.clients.length}`);
        } else {
            const ff = spawn('ffmpeg', [
                // '-rtsp_transport', 'udp',
                '-i', rtsp,
                '-c', 'copy',
                '-f', 'mpegts',
                'pipe:1'
            ], { stdio: ['ignore', 'pipe', 'ignore'] });

            const clients = [res];
            stream = { ffmpeg: ff, clients, alive: true };
            if (!hasQuery) streams.set(rtsp, stream);

            console.log(`[INFO] Started ffmpeg for ${rtsp} (single client=${hasQuery})`);

            ff.stdout.on('data', chunk => {
                clients.forEach(r => {
                    try { r.write(chunk); } catch (e) { }
                });
            });

            ff.on('exit', () => {
                stream.alive = false;
                clients.forEach(r => {
                    try { r.end(); } catch (e) { }
                });
                if (!hasQuery) streams.delete(rtsp);
                console.log(`[INFO] ffmpeg exited for ${rtsp}`);
            });
        }

        req.on('close', () => {
            if (!stream) return;
            stream.clients = stream.clients.filter(r => r !== res);

            if (stream.clients.length === 0 && stream.alive) {
                if (!hasQuery) streams.delete(rtsp);
                stream.alive = false;
                console.log(`[INFO] All clients disconnected, killing ffmpeg for ${rtsp}`);
                try { stream.ffmpeg.kill('SIGINT'); } catch (e) { }
            }
        });

    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
}).listen(PORT, () => console.log(`stream proxy listening ${PORT}`));