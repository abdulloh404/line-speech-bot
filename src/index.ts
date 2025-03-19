import * as speech from "@google-cloud/speech";
import axios from "axios";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import stringSimilarity from "string-similarity";
import "dotenv/config";
import {
  Client,
  middleware,
  MiddlewareConfig,
  ClientConfig,
} from "@line/bot-sdk";

const port = process.env.PORT;
const baseUrl = process.env.BASE_URL;

const app = express();
app.use(express.json());
// app.use(middleware(config));

const config: ClientConfig & MiddlewareConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};

const client = new Client(config);
const speechClient = new speech.SpeechClient();

let paramNoArray = ["1", "1", "1", "1", "1", "1", "1", "1", "1"];

app.get("/fetch", (req, res) => {
  let returnValue = JSON.stringify(paramNoArray, null, 2);
  res.status(200).send(returnValue);
});

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

const keywordFilePath = path.join(__dirname, "json/detcted-keyword.json");
const keywordData: string[][] = JSON.parse(
  fs.readFileSync(keywordFilePath, "utf-8")
);

/**
 * ตรวจจับ keyword จาก transcript โดยจะ return index ของ keyword ที่ตรวจพบ
 * index 0: motor run, index 1: motor stop, index 2: motor percent,
 * index 3: building1, index 4: building2, index 5: building3,
 * index 6: building4, index 7: headOffice, index 8: multi-purpose
 */
export function detectKeywords(transcript: string): number[] {
  const detectedIndices: number[] = [];
  const lowerText = transcript.toLowerCase();

  // ตรวจจับ motor run (index 0)
  if (!detectedIndices.includes(0)) {
    for (const kw of keywordData[0]) {
      if (lowerText.includes(kw.toLowerCase())) {
        detectedIndices.push(0);
        break;
      }
    }
  }

  // ตรวจจับ motor stop (index 1)
  if (!detectedIndices.includes(1)) {
    for (const kw of keywordData[1]) {
      if (lowerText.includes(kw.toLowerCase())) {
        detectedIndices.push(1);
        break;
      }
    }
  }

  // ตรวจจับ motor percent (index 2)
  // ตรวจสอบว่ามีคำว่า "มอเตอร์" หรือ "motor" และตัวเลขที่ตามด้วย "%" หรือ "เปอร์เซ็น"
  if (keywordData[2].some((kw) => lowerText.includes(kw.toLowerCase()))) {
    const percentRegex = /(\d{1,3})\s*(?:%|เปอร์เซ็น)/i;
    const match = transcript.match(percentRegex);
    if (match && match[1]) {
      detectedIndices.push(2);
    }
  }

  // ตรวจจับคำสั่งที่เกี่ยวกับตึก 1-4 (index 3-6)
  const buildingIndices = [3, 4, 5, 6];
  for (const i of buildingIndices) {
    const buildingNumber = i - 2; // ตึก 1-4
    if (
      (lowerText.includes(`ตึก ${buildingNumber}`) ||
        keywordData[i].some((kw) => lowerText.includes(kw.toLowerCase()))) &&
      (lowerText.includes("ชม") || lowerText.includes("ดู"))
    ) {
      detectedIndices.push(i);
      break; // หยุดทันทีถ้าพบเพื่อป้องกันการทับซ้อน
    }
  }

  // ตรวจจับ head office (index 7)
  if (!detectedIndices.includes(7)) {
    if (
      (lowerText.includes("head office") || lowerText.includes("เฮดออฟฟิศ")) &&
      lowerText.includes("ตึก") &&
      (lowerText.includes("ชม") || lowerText.includes("ดู"))
    ) {
      detectedIndices.push(7);
    }
  }

  // ตรวจจับ multi purpose (index 8)
  if (!detectedIndices.includes(8)) {
    if (
      (lowerText.includes("อาคารอเนกประสงค์") ||
        lowerText.includes("ตึกอเนกประสงค์")) &&
      (lowerText.includes("ชม") || lowerText.includes("ดู"))
    ) {
      detectedIndices.push(8);
    }
  }

  return detectedIndices;
}

export async function handleAudioMessage(event: any) {
  const messageId = event.message.id;
  const audioBuffer = await getAudioFromLINE(messageId);
  const audioPath = path.join("/tmp", `${messageId}.ogg`);
  const wavPath = path.join("/tmp", `${messageId}.wav`);
  fs.writeFileSync(audioPath, audioBuffer);

  await convertOggToWav(audioPath, wavPath);
  const transcript = await transcribeAudio(wavPath);
  console.log("Transcription:", transcript);

  // ตรวจจับคำสั่งจาก transcript โดยใช้ detectKeywords
  const detectedIndices = detectKeywords(transcript);
  console.log("Detected Indices:", detectedIndices);

  await client
    .replyMessage(event.replyToken, {
      type: "text",
      text: transcript || "ขออภัย ไม่สามารถแปลงข้อความได้",
    })
    .then(() => {
      // Toggle ค่าใน paramNoArray ตาม index ที่ตรวจจับได้
      detectedIndices.forEach((idx) => {
        if (idx === 2) {
          // สำหรับ motor percent, จับตัวเลขแล้วเก็บที่ paramNoArray[2]
          const percentRegex = /(\d{1,3})\s*(?:%|เปอร์เซ็น)/i;
          const match = transcript.match(percentRegex);
          if (match && match[1]) {
            paramNoArray[2] = Number(match[1]).toString();
          }
        } else {
          // สำหรับคำสั่งอื่นๆ, toggle ค่า "1" เป็น "0" หรือ "0" เป็น "1"
          paramNoArray[idx] = paramNoArray[idx] === "1" ? "0" : "1";
        }
      });
    });

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

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
