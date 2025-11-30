import express from "express";
import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from "crypto";
const app = express();
const execAsync = promisify(exec);

const PORT = process.env.PORT || 8080;
const activeBots = new Map();

// Interview Questions
const INTERVIEW_QUESTIONS = [
  "Can you tell me about yourself?",
  "What are your greatest strengths?",
  "Where do you see yourself in 5 years?"
];

/* -------------------------
   TTS SERVICE
---------------------------*/
async function speakText(text) {
  try {
    console.log(`🎤 TTS: ${text}`);
    // Use system TTS
    await execAsync(`say "${text.replace(/"/g, '')}"`);
    return true;
  } catch (error) {
    console.log("❌ TTS Error:", error.message);
    return false;
  }
}

/* -------------------------
   ZOOM BOT WITH PLAYWRIGHT
---------------------------*/
class ZoomBot {
  constructor(meetingId) {
    this.meetingId = meetingId;
    this.browser = null;
    this.page = null;
    this.currentQuestionIndex = 0;
  }

 async joinMeeting() {
  try {
    console.log(`🤖 Launching bot for meeting: ${this.meetingId}`);
    
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();
    
    // Use the web client join URL
    const joinUrl = `https://zoom.us/wc/${this.meetingId}/join`;
    console.log(`🔗 Joining: ${joinUrl}`);
    
    await this.page.goto(joinUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // Wait for page to load
    await this.page.waitForTimeout(5000);

    // Check if we're on the join page
    const currentUrl = this.page.url();
    if (currentUrl.includes('/wc/') && currentUrl.includes('/join')) {
      console.log("✅ Successfully loaded join page");
      
      // Enter display name
      const nameInput = await this.page.$('input[type="text"]');
      if (nameInput) {
        await nameInput.fill('AI Interviewer Bot');
        console.log("✅ Entered display name");
      }

      // Click join button
      const joinBtn = await this.page.$('button:has-text("Join"), [aria-label*="Join"]');
      if (joinBtn) {
        await joinBtn.click();
        console.log("✅ Clicked join button");
      }

      await this.page.waitForTimeout(10000);
      
      // Check if we successfully joined
      if (this.page.url().includes('/wc/join')) {
        console.log("❌ Still on join page - may need manual intervention");
        return false;
      }

      console.log(`✅ Bot successfully joined meeting: ${this.meetingId}`);
      return true;
    }

    return false;

  } catch (error) {
    console.log(`❌ Bot failed to join: ${error.message}`);
    return false;
  }
}

  async sendChatMessage(message) {
    try {
      // Simple chat implementation
      const chatInput = await this.page.$('textarea, [contenteditable="true"]');
      if (chatInput) {
        await chatInput.fill(message);
        await this.page.keyboard.press('Enter');
        console.log(`💬 Sent: ${message}`);
      }
    } catch (error) {
      console.log(`❌ Failed to send chat: ${error.message}`);
    }
  }

  async startInterview() {
    console.log(`🎤 Starting interview for: ${this.meetingId}`);
    this.askNextQuestion();
  }

  async askNextQuestion() {
    if (this.currentQuestionIndex >= INTERVIEW_QUESTIONS.length) {
      console.log("✅ Interview completed");
      await this.leaveMeeting();
      return;
    }

    const question = INTERVIEW_QUESTIONS[this.currentQuestionIndex];
    console.log(`❓ Question ${this.currentQuestionIndex + 1}: ${question}`);

    await this.sendChatMessage(`Question ${this.currentQuestionIndex + 1}: ${question}`);
    await speakText(question);

    this.currentQuestionIndex++;
    
    // Wait 60 seconds for answer
    setTimeout(() => this.askNextQuestion(), 60000);
  }

  async leaveMeeting() {
    try {
      console.log(`👋 Bot leaving meeting: ${this.meetingId}`);
      if (this.browser) {
        await this.browser.close();
      }
      activeBots.delete(this.meetingId);
    } catch (error) {
      console.log(`❌ Error leaving: ${error.message}`);
    }
  }
}

/* -------------------------
   API ENDPOINTS
---------------------------*/
/* -------------------------
   ZOOM WEBHOOK ENDPOINT (for your existing Zoom app)
---------------------------*/
app.use("/zoom/webhook", express.raw({ type: "application/json" }));

app.post("/zoom/webhook", (req, res) => {
  console.log("📨 Zoom webhook received");
  
  // Parse the webhook body
  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch (e) {
    console.log("❌ Failed to parse webhook JSON");
    return res.status(400).send("invalid json");
  }

  const event = body.event;
  const payload = body.payload;

  console.log("🔔 Zoom Webhook Event:", event);

  // Handle URL validation challenge
  if (event === "endpoint.url_validation") {
    const plainToken = payload.plainToken;
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    
    if (!secret) {
      console.log("❌ No webhook secret configured");
      return res.status(400).send("secret not configured");
    }

    const hash = crypto
      .createHmac("sha256", secret)
      .update(plainToken)
      .digest("hex");

    console.log("✅ URL validation response sent");
    return res.json({
      plainToken,
      encryptedToken: hash
    });
  }

  // Log other events but don't auto-join (using manual join now)
  if (event === "meeting.started") {
    console.log(`📅 Meeting started: ${payload.object.topic} (${payload.object.id})`);
    console.log("💡 Tip: Use POST /bot/join to start the interview bot");
  }

  if (event === "meeting.ended") {
    console.log(`🛑 Meeting ended: ${payload.object.id}`);
  }

  res.status(200).send("OK");
});
app.use(express.json());

app.post("/bot/join", async (req, res) => {
  const { meetingId } = req.body;
  
  if (!meetingId) {
    return res.status(400).json({ error: "Meeting ID required" });
  }

  try {
    const bot = new ZoomBot(meetingId);
    activeBots.set(meetingId, bot);
    
    const success = await bot.joinMeeting();
    
    if (success) {
      setTimeout(() => bot.startInterview(), 5000);
      res.json({ success: true, message: "Bot joined successfully" });
    } else {
      activeBots.delete(meetingId);
      res.json({ success: false, message: "Failed to join meeting" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/bots", (req, res) => {
  res.json({
    activeBots: activeBots.size,
    bots: Array.from(activeBots.keys())
  });
});

app.get("/", (req, res) => {
  res.json({ 
    message: "Zoom Interview Bot",
    status: "Running",
    endpoints: {
      join: "POST /bot/join { meetingId }",
      status: "GET /bots"
    }
  });
});
// Add this before app.listen()
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    activeBots: activeBots.size
  });
});
app.listen(PORT, () => {
  console.log(`🚀 Zoom Bot running on ${PORT}`);
});
