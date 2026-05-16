const axios = require('axios');

async function testLocal() {
    try {
        console.log("Testing local server...");
        const response = await axios.post(
            `http://localhost:3000/api/generate/gemini`,
            {
                userInput: "Test generating something.",
                category: "Computer Science",
                format: "IEEE",
                language: "ko-KR",
                imageAnalysis: null
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log("SUCCESS:", response.data.result);
    } catch (e) {
        console.log("ERROR:", e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}

testLocal();
