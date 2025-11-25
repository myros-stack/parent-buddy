import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize the client using the GEMINI_API_KEY environment variable
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export default ai;