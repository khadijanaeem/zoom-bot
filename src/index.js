import express from "express";
import crypto from "crypto";
import rtms from "@zoom/rtms";

const app = express();
const PORT = process.env.PORT || 8080;

/* ------------------------------------------------
   CAPTURE RAW BODY FOR ZOOM SIGNATURE VALIDATION
--------------------------------------------------*/
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

/* -----------------------------
   OWASP SECURITY HEADERS
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
   ROOT ROUTE
--------------------------------*/
app.get("/", (req, res) => {
  res.send("<h1>EmpowHR Zoom Bot</h1><p>OWASP OK</p>");
});

/* ------------------------------------------------
   CORRECT ZOOM SIGNATURE VERIFICATION
--------------------------------------------------*/
function verifyZoomSignature(req) {
  const timestamp = req.headers["x-zm-request-timestamp"];
  const signature = req.headers["x-zm-signature"];

  const message = timestamp + req.path + JSON.stringify(req.body);

  const hash = crypto
    .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest("hex");

  return signature === `v0=${hash}`;
}


/* ------------------------------------------------
   WEBHOOK ENDPOINT
--------------------------------------------------*/
app.post("/zoom/webhook", (req, res) => {
  if (!verifyZoomSignature(req)) {
    console.log("❌ Invalid Zoom signature");
    return res.status(401).send("invalid signature");
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log("🔔 Zoom Event:", event);

  /* ---- URL VALIDATION ---- */
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest("hex");

    return res.json({
      plainToken,
      encryptedToken,
    });
  }

  /* ---- RTMS MEETING STARTED ---- */
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

/* ------------------------------------------------
   HEALTH CHECK
--------------------------------------------------*/
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* ------------------------------------------------
   START SERVER
--------------------------------------------------*/
app.listen(PORT, () => {
  console.log(`🚀 Zoom bot running on ${PORT}`);
});
