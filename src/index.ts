import express from "express";
import rtms from "@zoom/rtms";

const app = express();
const PORT = process.env.PORT || 8080;

// Parse JSON bodies from Zoom webhooks
app.use(express.json());

/**
 * 1) Health check (for you + Railway)
 */
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "empowhr-zoom-bot" });
});

/**
 * 2) RTMS webhook handler
 *
 * We use createWebhookHandler from the RTMS SDK and mount it
 * on /zoom/webhook. When Zoom sends events, RTMS will parse them
 * and call our callback.
 */
const webhookHandler = rtms.createWebhookHandler(
  (payload) => {
    console.log("🔔 Zoom webhook event:", payload.event);

    // We only care about the RTMS start event for now
    if (payload.event !== "meeting.rtms_started") return;

    const rtmsPayload = payload.payload || {};

    // Create a client for this meeting
    const client = new rtms.Client();

    // Log when we successfully join
    client.onJoinConfirm((reason) => {
      console.log("✅ Joined RTMS stream. Reason:", reason);
    });

    // Log when we leave / meeting ends
    client.onLeave((reason) => {
      console.log("👋 Left RTMS stream. Reason:", reason);
    });

    // For now, we’re not processing audio yet, just confirm it fires
    client.onAudioData((data, timestamp, metadata) => {
      console.log(
        `🎧 Got audio: ${data.length} bytes from ${metadata.userName} @ ${timestamp}`
      );
    });

    // Join the RTMS stream using Zoom's payload
    client.join({
      meeting_uuid: rtmsPayload.meeting_uuid,
      rtms_stream_id: rtmsPayload.rtms_stream_id,
      server_urls: rtmsPayload.server_urls,
      signature: rtmsPayload.signature,
    });
  },
  "/zoom/webhook" // internal path, we mount on same below
);

// Wire the handler to POST /zoom/webhook
app.post("/zoom/webhook", webhookHandler);

/**
 * 3) Start HTTP server
 */
app.listen(PORT, () => {
  console.log(`🚀 Zoom bot server listening on port ${PORT}`);
  console.log(`   Health:  GET /health`);
  console.log(`   Webhook: POST /zoom/webhook`);
});
