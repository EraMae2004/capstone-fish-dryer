document.addEventListener("DOMContentLoaded", function () {

    // PASSWORD TOGGLE
    document.querySelectorAll(".password-wrapper").forEach(wrapper => {

        const input = wrapper.querySelector("input");
        const icon = wrapper.querySelector(".toggle-password");

        icon.addEventListener("click", function () {

            if (input.type === "password") {
                input.type = "text";
                icon.classList.replace("fa-eye", "fa-eye-slash");
            } else {
                input.type = "password";
                icon.classList.replace("fa-eye-slash", "fa-eye");
            }

        });
    });

    // FORM SUBMIT
    const form = document.getElementById("resetForm");

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const formData = new FormData(form);

        fetch(form.action, {
            method: "POST",
            headers: {
                "X-CSRF-TOKEN": document.querySelector('input[name="_token"]').value,
                "Accept": "application/json"
            },
            body: formData
        })
        .then(res => res.json())
        .then(data => {

            const modal = document.getElementById("resultModal");
            const icon = document.getElementById("modalIcon");
            const message = document.getElementById("modalMessage");

            modal.style.display = "flex";
            message.textContent = data.message;

            if (data.success) {
                icon.className = "fa-solid fa-circle-check";
                icon.style.color = "#4fc3f7";

                setTimeout(() => {
                    window.location.href = "/";
                }, 2000);
            } else {
                icon.className = "fa-solid fa-circle-xmark";
                icon.style.color = "#e74c3c";

                setTimeout(() => {
                    modal.style.display = "none";
                }, 2000);
            }

        })
        .catch(err => {
            console.log(err);
        });
    });

});
