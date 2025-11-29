import express from "express";
import crypto from "crypto";
import rtms from "@zoom/rtms";

const app = express();

// ✅ ADD SECURITY HEADERS MIDDLEWARE
app.use((req, res, next) => {
  // Add required OWASP headers
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Additional security headers (recommended)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
});

// ✅ CRITICAL FIX: Use raw body for webhook verification
app.use("/zoom/webhook", express.raw({ type: "application/json" }));
// Use JSON parsing for all other routes
app.use((req, res, next) => {
  if (req.path === "/zoom/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

const PORT = process.env.PORT || 8080;

/* -----------------------------
   VERIFY ZOOM WEBHOOK SIGNATURE
--------------------------------*/
function verifyZoomSignature(req) {
  const timestamp = req.headers["x-zm-request-timestamp"];
  const receivedSignature = req.headers["x-zm-signature"];
  
  // ✅ FIX: Use your ACTUAL environment variable name
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
 console.log("🔍 DEBUG - Headers received:");
  console.log("  x-zm-request-timestamp:", timestamp);
  console.log("  x-zm-signature:", receivedSignature);
  console.log("  Secret present:", !!secret);
  console.log("  Secret length:", secret ? secret.length : 0);
  if (!timestamp || !receivedSignature || !secret) {
    console.log("⚠️ Missing timestamp/signature/secret");
    return false;
  }

  // ✅ FIX: Use raw body instead of JSON.stringify()
  const rawBody = req.body.toString(); // This is the raw JSON string
  
  console.log("  Raw body length:", rawBody.length);
  console.log("  Raw body preview:", rawBody.substring(0, 200) + "...");
  const message = `v0:${timestamp}:${rawBody}`;

  console.log("  Message length:", message.length);
  console.log("  Message preview:", message.substring(0, 200) + "...");
  const hash = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const expectedSignature = `v0=${hash}`;

  // DEBUG LOGS
  console.log("🔐 Zoom signature debug:");
  console.log("  timestamp:", timestamp);
  console.log("  body length:", rawBody.length);
  console.log("  expected:", expectedSignature);
  console.log("  received:", receivedSignature);

  return expectedSignature === receivedSignature;
}

/* ---------------------------
   WEBHOOK ENDPOINT
----------------------------*/
app.post("/zoom/webhook", (req, res) => {
  if (!verifyZoomSignature(req)) {
    console.log("❌ Invalid Zoom signature");
    return res.status(401).send("invalid signature");
  }

  // ✅ Now parse the JSON for processing
  const body = JSON.parse(req.body.toString());
  const event = body.event;
  const payload = body.payload;

  console.log("🔔 Zoom Event:", event);

  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN) // ✅ Fixed variable name
      .update(plainToken)
      .digest("hex");

    return res.json({
      plainToken,
      encryptedToken,
    });
  }

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
  console.log(`🔑 Secret token present: ${!!process.env.ZOOM_WEBHOOK_SECRET_TOKEN}`);
  console.log(`🔑 Secret token starts with: ${process.env.ZOOM_WEBHOOK_SECRET_TOKEN ? process.env.ZOOM_MEBHOOK_SECRET_TOKEN.substring(0, 10) + '...' : 'MISSING'}`);
});
