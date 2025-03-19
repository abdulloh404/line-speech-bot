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
const PORT = process.env.PORT || 8806;

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
    if (event.message.type === "audio") {
      try {
        console.log(`🎤 Received Audio Message: ${event.message.id}`);
        await handleAudioMessage(event);
      } catch (error) {
        console.error("❌ Error handling audio message:", error);
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

  // ตรวจจับคำสั่งและเก็บผลลัพธ์ใน array
  const commandParams = detectCommands(transcript);
  console.log("Detected command parameters:", commandParams);

  // ส่งข้อความตอบกลับไปที่ LINE โดยแสดงค่าที่ตรวจจับได้
  await client.replyMessage(event.replyToken, {
    type: "text",
    text: `Detected commands: ${JSON.stringify(commandParams)}`,
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
function detectCommands(transcript: string): string[] {
  const params: string[] = [];

  // 1. Motor run
  const motorRunKeywords = [
    "เปิดมอเตอร์",
    "Motor run",
    "มอเตอร์รัน",
    "มอเตอร์ run",
    "มอเตอร์ Open",
    "มอเตอร์โอเพ่น",
    "Motor open",
  ];
  const motorRunDetected = motorRunKeywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[0] = motorRunDetected ? "run" : "";

  // 2. Motor stop
  const motorStopKeywords = [
    "ดับมอเตอร์",
    "Motor stop",
    "มอเตอร์สต๊อป",
    "Motor close",
    "มอเตอร์ Stop",
  ];
  const motorStopDetected = motorStopKeywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[1] = motorStopDetected ? "stop" : "";

  // 3. Motor percentage: ดึงตัวเลข 1-100 จากคำที่มี "%" หรือ "เปอร์เซ็น"
  const motorPercentageRegex =
    /(?:มอเตอร์|Motor)\s*(\d{1,3})\s*(?:เปอร์เซ็น|%)/i;
  const percentageMatch = transcript.match(motorPercentageRegex);
  params[2] = percentageMatch ? percentageMatch[1] : "";

  // 4. Building 1: "ไปชมตึก1" หรือ "พาไปดูตึก1"
  const building1Keywords = ["ไปชมตึก1", "พาไปดูตึก1"];
  const building1Detected = building1Keywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[3] = building1Detected ? "1" : "";

  // 5. Building 2
  const building2Keywords = ["ไปชมตึก2", "พาไปดูตึก2"];
  const building2Detected = building2Keywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[4] = building2Detected ? "2" : "";

  // 6. Building 3
  const building3Keywords = ["ไปชมตึก3", "พาไปดูตึก3"];
  const building3Detected = building3Keywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[5] = building3Detected ? "3" : "";

  // 7. Building 4
  const building4Keywords = ["ไปชมตึก4", "พาไปดูตึก4"];
  const building4Detected = building4Keywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[6] = building4Detected ? "4" : "";

  // 8. HeadOffice
  const headOfficeKeywords = ["ไปชมตึกHeadOffice", "พาไปดูตึกHeadOffice"];
  const headOfficeDetected = headOfficeKeywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[7] = headOfficeDetected ? "HeadOffice" : "";

  // 9. Multi-purpose
  const multiPurposeKeywords = [
    "ไปชมตึก multi-purpose",
    "พาไปดูตึกmulti-purpose",
  ];
  const multiPurposeDetected = multiPurposeKeywords.some((keyword) =>
    transcript.includes(keyword)
  );
  params[8] = multiPurposeDetected ? "multi-purpose" : "";

  return params;
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
