import "dotenv/config";
import express from "express";
import { Client, middleware, MiddlewareConfig } from "@line/bot-sdk";
import axios from "axios";
import fs from "fs";
import path from "path";
import * as speech from "@google-cloud/speech";

const app = express();
const PORT = process.env.PORT || 3000;

const config: MiddlewareConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN!,
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
};

const client = new Client(config);
const speechClient = new speech.SpeechClient();

app.use(middleware(config));

app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === "message" && event.message.type === "audio") {
      await handleAudioMessage(event);
    }
  }
  res.sendStatus(200);
});

async function handleAudioMessage(event: any) {
  const messageId = event.message.id;
  const audioBuffer = await getAudioFromLINE(messageId);
  const audioPath = path.join("/tmp", "audio.ogg");
  fs.writeFileSync(audioPath, audioBuffer);

  const transcript = await transcribeAudio(audioPath);

  await client.replyMessage(event.replyToken, {
    type: "text",
    text: transcript || "ขออภัย ไม่สามารถแปลงข้อความได้",
  });
}

async function getAudioFromLINE(messageId: string): Promise<Buffer> {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
}

async function transcribeAudio(filePath: string): Promise<string> {
  const audio = { content: fs.readFileSync(filePath).toString("base64") };
  const request = {
    audio: audio,
    config: {
      encoding: "OGG_OPUS",
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
