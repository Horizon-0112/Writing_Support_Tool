const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');
const fs = require('fs');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
const PORT = 3000;

// [1] 미들웨어 및 기본 설정
app.use(cors()); 
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const upload = multer({ dest: 'uploads/' });

// 필수 폴더 자동 생성
['uploads', 'templates', 'learned_formats'].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// 논문 형식 소스 데이터
const FORMAT_SOURCES = {
    "IEEE": {
        name: "IEEE Standard - Computer Science",
        urls: ["https://ieeeauthorcenter.ieee.org/create-your-ieee-article/create-the-text-of-your-article/"],
        fallbackGuide: "IEEE Format: Title centered 24pt bold. Sections use Roman numerals ALL CAPS: I. INTRODUCTION... References numbered [1] [2] IEEE style."
    },
    "Nature": {
        name: "Nature Portfolio - Computer Science",
        urls: ["https://www.nature.com/nature/for-authors/formatting-guide"],
        fallbackGuide: "Nature Format: Title concise max 90 chars. Structure Introduction Results Discussion Methods. NO numbered sections."
    },
    "ACM": {
        name: "ACM Transactions - Computer Science",
        urls: ["https://www.acm.org/publications/authors/submissions"],
        fallbackGuide: "ACM Format: Title bold centered. Sections numbered decimally 1. Introduction. References ACM style Author Year Title."
    },
    "ArXiv": {
        name: "ArXiv Preprint - Computer Science",
        urls: ["https://info.arxiv.org/help/submit/index.html"],
        fallbackGuide: "ArXiv Preprint Format: Focus on clarity and reproducibility. LaTeX preferred. No page limit."
    }
};

// URL 크롤링 함수 (ByteString 에러 방지 로직 포함)
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

        console.log(`[크롤링] ${safeUrl}`);
        const { data: html } = await axios.get(safeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const $ = cheerio.load(html);
        return $('body').text().replace(/\s+/g, ' ').substring(0, 5000);
    } catch(err) {
        console.log(`[크롤링 실패] ${url}: ${err.message}`);
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
        if (!source) return res.status(400).json({ error: "유효한 formatKey가 없습니다." });

        let scrapedTexts = [];
        for (const url of source.urls) {
            const text = await scrapeUrl(url);
            if (text) scrapedTexts.push(text);
        }

        const guidelineText = scrapedTexts.length > 0 ? scrapedTexts.join('\n\n') : source.fallbackGuide;

        if (!openai) {
            return res.json({ success: true, learnedFormat: { error: "OpenAI API Key missing, fallback used.", fallback: source.fallbackGuide } });
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
function buildPrompt(userInput, category, format, language, imageAnalysis) {
    let formatInstruction = "";
    const formatPath = `./learned_formats/${format}.json`;
    if (fs.existsSync(formatPath)) {
        const learned = JSON.parse(fs.readFileSync(formatPath, 'utf-8'));
        formatInstruction = `Follow this learned format: ${JSON.stringify(learned)}`;
    } else if (FORMAT_SOURCES[format]) {
        formatInstruction = `Follow ${FORMAT_SOURCES[format].name} format. ${FORMAT_SOURCES[format].fallbackGuide}`;
    }

    const langMap = { "ko-KR": "한국어로 작성하세요.", "en-US": "Write in English." };
    const langInstruction = langMap[language] || "Write in English.";
    const imageContext = imageAnalysis ? `\n\n[이미지 분석 데이터]:\n${imageAnalysis}` : "";

    const systemPrompt = `당신은 세계적인 학술 연구 논문 작성 전문가입니다.
주제 카테고리: ${category}
형식 지침: ${formatInstruction}
언어: ${langInstruction}

연구 데이터를 바탕으로 모든 섹션(Abstract, Intro, Method, Result, Conclusion)을 상세히 포함한 완성된 논문을 Markdown 형식으로 작성하세요. 제목은 # 로 시작하고, 각 섹션은 ## 로 시작하세요.`;

    return { systemPrompt, content: `연구 데이터:\n${userInput}${imageContext}\n\n위 내용을 바탕으로 논문 초안을 작성하세요.` };
}

// ═══════════════════════════════════════════════════════════
// API: 논문 생성 - Gemini
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gemini', async (req, res) => {
    try {
        const { userInput, category, format, language, imageAnalysis } = req.body;
        if (!userInput) return res.status(400).json({ error: "입력이 필요합니다." });

        if (!process.env.GEMINI_API_KEY) {
            return res.json({ success: false, error: "API 키가 설정되지 않았습니다.", result: "API Key Not Provided" });
        }

        const { systemPrompt, content } = buildPrompt(userInput, category, format, language, imageAnalysis);
        console.log(`[Gemini 호출] 포맷: ${format}, 언어: ${language}`);

        const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: `${systemPrompt}\n\n${content}`
                    }]
                }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        const resultText = response.data.candidates[0].content.parts[0].text;
        console.log(`[Gemini 생성 완료]`);

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[Gemini 에러]', error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Gemini API 호출 중 오류가 발생했습니다.", detail: error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// API: 논문 생성 - GPT
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/gpt', async (req, res) => {
    try {
        const { userInput, category, format, language, imageAnalysis } = req.body;
        if (!userInput) return res.status(400).json({ error: "입력이 필요합니다." });

        if (!process.env.OPENAI_API_KEY) {
            // 결제가 안되어있거나 키가 없을 때는 우아하게 실패
            return res.json({ 
                success: false, 
                result: "OpenAI(GPT) 연결이 현재 설정되지 않았습니다. 차후 연동 예정입니다. (현재는 Gemini만 지원)" 
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, category, format, language, imageAnalysis);
        console.log(`[GPT 호출] 포맷: ${format}, 언어: ${language}`);

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: content }
            ]
        });

        const resultText = response.choices[0].message.content;
        console.log(`[GPT 생성 완료]`);

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[GPT 에러]', error.message);
        res.status(500).json({ success: false, error: "GPT API 호출 중 오류가 발생했습니다.", detail: error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// API: 논문 생성 - Claude
// ═══════════════════════════════════════════════════════════
app.post('/api/generate/claude', async (req, res) => {
    try {
        const { userInput, category, format, language, imageAnalysis } = req.body;
        if (!userInput) return res.status(400).json({ error: "입력이 필요합니다." });

        if (!process.env.ANTHROPIC_API_KEY) {
            // 결제가 안되어있거나 키가 없을 때는 우아하게 실패
            return res.json({ 
                success: false, 
                result: "Claude 연결이 현재 설정되지 않았습니다. 차후 연동 예정입니다. (현재는 Gemini만 지원)" 
            });
        }

        const { systemPrompt, content } = buildPrompt(userInput, category, format, language, imageAnalysis);
        console.log(`[Claude 호출] 포맷: ${format}, 언어: ${language}`);

        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 4096,
                system: systemPrompt,
                messages: [
                    { role: "user", content: content }
                ]
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
        console.log(`[Claude 생성 완료]`);

        res.json({ success: true, result: resultText });
    } catch (error) {
        console.error('[Claude 에러]', error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Claude API 호출 중 오류가 발생했습니다.", detail: error.message });
    }
});

// 이미지 분석 API (기존 유지)
app.post('/api/analyze-image', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!process.env.OPENAI_API_KEY) {
            return res.json({ success: true, analysis: "이미지 분석 기능이 일시적으로 비활성화 되었습니다. (OpenAI 키 필요)" });
        }
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "Analyze this research graph/image in detail for a research paper." },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } }
                ]
            }]
        });
        res.json({ success: true, analysis: response.choices[0].message.content });
    } catch(error) { res.status(500).json({ success: false, error: error.message }); }
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Paper Outline Generator 실행 중: http://localhost:${PORT}`);
    console.log(`  연동 모델: 개별 API로 분리 (Gemini, GPT, Claude)`);
    console.log(`========================================\n`);
});
