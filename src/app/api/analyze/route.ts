// src/app/api/analyze/route.ts

import { NextResponse } from 'next/server';
import ai from '@/lib/gemini';

export async function POST(request: Request) {
    try {
        const { emails } = await request.json();
        const emailText = emails.join('\n\n---\n\n');
        
        // --- Gemini Model Initialization ---
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Define the JSON Schema for structured output
        const schema = {
            type: "object",
            properties: {
                summary: { type: "string", description: "A brief, friendly summary of the key takeaways." },
                events: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Short title for the calendar event/task." },
                            description: { type: "string", description: "Detailed description of the task or event." },
                            date: { type: "string", description: "The date and time in YYYY-MM-DDTHH:MM:SS format, or just YYYY-MM-DD for all-day events." },
                            type: { type: "string", enum: ["event", "task"] }
                        },
                        required: ["title", "date", "type"]
                    }
                }
            },
            required: ["summary", "events"]
        };

        const prompt = `Analyze the following emails. Extract all dates, deadlines, and required actions. Format your entire response ONLY as a single JSON object that conforms to the provided schema. The 'date' field must be an ISO 8601 formatted string (e.g., "2025-12-25" or "2025-12-25T14:30:00").

EMAIL TEXT:
---
${emailText}
---`;
        
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                generationConfig: { 
                    responseMimeType: "application/json",
                    responseSchema: schema,
                },
            }
        });

        // Parse and return the structured JSON data
        return NextResponse.json(JSON.parse(result.text)); 

    } catch (error) {
        console.error('Gemini analysis failed:', error);
        return NextResponse.json({ error: 'Failed to analyze emails.' }, { status: 500 });
    }
}