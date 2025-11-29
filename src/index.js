import express from "express";
import crypto from "crypto";
import rtms from "@zoom/rtms";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8080;

/* -----------------------------
   VERIFY ZOOM WEBHOOK SIGNATURE
--------------------------------*/
function verifyZoomSignature(req) {
  const timestamp = req.headers["x-zm-request-timestamp"];
  const receivedSignature = req.headers["x-zm-signature"];
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

  if (!timestamp || !receivedSignature || !secret) {
    console.log("⚠️ Missing timestamp/signature/secret");
    return false;
  }

  const bodyJson = JSON.stringify(req.body);
  const message = `v0:${timestamp}:${bodyJson}`;

  const hash = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const expectedSignature = `v0=${hash}`;

  // DEBUG LOGS – will help us if it still fails
  console.log("🔐 Zoom signature debug:");
  console.log("  timestamp:", timestamp);
  console.log("  bodyJson:", bodyJson);
  console.log("  expected:", expectedSignature);
  console.log("  received:", receivedSignature);

  return expectedSignature === receivedSignature;
}

/* ---------------------------
   WEBHOOK ENDPOINT
----------------------------*/
app.post("/zoom/webhook", (req, res) => {
  if (!verifyZoomSignature(req)) {
    console.log(" Invalid Zoom signature");
    return res.status(401).send("invalid signature");
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log("🔔 Zoom Event:", event);

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
