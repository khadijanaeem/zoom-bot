import express from "express";
import { chromium } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';

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
      
      // Launch browser with Playwright (much lighter)
      this.browser = await chromium.launch({
        headless: true
      });

      this.page = await this.browser.newPage();
      
      const joinUrl = `https://zoom.us/j/${this.meetingId}`;
      console.log(`🔗 Joining: ${joinUrl}`);
      
      await this.page.goto(joinUrl, { waitUntil: 'networkidle' });

      // Simple join process
      await this.page.waitForTimeout(5000);
      
      // Try to find and click join buttons
      const joinSelectors = [
        '.preview-join-button',
        '[aria-label="Join from Your Browser"]',
        'button:has-text("Join")'
      ];

      for (const selector of joinSelectors) {
        const button = await this.page.$(selector);
        if (button) {
          await button.click();
          console.log("✅ Clicked join button");
          break;
        }
      }

      await this.page.waitForTimeout(3000);

      // Enter name if needed
      const nameInput = await this.page.$('input[type="text"]');
      if (nameInput) {
        await nameInput.fill('AI Interviewer');
        console.log("✅ Entered display name");
      }

      // Final join
      const finalJoin = await this.page.$('button:has-text("Join"), [aria-label="Join"]');
      if (finalJoin) {
        await finalJoin.click();
      }

      await this.page.waitForTimeout(10000);
      console.log(`✅ Bot successfully joined meeting: ${this.meetingId}`);
      return true;

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

app.listen(PORT, () => {
  console.log(`🚀 Zoom Bot running on ${PORT}`);
});
