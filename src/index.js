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
  "Where do you see yourself in 5 years?",
  "Why do you want to work here?",
  "What are your salary expectations?"
];

/* -------------------------
   ZOOM BOT WITH IMPROVED SELECTORS
---------------------------*/
class ZoomBot {
  constructor(meetingId, password = '') {
    this.meetingId = meetingId;
    this.password = password;
    this.browser = null;
    this.page = null;
    this.currentQuestionIndex = 0;
    this.isInMeeting = false;
  }

  async joinMeeting() {
    try {
      console.log(`🤖 Launching bot for meeting: ${this.meetingId}`);
      
      this.browser = await chromium.launch({
        headless: false, // Set to true after testing
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=site-per-process',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      const context = await this.browser.newContext();
      // Override webdriver property
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      this.page = await context.newPage();
      
      // Use the join page directly
      const joinUrl = `https://zoom.us/wc/join/${this.meetingId}`;
      console.log(`🔗 Joining: ${joinUrl}`);
      
      await this.page.goto(joinUrl, { 
        waitUntil: 'networkidle',
        timeout: 60000 
      });

      console.log("📄 Page loaded, looking for form elements...");

      // Wait for the join form to load
      await this.page.waitForTimeout(5000);

      // Multiple selectors for display name input
      const nameSelectors = [
        'input[type="text"]',
        'input#inputname',
        'input[placeholder*="name"]',
        'input[aria-label*="name"]',
        '.preview-meeting-info input'
      ];

      let nameEntered = false;
      for (const selector of nameSelectors) {
        try {
          const nameInput = await this.page.$(selector);
          if (nameInput && await nameInput.isVisible()) {
            await nameInput.click({ clickCount: 3 }); // Select all
            await nameInput.fill('AI Interviewer Bot');
            console.log("✅ Entered display name");
            nameEntered = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!nameEntered) {
        console.log("⚠️ Could not find name input, trying to type anyway");
        await this.page.keyboard.type('AI Interviewer Bot');
      }

      // Look for join buttons
      const joinSelectors = [
        'button:has-text("Join")',
        'button.preview-join-button',
        'button[aria-label*="Join"]',
        'button[class*="join"]',
        '.preview-join-button',
        '#btnSubmit'
      ];

      let joined = false;
      for (const selector of joinSelectors) {
        try {
          const joinButton = await this.page.$(selector);
          if (joinButton && await joinButton.isVisible()) {
            console.log(`🎯 Found join button: ${selector}`);
            await joinButton.click();
            console.log("✅ Clicked join button");
            
            // Wait for meeting to load or password prompt
            await this.page.waitForTimeout(10000);
            joined = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!joined) {
        console.log("⚠️ No join button found, trying Enter key");
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(10000);
      }

      // Check if we're in the meeting or need password
      const currentUrl = this.page.url();
      console.log(`🌐 Current URL: ${currentUrl}`);

      if (currentUrl.includes('/wc/join') || currentUrl.includes('password')) {
        console.log("🔒 Password may be required or join failed");
        
        // Try password if provided
        if (this.password) {
          await this.enterPassword(this.password);
        }
      } else {
        console.log("🎉 Likely joined meeting successfully!");
        this.isInMeeting = true;
      }

      // Final check - look for meeting controls
      const meetingControls = await this.page.$('.footer-button-base');
      if (meetingControls) {
        console.log("✅ Confirmed: Bot is in the meeting!");
        this.isInMeeting = true;
        return true;
      }

      console.log("❌ May not have joined meeting successfully");
      return this.isInMeeting;

    } catch (error) {
      console.log(`❌ Bot failed to join: ${error.message}`);
      return false;
    }
  }

  async enterPassword(password) {
    try {
      console.log("🔑 Attempting to enter password...");
      
      const passwordSelectors = [
        'input[type="password"]',
        'input#inputpasscode',
        'input[placeholder*="password"]',
        'input[placeholder*="passcode"]'
      ];

      for (const selector of passwordSelectors) {
        const passwordInput = await this.page.$(selector);
        if (passwordInput) {
          await passwordInput.fill(password);
          console.log("✅ Entered password");
          
          // Submit password
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(5000);
          break;
        }
      }
    } catch (error) {
      console.log(`❌ Password entry failed: ${error.message}`);
    }
  }

  async sendChatMessage(message) {
    try {
      if (!this.isInMeeting) {
        console.log("❌ Not in meeting, cannot send chat");
        return;
      }

      // Open chat panel
      const chatButton = await this.page.$('button[aria-label*="chat"], button[aria-label*="Chat"]');
      if (chatButton) {
        await chatButton.click();
        await this.page.waitForTimeout(2000);
      }

      // Find chat input
      const chatInput = await this.page.$('textarea, [contenteditable="true"], .chat-box__chat-textarea');
      if (chatInput) {
        await chatInput.fill(message);
        await this.page.keyboard.press('Enter');
        console.log(`💬 Sent chat: ${message}`);
        return true;
      }
      
      console.log("❌ Could not find chat input");
      return false;
    } catch (error) {
      console.log(`❌ Failed to send chat: ${error.message}`);
      return false;
    }
  }

  async startInterview() {
    console.log(`🎤 Starting interview for: ${this.meetingId}`);
    
    if (!this.isInMeeting) {
      console.log("❌ Bot not in meeting, cannot start interview");
      return;
    }

    await this.page.waitForTimeout(3000);
    await this.sendChatMessage("Hello! I'm your AI Interviewer Bot. I'll be asking you some questions.");
    
    await this.page.waitForTimeout(2000);
    this.askNextQuestion();
  }

  async askNextQuestion() {
    if (this.currentQuestionIndex >= INTERVIEW_QUESTIONS.length) {
      await this.sendChatMessage("Thank you for completing the interview! Best of luck.");
      console.log("✅ Interview completed");
      return;
    }

    const question = INTERVIEW_QUESTIONS[this.currentQuestionIndex];
    const questionNumber = this.currentQuestionIndex + 1;
    
    console.log(`❓ Question ${questionNumber}: ${question}`);
    
    const fullMessage = `Question ${questionNumber}/${INTERVIEW_QUESTIONS.length}: ${question}`;
    await this.sendChatMessage(fullMessage);

    this.currentQuestionIndex++;
    
    // Wait 45 seconds for answer, then ask next question
    setTimeout(() => this.askNextQuestion(), 45000);
  }

  async leaveMeeting() {
    try {
      console.log(`👋 Bot leaving meeting: ${this.meetingId}`);
      
      // Try to leave meeting properly
      const leaveButton = await this.page.$('button[aria-label*="leave"], button[aria-label*="end"]');
      if (leaveButton) {
        await leaveButton.click();
        await this.page.waitForTimeout(2000);
        
        // Confirm leave if needed
        const confirmButton = await this.page.$('button:has-text("Leave"), button:has-text("End")');
        if (confirmButton) {
          await confirmButton.click();
        }
      }
      
      if (this.browser) {
        await this.browser.close();
      }
      activeBots.delete(this.meetingId);
      console.log("✅ Bot successfully left meeting");
    } catch (error) {
      console.log(`❌ Error leaving: ${error.message}`);
    }
  }
}

/* -------------------------
   API ENDPOINTS
---------------------------*/
app.use(express.json());

// Health check for Railway
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    activeBots: activeBots.size,
    message: "Zoom Interview Bot is running"
  });
});

app.post("/bot/join", async (req, res) => {
  const { meetingId, password } = req.body;
  
  if (!meetingId) {
    return res.status(400).json({ error: "Meeting ID required" });
  }

  // Check if bot already exists for this meeting
  if (activeBots.has(meetingId)) {
    return res.status(400).json({ error: "Bot already active for this meeting" });
  }

  try {
    console.log(`🚀 Creating bot for meeting: ${meetingId}`);
    const bot = new ZoomBot(meetingId, password);
    activeBots.set(meetingId, bot);
    
    const success = await bot.joinMeeting();
    
    if (success) {
      // Start interview after 10 seconds
      setTimeout(() => bot.startInterview(), 10000);
      res.json({ 
        success: true, 
        message: "Bot joined successfully, starting interview in 10 seconds",
        meetingId: meetingId
      });
    } else {
      activeBots.delete(meetingId);
      res.json({ 
        success: false, 
        message: "Bot failed to join meeting. Check meeting ID and try again." 
      });
    }
  } catch (error) {
    activeBots.delete(meetingId);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/bots", (req, res) => {
  res.json({
    activeBots: activeBots.size,
    meetings: Array.from(activeBots.keys())
  });
});

app.post("/bot/leave", async (req, res) => {
  const { meetingId } = req.body;
  
  if (!meetingId) {
    return res.status(400).json({ error: "Meeting ID required" });
  }

  const bot = activeBots.get(meetingId);
  if (!bot) {
    return res.status(404).json({ error: "No active bot for this meeting" });
  }

  try {
    await bot.leaveMeeting();
    res.json({ success: true, message: "Bot left meeting" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({ 
    message: "Zoom Interview Bot API",
    status: "Running 🚀",
    endpoints: {
      join: "POST /bot/join { meetingId, password? }",
      leave: "POST /bot/leave { meetingId }",
      status: "GET /bots",
      health: "GET /health"
    },
    example: {
      join: {
        meetingId: "12345678901",
        password: "optional_password"
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Zoom Bot Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
