const express = require("express");
const http = require("http");
const path = require("path");
const cookieParser = require("cookie-parser");
const socketIO = require("socket.io");
const config = require("./config");
const router = require("./router");

const app = express();
const server = http.createServer(app);
const io = new socketIO.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = config.port;
global.remoteURL = `http://localhost:${PORT}`;
global.IO = io;

// Simple lightweight template renderer for HTML views
app.engine("html", (filePath, options, callback) => {
    const fs = require("fs");
    fs.readFile(filePath, "utf8", (err, content) => {
        if (err) return callback(err);
        let rendered = content;

        // Simple variable replacement {{ key }}
        for (const [key, value] of Object.entries(options)) {
            if (key === "settings" || key === "_locals" || key === "cache") continue;
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
            const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
            rendered = rendered.replace(regex, valStr);
        }
        return callback(null, rendered);
    });
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "html");

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Attach router
app.use("/", router);

// Socket.IO Connection Handler
io.on("connection", (socket) => {
    console.log(`[+] Web Socket Admin/Client connected: ${socket.id}`);

    socket.on("join-admin", () => {
        socket.join("admin-room");
        // Send initial target list snapshot to admin
        socket.emit("initial-targets", router.TARGETS);
    });

    socket.on("disconnect", () => {
        // Handle disconnect if needed
    });
});

server.listen(PORT, async () => {
    const localURL = `http://localhost:${PORT}`;
    console.log(`\n==================================================`);
    console.log(` 🚀 ${config.appName}`);
    console.log(`==================================================`);
    console.log(`  [+] LOCAL DASHBOARD : ${localURL}`);
    console.log(`  [+] ADMIN USERNAME  : ${config.username}`);
    console.log(`  [+] ADMIN PASSWORD  : ${config.password}`);

    // Try cloudflared if module is present
    try {
        const { tunnel } = require("cloudflared");
        const tunnelObj = await tunnel({ "--url": localURL });
        if (tunnelObj && tunnelObj.url) {
            global.remoteURL = tunnelObj.url;
            console.log(`  [+] REMOTE PUBLIC TUNNEL: ${global.remoteURL}`);
        }
    } catch (e) {
        console.log(`  [!] Cloudflared tunnel not active. Using Local URL.`);
    }
    console.log(`==================================================\n`);
});
