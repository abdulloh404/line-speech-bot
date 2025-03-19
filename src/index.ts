import "dotenv/config";
import express from "express";
import {
  Client,
  middleware,
  MiddlewareConfig,
  ClientConfig,
} from "@line/bot-sdk";
import axios from "axios";
import fs from "fs";
import path from "path";
import * as speech from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const app = express();
const PORT = process.env.PORT;

const config: ClientConfig & MiddlewareConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};

const client = new Client(config);
const speechClient = new speech.SpeechClient();

let paramNoArray = [
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
  "1",
];

app.get("/fetch", (req, res) => {
  let returnValue = JSON.stringify(paramNoArray, null, 2);
  res.status(200).send(returnValue);
});

// app.use(middleware(config));
app.use(express.json());

app.post("/webhook", async (req, res) => {
  console.log(
    "📥 Received Webhook Request:",
    JSON.stringify(req.body, null, 2)
  );

  const events = req.body.events;
  for (const event of events) {
    if (event.message.type === "audio") {
      try {
        console.log(`🎤 Received Audio Message: ${event.message.id}`);
        await handleAudioMessage(event);
      } catch (error) {
        console.error("Error handling audio message:", error);
      }
    }
  }
  res.sendStatus(200);
});

app.get("/command", (req, res) => {
  // get parameter from url
  let param = req.query.no;
  let returnValue = paramNoArray[Number(param) - 1];
  res.status(200).send(returnValue);
});

function detectCommands(transcript: string) {
  const commands: any[] = [];

  // 1. ตรวจจับคำสั่ง "มอเตอร์ run"
  const motorRunKeywords = [
    "เปิดมอเตอร์",
    "Motor run",
    "มอเตอร์รัน",
    "มอเตอร์ run",
    "มอเตอร์ Open",
    "มอเตอร์โอเพ่น",
    "Motor open",
    "Motor Run",
  ];
  if (motorRunKeywords.some((kw) => transcript.includes(kw))) {
    commands.push({ type: "motor", action: "run" });
  }

  // 2. ตรวจจับคำสั่ง "มอเตอร์ stop"
  const motorStopKeywords = [
    "ดับมอเตอร์",
    "Motor stop",
    "มอเตอร์สต๊อป",
    "Motor close",
    "มอเตอร์ Stop",
  ];
  if (motorStopKeywords.some((kw) => transcript.includes(kw))) {
    commands.push({ type: "motor", action: "stop" });
  }

  // 3. ตรวจจับคำสั่ง "มอเตอร์ xx เปอร์เซ็น" หรือ "มอเตอร์ xx %"
  const motorPercentRegex = /(?:มอเตอร์|Motor)\s*(\d{1,3})\s*(?:เปอร์เซ็น|%)/i;
  const percentMatch = transcript.match(motorPercentRegex);
  if (percentMatch && percentMatch[1]) {
    const percent = Number(percentMatch[1]);
    if (percent >= 1 && percent <= 100) {
      commands.push({ type: "motor", action: "percent", value: percent });
    }
  }

  // 4-9. ตรวจจับคำสั่งนำทางไปยังอาคารต่าง ๆ
  const buildingCommands: { [key: string]: string[] } = {
    building1: ["ไปชมตึก 1", "พาไปดูตึก 1"],
    building2: ["ไปชมตึก 2", "พาไปดูตึก 2"],
    building3: ["ไปชมตึก 3", "พาไปดูตึก 3"],
    building4: ["ไปชมตึก 4", "พาไปดูตึก 4"],
    headOffice: ["ไปชมตึก Head Office", "พาไปดูตึก Head Office"],
    multiPurpose: ["ไปชมตึก Multi Purpose", "พาไปดูตึก Multi Purpose"],
  };

  Object.entries(buildingCommands).forEach(([destination, keywords]) => {
    if (keywords.some((kw) => transcript.includes(kw))) {
      commands.push({ type: "navigate", destination });
    }
  });

  return commands;
}

async function handleAudioMessage(event: any) {
  const messageId = event.message.id;
  const audioBuffer = await getAudioFromLINE(messageId);
  const audioPath = path.join("/tmp", `${messageId}.ogg`);
  const wavPath = path.join("/tmp", `${messageId}.wav`);
  fs.writeFileSync(audioPath, audioBuffer);

  await convertOggToWav(audioPath, wavPath);
  const transcript = await transcribeAudio(wavPath);
  console.log("Transcription:", transcript);

  // ตรวจจับคำสั่ง
  const detectedCommands = detectCommands(transcript);
  console.log("Detected Commands:", detectedCommands);

  // ส่งข้อความตอบกลับ (หรือปรับตามที่ต้องการ)
  await client.replyMessage(event.replyToken, {
    type: "text",
    text: transcript || "ขออภัย ไม่สามารถแปลงข้อความได้",
  });

  // Toggle ค่าตามคำสั่งที่ตรวจจับได้
  detectedCommands.forEach((cmd) => {
    if (cmd.type === "motor") {
      if (cmd.action === "run") {
        // สมมุติ toggle motor run ที่ paramNoArray[0]
        paramNoArray[0] = paramNoArray[0] === "1" ? "0" : "1";
      } else if (cmd.action === "stop") {
        // สมมุติ toggle motor stop ที่ paramNoArray[1]
        paramNoArray[1] = paramNoArray[1] === "1" ? "0" : "1";
      } else if (cmd.action === "percent") {
        // บันทึกค่าเปอร์เซ็นที่ paramNoArray[2]
        paramNoArray[2] = cmd.value.toString();
      }
    } else if (cmd.type === "navigate") {
      // mapping สำหรับ toggle ค่าของ building commands
      const buildingToggleMapping: { [key: string]: number } = {
        building1: 6,
        building2: 7,
        building3: 8,
        building4: 9,
        headOffice: 10,
        multiPurpose: 11,
      };
      const index = buildingToggleMapping[cmd.destination];
      if (index !== undefined) {
        paramNoArray[index] = paramNoArray[index] === "1" ? "0" : "1";
        console.log(
          `Toggle ${cmd.destination} at index ${index}: ${paramNoArray[index]}`
        );
      }
    }
  });

  // ลบไฟล์ชั่วคราว
  fs.unlinkSync(audioPath);
  fs.unlinkSync(wavPath);
}

async function getAudioFromLINE(messageId: string): Promise<Buffer> {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
}

async function convertOggToWav(
  inputPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("wav")
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

async function transcribeAudio(filePath: string): Promise<string> {
  const audio = {
    content: fs.readFileSync(filePath).toString("base64"),
  };
  const request = {
    audio: audio,
    config: {
      encoding: "LINEAR16" as any,
      sampleRateHertz: 16000,
      languageCode: "th-TH",
    },
  };
  const [response] = await speechClient.recognize(request);
  return (
    response.results
      ?.map((result) => result.alternatives[0].transcript)
      .join("\n") || ""
  );
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
