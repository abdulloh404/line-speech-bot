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
import stringSimilarity from "string-similarity";

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

let paramNoArray = ["1", "1", "1", "1", "1", "1", "1", "1"];

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
  const text = transcript.toLowerCase();
  const detectedIndices: number[] = [];

  // ตรวจจับ motor run (index 0)
  if (keywordData[0].some((kw) => text.includes(kw.toLowerCase()))) {
    detectedIndices.push(0);
  }

  // ตรวจจับ motor stop (index 1)
  if (keywordData[1].some((kw) => text.includes(kw.toLowerCase()))) {
    detectedIndices.push(1);
  }

  // ตรวจจับ motor percent (index 2)
  // ตรวจสอบว่ามีคำว่า "มอเตอร์" หรือ "motor" และตัวเลขที่ตามด้วย "%" หรือ "เปอร์เซ็น"
  if (keywordData[2].some((kw) => text.includes(kw.toLowerCase()))) {
    const percentRegex = /(\d{1,3})\s*(?:%|เปอร์เซ็น)/i;
    const match = transcript.match(percentRegex);
    if (match && match[1]) {
      detectedIndices.push(2);
    }
  }

  // สำหรับ building commands index 3-6
  for (let i = 3; i <= 6; i++) {
    if (keywordData[i].some((kw) => text.includes(kw.toLowerCase()))) {
      detectedIndices.push(i);
    }
  }

  const lowerText = text.toLowerCase();

  // ตรวจจับ head office (index 7)
  // target คำสำคัญสำหรับ head office: ภาษาอังกฤษและภาษาไทย
  const headOfficeTargets = ["head office", "เฮดออฟฟิศ"];
  const headOfficeScore = Math.max(
    ...headOfficeTargets.map((t) =>
      stringSimilarity.compareTwoStrings(lowerText, t.toLowerCase())
    )
  );
  if (
    headOfficeScore >= 0.8 &&
    lowerText.includes("ตึก") &&
    (lowerText.includes("ชม") || lowerText.includes("ดู"))
  ) {
    detectedIndices.push(7);
  }

  // ตรวจจับ multi purpose (index 8)
  // target สำหรับ "อาคารอเนกประสงค์"
  const multiPurposeTargets = ["อาคารอเนกประสงค์"];
  const multiPurposeScore = Math.max(
    ...multiPurposeTargets.map((t) =>
      stringSimilarity.compareTwoStrings(lowerText, t.toLowerCase())
    )
  );
  if (
    multiPurposeScore >= 0.8 &&
    lowerText.includes("อาคาร") &&
    (lowerText.includes("ชม") || lowerText.includes("ดู"))
  ) {
    detectedIndices.push(8);
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
