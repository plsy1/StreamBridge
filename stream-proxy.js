const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const logFile = path.join(__dirname, 'logs', 'access.log');

const streams = new Map();
let iptvData = [];

try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'iptv.json'), 'utf-8');
    iptvData = JSON.parse(data);
} catch (err) {
    console.error('Failed to read iptv.json:', err);
}

function logAccess(ip, path, rtsp) {
    const time = new Date().toISOString();
    const line = `[${time}] ${ip} requested ${path} -> ${rtsp}\n`;
    console.log(line.trim());
    fs.appendFile(logFile, line, err => {
        if (err) console.error('Failed to write access log:', err);
    });
}

function generatePlaybackUrl(uni_playback, tvdr) {
    // tvdr=20250926120000GMT-20250926123000GMT
    const match = tvdr.match(/(\d{14})GMT-(\d{14})GMT/);
    if (!match) return null;
    const [_, start, end] = match;
    let url = uni_playback;
    // 替换 {utc:YmdHMS}GMT 和 {utcend:YmdHMS}GMT
    url = url.replace('{utc:YmdHMS}GMT', start);
    url = url.replace('{utcend:YmdHMS}GMT', end);
    return url;
}

http.createServer((req, res) => {
    try {
        const fullUrl = `http://${req.headers.host}${req.url}`;
        const parsed = new URL(fullUrl);
        const pathname = parsed.pathname;
        const parts = pathname.split('/').filter(Boolean);

        if (parts.length < 2) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const type = parts[0];

        if (type === 'catchup') {
            const ip = req.socket.remoteAddress;
            const rawUrl = parts.slice(1).join('/');
            let rtsp = `rtsp://${rawUrl}`;
            if (parsed.search) rtsp += parsed.search;

            logAccess(ip, pathname, rtsp);

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

        }
        else if (type === 'tv') {
            const ip = req.socket.remoteAddress;
            const ChannelID = parts[1]; // /tv/:ChannelID
            const channel = iptvData.find(c => c.ChannelID === ChannelID);

            if (!channel) {
                res.writeHead(404);
                res.end('Channel not found');
                return;
            }

            const tvdrParam = parsed.searchParams.get('tvdr');
            let rtsp;
            let hasQuery = false;

            if (tvdrParam) {
                const match = tvdrParam.match(/(\d{14})GMT-(\d{14})GMT/);
                if (!match) {
                    res.writeHead(400);
                    res.end('Invalid tvdr parameter');
                    return;
                }
                const [_, start, end] = match;
                rtsp = channel.uni_playback
                    .replace('{utc:YmdHMS}', start)
                    .replace('{utcend:YmdHMS}', end);
                hasQuery = true;
            } else {

                rtsp = channel.uni_live;
            }

            logAccess(ip, pathname, rtsp);

            res.writeHead(200, {
                'Content-Type': 'video/MP2T',
                'Cache-Control': 'no-cache',
                'Connection': 'close'
            });

            let stream;

            if (!hasQuery && streams.has(rtsp) && streams.get(rtsp).alive) {

                stream = streams.get(rtsp);
                stream.clients.push(res);
                console.log(`[INFO] Reusing existing ffmpeg for tv/${ChannelID}, clients=${stream.clients.length}`);
            } else {

                const ff = spawn('ffmpeg', [
                    '-i', rtsp,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    'pipe:1'
                ], { stdio: ['ignore', 'pipe', 'ignore'] });

                const clients = [res];
                stream = { ffmpeg: ff, clients, alive: true };

                if (!hasQuery) streams.set(rtsp, stream);

                console.log(`[INFO] Started ffmpeg for tv/${ChannelID} (single client=${hasQuery})`);

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
                    console.log(`[INFO] ffmpeg exited for tv/${ChannelID}`);
                });
            }

            req.on('close', () => {
                if (!stream) return;
                stream.clients = stream.clients.filter(r => r !== res);

                if (stream.clients.length === 0 && stream.alive) {
                    if (!hasQuery) streams.delete(rtsp);
                    stream.alive = false;
                    console.log(`[INFO] All clients disconnected, killing ffmpeg for tv/${ChannelID}`);
                    try { stream.ffmpeg.kill('SIGINT'); } catch (e) { }
                }
            });
        }


        else {
            res.writeHead(404);
            res.end('Not found');
        }

    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
}).listen(PORT, () => console.log(`stream proxy listening ${PORT}`));