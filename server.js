const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
const PORT = 3000;

// [1] 미들웨어 및 기본 설정
app.use(cors()); 
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// 필수 폴더 자동 생성
['templates', 'learned_formats'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// 논문 형식 소스 데이터
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
                catch(e) { return encodeURIComponent(seg); }
            }).join('/');
            safeUrl = parsed.toString();
        } catch(e) { safeUrl = encodeURI(cleanUrl); }

        const { data: html } = await axios.get(safeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const $ = cheerio.load(html);
        return $('body').text().replace(/\s+/g, ' ').substring(0, 5000);
    } catch(err) {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
// API: 논문 형식 학습 로직 (기존 유지)
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
    } catch(error) { res.status(500).json({ success: false, error: error.message }); }
});

// 공통 프롬프트 생성기
function buildPrompt(userInput, format, language, imageData) {
    let formatInstruction = "";
    const formatPath = `./learned_formats/${format}.json`;
    if (fs.existsSync(formatPath)) {
        const learned = JSON.parse(fs.readFileSync(formatPath, 'utf-8'));
        formatInstruction = `Follow this learned format: ${JSON.stringify(learned)}`;
    } else if (FORMAT_SOURCES[format]) {
        formatInstruction = `Follow ${FORMAT_SOURCES[format].name} format. ${FORMAT_SOURCES[format].fallbackGuide}`;
    }

    const langTemplates = {
        "ko-KR": {
            instruction: "한국어로 작성하세요.",
            role: "당신은 문서 재배치기(Document Reorganizer)입니다.",
            task: "사용자가 제공한 문장만 사용하고, 새로운 정보, 숫자, 표, 참고문헌, 실험 결과, 성능 지표, 하드웨어 환경, 데이터셋 정보, 알고리즘 설명, 분석 결과를 추가하지 마십시오.",
            structure: "선택된 포맷에 맞춰 논문 개요를 구성하십시오.",
            outputFormat: "결과를 마크다운 형식으로 출력하고, 도입부만이 아니라 전체 섹션 구조를 포함하십시오.",
            imageInstruction: "이미지가 첨부된 경우, 이미지가 들어갈 위치를 명확하게 지정하는 자리 표시자를 포함하십시오. 실제 이미지 내용을 추측하지 말고 'Image 1 placeholder' 또는 'Figure 1 placeholder' 형태로 지정하십시오.",
            contentHeader: "사용자 입력:",
            promptEnd: "위 내용을 바탕으로 문서 형식에 맞게 재배치하십시오. 정보가 부족하면 기본 섹션 제목을 포함한 개요를 생성하되, 제공되지 않은 내용을 새로 작성하지 마십시오."
        },
        "en-US": {
            instruction: "Write in English.",
            role: "You are a Document Reorganizer.",
            task: "Use only the sentences provided by the user, and do not add any new information, numbers, tables, references, experimental results, performance metrics, hardware environment, dataset details, algorithm descriptions, or analysis conclusions.",
            structure: "Organize the document according to the selected format.",
            outputFormat: "Return the outline in markdown format with clear headings, and include the full paper structure rather than only an introduction.",
            imageInstruction: "If images are attached, include explicit placeholders indicating where each image should appear, such as 'Image 1 placeholder' or 'Figure 1 placeholder'. Do not invent image details beyond what is clearly provided.",
            contentHeader: "User input:",
            promptEnd: "Reorganize the content into the document format. If information is insufficient, include a complete outline skeleton with section headings and the provided sentences, without inventing missing content."
        }
    };

    const langTemplate = langTemplates[language] || langTemplates["en-US"];
    const trimmedInput = userInput ? String(userInput).trim() : "";
    let imageContext = "";
    if (imageData && imageData.length) {
        imageContext = `\n\n[Images attached]: ${imageData.length} images are included. ${langTemplate.imageInstruction}`;
    }

    const fallbackContent = language === 'ko-KR'
        ? '사용자가 세부 내용을 제공하지 않았습니다. 선택된 형식에 맞는 기본 논문 개요 골격을 생성하십시오. 도입, 방법, 결과, 결론 등 기본 섹션 제목을 포함하고 구체적 연구 결과는 추가하지 마십시오.'
        : 'The user has not provided any specific details. Generate a basic paper outline skeleton for the selected format. Include standard section headings like Introduction, Methods, Results, and Conclusion, without inventing specific results.';

    const systemPrompt = `${langTemplate.role}
${langTemplate.task}
${langTemplate.structure}
${langTemplate.instruction}
${langTemplate.outputFormat}

Format guidance: ${formatInstruction}`;

    return {
        systemPrompt,
        content: `${langTemplate.contentHeader}
${trimmedInput || fallbackContent}${imageContext}

${langTemplate.promptEnd}`
    };
}

// ═══════════════════════════════════════════════════════════
// API: 논문 생성 - Gemini
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gemini', async (req, res) => {
    try {
        const { userInput, format, language, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "Gemini API key is not configured.", result: "API Key Not Provided" });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, language, imageData);

        const parts = [{ text: `${systemPrompt}\n\n${content}` }];
        if (imageData && Array.isArray(imageData)) {
            imageData.forEach(base64 => {
                parts.push({
                    image: {
                        image_url: {
                            url: `data:image/png;base64,${base64}`
                        }
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
// API: 논문 생성 - GPT
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gpt', async (req, res) => {
    try {
        const { userInput, format, language, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.json({ 
                success: false, 
                result: "OpenAI (GPT) connection is not configured. Integration pending. (Currently Gemini only)" 
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, language, imageData);

        // OpenAI chat completions expects plain text content for each message.
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o';
        const response = await openai.chat.completions.create({
            model: openaiModel,
            messages: [
                { role: "system", content: [{ type: 'text', text: systemPrompt }] },
                { role: "user", content: [{ type: 'text', text: content }] }
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
// API: 논문 생성 - Claude
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/claude', async (req, res) => {
    try {
        const { userInput, format, language, imageData } = req.body;
        if ((!userInput || !String(userInput).trim()) && (!imageData || !imageData.length)) {
            return res.status(400).json({ error: "Text input or image required." });
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            return res.json({ 
                success: false, 
                result: "Claude connection is not configured. Integration pending. (Currently Gemini only)" 
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, format, language, imageData);

        const messages = [{ role: "user", content }];
        if (imageData && Array.isArray(imageData)) {
            imageData.forEach(base64 => {
                messages.push({
                    role: "user",
                    content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }]
                });
            });
        }

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
