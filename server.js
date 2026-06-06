const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
const PORT = 3000;

// [1] Middleware and base configuration
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Auto-create required directories
['templates', 'learned_formats'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Paper format source data
const FORMAT_SOURCES = {
    "IEEE": {
        name: "IEEE Standard",
        urls: ["https://ieeeauthorcenter.ieee.org/create-your-ieee-article/create-the-text-of-your-article/"],
        fallbackGuide: "IEEE Format: Title centered 24pt bold. Sections use Roman numerals ALL CAPS: I. INTRODUCTION... References numbered [1] [2] IEEE style."
    },
    "Nature": {
        name: "Nature Portfolio",
        urls: ["https://www.nature.com/nature/for-authors/formatting-guide"],
        fallbackGuide: "Nature Format: Title concise max 90 chars. Structure Introduction Results Discussion Methods. NO numbered sections."
    },
    "ACM": {
        name: "ACM Transactions",
        urls: ["https://www.acm.org/publications/authors/submissions"],
        fallbackGuide: "ACM Format: Title bold centered. Sections numbered decimally 1. Introduction. References ACM style Author Year Title."
    },
    "ArXiv": {
        name: "ArXiv Preprint",
        urls: ["https://info.arxiv.org/help/submit/index.html"],
        fallbackGuide: "ArXiv Preprint Format: Focus on clarity and reproducibility. LaTeX preferred. No page limit."
    }
};

// URL scraping helper (includes ByteString safe encoding handling)
async function scrapeUrl(url) {
    try {
        const cleanUrl = String(url).trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
        let safeUrl;
        try {
            const parsed = new URL(cleanUrl);
            parsed.pathname = parsed.pathname.split('/').map(seg => {
                try { return encodeURIComponent(decodeURIComponent(seg)); }
                catch (e) { return encodeURIComponent(seg); }
            }).join('/');
            safeUrl = parsed.toString();
        } catch (e) { safeUrl = encodeURI(cleanUrl); }

        const { data: html } = await axios.get(safeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const $ = cheerio.load(html);
        return $('body').text().replace(/\s+/g, ' ').substring(0, 5000);
    } catch (err) {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
// API: Learn paper format
// ═══════════════════════════════════════════════════════════
app.post('/api/learn-format', async (req, res) => {
    try {
        const { formatKey } = req.body;
        const source = FORMAT_SOURCES[formatKey];
        if (!source) return res.status(400).json({ error: "Invalid formatKey." });

        let scrapedTexts = [];
        for (const url of source.urls) {
            const text = await scrapeUrl(url);
            if (text) scrapedTexts.push(text);
        }

        const guidelineText = scrapedTexts.length > 0 ? scrapedTexts.join('\n\n') : source.fallbackGuide;

        if (!openai) {
            return res.json({ success: true, learnedFormat: { error: "OpenAI API key missing, fallback used.", fallback: source.fallbackGuide } });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "Analyze the guideline and return a structured JSON format specification." },
                { role: "user", content: `Guideline for ${source.name}:\n\n${guidelineText}` }
            ],
            response_format: { type: "json_object" }
        });

        const learnedFormat = JSON.parse(response.choices[0].message.content);
        fs.writeFileSync(`./learned_formats/${formatKey}.json`, JSON.stringify(learnedFormat, null, 2));
        res.json({ success: true, learnedFormat });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Common prompt builder - always outputs in English regardless of user input language
function buildPrompt(userInput, format, _language, imageData) {
    let formatInstruction = "";
    const formatPath = `./learned_formats/${format}.json`;
    if (fs.existsSync(formatPath)) {
        const learned = JSON.parse(fs.readFileSync(formatPath, 'utf-8'));
        formatInstruction = `Follow this learned format: ${JSON.stringify(learned)}`;
    } else if (FORMAT_SOURCES[format]) {
        formatInstruction = `Follow ${FORMAT_SOURCES[format].name} format. ${FORMAT_SOURCES[format].fallbackGuide}`;
    }

    const template = {
        instruction: "Always write in English only, regardless of the language of the user input.",
        role: "You are a Document Reorganizer.",
        task: "Use only the sentences provided by the user, and do not add any new information, numbers, tables, references, experimental results, performance metrics, hardware environment, dataset details, algorithm descriptions, or analysis conclusions.",
        structure: "Organize the document according to the selected format.",
        outputFormat: "Return the output as plain academic paper text. Do NOT use markdown symbols such as #, **, -, or *. Write section headings in the academic style like 'I. INTRODUCTION', 'II. METHODS' (numbered, uppercase) and subsections as 'A. Subsection Title'. Include the full paper structure with all sections, not just the introduction.",
        imageInstruction: "If images are attached, include explicit placeholders indicating where each image should appear, such as 'Image 1 placeholder' or 'Figure 1 placeholder'. Do not invent image details beyond what is clearly provided.",
        contentHeader: "User input:",
        promptEnd: "Reorganize the content into the document format. If information is insufficient, include a complete outline skeleton with section headings and the provided sentences, without inventing missing content."
    };

    const trimmedInput = userInput ? String(userInput).trim() : "";
    let imageContext = "";
    if (imageData && imageData.length) {
        imageContext = `\n\n[Images attached]: ${imageData.length} images are included. ${template.imageInstruction}`;
    }

    const fallbackContent = 'The user has not provided any specific details. Generate a basic paper outline skeleton for the selected format. Include standard section headings like Introduction, Methods, Results, and Conclusion, without inventing specific results.';

    const systemPrompt = `${template.role}
${template.task}
${template.structure}
${template.instruction}
${template.outputFormat}

Format guidance: ${formatInstruction}`;

    return {
        systemPrompt,
        content: `${template.contentHeader}
${trimmedInput || fallbackContent}${imageContext}

${template.promptEnd}`
    };
}

// ═══════════════════════════════════════════════════════════
// API: Generate paper outline - Gemini
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gemini', async (req, res) => {
    try {
        const { userInput, format, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "Gemini API key is not configured.", result: "API Key Not Provided" });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, null, imageData);

        const parts = [{ text: `${systemPrompt}\n\n${content}` }];
        if (imageData && Array.isArray(imageData)) {
            imageData.forEach(base64 => {
                parts.push({
                    inlineData: {
                        mimeType: "image/png",
                        data: base64
                    }
                });
            });
        }

        const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        const resultText = response.data.candidates[0].content.parts[0].text;

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[Gemini Error]', error.response?.data || error.message);
        res.status(500).json({ success: false, error: "An error occurred while calling the Gemini API.", detail: error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// API: Generate paper outline - GPT
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gpt', async (req, res) => {
    try {
        const { userInput, format, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.json({
                success: false,
                result: "OpenAI (GPT) connection is not configured. Integration pending. (Currently Gemini only)"
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, null, imageData);

        // OpenAI chat completions with image support
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o';
        const userContent = [{ type: 'text', text: content }];
        if (imageData && Array.isArray(imageData)) {
            imageData.forEach(base64 => {
                userContent.push({
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${base64}` }
                });
            });
        }

        const response = await openai.chat.completions.create({
            model: openaiModel,
            messages: [
                { role: "system", content: [{ type: 'text', text: systemPrompt }] },
                { role: "user", content: userContent }
            ]
        });

        const resultText = response.choices[0].message.content;

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[GPT Error]', error.response?.data || error.message);
        res.status(500).json({ success: false, error: "An error occurred while calling the GPT API.", detail: error.response?.data?.error?.message || error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// API: Generate paper outline - Claude
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/claude', async (req, res) => {
    try {
        const { userInput, format, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return res.json({
                success: false,
                result: "Claude connection is not configured. Integration pending. (Currently Gemini only)"
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, null, imageData);

        const userMessageContent = [{ type: 'text', text: content }];
        if (imageData && Array.isArray(imageData)) {
            imageData.forEach(base64 => {
                userMessageContent.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: base64
                    }
                });
            });
        }

        const messages = [{ role: "user", content: userMessageContent }];

        const claudeModel = process.env.CLAUDE_MODEL || 'claude-3.5-mini';
        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: claudeModel,
                max_tokens: 4096,
                system: systemPrompt,
                messages
            },
            {
                headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            }
        );

        const resultText = response.data.content[0].text;

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[Claude Error]', error.response?.data || error.message);
        res.status(500).json({ success: false, error: "An error occurred while calling the Claude API.", detail: error.message });
    }
});

app.use(express.static('public'));

app.listen(PORT);
