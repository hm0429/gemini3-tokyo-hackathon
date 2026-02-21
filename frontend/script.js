document.addEventListener('DOMContentLoaded', () => {
    const imageUpload = document.getElementById('imageUpload');
    const previewImage = document.getElementById('previewImage');
    const generateBtn = document.getElementById('generateBtn');

    const loadingIndicator = document.getElementById('loadingIndicator');
    const resultContainer = document.getElementById('resultContainer');

    const monsterSprite = document.getElementById('monsterSprite');
    const rawSpriteImg = document.getElementById('rawSpriteImg');
    const promptText = document.getElementById('promptText');

    const animStandBtn = document.getElementById('animStandBtn');
    const animWalkBtn = document.getElementById('animWalkBtn');

    let currentFile = null;

    // Load default image as a File object so it can be uploaded easily
    async function loadDefaultImage() {
        try {
            const response = await fetch('/sample.jpg');
            if (response.ok) {
                const blob = await response.blob();
                currentFile = new File([blob], 'sample.jpg', { type: blob.type });
            } else {
                console.error("Failed to load default sample.jpg");
            }
        } catch (error) {
            console.error("Error loading default image:", error);
        }
    }

    // Call it immediately
    loadDefaultImage();

    // Handle Image Upload Selection
    imageUpload.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            currentFile = e.target.files[0];
            const reader = new FileReader();

            reader.onload = (e) => {
                previewImage.src = e.target.result;
            };

            reader.readAsDataURL(currentFile);
        }
    });

    // Handle Generation
    generateBtn.addEventListener('click', async () => {
        if (!currentFile) {
            alert('Please select an image first.');
            return;
        }

        // UI Updates
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
        resultContainer.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');

        try {
            const formData = new FormData();
            formData.append('file', currentFile);

            // Fetch from the same host since frontend and backend are served together
            const response = await fetch('/generate', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Build image source
            const imgSrc = `data:image/jpeg;base64,${data.sprite_base64}`;

            // Update UI with generated content
            rawSpriteImg.src = imgSrc;
            promptText.textContent = data.prompt_used;

            // Set up sprite animation
            monsterSprite.style.backgroundImage = `url(${imgSrc})`;

            // By default, start walking
            setAnimationMode('walk');

            // Show results
            loadingIndicator.classList.add('hidden');
            resultContainer.classList.remove('hidden');

        } catch (error) {
            console.error('Generation failed:', error);
            alert(`Failed to generate monster: ${error.message}`);
            loadingIndicator.classList.add('hidden');
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Monster ✨';
        }
    });

    // Animation Controls
    function setAnimationMode(mode) {
        if (mode === 'stand') {
            monsterSprite.className = 'sprite standing';
            animStandBtn.classList.add('active');
            animWalkBtn.classList.remove('active');
        } else if (mode === 'walk') {
            monsterSprite.className = 'sprite walking';
            animWalkBtn.classList.add('active');
            animStandBtn.classList.remove('active');
        }
    }

    animStandBtn.addEventListener('click', () => setAnimationMode('stand'));
    animWalkBtn.addEventListener('click', () => setAnimationMode('walk'));
});
