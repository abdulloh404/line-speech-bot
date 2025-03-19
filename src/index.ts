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

app.use(express.json());

app.post("/webhook", async (req, res) => {
  console.log(
    "📥 Received Webhook Request:",
    JSON.stringify(req.body, null, 2)
  );

  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "audio") {
      try {
        console.log(`Received Audio Message: ${event.message.id}`);
        await handleAudioMessage(event);
      } catch (error) {
        console.error("Error handling audio message:", error);
      }
    }
  }
  res.sendStatus(200);
});

// app.get("/command", (req, res) => {
//   // get parameter from url
//   let param = req.query.no;
//   let returnValue = paramNoArray[Number(param) - 1];
//   res.status(200).send(returnValue);
// });

async function handleAudioMessage(event: any) {
  const messageId = event.message.id;
  const audioBuffer = await getAudioFromLINE(messageId);
  const audioPath = path.join("/tmp", `${messageId}.ogg`);
  const wavPath = path.join("/tmp", `${messageId}.wav`);
  fs.writeFileSync(audioPath, audioBuffer);

  await convertOggToWav(audioPath, wavPath);

  const transcript = await transcribeAudio(wavPath);
  console.log("Transcript:", transcript);

  // ตรวจจับคำสั่งตาม logic เก่า เก็บเป็น "0" / "1" หรือ ตัวเลข
  const paramNoArray = detectCommands(transcript);
  console.log("Detected paramNoArray:", paramNoArray);

  // ส่งค่า array กลับเป็น JSON string
  const resultJson = JSON.stringify(paramNoArray);

  await client.replyMessage(event.replyToken, {
    type: "text",
    text: resultJson,
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
      encoding: "LINEAR16" as "LINEAR16",
      sampleRateHertz: 16000,
      languageCode: "th-TH",
      alternativeLanguageCodes: ["en-US"],
      model: "default",
      useEnhanced: true,
    },
  };

  const [response] = await speechClient.recognize(request);
  return (
    response.results
      ?.map((result) => result.alternatives![0].transcript)
      .join("\n") || ""
  );
}

/**
 * ตรวจจับคำสั่งจาก transcript และส่งกลับเป็น array
 * index 0: คำสั่ง Motor run (เปิดมอเตอร์)
 * index 1: คำสั่ง Motor stop (ดับมอเตอร์)
 * index 2: Motor percentage (ตัวเลขเปอร์เซ็นต์)
 * index 3: Building 1 (ไปชมตึก1)
 * index 4: Building 2 (ไปชมตึก2)
 * index 5: Building 3 (ไปชมตึก3)
 * index 6: Building 4 (ไปชมตึก4)
 * index 7: HeadOffice (ไปชมตึก HeadOffice)
 * index 8: Multi-purpose (ไปชมตึก multi-purpose)
 */
function detectCommands(transcript: string): number[] {
  // paramNoArray มี 9 ช่องเป็นตัวเลข เริ่มต้นเป็น 0
  let paramNoArray = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  // 1. Motor run
  const motorRunKeywords = [
    "เปิดมอเตอร์",
    "motor run",
    "มอเตอร์รัน",
    "มอเตอร์ run",
    "มอเตอร์ open",
    "มอเตอร์โอเพ่น",
    "motor open",
  ];
  const motorRunDetected = motorRunKeywords.some((kw) =>
    transcript.toLowerCase().includes(kw.toLowerCase())
  );
  if (motorRunDetected) {
    paramNoArray[0] = 1;
  }

  // 2. Motor stop
  const motorStopKeywords = [
    "ดับมอเตอร์",
    "motor stop",
    "มอเตอร์สต๊อป",
    "motor close",
    "มอเตอร์ stop",
  ];
  const motorStopDetected = motorStopKeywords.some((kw) =>
    transcript.toLowerCase().includes(kw.toLowerCase())
  );
  if (motorStopDetected) {
    paramNoArray[1] = 1;
  }

  // 3. Motor percentage (ดึงตัวเลข 1-100)
  // ตัวอย่างคำ: "มอเตอร์ 50 %", "motor 80 เปอร์เซ็น"
  const motorPercentRegex = /(?:มอเตอร์|motor)\s+(\d{1,3})\s*(?:เปอร์เซ็น|%)/i;
  const percentMatch = transcript.match(motorPercentRegex);
  if (percentMatch) {
    // แปลงเป็นตัวเลข เช่น "50" → 50
    const value = parseInt(percentMatch[1], 10);
    // ถ้าเกิน 100 ก็อาจกำหนดเป็น 100 หรือไม่เก็บก็ได้
    paramNoArray[2] = value > 100 ? 100 : value;
  }

  // 4. ตึก1
  const building1Keywords = ["ไปชมตึก1", "พาไปดูตึก1"];
  if (building1Keywords.some((kw) => transcript.includes(kw))) {
    paramNoArray[3] = 1;
  }

  // 5. ตึก2
  const building2Keywords = ["ไปชมตึก2", "พาไปดูตึก2"];
  if (building2Keywords.some((kw) => transcript.includes(kw))) {
    paramNoArray[4] = 1;
  }

  // 6. ตึก3
  const building3Keywords = ["ไปชมตึก3", "พาไปดูตึก3"];
  if (building3Keywords.some((kw) => transcript.includes(kw))) {
    paramNoArray[5] = 1;
  }

  // 7. ตึก4
  const building4Keywords = ["ไปชมตึก4", "พาไปดูตึก4"];
  if (building4Keywords.some((kw) => transcript.includes(kw))) {
    paramNoArray[6] = 1;
  }

  // 8. ตึก HeadOffice
  const headOfficeKeywords = ["ไปชมตึกheadoffice", "พาไปดูตึกheadoffice"];
  if (
    headOfficeKeywords.some((kw) =>
      transcript.toLowerCase().includes(kw.toLowerCase())
    )
  ) {
    paramNoArray[7] = 1;
  }

  // 9. ตึก multi-purpose
  const multiKeywords = ["ไปชมตึก multi-purpose", "พาไปดูตึกmulti-purpose"];
  if (
    multiKeywords.some((kw) =>
      transcript.toLowerCase().includes(kw.toLowerCase())
    )
  ) {
    paramNoArray[8] = 1;
  }

  return paramNoArray;
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
