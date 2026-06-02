document.addEventListener('DOMContentLoaded', () => {
    
    // --- Elements: Inputs ---
    const dropZone = document.getElementById('dropZone');
    const imageUpload = document.getElementById('imageUpload');
    const uploadContent = document.querySelector('.upload-content');
    
    const generateBtn = document.getElementById('generateBtn');
    const userInput = document.getElementById('userInput');
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
    let lastPayloadStr = null; // Used for Token Caching
    let generatedData = {}; // Stores raw markdown output from each API

    // --- Image Upload Logic ---
    const imagePreviewList = document.getElementById('imagePreviewList');
    const uploadInfo = document.getElementById('uploadInfo');
    const MAX_FILES = 10;
    const MAX_FILE_SIZE_MB = 5;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    let imageFiles = [];

    dropZone.addEventListener('click', () => {
        imageUpload.click();
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
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    });

    imageUpload.addEventListener('change', function() {
        if (this.files && this.files.length) {
            handleFiles(Array.from(this.files));
        }
    });

    function handleFiles(files) {
        const selectedImages = files.filter(file => file.type.startsWith('image/'));
        if (!selectedImages.length) {
            alert('이미지 파일만 업로드할 수 있습니다.');
            return;
        }

        if (imageFiles.length + selectedImages.length > MAX_FILES) {
            alert(`최대 ${MAX_FILES}개의 이미지만 업로드할 수 있습니다.`);
            return;
        }

        const oversized = selectedImages.filter(file => file.size > MAX_FILE_SIZE_BYTES);
        if (oversized.length) {
            alert(`각 파일의 최대 용량은 ${MAX_FILE_SIZE_MB}MB입니다.`);
            return;
        }

        const readPromises = selectedImages.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const fullBase64 = e.target.result;
                resolve({
                    name: file.name,
                    size: file.size,
                    previewUrl: fullBase64,
                    base64: fullBase64.split(',')[1]
                });
            };
            reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
            reader.readAsDataURL(file);
        }));

        Promise.all(readPromises)
            .then(results => {
                imageFiles = imageFiles.concat(results);
                renderPreviews();
                imageUpload.value = '';
            })
            .catch(error => {
                console.error(error);
                alert('이미지 업로드 중 오류가 발생했습니다.');
            });
    }

    function renderPreviews() {
        imagePreviewList.innerHTML = '';
        if (!imageFiles.length) {
            uploadContent.style.display = 'flex';
            uploadInfo.textContent = `최대 ${MAX_FILES}개 이미지, 개별 파일 최대 ${MAX_FILE_SIZE_MB}MB.`;
            return;
        }

        uploadContent.style.display = 'none';
        uploadInfo.textContent = `${imageFiles.length}/${MAX_FILES}개 업로드됨 · 각 파일 최대 ${MAX_FILE_SIZE_MB}MB`;

        imageFiles.forEach((item, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'preview-thumb';
            thumb.innerHTML = `
                <img src="${item.previewUrl}" alt="${item.name}">
                <div class="preview-meta">
                    <span>${item.name}</span>
                    <button type="button" class="preview-remove-btn" data-index="${index}" aria-label="Remove image">×</button>
                </div>
            `;
            imagePreviewList.appendChild(thumb);
        });

        imagePreviewList.querySelectorAll('.preview-remove-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.index);
                imageFiles.splice(idx, 1);
                renderPreviews();
            });
        });
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
        const format = formatSelect.value;
        const language = languageSelect.value;

        if (!text && !imageFiles.length) {
            alert('Please provide keywords or an image.');
            return;
        }

        const currentPayload = {
            userInput: text,
            format: format,
            language: language,
            imageData: imageFiles.length ? imageFiles.map(item => item.base64) : null
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
        documentPreview.innerHTML = '';
        
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
        const originalText = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';

        const textContent = documentPreview.innerText.trim();
        if (!textContent) {
            alert('No content to export. Please select an outline first.');
            downloadPdfBtn.innerHTML = originalText;
            return;
        }

        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 40;
        const maxWidth = pageWidth - margin * 2;

        doc.setFont('Helvetica');
        doc.setFontSize(11);
        const splitText = doc.splitTextToSize(textContent, maxWidth);
        doc.text(splitText, margin, margin);
        doc.save(`Paper_Outline_${new Date().getTime()}.pdf`);

        downloadPdfBtn.innerHTML = originalText;
    });

});
