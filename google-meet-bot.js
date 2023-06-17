const express = require("express");
const puppeteer = require("puppeteer");
const speech = require("@google-cloud/speech");
const fs = require("fs");
const openai = require("openai");
const googleTTS = require("google-tts-api");
const app = express();

// Configure OpenAI API client
const openaiClient = new openai.OpenAIApi({
  apiKey: "YOUR_OPENAI_API_KEY",
});

// Configure the Google Cloud Speech-to-Text client
const speechClient = new speech.SpeechClient({
  keyFilename: "PATH_TO_YOUR_SERVICE_ACCOUNT_KEY_FILE",
});

// Function to convert audio file to text using Google Cloud Speech-to-Text API
async function convertAudioToText(audioFile) {
  const audio = {
    content: fs.readFileSync(audioFile).toString("base64"),
  };

  const config = {
    encoding: "LINEAR16",
    sampleRateHertz: 16000,
    languageCode: "en-US",
  };

  const request = {
    audio: audio,
    config: config,
  };

  const [response] = await speechClient.recognize(request);
  const transcription = response.results
    .map((result) => result.alternatives[0].transcript)
    .join("\n");

  return transcription;
}

// Function to generate text using OpenAI GPT-3.5
async function generateText(prompt) {
  const gptResponse = await openaiClient.complete({
    engine: "text-davinci-003",
    prompt: prompt,
    maxTokens: 100,
    temperature: 0.7,
    topP: 1.0,
    n: 1,
    stop: "\n",
  });

  const generatedText = gptResponse.data.choices[0].text.trim();
  return generatedText;
}

// Function to generate speech from text using Google Text-to-Speech API
async function generateSpeech(text) {
  const speechFile = "speech.mp3"; // Change the filename and format as needed

  return new Promise((resolve, reject) => {
    googleTTS(text, "en", 1) // Generate speech in English
      .then((url) => {
        const file = fs.createWriteStream(speechFile);
        const response = axios.get(url, { responseType: "stream" });

        response.data.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve(speechFile);
        });

        file.on("error", (error) => {
          fs.unlink(speechFile, () => {}); // Delete the incomplete file
          reject(error);
        });
      })
      .catch((error) => {
        reject(error);
      });
  });
}

// Express route to handle entering Google Meet and processing speech
app.get("/enter-meeting", async (req, res) => {
  const meetingLink = req.query.link;

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Open the Google Meet meeting link
    await page.goto(meetingLink);

    // Wait for the page to load and show the Join button
    await page.waitForSelector(
      'div[role="button"].uArJ5e.UQuaGc.Y5sE8d.uyXBBb.xKiqt'
    );

    // Click the Join button
    await page.click('div[role="button"].uArJ5e.UQuaGc.Y5sE8d.uyXBBb.xKiqt');

    // Wait for the Google Meet to launch
    await page.waitForTimeout(5000); // Adjust the wait time as needed

    // Start speech-to-text transcription
    const audioElement = await page.$("audio");
    const audioSrc = await audioElement.evaluate((node) =>
      node.getAttribute("src")
    );
    const audioFile = "audio.webm"; // Change the filename and format as needed

    // Download the audio file
    await page.evaluate(
      (audioSrc, audioFile) => {
        const a = document.createElement("a");
        a.href = audioSrc;
        a.download = audioFile;
        a.click();
      },
      audioSrc,
      audioFile
    );

    // Wait for the audio file to be downloaded
    await page.waitForTimeout(5000); // Adjust the wait time as needed

    // Convert the audio file to text
    const transcription = await convertAudioToText(audioFile);
    console.log("Transcription:", transcription);

    // Generate text using GPT-3.5
    const generatedText = await generateText(transcription);
    console.log("Generated Text:", generatedText);

    // Generate speech from the GPT response
    const speechFile = await generateSpeech(generatedText);
    console.log("Generated Speech:", speechFile);

    // Play the generated speech in Google Meet
    const audioBuffer = fs.readFileSync(speechFile);
    const base64Data = audioBuffer.toString("base64");

    await page.evaluate((base64Data) => {
      const audioPlayer = document.createElement("audio");
      audioPlayer.src = `data:audio/mp3;base64,${base64Data}`;
      audioPlayer.play();
    }, base64Data);

    // Return the result as a JSON response
    res.json({
      transcription: transcription,
      generatedText: generatedText,
      speechFile: speechFile,
    });

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error("Error entering Google Meet:", error);
    res.status(500).json({ error: "Error entering Google Meet" });
  }
});

// Start the Express server
app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
