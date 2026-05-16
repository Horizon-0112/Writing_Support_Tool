const axios = require('axios');
const key = 'AIzaSyCKtF1vopG_XjPTZI5FzFt8CtgihCw7zdY';

async function listModels() {
    try {
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        console.log("AVAILABLE MODELS:");
        response.data.models.forEach(m => console.log(m.name));
    } catch (e) {
        console.log("Error:", e.response ? e.response.data : e.message);
    }
}
listModels();
