document.addEventListener('DOMContentLoaded', function () {

    const confirmModal = document.getElementById('confirmDeleteModal');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const cancelBtn = document.getElementById('cancelDeleteBtn');
    const bulkDeleteBtn = document.querySelector('.delete-btn');
    const successModal = document.getElementById('successOverlay');
    const successText = successModal ? successModal.querySelector('h2') : null;

    let deleteType = null; // "bulk" or URL
    let deleteUrl = null;

    const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        .getAttribute('content');

    /* =============================
       BULK DELETE BUTTON
    ============================= */
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', function () {

            const selected = document.querySelectorAll('.user-checkbox:checked');

            if (selected.length === 0) return;

            deleteType = "bulk";
            confirmModal.style.display = "flex";
        });
    }

    /* =============================
       SINGLE DELETE BUTTON
    ============================= */
    document.querySelectorAll('.delete-icon-btn')
        .forEach(btn => {
            btn.addEventListener('click', function () {

                deleteType = "single";
                deleteUrl = this.closest('form').action;

                confirmModal.style.display = "flex";
            });
        });

    /* =============================
       CONFIRM DELETE
    ============================= */
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {

            confirmModal.style.display = "none";

            /* -------- BULK DELETE -------- */
            if (deleteType === "bulk") {

                const selected = document.querySelectorAll('.user-checkbox:checked');
                const ids = Array.from(selected).map(cb => cb.value);

                fetch('/api/admin/users', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': csrfToken,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ ids: ids })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showSuccess("User successfully deleted");
                    }
                })
                .catch(err => console.error(err));
            }

            /* -------- SINGLE DELETE -------- */
            if (deleteType === "single") {

                fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: {
                        'X-CSRF-TOKEN': csrfToken,
                        'Accept': 'application/json'
                    }
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showSuccess("User successfully deleted");
                    }
                })
                .catch(err => console.error(err));
            }

        });
    }

    /* =============================
       CANCEL
    ============================= */
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            confirmModal.style.display = "none";
        });
    }

    /* =============================
       SUCCESS MODAL
    ============================= */
    function showSuccess(message) {

        if (!successModal || !successText) return;

        successText.innerText = message;
        successModal.style.display = "flex";

        setTimeout(() => {
            successModal.style.display = "none";
            window.location.reload();
        }, 1500);
    }

});

/* =============================
   TOGGLE STATUS (REACTIVATE / DEACTIVATE)
============================= */

document.querySelectorAll('.toggle-btn')
    .forEach(btn => {

        btn.addEventListener('click', function () {

            const form = this.closest('.toggle-form');
            const userId = form.dataset.id;

            fetch(`/api/admin/users/${userId}/toggle-status`, {
                method: 'PATCH',
                headers: {
                    'X-CSRF-TOKEN': document
                        .querySelector('meta[name="csrf-token"]')
                        .getAttribute('content'),
                    'Accept': 'application/json'
                }
            })
            .then(res => res.json())
            .then(data => {

                if (data.success) {

                    const successModal = document.getElementById('successOverlay');
                    const successText = successModal.querySelector('h2');

                    successText.innerText = "User status updated";
                    successModal.style.display = "flex";

                    setTimeout(() => {
                        successModal.style.display = "none";
                        window.location.reload();
                    }, 1500);
                }

            })
            .catch(err => console.error("Toggle failed:", err));

        });

    });
