import express from "express";
import crypto from "crypto";
import { exec } from 'child_process';
import { promisify } from 'util';
import puppeteer from "puppeteer";

const app = express();
const execAsync = promisify(exec);

const PORT = process.env.PORT || 8080;

// Store active sessions
const activeBots = new Map();

// Interview Questions
const INTERVIEW_QUESTIONS = [
  "Can you tell me about yourself and your background?",
  "What interested you in this position?",
  "What are your greatest professional strengths?",
  "Can you describe a challenging project you worked on?",
  "Where do you see yourself in 3-5 years?",
  "What are your salary expectations?",
  "Do you have any questions for me?"
];

/* -------------------------
   TTS SERVICE
---------------------------*/
async function speakText(text) {
  try {
    console.log(`🎤 TTS: ${text}`);
    
    // Windows TTS
    await execAsync(`powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`);
    
    // macOS alternative (uncomment if needed)
    // await execAsync(`say "${text.replace(/"/g, '')}"`);
    
    return true;
  } catch (error) {
    console.log("❌ TTS Error:", error.message);
    return false;
  }
}

/* -------------------------
   ZOOM BOT WITH TTS
---------------------------*/
class ZoomBot {
  constructor(meetingId, meetingTopic = "Interview") {
    this.meetingId = meetingId;
    this.topic = meetingTopic;
    this.browser = null;
    this.page = null;
    this.currentQuestionIndex = 0;
    this.isInMeeting = false;
    this.interviewActive = false;
  }

  async joinMeeting() {
    try {
      console.log(`🤖 Launching bot for meeting: ${this.meetingId}`);
      
      // Launch browser
      this.browser = await puppeteer.launch({
        headless: false, // Set to true in production
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--window-size=1920,1080'
        ],
        defaultViewport: { width: 1920, height: 1080 }
      });

      this.page = await this.browser.newPage();
      
      // Navigate to Zoom join page
      const joinUrl = `https://zoom.us/j/${this.meetingId}`;
      console.log(`🔗 Joining: ${joinUrl}`);
      
      await this.page.goto(joinUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Join process
      try {
        await this.page.waitForSelector('.preview-join-button', { timeout: 10000 });
        await this.page.click('.preview-join-button');
        console.log("✅ Clicked 'Join from Browser'");
      } catch (error) {
        console.log("ℹ️  No browser join button found, proceeding directly");
      }

      // Wait for meeting to load and enter name
      await this.page.waitForTimeout(5000);
      
      // Enter display name
      const nameInput = await this.page.$('[aria-label="Name"]') || await this.page.$('input[placeholder*="name" i]');
      if (nameInput) {
        await nameInput.type('AI Interviewer', { delay: 100 });
        console.log("✅ Entered display name");
      }

      // Join the meeting
      const joinButton = await this.page.$('[aria-label="Join"]') || await this.page.$('[data-testid="joinButton"]');
      if (joinButton) {
        await joinButton.click();
        console.log("✅ Clicked join button");
      }

      // Wait for meeting to fully load
      await this.page.waitForTimeout(10000);

      this.isInMeeting = true;
      console.log(`✅ Bot successfully joined meeting: ${this.meetingId}`);

      return true;
    } catch (error) {
      console.log(`❌ Bot failed to join: ${error.message}`);
      return false;
    }
  }

  async startInterview() {
    if (!this.isInMeeting) {
      console.log("❌ Bot not in meeting, cannot start interview");
      return false;
    }

    console.log(`🎤 Starting automated interview for: ${this.meetingId}`);
    this.interviewActive = true;
    
    // Wait 10 seconds then start questions
    setTimeout(() => this.askNextQuestion(), 10000);
    return true;
  }

  async askNextQuestion() {
    if (!this.interviewActive || this.currentQuestionIndex >= INTERVIEW_QUESTIONS.length) {
      console.log("✅ Interview completed or stopped");
      await this.endInterview();
      return;
    }

    const question = INTERVIEW_QUESTIONS[this.currentQuestionIndex];
    const questionNumber = this.currentQuestionIndex + 1;
    
    console.log(`❓ [Q${questionNumber}/${INTERVIEW_QUESTIONS.length}]: ${question}`);

    try {
      // Send question via chat
      await this.sendChatMessage(`Question ${questionNumber}: ${question}`);
      
      // Speak question via TTS
      await speakText(`Question ${questionNumber}. ${question}`);
      
      this.currentQuestionIndex++;
      
      // Schedule next question in 75 seconds (gives candidate time to answer)
      setTimeout(() => this.askNextQuestion(), 75000);
    } catch (error) {
      console.log(`❌ Failed to ask question: ${error.message}`);
    }
  }

  async sendChatMessage(message) {
    try {
      // Open chat panel
      const chatButton = await this.page.$('[aria-label*="Chat" i], [data-testid*="chat" i]');
      if (chatButton) {
        await chatButton.click();
        await this.page.waitForTimeout(1000);
      }

      // Find and type in chat input
      const chatInput = await this.page.$('textarea[placeholder*="chat" i], [data-testid*="chat" i] textarea');
      if (chatInput) {
        await chatInput.type(message, { delay: 50 });
        await this.page.keyboard.press('Enter');
        console.log(`💬 Sent chat: ${message}`);
      } else {
        console.log("❌ Could not find chat input");
      }
    } catch (error) {
      console.log(`❌ Failed to send chat: ${error.message}`);
    }
  }

  async endInterview() {
    this.interviewActive = false;
    console.log(`🏁 Ending interview for: ${this.meetingId}`);
    
    // Send closing message
    await this.sendChatMessage("Thank you for your time! This concludes our interview. We'll be in touch soon.");
    
    // Leave meeting after 10 seconds
    setTimeout(async () => {
      await this.leaveMeeting();
    }, 10000);
  }

  async leaveMeeting() {
    try {
      console.log(`👋 Bot leaving meeting: ${this.meetingId}`);
      
      // Click leave button
      const leaveButton = await this.page.$('[aria-label*="Leave" i], [data-testid*="leave" i]');
      if (leaveButton) {
        await leaveButton.click();
      }

      await this.page.waitForTimeout(3000);

      if (this.browser) {
        await this.browser.close();
      }

      this.isInMeeting = false;
      activeBots.delete(this.meetingId);
      
      console.log(`✅ Bot left meeting: ${this.meetingId}`);
    } catch (error) {
      console.log(`❌ Error leaving meeting: ${error.message}`);
    }
  }
}

/* -------------------------
   BOT MANAGEMENT
---------------------------*/
async function startBotForMeeting(meetingId, topic = "Interview") {
  try {
    console.log(`🚀 Starting bot for meeting: ${meetingId}`);
    
    // Create and start bot
    const bot = new ZoomBot(meetingId, topic);
    activeBots.set(meetingId, bot);
    
    const joinSuccess = await bot.joinMeeting();
    
    if (joinSuccess) {
      // Start interview after 5 seconds
      setTimeout(() => bot.startInterview(), 5000);
      return { success: true, message: "Bot joined and interview started" };
    } else {
      activeBots.delete(meetingId);
      return { success: false, message: "Failed to join meeting" };
    }
  } catch (error) {
    console.log("❌ Bot startup failed:", error);
    return { success: false, message: error.message };
  }
}

/* -------------------------
   API ENDPOINTS
---------------------------*/
app.use(express.json());

// Manual Bot Join Endpoint
app.post("/bot/join", async (req, res) => {
  const { meetingId, topic } = req.body;
  
  if (!meetingId) {
    return res.status(400).json({ success: false, error: "Meeting ID required" });
  }

  try {
    const result = await startBotForMeeting(meetingId, topic || "Automated Interview");
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop Bot Endpoint
app.post("/bot/:meetingId/stop", async (req, res) => {
  const { meetingId } = req.params;
  
  try {
    if (activeBots.has(meetingId)) {
      await activeBots.get(meetingId).leaveMeeting();
      res.json({ success: true, message: "Bot stopped" });
    } else {
      res.status(404).json({ success: false, error: "Bot not found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ask Specific Question
app.post("/bot/:meetingId/ask", async (req, res) => {
  const { meetingId } = req.params;
  const { question } = req.body;
  
  try {
    if (activeBots.has(meetingId)) {
      const bot = activeBots.get(meetingId);
      await bot.sendChatMessage(question);
      await speakText(question);
      res.json({ success: true, message: "Question asked" });
    } else {
      res.status(404).json({ success: false, error: "Bot not in meeting" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Active Bots Status
app.get("/bots", (req, res) => {
  const bots = Array.from(activeBots.entries()).map(([meetingId, bot]) => ({
    meetingId,
    topic: bot.topic,
    isInMeeting: bot.isInMeeting,
    interviewActive: bot.interviewActive,
    currentQuestion: bot.currentQuestionIndex,
    totalQuestions: INTERVIEW_QUESTIONS.length
  }));
  
  res.json({
    activeBots: activeBots.size,
    bots: bots
  });
});

app.get("/", (req, res) => {
  res.json({ 
    message: "🤖 EmpowHR Zoom Bot API",
    status: "Ready for interviews!",
    version: "1.0",
    endpoints: {
      join: "POST /bot/join - { meetingId, topic }",
      stop: "POST /bot/:meetingId/stop",
      ask: "POST /bot/:meetingId/ask - { question }",
      status: "GET /bots",
      health: "GET /health"
    },
    questions: INTERVIEW_QUESTIONS.length + " preloaded"
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    activeBots: activeBots.size,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 EmpowHR Zoom Bot running on ${PORT}`);
  console.log(`📝 Preloaded ${INTERVIEW_QUESTIONS.length} interview questions`);
  console.log(`🤖 Endpoints:`);
  console.log(`   POST /bot/join - Start bot for meeting`);
  console.log(`   GET  /bots     - Check active bots`);
  console.log(`   POST /bot/:id/stop - Stop bot`);
});
