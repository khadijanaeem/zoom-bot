import express from "express";
import crypto from "crypto";
import rtms from "@zoom/rtms";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8080;

/* -----------------------------
   OWASP SECURITY HEADERS (REQUIRED BY ZOOM)
--------------------------------*/
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
/* -----------------------------
   VERIFY ZOOM WEBHOOK SIGNATURE
--------------------------------*/
function verifyZoomSignature(req) {
  const message = req.headers["x-zm-request-timestamp"] + req.originalUrl + JSON.stringify(req.body);
  const hmac = crypto
    .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest("hex");

  const expectedSignature = `v0=${hmac}`;
  const receivedSignature = req.headers["x-zm-signature"];

  return expectedSignature === receivedSignature;
}

/* ---------------------------
   WEBHOOK ENDPOINT
----------------------------*/
app.post("/zoom/webhook", (req, res) => {
  // 1. Verify webhook
  if (!verifyZoomSignature(req)) {
    console.log("❌ Invalid Zoom signature");
    return res.status(401).send("invalid signature");
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log("🔔 Zoom Event:", event);

  if (event === "endpoint.url_validation") {
    // Zoom URL verification
    return res.json({
      plainToken: payload.plainToken,
      encryptedToken: crypto
        .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
        .update(payload.plainToken)
        .digest("hex"),
    });
  }

  // 2. RTMS event fired → join meeting
  if (event === "meeting.rtms_started") {
    console.log("🎉 RTMS START DETECTED");

    const client = new rtms.RTMSClient();

    client.on("rtms.joined", () => {
      console.log("✅ RTMS JOINED");
    });

    client.on("rtms.audio", (data) => {
      console.log("🎧 Audio Received:", data.byteLength);
    });

    client.join({
      meetingUUID: payload.meetingUUID,
      streamID: payload.rtmsStreamID,
      signature: payload.signature,
      serverURLs: payload.serverURLs,
    });
  }

  res.status(200).send("OK");
});

/* -------------------------
   HEALTH CHECK
---------------------------*/
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* -------------------------
   START SERVER
---------------------------*/
app.listen(PORT, () => {
  console.log(`🚀 Zoom bot running on ${PORT}`);
});
