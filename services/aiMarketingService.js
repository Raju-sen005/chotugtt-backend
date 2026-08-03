const { GoogleGenAI } = require('@google/genai');

// Debugging ke liye check karein ki key mil rahi hai ya nahi
console.log("Checking Gemini Key:", process.env.GEMINI_API_KEY ? "Key Loaded Successfully!" : "KEY IS MISSING!");

// Explicitly pass karein
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
exports.analyzeReviewAndDraftReply = async (reviewText, rating) => {
  const prompt = `Analyze this restaurant review (Rating: ${rating}/5): "${reviewText}"
  Return ONLY a valid JSON object with keys:
  - sentiment ("Positive", "Neutral", or "Negative")
  - category (e.g., Food, Service, Ambience, Price, Hygiene)
  - severity ("Low", "Medium", "High")
  - isComplaint (boolean, true if rating <= 2 or customer is unhappy)
  - suggestedReply (a professional, polite reply from the restaurant owner)`;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  // Clean response text to avoid markdown backticks issues
  let rawText = response.text || "";
  rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

  return JSON.parse(rawText);
};

exports.generateSocialContent = async (type, details) => {
  const prompt = `Create a social media post for a restaurant. 
  Type: ${type}
  Details: ${details}
  Return ONLY a valid JSON object with keys:
  - caption (engaging marketing caption)
  - hashtags (array of strings)
  - emoji (string of relevant emojis)
  - cta (Call to Action text)
  - imagePrompt (descriptive prompt for AI image generation)`;

  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  // Clean response text to avoid markdown backticks issues
  let rawText = response.text || "";
  rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();

  return JSON.parse(rawText);
};