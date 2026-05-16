const axios = require('axios');
require('dotenv').config();

async function testGemini() {
    try {
        console.log("Testing generation...");
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: "Hello, say 'Test successful'." }] }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log("SUCCESS:", response.data.candidates[0].content.parts[0].text);
    } catch (e) {
        console.log("ERROR:", e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}

testGemini();
