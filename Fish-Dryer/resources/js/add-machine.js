document.addEventListener('DOMContentLoaded', function () {

    const modal = document.getElementById('addMachineModal');
    const openBtn = document.querySelector('.add-machine-btn');
    const closeBtn = document.getElementById('closeModal');
    const refreshBtn = document.getElementById('refreshEsp');
    const espList = document.getElementById('espList');
    const detecting = document.getElementById('detectingIndicator');

    /* ===== OPEN MODAL ===== */
    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        detectESP();
    });

    /* ===== CLOSE MODAL ===== */
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    /* ===== REFRESH BUTTON ===== */
    refreshBtn.addEventListener('click', detectESP);

    /* ===== DETECT ESP32 ===== */
    function detectESP() {

        detecting.style.display = 'block';
        espList.innerHTML = '';

        fetch('/detect-esp')
            .then(res => res.json())
            .then(data => {

                detecting.style.display = 'none';

                if (data.length === 0) {
                    espList.innerHTML = '<div class="esp-item">No Active ESP32 Found</div>';
                    return;
                }

                data.forEach(device => {
                    const div = document.createElement('div');
                    div.classList.add('esp-item');
                    div.innerHTML = `
                        <span>${device.id}</span>
                        <span class="online-dot"></span>
                    `;
                    espList.appendChild(div);
                });

            })
            .catch(err => {
                detecting.style.display = 'none';
                espList.innerHTML = '<div class="esp-item">No device available</div>';
            });
    }

});