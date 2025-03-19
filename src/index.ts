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

async function handleAudioMessage(event: any) {
  const messageId = event.message.id;
  const audioBuffer = await getAudioFromLINE(messageId);
  const audioPath = path.join("/tmp", `${messageId}.ogg`);
  const wavPath = path.join("/tmp", `${messageId}.wav`);
  fs.writeFileSync(audioPath, audioBuffer);

  await convertOggToWav(audioPath, wavPath);

  const transcript = await transcribeAudio(wavPath);
  console.log(transcript);

  await client
    .replyMessage(event.replyToken, {
      type: "text",
      text: transcript || "ขออภัย ไม่สามารถแปลงข้อความได้",
    })
    .then(() => {
      console.log("📤 Sent Text Response:", transcript);
      if (transcript.indexOf("เปิดไฟเมน 1") > -1) {
        paramNoArray[0] = paramNoArray[0] == "1" ? "0" : "1";
      } else if (transcript.indexOf("ดับไฟเมน 1") > -1) {
        paramNoArray[1] = paramNoArray[1] == "1" ? "0" : "1";
      } else if (transcript.indexOf("เปิดไฟเมน 2") > -1) {
        paramNoArray[2] = paramNoArray[2] == "1" ? "0" : "1";
      } else if (transcript.indexOf("ดับไฟเมน 2") > -1) {
        paramNoArray[3] = paramNoArray[3] == "1" ? "0" : "1";
      } else if (transcript.indexOf("เปิดไฟห้องคอนโทรล") > -1) {
        paramNoArray[4] = paramNoArray[4] == "1" ? "0" : "1";
      } else if (transcript.indexOf("ดับไฟห้องคอนโทรล") > -1) {
        paramNoArray[5] = paramNoArray[5] == "1" ? "0" : "1";
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
