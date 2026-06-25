// Sử dụng thư viện puppeteer-extra kết hợp plugin stealth để giả lập vân tay trình duyệt người dùng thật
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3072;
app.use(cors());
app.use(express.json());

const GAME_URL = "https://play.sao789a.me/";

// Tạo một thư mục riêng tên là 'game_session' ngay tại thư mục bot để lưu dữ liệu đăng nhập ẩn
const sessionPath = path.join(__dirname, 'game_session');

let latestTxData = null;
let latestMd5Data = null;
let isBrowserReady = false;

let lastTxSessionId = null;
let lastMd5SessionId = null;

async function startBrowser() {
    console.log('🌐 Đang khởi chạy trình duyệt bảo mật chống Cloudflare...');
    
    const browser = await puppeteer.launch({ 
        headless: false, // Hiện trình duyệt nhỏ lên để vượt tường lửa bảo mật
        userDataDir: sessionPath, // 🔒 NƠI GHI NHỚ ĐĂNG NHẬP (Lần sau tự vào không cần nhập lại)
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-blink-features=AutomationControlled',
            '--window-size=1200,800'
        ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // Mở cổng can thiệp luồng mạng để tự động "hứng" gói tin WebSocket từ Game mà không cần copy link
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', ({requestId, timestamp, response}) => {
        try {
            const rawData = response.payloadData;
            if (rawData.startsWith('[') || rawData.startsWith('{')) {
                const parsed = JSON.parse(rawData);
                
                // 1. Tự động xử lý dữ liệu bàn Tài Xỉu Thường (cmd 1005)
                if (parsed === 5 && parsed && parsed.cmd === 1005) {
                    const gameData = parsed;
                    if (gameData.htr && gameData.htr.length > 0) {
                        latestTxData = gameData;
                        isBrowserReady = true; 
                        
                        const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                        if (latestSession.sid !== lastTxSessionId) {
                            lastTxSessionId = latestSession.sid;
                            const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
                            console.log(`\n🔔 [BÀN THƯỜNG] >>> CẬP NHẬT PHIÊN MỚI: #${latestSession.sid} <<<`);
                            console.log(`🎲 Xúc xắc: ${latestSession.d1} - ${latestSession.d2} - ${latestSession.d3} => Tổng: ${tong} (${tong >= 11 ? "TÀI" : "XỈU"})`);
                        }
                    }
                }
                
                // 2. Tự động xử lý dữ liệu bàn Tài Xỉu MD5 (cmd 1105)
                if (parsed === 5 && parsed && parsed.cmd === 1105) {
                    const gameData = parsed;
                    if (gameData.htr && gameData.htr.length > 0) {
                        latestMd5Data = gameData;
                        isBrowserReady = true;
                        
                        const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                        if (latestSession.sid !== lastMd5SessionId) {
                            lastMd5SessionId = latestSession.sid;
                            const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
                            console.log(`\n🔔 [BÀN MD5] >>> CẬP NHẬT PHIÊN MỚI: #${latestSession.sid} <<<`);
                            console.log(`🎲 Xúc xắc: ${latestSession.d1} - ${latestSession.d2} - ${latestSession.d3} => Tổng: ${tong} (${tong >= 11 ? "TÀI" : "XỈU"})`);
                        }
                    }
                }
            }
        } catch (e) {}
    });

    console.log(`🔗 Đang tải trang game: ${GAME_URL}`);
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('\n--------------------------------------------------------------');
    console.log('ℹ️ HƯỚNG DẪN KÍCH HOẠT HỆ THỐNG TỰ ĐỘNG:');
    console.log('👉 Bước 1: Hãy nhìn vào trình duyệt Chrome nhỏ vừa hiện lên.');
    console.log('👉 Bước 2: Tự tay đăng nhập tài khoản vippro296 / propro296 vào game.');
    console.log('👉 Bước 3: Đăng nhập xong, bot sẽ tự nhận link và cập nhật mãi mãi về sau.');
    console.log('--------------------------------------------------------------\n');
}

// --- ĐỊNH DẠNG API JSON SẠCH ĐỂ XUẤT RA NGOÀI ---
function formatSession(gameData, banType) {
    if (!gameData || !gameData.htr || gameData.htr.length === 0) {
        return { error: "Đang đợi bạn đăng nhập vào game để đồng bộ dữ liệu..." };
    }
    const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
    const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
    return {
        phien: latestSession.sid,
        xuc_xac_1: latestSession.d1,
        xuc_xac_2: latestSession.d2,
        xuc_xac_3: latestSession.d3,
        tong: tong,
        ket_qua: tong >= 11 ? "tài" : "xỉu",
        timestamp: new Date().toISOString(),
        ban: banType
    };
}

// --- THIẾT LẬP ĐỊNH TUYẾN CÁC ENDPOINT API CỔNG 3072 ---
app.get('/api/tx', (req, res) => res.json(formatSession(latestTxData, "tai_xiu")));
app.get('/api/md5', (req, res) => res.json(formatSession(latestMd5Data, "md5")));
app.get('/api/all', (req, res) => {
    res.json({
        tai_xiu: formatSession(latestTxData, "tai_xiu"),
        md5: formatSession(latestMd5Data, "md5"),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: "running",
        game_connected: isBrowserReady,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Server đang chạy tại http://localhost:${PORT}`);
    startBrowser();
});
