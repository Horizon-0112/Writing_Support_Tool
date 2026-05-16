document.addEventListener('DOMContentLoaded', () => {
    
    // --- Elements: Inputs ---
    const dropZone = document.getElementById('dropZone');
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    const uploadContent = document.querySelector('.upload-content');
    const removeImageBtn = document.getElementById('removeImageBtn');
    
    const generateBtn = document.getElementById('generateBtn');
    const userInput = document.getElementById('userInput');
    const categoryInput = document.getElementById('categoryInput');
    const formatSelect = document.getElementById('formatSelect');
    const languageSelect = document.getElementById('languageSelect');

    // --- Elements: Navigation ---
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const backToStep1Btn = document.getElementById('backToStep1Btn');
    const backToStep2Btn = document.getElementById('backToStep2Btn');
    const selectBtns = document.querySelectorAll('.select-btn');
    const documentPreview = document.getElementById('documentPreview');
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');

    // --- State & Cache ---
    let base64Image = null;
    let lastPayloadStr = null; // Used for Token Caching
    let generatedData = {}; // Stores raw markdown output from each API

    // --- Image Upload Logic ---
    dropZone.addEventListener('click', () => {
        if (!base64Image) imageUpload.click();
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--panel-border)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--panel-border)';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    imageUpload.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            handleFile(this.files[0]);
        }
    });

    removeImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        base64Image = null;
        imagePreview.src = '';
        imagePreview.style.display = 'none';
        removeImageBtn.style.display = 'none';
        uploadContent.style.display = 'flex';
        imageUpload.value = '';
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const fullBase64 = e.target.result;
            base64Image = fullBase64.split(',')[1]; 
            
            imagePreview.src = fullBase64;
            imagePreview.style.display = 'block';
            uploadContent.style.display = 'none';
            removeImageBtn.style.display = 'block';
        }
        reader.readAsDataURL(file);
    }

    // --- Navigation Functions ---
    function showStep(stepId) {
        document.querySelectorAll('.view-step').forEach(el => el.classList.remove('active'));
        document.getElementById(stepId).classList.add('active');
    }

    backToStep1Btn.addEventListener('click', () => {
        showStep('step-1');
    });

    backToStep2Btn.addEventListener('click', () => {
        showStep('step-2');
    });


    // --- Generation Logic (Step 1 -> Step 2) ---
    generateBtn.addEventListener('click', async () => {
        const text = userInput.value.trim();
        const category = categoryInput.value.trim() || 'General';
        const format = formatSelect.value;
        const language = languageSelect.value;

        if (!text && !base64Image) {
            alert('Please provide keywords or an image.');
            return;
        }

        const currentPayload = {
            userInput: text,
            category: category,
            format: format,
            language: language,
            imageAnalysis: base64Image
        };

        const currentPayloadStr = JSON.stringify(currentPayload);

        // --- TOKEN CACHING LOGIC ---
        // If the payload hasn't changed, skip API calls and just show Step 2
        if (lastPayloadStr === currentPayloadStr) {
            showStep('step-2');
            return; 
        }

        // --- NEW GENERATION ---
        lastPayloadStr = currentPayloadStr;
        generatedData = {}; // Clear old data
        
        // Go to Step 2
        showStep('step-2');

        // UI Reset
        ['gemini', 'gpt', 'claude'].forEach(ai => {
            const cardBody = document.querySelector(`#card-${ai} .card-body`);
            const selectBtn = document.querySelector(`.select-btn[data-target="${ai}"]`);
            
            selectBtn.disabled = true;
            cardBody.querySelector('.placeholder-text').style.display = 'none';
            cardBody.querySelector('.markdown-content').style.display = 'none';
            cardBody.querySelector('.loading-spinner').style.display = 'flex';
            cardBody.querySelector('.markdown-content').innerHTML = '';
        });

        // Parallel Fetch Requests
        const apis = [
            { id: 'gemini', url: '/api/generate/gemini' },
            { id: 'gpt', url: '/api/generate/gpt' },
            { id: 'claude', url: '/api/generate/claude' }
        ];

        const fetchPromises = apis.map(api => fetchAPI(api.id, api.url, currentPayload));
        await Promise.allSettled(fetchPromises);
    });

    async function fetchAPI(id, url, payload) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            const cardBody = document.querySelector(`#card-${id} .card-body`);
            cardBody.querySelector('.loading-spinner').style.display = 'none';
            const contentDiv = cardBody.querySelector('.markdown-content');
            contentDiv.style.display = 'block';

            if (data.success) {
                if (data.result.includes('연결이 현재 설정되지 않았습니다')) {
                     contentDiv.innerHTML = `<div class="info-text"><i class="fa-solid fa-circle-info"></i> ${data.result}</div>`;
                } else {
                    // Store raw markdown
                    generatedData[id] = data.result;
                    
                    // Render HTML for Step 2
                    contentDiv.innerHTML = marked.parse(data.result);
                    
                    // Enable Select Button
                    document.querySelector(`.select-btn[data-target="${id}"]`).disabled = false;
                }
            } else {
                contentDiv.innerHTML = `<div class="error-text"><i class="fa-solid fa-circle-exclamation"></i> Error: ${data.error || 'Failed to generate'}</div>`;
            }

        } catch (error) {
            console.error(`Error with ${id}:`, error);
            const cardBody = document.querySelector(`#card-${id} .card-body`);
            cardBody.querySelector('.loading-spinner').style.display = 'none';
            const contentDiv = cardBody.querySelector('.markdown-content');
            contentDiv.style.display = 'block';
            contentDiv.innerHTML = `<div class="error-text"><i class="fa-solid fa-circle-exclamation"></i> Connection error. Make sure the server is running.</div>`;
        }
    }

    // --- Select Outline Logic (Step 2 -> Step 3) ---
    selectBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const markdownText = generatedData[targetId];

            if (markdownText) {
                // Parse markdown and inject into Step 3 document preview
                documentPreview.innerHTML = marked.parse(markdownText);
                showStep('step-3');
            }
        });
    });

    // --- PDF Export Logic (Step 3) ---
    downloadPdfBtn.addEventListener('click', () => {
        // Change button text temporarily
        const originalText = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        
        const opt = {
            margin:       0.5,
            filename:     `Paper_Outline_${new Date().getTime()}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(documentPreview).save().then(() => {
            downloadPdfBtn.innerHTML = originalText;
        });
    });

});
